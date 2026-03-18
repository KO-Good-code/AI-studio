/**
 * 模型提供商和配置
 */

export type ModelProvider = 'ollama' | 'zhipu';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  displayName: string;
  description?: string;
  maxTokens?: number;
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  // Ollama 本地模型
  {
    id: 'llama3.2',
    name: 'llama3.2',
    provider: 'ollama',
    displayName: '🦙 Llama 3.2 (本地)',
    description: 'Meta 出品，3B 参数，速度快',
  },
  {
    id: 'qwen2.5:7b',
    name: 'qwen2.5:7b',
    provider: 'ollama',
    displayName: '🇨🇳 Qwen 2.5 7B (本地)',
    description: '阿里出品，7B 参数，中文优秀',
  },
  
  // 智谱 AI 模型
  {
    id: 'glm-4.7-flash',
    name: 'glm-4.7-flash',
    provider: 'zhipu',
    displayName: '⚡ GLM-4.7-Flash (智谱 AI)',
    description: '智谱 AI，速度快、性价比高',
    maxTokens: 128000,
  },
  {
    id: 'glm-4.7-plus',
    name: 'glm-4.7-plus',
    provider: 'zhipu',
    displayName: '🚀 GLM-4.7-Plus (智谱 AI)',
    description: '智谱 AI 旗舰模型，综合性能强',
    maxTokens: 128000,
  },
];

/**
 * 根据 ID 获取模型配置
 * 如果是动态 Ollama 模型（不在预定义列表中），返回基本配置
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  const predefined = AVAILABLE_MODELS.find((m) => m.id === modelId);
  
  if (predefined) {
    return predefined;
  }
  
  // 如果不在预定义列表中，假设它是 Ollama 模型
  // 为动态发现的 Ollama 模型创建基本配置
  return {
    id: modelId,
    name: modelId,
    provider: 'ollama',
    displayName: `🦙 ${modelId} (本地)`,
    description: '本地 Ollama 模型',
  };
}

/**
 * 检查是否为 Ollama 模型
 */
export function isOllamaModel(modelId: string): boolean {
  const config = getModelConfig(modelId);
  return config?.provider === 'ollama';
}

/**
 * 检查是否为智谱 AI 模型
 */
export function isZhipuModel(modelId: string): boolean {
  const config = getModelConfig(modelId);
  return config?.provider === 'zhipu';
}
