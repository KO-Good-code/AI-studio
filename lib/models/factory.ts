import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getModelConfig, isOllamaModel, isZhipuModel } from './types';
import { getZhipuBaseUrl, getZhipuDefaultHeaders } from './zhipuEnv';
import { getCustomModelById } from '@/lib/storage/custom-models';

export { isZhipuModel, isOllamaModel };

/** 自定义模型配置缓存（避免每次 createLLM 都读文件） */
let _customCache: Map<string, { baseUrl: string; apiKey: string; name: string; maxTokens?: number }> = new Map();
let _customCacheTs = 0;
const CACHE_TTL = 60_000;

async function resolveCustomConfig(modelId: string) {
  if (Date.now() - _customCacheTs > CACHE_TTL) {
    _customCache.clear();
    _customCacheTs = Date.now();
  }
  if (_customCache.has(modelId)) return _customCache.get(modelId)!;

  const cm = await getCustomModelById(modelId);
  if (!cm) return null;
  const entry = { baseUrl: cm.baseUrl, apiKey: cm.apiKey, name: cm.name, maxTokens: cm.maxTokens };
  _customCache.set(modelId, entry);
  return entry;
}

/**
 * 创建 LLM 实例的工厂函数
 */
export function createLLM(modelId: string, temperature: number = 0.5): BaseChatModel {
  const config = getModelConfig(modelId);
  
  if (!config) {
    throw new Error(`未知的模型: ${modelId}`);
  }

  if (isOllamaModel(modelId)) {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    return new ChatOllama({
      baseUrl: ollamaBaseUrl,
      model: config.name,
      temperature,
    });
  }

  if (isZhipuModel(modelId)) {
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey || apiKey === 'your_zhipu_api_key_here') {
      throw new Error('智谱 AI API Key 未配置，请在 .env.local 中设置 ZHIPU_API_KEY');
    }

    console.log(`🔑 使用智谱 AI 模型: ${config.name}`);

    const enableWebSearch = process.env.ZHIPU_ENABLE_WEB_SEARCH === 'true';
    if (enableWebSearch) {
      console.log('🌐 已启用智谱 AI 联网搜索功能');
    }

    const zhipuHeaders = getZhipuDefaultHeaders();
    return new ChatOpenAI({
      apiKey: apiKey,
      model: config.name,
      temperature,
      maxTokens: config.maxTokens,
      streaming: true,
      configuration: {
        baseURL: getZhipuBaseUrl(),
        ...(zhipuHeaders ? { defaultHeaders: zhipuHeaders } : {}),
      },
    }) as BaseChatModel;
  }

  if (config.provider === 'custom') {
    return createCustomLLMSync(config, temperature);
  }

  throw new Error(`不支持的模型提供商: ${config.provider}`);
}

/**
 * 异步版本：用于需要从文件读取自定义模型配置的场景
 */
export async function createLLMAsync(modelId: string, temperature: number = 0.5): Promise<BaseChatModel> {
  const config = getModelConfig(modelId);
  if (config && config.provider !== 'custom') {
    return createLLM(modelId, temperature);
  }

  const custom = await resolveCustomConfig(modelId);
  if (custom) {
    console.log(`🔗 使用自定义模型: ${custom.name} @ ${custom.baseUrl}`);
    return new ChatOpenAI({
      apiKey: custom.apiKey,
      model: custom.name,
      temperature,
      maxTokens: custom.maxTokens,
      streaming: true,
      configuration: { baseURL: custom.baseUrl },
    }) as BaseChatModel;
  }

  return createLLM(modelId, temperature);
}

function createCustomLLMSync(config: { id: string; name: string; maxTokens?: number }, temperature: number): BaseChatModel {
  const cached = _customCache.get(config.id);
  if (!cached) {
    throw new Error(`自定义模型 ${config.name} 的配置未加载，请使用 createLLMAsync`);
  }
  console.log(`🔗 使用自定义模型: ${cached.name} @ ${cached.baseUrl}`);
  return new ChatOpenAI({
    apiKey: cached.apiKey,
    model: cached.name,
    temperature,
    maxTokens: cached.maxTokens,
    streaming: true,
    configuration: { baseURL: cached.baseUrl },
  }) as BaseChatModel;
}

/**
 * 验证模型是否可用
 */
export async function validateModel(modelId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const config = getModelConfig(modelId);
    
    if (!config) {
      return { success: false, error: '未知的模型' };
    }

    if (isOllamaModel(modelId)) {
      const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const response = await fetch(`${ollamaBaseUrl}/api/tags`);
      
      if (!response.ok) {
        return { success: false, error: 'Ollama 服务未运行' };
      }
      
      const data = await response.json();
      const models = data.models || [];
      const exists = models.some((m: any) => m.name === config.name);
      
      if (!exists) {
        return { success: false, error: `模型未安装，请运行: ollama pull ${config.name}` };
      }
    }

    if (isZhipuModel(modelId)) {
      const apiKey = process.env.ZHIPU_API_KEY;
      if (!apiKey || apiKey === 'your_zhipu_api_key_here') {
        return { success: false, error: '请配置智谱 AI API Key' };
      }
    }

    if (config.provider === 'custom') {
      const custom = await resolveCustomConfig(modelId);
      if (!custom) return { success: false, error: '自定义模型配置已删除' };
      if (!custom.apiKey) return { success: false, error: 'API Key 未配置' };
      if (!custom.baseUrl) return { success: false, error: 'Base URL 未配置' };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
