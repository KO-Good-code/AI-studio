/**
 * 模型提供商和配置
 *
 * 智谱文本对话模型 ID 与官方「模型概览」对齐：
 * https://docs.bigmodel.cn/cn/guide/start/model-overview
 * （仅收录适用于对话补全 /chat/completions 的文本模型；图像/视频/向量等请走对应 API）
 */

export type ModelProvider = 'ollama' | 'zhipu';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  displayName: string;
  description?: string;
  /** 传给 ChatOpenAI 的 maxTokens 上限（与官方「最大输出 Tokens」对齐或取合理上限） */
  maxTokens?: number;
}

/** 智谱：当前开放平台「文本模型」列表（2026-01 文档） */
const ZHIPU_TEXT_MODELS: ModelConfig[] = [
  {
    id: 'glm-5',
    name: 'glm-5',
    provider: 'zhipu',
    displayName: '🌟 GLM-5（旗舰）',
    description: '最新旗舰基座，Agent / 编程 / 长程任务',
    maxTokens: 131_072,
  },
  {
    id: 'glm-5-turbo',
    name: 'glm-5-turbo',
    provider: 'zhipu',
    displayName: '🔧 GLM-5-Turbo',
    description: '面向 OpenClaw 等长链路 Agent 场景优化',
    maxTokens: 131_072,
  },
  {
    id: 'glm-4.7',
    name: 'glm-4.7',
    provider: 'zhipu',
    displayName: '🚀 GLM-4.7',
    description: '高智能旗舰，编码与工具调用强化',
    maxTokens: 131_072,
  },
  /** 兼容旧版下拉选项：API 模型名已统一为 glm-4.7 */
  {
    id: 'glm-4.7-plus',
    name: 'glm-4.7',
    provider: 'zhipu',
    displayName: '🚀 GLM-4.7（原 Plus）',
    description: '与 glm-4.7 相同，保留旧 id 以免本地已选模型失效',
    maxTokens: 131_072,
  },
  {
    id: 'glm-4.7-flash',
    name: 'glm-4.7-flash',
    provider: 'zhipu',
    displayName: '⚡ GLM-4.7-Flash',
    description: '轻量高速，通用中文与长文本等场景',
    maxTokens: 131_072,
  },
  {
    id: 'glm-4.6',
    name: 'glm-4.6',
    provider: 'zhipu',
    displayName: '💎 GLM-4.6',
    description: '200K 上下文，编码与推理增强',
    maxTokens: 131_072,
  },
  {
    id: 'glm-4.5-air',
    name: 'glm-4.5-air',
    provider: 'zhipu',
    displayName: '💨 GLM-4.5-Air',
    description: '高性价比，推理 / 编码 / 智能体',
    maxTokens: 98_304,
  },
  {
    id: 'glm-4.5-airx',
    name: 'glm-4.5-airx',
    provider: 'zhipu',
    displayName: '⚡ GLM-4.5-AirX',
    description: 'Air 极速版，低延迟',
    maxTokens: 98_304,
  },
  {
    id: 'glm-4-long',
    name: 'glm-4-long',
    provider: 'zhipu',
    displayName: '📄 GLM-4-Long',
    description: '1M 上下文，超长输入（单次输出上限 4K）',
    maxTokens: 4096,
  },
  {
    id: 'glm-4-flashx-250414',
    name: 'glm-4-flashx-250414',
    provider: 'zhipu',
    displayName: '🔥 GLM-4-FlashX-250414',
    description: 'Flash 增强版，高并发',
    maxTokens: 16_384,
  },
  {
    id: 'glm-4.7-flash',
    name: 'glm-4.7-flash',
    provider: 'zhipu',
    displayName: '🆓 GLM-4.7-Flash',
    description: '免费档，普惠高速',
    maxTokens: 131_072,
  },
  {
    id: 'glm-4.5-flash',
    name: 'glm-4.5-flash',
    provider: 'zhipu',
    displayName: '🆓 GLM-4.5-Flash',
    description: '免费档（文档标注即将下线，请留意迁移）',
    maxTokens: 98_304,
  },
  {
    id: 'glm-4-flash-250414',
    name: 'glm-4-flash-250414',
    provider: 'zhipu',
    displayName: '🆓 GLM-4-Flash-250414',
    description: '免费档，128K 上下文',
    maxTokens: 16_384,
  },
];

export const AVAILABLE_MODELS: ModelConfig[] = [
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
  ...ZHIPU_TEXT_MODELS,
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
