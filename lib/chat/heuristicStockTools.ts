import type { ToolCallLike } from '@/lib/chat/executeToolCall';
import type { ChatClientMessage } from '@/lib/chat/schemas';
import { normalizeClientMessageContent } from '@/lib/chat/schemas';

export function getLastUserQuery(messages: ChatClientMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return last ? normalizeClientMessageContent(last).trim() : '';
}

/**
 * 当 Ollama 未触发 tool_calls 时，对明显的「涨跌停名单」类问题代为调用 aShareLimitList。
 */
export function heuristicLimitListToolCall(query: string): ToolCallLike | null {
  if (query.length < 4) return null;
  if (!/(涨停|跌停|炸板|涨跌停)/.test(query)) return null;
  if (!/(名单|列表|股票|查询|哪|哪些|给出|数据|关键)/.test(query)) {
    return null;
  }

  let limit_type: 'U' | 'D' | 'Z' = 'U';
  if (/跌停/.test(query) && !/涨停/.test(query)) limit_type = 'D';
  else if (/炸板/.test(query)) limit_type = 'Z';

  let trade_date: string | undefined;
  const ymd = query.match(/(\d{4})[-－/](\d{1,2})[-－/](\d{1,2})/);
  const cn = query.match(/(\d{4})年(\d{1,2})月(\d{1,2})\s*[日号]?/);
  if (ymd) {
    const y = ymd[1];
    const mo = ymd[2].padStart(2, '0');
    const da = ymd[3].padStart(2, '0');
    trade_date = `${y}${mo}${da}`;
  } else if (cn) {
    const y = cn[1];
    const mo = cn[2].padStart(2, '0');
    const da = cn[3].padStart(2, '0');
    trade_date = `${y}${mo}${da}`;
  }

  const args: Record<string, unknown> = {
    limit_type,
    max_rows: 200,
  };
  if (trade_date) args.trade_date = trade_date;

  return { name: 'aShareLimitList', args };
}
