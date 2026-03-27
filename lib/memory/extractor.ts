/**
 * 记忆提取器 — 每轮对话后异步分析，提取用户偏好/事实/习惯
 * 采用 LLM 分析对话内容，输出结构化记忆条目
 */
import { createLLM } from '@/lib/models/factory';
import { addMemories, listMemories, type MemoryItem } from '@/lib/storage/memories';

interface ChatMsg {
  role: string;
  content: string;
}

const EXTRACT_PROMPT = `你是一个记忆提取助手。你的任务是从用户和AI的对话中，提取出关于**用户本人**的有价值信息。

提取规则：
1. 只提取关于用户的事实、偏好、习惯、身份信息、常用工具/技术栈等
2. 不要提取通用知识或AI的回答内容
3. 每条记忆要简洁（一句话），用第三人称描述用户（如"用户喜欢…"、"用户是…"）
4. 对每条记忆分类：preference（偏好）、fact（事实）、habit（习惯）、instruction（用户指示AI的行为）、other
5. 如果对话中没有值得记住的用户信息，返回空数组
6. 不要重复已有记忆中的内容

已有记忆（不要重复）：
{existing_memories}

请以 JSON 数组格式输出，每个元素包含 content 和 category 字段：
[{"content": "用户是一名前端开发者", "category": "fact"}, ...]

如果没有值得提取的信息，返回：[]`;

function buildExtractionMessages(
  conversationMessages: ChatMsg[],
  existingMemories: MemoryItem[]
) {
  const existingStr = existingMemories.length > 0
    ? existingMemories.map((m) => `- ${m.content}`).join('\n')
    : '（暂无已有记忆）';

  const conversationStr = conversationMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-10) // only last 10 messages to stay within context
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, 500)}`)
    .join('\n\n');

  return {
    system: EXTRACT_PROMPT.replace('{existing_memories}', existingStr),
    user: `以下是本轮对话内容，请提取用户相关记忆：\n\n${conversationStr}`,
  };
}

function parseExtractionResult(text: string): Array<{ content: string; category?: MemoryItem['category'] }> {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((item: Record<string, unknown>) => typeof item.content === 'string' && item.content.trim())
      .map((item: Record<string, unknown>) => ({
        content: item.content as string,
        category: (['preference', 'fact', 'habit', 'instruction', 'other'].includes(item.category as string)
          ? item.category as MemoryItem['category']
          : 'other'),
      }));
  } catch {
    return [];
  }
}

/**
 * 从对话中提取记忆并保存（异步，不阻塞主流程）
 * @param model 当前使用的模型 ID
 * @param messages 本轮对话消息
 */
export async function extractAndSaveMemories(
  model: string,
  messages: ChatMsg[]
): Promise<MemoryItem[]> {
  if (messages.length < 2) return [];

  const userMsgCount = messages.filter((m) => m.role === 'user').length;
  if (userMsgCount === 0) return [];

  try {
    const existing = await listMemories();
    const { system, user } = buildExtractionMessages(messages, existing);

    const llm = createLLM(model, 0.1);
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await llm.invoke([
          new SystemMessage(system),
          new HumanMessage(user),
        ]);
        break;
      } catch (retryErr: unknown) {
        const is429 = retryErr instanceof Error && retryErr.message.includes('429');
        if (is429 && attempt < 2) {
          const wait = (attempt + 1) * 5000;
          console.warn(`[memory] 429 速率限制，${wait / 1000}s 后重试 (${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw retryErr;
      }
    }
    if (!response) return [];

    const text = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c) => (typeof c === 'string' ? c : (c as Record<string, unknown>).text ?? '')).join('')
        : '';

    const entries = parseExtractionResult(text);
    if (entries.length === 0) return [];

    console.log(`[memory] 提取到 ${entries.length} 条新记忆:`, entries.map((e) => e.content));
    return await addMemories(entries);
  } catch (err) {
    console.error('[memory] 记忆提取失败:', err);
    return [];
  }
}
