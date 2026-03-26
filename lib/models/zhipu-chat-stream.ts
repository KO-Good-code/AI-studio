import type { BaseMessage } from '@langchain/core/messages';
import { convertMessagesToCompletionsMessageParams } from '@langchain/openai';
import { getModelConfig } from './types';
import { getZhipuChatCompletionsUrl, getZhipuDefaultHeaders } from './zhipuEnv';

/** 智谱等接口在流式 delta 里可能返回 string 或 content part 数组 */
export function extractOpenAiDeltaText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && item !== null && 'text' in item) {
          const t = (item as { text?: unknown }).text;
          return t != null ? String(t) : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 工具执行后的「续写」若走 LangChain ChatOpenAI.stream，智谱常返回非 string 的 delta.content，
 * @langchain/openai completions 路径会丢弃这些 chunk，表现为流式始终无正文。
 * 此处用 HTTP SSE 直连并解析 string | 数组 content。
 */
export async function* streamZhipuChatCompletion(
  modelId: string,
  temperature: number,
  messages: BaseMessage[]
): AsyncGenerator<string, void, unknown> {
  const config = getModelConfig(modelId);
  if (!config || config.provider !== 'zhipu') {
    throw new Error(`streamZhipuChatCompletion 仅用于智谱模型: ${modelId}`);
  }

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey || apiKey === 'your_zhipu_api_key_here') {
    throw new Error('ZHIPU_API_KEY 未配置');
  }

  const openaiMessages = convertMessagesToCompletionsMessageParams({
    messages,
    model: config.name,
  });

  const maxOut = config.maxTokens
    ? Math.min(config.maxTokens, 8192)
    : 4096;

  const extra = getZhipuDefaultHeaders();
  const res = await fetch(getZhipuChatCompletionsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extra,
    },
    body: JSON.stringify({
      model: config.name,
      messages: openaiMessages,
      temperature,
      max_tokens: maxOut,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`智谱流式请求失败 ${res.status}: ${errBody.slice(0, 500)}`);
  }

  if (!res.body) {
    throw new Error('智谱流式响应无 body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown } }>;
        };
        const raw = json.choices?.[0]?.delta?.content;
        const text = extractOpenAiDeltaText(raw);
        if (text) yield text;
      } catch {
        // 忽略非 JSON 行
      }
    }
  }
}
