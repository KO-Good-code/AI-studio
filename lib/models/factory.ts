import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getModelConfig, isOllamaModel, isZhipuModel } from './types';
import { getZhipuBaseUrl, getZhipuDefaultHeaders } from './zhipuEnv';

export { isZhipuModel, isOllamaModel };

/**
 * 创建 LLM 实例的工厂函数
 */
export function createLLM(modelId: string, temperature: number = 0.5): BaseChatModel {
  const config = getModelConfig(modelId);
  
  if (!config) {
    throw new Error(`未知的模型: ${modelId}`);
  }

  // Ollama 本地模型
  if (isOllamaModel(modelId)) {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    
    return new ChatOllama({
      baseUrl: ollamaBaseUrl,
      model: config.name,
      temperature,
    });
  }

  // 智谱 AI 模型
  if (isZhipuModel(modelId)) {
    const apiKey = process.env.ZHIPU_API_KEY;
    
    if (!apiKey || apiKey === 'your_zhipu_api_key_here') {
      throw new Error('智谱 AI API Key 未配置，请在 .env.local 中设置 ZHIPU_API_KEY');
    }

    console.log(`🔑 使用智谱 AI 模型: ${config.name}`);

    // ✨ 启用联网搜索功能
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

  throw new Error(`不支持的模型提供商: ${config.provider}`);
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

    // 验证 Ollama 模型
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

    // 验证智谱 AI 模型
    if (isZhipuModel(modelId)) {
      const apiKey = process.env.ZHIPU_API_KEY;
      
      if (!apiKey || apiKey === 'your_zhipu_api_key_here') {
        return { success: false, error: '请配置智谱 AI API Key' };
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
