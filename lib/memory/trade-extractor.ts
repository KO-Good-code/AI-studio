/**
 * 从对话中自动提取操作记录
 * 当用户讨论具体的打板/买入策略时，自动生成 TradeRecord
 */
import { createLLM } from '@/lib/models/factory';
import { addTradeRecords, type TradeRecord } from '@/lib/storage/trade-records';

interface ChatMsg {
  role: string;
  content: string;
}

const EXTRACT_PROMPT = `你是一个 A股打板操作记录提取助手。你的任务是从用户和AI的对话中，提取出具体的**股票操作记录**。

提取规则：
1. 只提取有明确股票名称/代码、且涉及具体买入/打板/操作的记录
2. 不提取纯粹的行情分析或泛泛讨论
3. 每条记录要包含尽可能多的字段
4. 如果对话中没有具体操作记录，返回空数组

字段说明：
- stockName: 股票名称（必填）
- stockCode: 6位代码（必填）
- concept: 主线概念板块（如"电力+氢能"）
- isDragon: 是否被认为是龙头/龙一（boolean）
- position: 仓位建议（如"满仓"、"1/2仓"、"1w"）
- tradeDate: 操作日期 YYYYMMDD（如提到"今天"则用当前日期）
- marketCap: 市值（亿），纯数字
- price: 股价（元），纯数字
- changePercent: 涨幅（如"10.00%"）
- boardInfo: 连板信息（如"首板"、"2连板"、"断板反包"）
- strategy: 策略描述（如"涨停,不能直接排板,只打回封"）
- notes: 补充说明

今天日期：{today}

请以 JSON 数组格式输出：
[{"stockName":"华电辽能","stockCode":"600396","concept":"电力+氢能","isDragon":true,"position":"必须满仓","tradeDate":"20260325","marketCap":"92","price":"6.26","changePercent":"7.20%","boardInfo":"4连板","strategy":"有低价尽量买低价,次日有涨停的溢价,多格局耐心等板砸","notes":""}]

如果没有可提取的操作记录，返回：[]`;

function buildMessages(conversationMessages: ChatMsg[]) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const conversationStr = conversationMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, 800)}`)
    .join('\n\n');

  return {
    system: EXTRACT_PROMPT.replace('{today}', today),
    user: `以下是对话内容，请提取操作记录：\n\n${conversationStr}`,
  };
}

function parseResult(
  text: string
): Array<Omit<TradeRecord, 'id' | 'createdAt' | 'updatedAt' | 'source'>> {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (item: Record<string, unknown>) =>
          typeof item.stockName === 'string' &&
          item.stockName.trim() &&
          typeof item.stockCode === 'string' &&
          item.stockCode.trim()
      )
      .map((item: Record<string, unknown>) => ({
        stockName: (item.stockName as string).trim(),
        stockCode: (item.stockCode as string).trim(),
        concept: typeof item.concept === 'string' ? item.concept.trim() : '',
        isDragon: !!item.isDragon,
        position: typeof item.position === 'string' ? item.position.trim() : '',
        tradeDate:
          typeof item.tradeDate === 'string' ? item.tradeDate.trim() : '',
        marketCap:
          typeof item.marketCap === 'string' || typeof item.marketCap === 'number'
            ? String(item.marketCap).trim()
            : undefined,
        price:
          typeof item.price === 'string' || typeof item.price === 'number'
            ? String(item.price).trim()
            : undefined,
        changePercent:
          typeof item.changePercent === 'string'
            ? item.changePercent.trim()
            : '',
        boardInfo:
          typeof item.boardInfo === 'string' ? item.boardInfo.trim() : '',
        strategy:
          typeof item.strategy === 'string' ? item.strategy.trim() : '',
        notes: typeof item.notes === 'string' ? item.notes.trim() : '',
      }));
  } catch {
    return [];
  }
}

export async function extractAndSaveTradeRecords(
  model: string,
  messages: ChatMsg[]
): Promise<TradeRecord[]> {
  if (messages.length < 2) return [];

  const stockPattern = /打板|涨停|买入|操作|仓位|龙头|连板|排板|回封|低吸|首板|封板|炸板|竞价|止损|溢价/;
  const hasStockKeywords = messages.some(
    (m) => (m.role === 'user' || m.role === 'assistant') && stockPattern.test(m.content)
  );
  if (!hasStockKeywords) return [];

  try {
    const { system, user } = buildMessages(messages);
    const llm = createLLM(model, 0.1);
    const { HumanMessage, SystemMessage } = await import(
      '@langchain/core/messages'
    );

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
          console.warn(`[trade-records] 429 速率限制，${wait / 1000}s 后重试 (${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw retryErr;
      }
    }
    if (!response) return [];

    const text =
      typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c) =>
                typeof c === 'string'
                  ? c
                  : ((c as Record<string, unknown>).text as string) ?? ''
              )
              .join('')
          : '';

    const entries = parseResult(text);
    if (entries.length === 0) return [];

    console.log(
      `[trade-records] 提取到 ${entries.length} 条操作记录:`,
      entries.map((e) => `${e.stockName}(${e.stockCode})`)
    );
    return await addTradeRecords(
      entries.map((e) => ({ ...e, source: 'ai' as const }))
    );
  } catch (err) {
    console.error('[trade-records] 操作记录提取失败:', err);
    return [];
  }
}
