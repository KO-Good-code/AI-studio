import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  chinaTodayYmd,
  code6ToTsCode,
  getTushareToken,
  type TushareRow,
  tushareQuery,
  tushareStockName,
  ymdMinusCalendarDays,
} from './tushareClient';

const UA =
  'Mozilla/5.0 (compatible; AI-studio/1.0; +https://github.com/)';

/** 东方财富 secid：沪 1.xxxxxxx，深/北证部分 0.xxxxxx */
export function aShareCodeToSecid(code6: string): string | null {
  const c = code6;
  if (!/^\d{6}$/.test(c)) return null;
  if (c.startsWith('920')) return `0.${c}`;
  if (c.startsWith('688') || c.startsWith('6')) return `1.${c}`;
  if (c.startsWith('0') || c.startsWith('3')) return `0.${c}`;
  return `0.${c}`;
}

function normalizeSymbol(input: string): string {
  return input
    .trim()
    .replace(/^(sh|sz|bj)\s*/i, '')
    .replace(/\s/g, '');
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`行情接口 HTTP ${res.status}`);
  }
  return res.json() as Promise<unknown>;
}

type EmQuoteData = {
  f57?: string;
  f58?: string;
  f43?: number | string;
  f44?: number | string;
  f45?: number | string;
  f46?: number | string;
  f60?: number | string;
  f168?: number | string;
  f169?: number | string;
  f170?: number | string;
};

function fmtNum(v: number | string | undefined): string {
  if (v === undefined || v === null) return '-';
  if (typeof v === 'string') return v === '-' ? '-' : v;
  return Number.isFinite(v) ? String(v) : '-';
}

export async function fetchAShareRealtime(secid: string): Promise<string> {
  const u = new URL('https://push2delay.eastmoney.com/api/qt/stock/get');
  u.searchParams.set('secid', secid);
  u.searchParams.set('invt', '2');
  u.searchParams.set('fltt', '2');
  u.searchParams.set(
    'fields',
    'f57,f58,f43,f44,f45,f46,f60,f168,f169,f170,f116,f117'
  );

  const json = (await fetchJson(u.toString())) as {
    rc?: number;
    data?: EmQuoteData;
  };
  if (json.rc !== 0 || !json.data) {
    return JSON.stringify(
      { error: '未取到行情', secid, raw: json },
      null,
      2
    );
  }
  const d = json.data;
  const name = d.f58 ?? '';
  const code = d.f57 ?? '';
  const out = {
    数据源: '东方财富（公开接口）',
    代码: code,
    名称: name,
    最新价: fmtNum(d.f43),
    涨跌额: fmtNum(d.f169),
    涨跌幅_百分比: fmtNum(d.f170),
    今开: fmtNum(d.f46),
    最高: fmtNum(d.f44),
    最低: fmtNum(d.f45),
    昨收: fmtNum(d.f60),
    换手率_百分比: fmtNum(d.f168),
    说明:
      '延迟行情，仅供参考，不构成投资建议。',
  };
  return JSON.stringify(out, null, 2);
}

/** klt: 101 日 102 周 103 月 */
export async function fetchAShareKline(
  secid: string,
  klt: '101' | '102' | '103',
  limit: number
): Promise<string> {
  const lmt = Math.min(Math.max(1, limit), 250);
  const u = new URL(
    'https://push2his.eastmoney.com/api/qt/stock/kline/get'
  );
  u.searchParams.set('secid', secid);
  u.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6,f7,f8');
  u.searchParams.set(
    'fields2',
    'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
  );
  u.searchParams.set('klt', klt);
  u.searchParams.set('fqt', '1');
  u.searchParams.set('end', '20500101');
  u.searchParams.set('lmt', String(lmt));

  const json = (await fetchJson(u.toString())) as {
    rc?: number;
    data?: {
      name?: string;
      code?: string;
      klines?: string[];
    };
  };
  if (json.rc !== 0 || !json.data?.klines?.length) {
    return JSON.stringify(
      { error: '未取到K线', secid, klt, raw: json },
      null,
      2
    );
  }
  const { name, code, klines } = json.data;
  const periodLabel =
    klt === '101' ? '日线' : klt === '102' ? '周线' : '月线';
  const rows = klines.map((line) => {
    const p = line.split(',');
    return {
      日期: p[0] ?? '',
      开盘: p[1] ?? '',
      收盘: p[2] ?? '',
      最高: p[3] ?? '',
      最低: p[4] ?? '',
      成交量: p[5] ?? '',
      成交额: p[6] ?? '',
      振幅_百分比: p[7] ?? '',
      涨跌幅_百分比: p[8] ?? '',
      涨跌额: p[9] ?? '',
      换手率_百分比: p[10] ?? '',
    };
  });
  const out = {
    数据源: '东方财富（公开接口）',
    代码: code,
    名称: name,
    周期: periodLabel,
    条数: rows.length,
    复权: '前复权(fqt=1)',
    K线: rows,
    说明: '仅供参考，不构成投资建议。',
  };
  return JSON.stringify(out, null, 2);
}

function sortRowsByTradeDateDesc(rows: TushareRow[]): TushareRow[] {
  return [...rows].sort((a, b) =>
    String(b.trade_date ?? '').localeCompare(String(a.trade_date ?? ''))
  );
}

async function fetchTushareRealtime(
  token: string,
  code6: string,
  tsCode: string
): Promise<string | null> {
  const end = chinaTodayYmd();
  const start = ymdMinusCalendarDays(end, 200);
  const daily = await tushareQuery(
    token,
    'daily',
    { ts_code: tsCode, start_date: start, end_date: end },
    'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount'
  );

  if (!daily.ok) {
    return JSON.stringify(
      {
        error: 'Tushare 请求失败',
        ts_code: tsCode,
        code: daily.code,
        msg: daily.msg,
        hint: '请检查 TUSHARE_TOKEN、积分权限及 ts_code 是否正确',
      },
      null,
      2
    );
  }

  const sorted = sortRowsByTradeDateDesc(daily.rows);
  const latest = sorted[0];
  if (!latest) {
    return null;
  }

  const td = String(latest.trade_date ?? '');
  const basic = await tushareQuery(
    token,
    'daily_basic',
    { ts_code: tsCode, trade_date: td },
    'turnover_rate,pe,pb,total_mv,circ_mv'
  );

  let extra: Record<string, string> = {};
  if (basic.ok && basic.rows[0]) {
    const b = basic.rows[0];
    extra = {
      换手率_百分比: b.turnover_rate != null ? String(b.turnover_rate) : '-',
      市盈率_PE: b.pe != null ? String(b.pe) : '-',
      市净率_PB: b.pb != null ? String(b.pb) : '-',
      总市值_万元: b.total_mv != null ? String(b.total_mv) : '-',
      流通市值_万元: b.circ_mv != null ? String(b.circ_mv) : '-',
    };
  }

  const name = (await tushareStockName(token, tsCode)) ?? '';

  const out = {
    数据源: 'Tushare Pro',
    ts_code: tsCode,
    代码: code6,
    名称: name,
    口径:
      '最近一个已收盘交易日的日线数据（非盘中 tick；盘中请依赖东方财富源或专业行情）',
    交易日期: td,
    开盘: String(latest.open ?? '-'),
    最高: String(latest.high ?? '-'),
    最低: String(latest.low ?? '-'),
    收盘: String(latest.close ?? '-'),
    昨收: String(latest.pre_close ?? '-'),
    涨跌额: String(latest.change ?? '-'),
    涨跌幅_百分比: String(latest.pct_chg ?? '-'),
    成交量_手: String(latest.vol ?? '-'),
    成交额_千元: String(latest.amount ?? '-'),
    ...extra,
    说明: '数据来自 Tushare Pro，使用受积分与权限限制；不构成投资建议。',
  };
  return JSON.stringify(out, null, 2);
}

async function fetchTushareHistory(
  token: string,
  code6: string,
  tsCode: string,
  klinePeriod: 'daily' | 'weekly' | 'monthly',
  limit: number
): Promise<string | null> {
  const end = chinaTodayYmd();
  const calBack =
    klinePeriod === 'daily'
      ? Math.min(limit * 5, 3650)
      : klinePeriod === 'weekly'
        ? Math.min(limit * 20, 3650)
        : Math.min(limit * 60, 7300);
  const start = ymdMinusCalendarDays(end, calBack);

  const apiName =
    klinePeriod === 'weekly'
      ? 'weekly'
      : klinePeriod === 'monthly'
        ? 'monthly'
        : 'daily';

  const fields =
    apiName === 'daily'
      ? 'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount'
      : 'ts_code,trade_date,open,high,low,close,vol,amount';

  const r = await tushareQuery(token, apiName, {
    ts_code: tsCode,
    start_date: start,
    end_date: end,
  }, fields);

  if (!r.ok) {
    return JSON.stringify(
      {
        error: 'Tushare 请求失败',
        ts_code: tsCode,
        code: r.code,
        msg: r.msg,
        hint:
          '周线/月线接口通常需要更高积分；可改查日线或到 tushare.pro 查看权限说明',
      },
      null,
      2
    );
  }

  const sorted = sortRowsByTradeDateDesc(r.rows);
  const slice = sorted.slice(0, limit).reverse();
  if (!slice.length) {
    return null;
  }

  const name = (await tushareStockName(token, tsCode)) ?? '';
  const periodLabel =
    klinePeriod === 'daily' ? '日线' : klinePeriod === 'weekly' ? '周线' : '月线';

  const K线 = slice.map((row) => ({
    交易日期: String(row.trade_date ?? ''),
    开盘: String(row.open ?? '-'),
    收盘: String(row.close ?? '-'),
    最高: String(row.high ?? '-'),
    最低: String(row.low ?? '-'),
    ...(apiName === 'daily'
      ? {
          昨收: String((row as { pre_close?: unknown }).pre_close ?? '-'),
          涨跌额: String((row as { change?: unknown }).change ?? '-'),
          涨跌幅_百分比: String((row as { pct_chg?: unknown }).pct_chg ?? '-'),
        }
      : {}),
    成交量_手: String(row.vol ?? '-'),
    成交额_千元: String(row.amount ?? '-'),
  }));

  const out = {
    数据源: 'Tushare Pro',
    ts_code: tsCode,
    代码: code6,
    名称: name,
    周期: periodLabel,
    条数: K线.length,
    K线,
    说明: '数据来自 Tushare Pro，使用受积分与权限限制；不构成投资建议。',
  };
  return JSON.stringify(out, null, 2);
}

export const aShareTool = new DynamicStructuredTool({
  name: 'aShareQuote',
  description: `查询中国 A 股行情或历史 K 线。
若环境变量配置了 TUSHARE_TOKEN，优先使用 Tushare Pro（日线/周线/月线、最近交易日收盘口径快照）；否则使用东方财富公开接口。
6 位代码可带 sh/sz/bj 前缀（如 sh600519、000001、920002）。
queryType：realtime=快照（Tushare 为最近收盘日线+daily_basic；东财为盘中延迟行情）；history=K 线，默认最近 30 根日线。`,

  schema: z.object({
    symbol: z
      .string()
      .describe('股票代码，6 位数字，如 600519、000001、688001、920002'),
    queryType: z
      .enum(['realtime', 'history'])
      .describe('realtime=快照，history=历史K线'),
    klinePeriod: z
      .enum(['daily', 'weekly', 'monthly'])
      .optional()
      .describe('仅 history 有效：日线/周线/月线，默认 daily'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('仅 history 有效：返回最近多少根K线，默认 30，最大 250'),
  }),

  func: async ({ symbol, queryType, klinePeriod = 'daily', limit = 30 }) => {
    const code6 = normalizeSymbol(symbol);
    if (!/^\d{6}$/.test(code6)) {
      return JSON.stringify({
        error: '代码格式无效，请使用 6 位数字（可带 sh/sz/bj 前缀）',
        symbol,
      });
    }

    const secid = aShareCodeToSecid(code6);
    if (!secid) {
      return JSON.stringify({ error: '无法解析东方财富市场代码', code: code6 });
    }

    const token = getTushareToken();
    const tsCode = code6ToTsCode(code6);

    console.log(
      `📈 aShareQuote ${queryType} ${code6} secid=${secid} tushare=${Boolean(token && tsCode)}`
    );

    try {
      if (token && tsCode) {
        if (queryType === 'realtime') {
          const t = await fetchTushareRealtime(token, code6, tsCode);
          if (t) return t;
        } else {
          const t = await fetchTushareHistory(
            token,
            code6,
            tsCode,
            klinePeriod,
            Math.min(Math.max(1, limit), 250)
          );
          if (t) return t;
        }
      }

      if (queryType === 'realtime') {
        return await fetchAShareRealtime(secid);
      }
      const klt =
        klinePeriod === 'weekly'
          ? '102'
          : klinePeriod === 'monthly'
            ? '103'
            : '101';
      return await fetchAShareKline(secid, klt, limit);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('❌ aShareQuote:', msg);
      return JSON.stringify({ error: msg, code: code6, secid });
    }
  },
});
