/**
 * 合并提取器 — 一次 LLM 调用同时提取用户记忆 + 操作记录
 * 解决智谱 API 速率限制问题（从 2 次后台调用减到 1 次）
 */
import { createLLMAsync } from '@/lib/models/factory';
import { addMemories, listMemories, type MemoryItem } from '@/lib/storage/memories';
import { addTradeRecords, type TradeRecord } from '@/lib/storage/trade-records';

interface ChatMsg {
  role: string;
  content: string;
}

const COMBINED_PROMPT = `你是一个信息提取助手，需要同时完成两个任务。请仔细分析对话内容，输出一个 JSON 对象，包含 memories 和 tradeRecords 两个数组。

## 任务一：提取用户记忆（memories）
从对话中提取关于**用户本人**的偏好、事实、习惯等信息。
规则：
- 每条简洁一句话，第三人称（如"用户喜欢…"）
- 分类：preference（偏好）、fact（事实）、habit（习惯）、instruction（指示）、other
- 不重复已有记忆

已有记忆（不要重复）：
{existing_memories}

## 任务二：提取操作记录（tradeRecords）
从对话中提取具体的**A股操作/打板策略记录**。
规则：
- 只提取有明确股票名称+代码、且涉及具体买入/打板操作的记录
- 不提取纯行情分析或泛泛讨论
- **必须准确标注以下关键字段**：
  · isDragon: 是否龙一/龙头？根据对话中"龙头""总龙""龙一""板块龙头"等描述判断，是=true，否/不确定=false
  · boardInfo: 最新几连板？如"首板""2连板""3连板""4连板""断板反包"。根据对话中实际连板数据填写，不要猜测
  · position: 推荐仓位？如"必须满仓""1/2仓""1/3仓""1w""轻仓"。根据对话中的仓位建议填写；若对话明确说"龙头必须满仓"则填"必须满仓"；若无仓位建议则留空
  · concept: 主线概念，如"电力+氢能""算力租赁""固态电池"
  · strategy: 打板策略，如"涨停,不能直接排板,只打回封""竞价高开3%以上排板"
  · notes: 额外补充，如"大妖股,必须满仓梭哈,能吃3个板""有低价尽量买低价,次日有涨停的溢价"
今天日期：{today}

## 输出格式（必须是合法 JSON）
{
  "memories": [{"content": "...", "category": "preference|fact|habit|instruction|other"}],
  "tradeRecords": [{"stockName":"融捷股份","stockCode":"002192","concept":"固态电池","isDragon":true,"position":"必须满仓","tradeDate":"20260327","marketCap":"110","price":"78","changePercent":"9.99%","boardInfo":"2连板","strategy":"竞价高开3%-5%,低开放弃,快速拉升封板","notes":"锂电板块总龙头,成交额31亿,资金共识最强"}]
}

如果某个数组没有可提取的内容，返回空数组。`;

export async function extractAll(
  model: string,
  messages: ChatMsg[]
): Promise<{ memories: MemoryItem[]; records: TradeRecord[] }> {
  if (messages.length < 2) return { memories: [], records: [] };

  try {
    const existing = await listMemories();
    const existingStr = existing.length > 0
      ? existing.map((m) => `- ${m.content}`).join('\n')
      : '（暂无）';
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const systemContent = COMBINED_PROMPT
      .replace('{existing_memories}', existingStr)
      .replace('{today}', today);

    const filtered = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10);

    const conversationStr = filtered
      .map((m, idx) => {
        const isLast = idx === filtered.length - 1;
        const limit = isLast ? 4000 : 1200;
        return `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, limit)}`;
      })
      .join('\n\n');

    const llm = await createLLMAsync(model, 0.1);
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await llm.invoke([
          new SystemMessage(systemContent),
          new HumanMessage(`以下是对话内容：\n\n${conversationStr}`),
        ]);
        break;
      } catch (retryErr: unknown) {
        const is429 = retryErr instanceof Error && retryErr.message.includes('429');
        if (is429 && attempt < 2) {
          const wait = (attempt + 1) * 10000;
          console.warn(`[extractor] 429 速率限制，${wait / 1000}s 后重试 (${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw retryErr;
      }
    }
    if (!response) {
      console.warn('[extractor] LLM 未返回响应');
      return { memories: [], records: [] };
    }

    const rawText = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c) => (typeof c === 'string' ? c : ((c as Record<string, unknown>).text as string) ?? '')).join('')
        : '';

    const text = rawText
      .replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '')
      .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').replace(/<\/?minimax:[^>]*>/g, '')
      .replace(/<invoke[\s\S]*?<\/invoke>/g, '').replace(/<\/?invoke[^>]*>/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/<\/?tool_call>/g, '')
      .trim();

    console.log('[extractor] LLM 原始输出长度:', rawText.length, '清理后:', text.length, '前200字:', text.slice(0, 200));

    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('[extractor] 未匹配到 JSON 对象，cleaned 前300字:', cleaned.slice(0, 300));
      return { memories: [], records: [] };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      console.warn('[extractor] JSON 解析失败:', e, '原始片段:', match[0].slice(0, 300));
      return { memories: [], records: [] };
    }
    console.log('[extractor] 解析成功 memories:', Array.isArray(parsed.memories) ? parsed.memories.length : 0,
      'tradeRecords:', Array.isArray(parsed.tradeRecords) ? parsed.tradeRecords.length : 0);

    // Process memories
    let savedMemories: MemoryItem[] = [];
    if (Array.isArray(parsed.memories) && parsed.memories.length > 0) {
      const validMemories = parsed.memories
        .filter((m: Record<string, unknown>) => typeof m.content === 'string' && m.content.trim())
        .map((m: Record<string, unknown>) => ({
          content: m.content as string,
          category: (['preference', 'fact', 'habit', 'instruction', 'other'].includes(m.category as string)
            ? m.category as MemoryItem['category']
            : 'other'),
        }));
      if (validMemories.length > 0) {
        savedMemories = await addMemories(validMemories);
        console.log(`[extractor] 记忆 ${savedMemories.length} 条:`, savedMemories.map((m) => m.content));
      }
    }

    // Process trade records
    let savedRecords: TradeRecord[] = [];
    if (Array.isArray(parsed.tradeRecords) && parsed.tradeRecords.length > 0) {
      const validRecords = parsed.tradeRecords
        .filter((r: Record<string, unknown>) =>
          typeof r.stockName === 'string' && r.stockName.trim() &&
          typeof r.stockCode === 'string' && r.stockCode.trim()
        )
        .map((r: Record<string, unknown>) => ({
          stockName: (r.stockName as string).trim(),
          stockCode: (r.stockCode as string).trim(),
          concept: typeof r.concept === 'string' ? r.concept.trim() : '',
          isDragon: !!r.isDragon,
          position: typeof r.position === 'string' ? r.position.trim() : '',
          tradeDate: typeof r.tradeDate === 'string' ? r.tradeDate.trim() : today,
          marketCap: r.marketCap != null ? String(r.marketCap).trim() : undefined,
          price: r.price != null ? String(r.price).trim() : undefined,
          changePercent: typeof r.changePercent === 'string' ? r.changePercent.trim() : '',
          boardInfo: typeof r.boardInfo === 'string' ? r.boardInfo.trim() : '',
          strategy: typeof r.strategy === 'string' ? r.strategy.trim() : '',
          notes: typeof r.notes === 'string' ? r.notes.trim() : '',
          source: 'ai' as const,
        }));
      if (validRecords.length > 0) {
        savedRecords = await addTradeRecords(validRecords);
        console.log(`[extractor] 操作记录 ${savedRecords.length} 条:`, savedRecords.map((r) => `${r.stockName}(${r.stockCode})`));
      }
    }

    return { memories: savedMemories, records: savedRecords };
  } catch (err) {
    console.error('[extractor] 合并提取失败:', err);
    return { memories: [], records: [] };
  }
}
