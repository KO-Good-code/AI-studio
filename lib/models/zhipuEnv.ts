/**
 * 智谱 OpenAI 兼容 API 环境：国内默认 open.bigmodel.cn，海外可设为 api.z.ai。
 */

const DEFAULT_BASE = 'https://open.bigmodel.cn/api/paas/v4/';

/** 海外示例：https://api.z.ai/api/paas/v4/ */
export function getZhipuBaseUrl(): string {
  const raw = process.env.ZHIPU_BASE_URL?.trim();
  if (!raw) return DEFAULT_BASE;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * 海外 curl 常带 Accept-Language；不设则不加该头。
 * 示例：ZHIPU_ACCEPT_LANGUAGE=en-US,en
 */
export function getZhipuDefaultHeaders(): Record<string, string> | undefined {
  const lang = process.env.ZHIPU_ACCEPT_LANGUAGE?.trim();
  if (!lang) return undefined;
  return { 'Accept-Language': lang };
}

export function getZhipuChatCompletionsUrl(): string {
  return new URL('chat/completions', getZhipuBaseUrl()).toString();
}
