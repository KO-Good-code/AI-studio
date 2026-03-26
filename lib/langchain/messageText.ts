/**
 * LangChain 消息 / 流式 chunk 正文提取（ChatOpenAI、Ollama 等）
 */

export function messageContentToText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === 'string') return c;
        const block = c as { text?: unknown; type?: string };
        if (block?.text != null) return String(block.text);
        if (block?.type === 'text' && block.text != null) return String(block.text);
        return '';
      })
      .join('');
  }
  return String(content);
}

/** 流式迭代器 yield 的 chunk（AIMessageChunk / ChatGenerationChunk / Ollama 等） */
export function streamChunkToText(chunk: unknown): string {
  if (chunk == null) return '';
  const c = chunk as Record<string, unknown>;
  if (typeof c.text === 'string' && c.text) return c.text;

  const gens = c.generations as unknown[] | undefined;
  if (Array.isArray(gens) && gens.length > 0) {
    const g0 = gens[0] as Record<string, unknown>;
    if (typeof g0.text === 'string' && g0.text) return g0.text;
    const gmsg = g0.message as { content?: unknown } | undefined;
    if (gmsg?.content != null) return messageContentToText(gmsg.content);
  }

  const msg = c.message as { content?: unknown } | undefined;
  if (msg && msg.content != null) return messageContentToText(msg.content);

  const t = messageContentToText(c.content);
  if (t.trim()) return t;

  const additional = c.additional_kwargs as { content?: unknown } | undefined;
  if (additional?.content != null) {
    return messageContentToText(additional.content);
  }

  return '';
}
