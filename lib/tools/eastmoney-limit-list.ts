/**
 * 东方财富 clist 公开接口兜底：无积分限额，但仅为「当前快照」、按涨跌幅近似筛涨停/跌停，
 * 与交易所官方「封板」口径可能不一致；不支持指定历史交易日。
 */

import { chinaTodayYmd } from './tushareClient';

const UA = 'Mozilla/5.0 (compatible; AI-studio/1.0)';
const CLIST =
  'https://push2delay.eastmoney.com/api/qt/clist/get';

/** 沪深京 A 股（排除 ST 等口径以东财 fs 为准） */
const FS_ALL_A =
  'm:0+t:6+f:!50,m:0+t:80+f:!50,m:1+t:2+f:!50,m:1+t:23+f:!50';

const FIELDS =
  'f12,f14,f2,f3,f4,f5,f6,f7,f8,f10,f20,f21,f62';

function padCode6(f12: string): string {
  const s = String(f12).replace(/\D/g, '');
  return s.length <= 6 ? s.padStart(6, '0') : s.slice(-6);
}

/** 近似判断是否涨停（排除新股极端涨幅） */
export function isApproxLimitUp(code6: string, f3: number): boolean {
  if (!Number.isFinite(f3) || f3 < 0) return false;
  if (f3 > 45) return false;
  if (code6.startsWith('300') || code6.startsWith('301') || code6.startsWith('688')) {
    return f3 >= 19.4 && f3 <= 22.5;
  }
  if (code6.startsWith('920') || /^8\d{5}$/.test(code6)) {
    return f3 >= 28.5 && f3 <= 32.5;
  }
  return f3 >= 9.75 && f3 <= 11.2;
}

export function isApproxLimitDown(code6: string, f3: number): boolean {
  if (!Number.isFinite(f3) || f3 >= 0) return false;
  if (f3 < -45) return false;
  const a = Math.abs(f3);
  if (code6.startsWith('300') || code6.startsWith('301') || code6.startsWith('688')) {
    return a >= 19.4 && a <= 22.5;
  }
  if (code6.startsWith('920') || /^8\d{5}$/.test(code6)) {
    return a >= 28.5 && a <= 32.5;
  }
  return a >= 9.75 && a <= 11.2;
}

function filterByExchange(code6: string, exchange?: 'SH' | 'SZ' | 'BJ'): boolean {
  if (!exchange) return true;
  if (exchange === 'SH') return code6.startsWith('6') || code6.startsWith('688');
  if (exchange === 'SZ') {
    return (
      code6.startsWith('0') ||
      code6.startsWith('3') ||
      code6.startsWith('001')
    );
  }
  if (exchange === 'BJ') return code6.startsWith('8') || code6.startsWith('4') || code6.startsWith('920');
  return true;
}

type EmRow = Record<string, unknown>;

async function fetchClistPage(pn: number, pz: number): Promise<EmRow[]> {
  const u = new URL(CLIST);
  u.searchParams.set('pn', String(pn));
  u.searchParams.set('pz', String(pz));
  u.searchParams.set('po', '1');
  u.searchParams.set('np', '1');
  u.searchParams.set('ut', 'fa5fd1943c7b386f172d6893dbfba10b');
  u.searchParams.set('fltt', '2');
  u.searchParams.set('invt', '2');
  u.searchParams.set('fid', 'f3');
  u.searchParams.set('fs', FS_ALL_A);
  u.searchParams.set('fields', FIELDS);

  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`东财 clist HTTP ${res.status}`);
  const json = (await res.json()) as { rc?: number; data?: { diff?: EmRow[]; total?: number } };
  if (json.rc !== 0 || !json.data?.diff) return [];
  return json.data.diff;
}

/**
 * 东财兜底：仅当查询日 = 东八区「今天」时使用（无法按任意历史日回溯）。
 */
export async function fetchEastMoneyLimitListFallback(options: {
  limit_type: 'U' | 'D';
  max_rows: number;
  exchange?: 'SH' | 'SZ' | 'BJ';
  /** 必须与 chinaTodayYmd() 一致，否则调用方应拒绝 */
  trade_date: string;
}): Promise<string> {
  const { limit_type, max_rows, exchange, trade_date } = options;
  const today = chinaTodayYmd();
  if (trade_date !== today) {
    return JSON.stringify({
      error: '东财兜底仅支持「当前交易日快照」',
      请求日期: trade_date,
      今日: today,
      hint: '查询历史某天的涨跌停名单请使用 Tushare limit_list_d（受积分与每日次数限制）。',
    });
  }

  const picked: Array<Record<string, string | number>> = [];
  const pz = 500;
  let pn = 1;
  const totalCap = 8000;

  while (picked.length < max_rows && (pn - 1) * pz < totalCap) {
    const diff = await fetchClistPage(pn, pz);
    if (!diff.length) break;

    for (const row of diff) {
      const f12 = row.f12;
      const f3 = row.f3;
      if (typeof f12 !== 'string' && typeof f12 !== 'number') continue;
      const code6 = padCode6(String(f12));
      const pct = typeof f3 === 'number' ? f3 : parseFloat(String(f3));
      if (!filterByExchange(code6, exchange)) continue;

      const ok =
        limit_type === 'U'
          ? isApproxLimitUp(code6, pct)
          : isApproxLimitDown(code6, pct);
      if (!ok) continue;

      picked.push({
        代码: code6,
        名称: String(row.f14 ?? ''),
        涨跌幅_百分比: pct,
        最新价: row.f2 as number,
        成交额: row.f6 as number,
        换手率: row.f8 as number,
      });
      if (picked.length >= max_rows) break;
    }
    if (diff.length < pz) break;
    pn += 1;
  }

  const out = {
    数据源: '东方财富 clist（公开接口·兜底）',
    交易日期说明: `按东八区今日 ${today} 的行情快照筛选，非交易所官方「封板」口径，新股/ST 等特殊规则可能误判`,
    类型: limit_type === 'U' ? '近似涨停' : '近似跌停',
    交易所筛选: exchange ?? '全部',
    返回条数: picked.length,
    列表: picked,
    说明:
      '与 Tushare limit_list_d 的封板时间、连板数等字段不一致；仅供行情参考，不构成投资建议。',
  };
  return JSON.stringify(out, null, 2);
}
