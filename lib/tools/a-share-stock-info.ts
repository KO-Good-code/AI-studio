import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  code6ToTsCode,
  getTushareToken,
  tushareQuery,
} from './tushareClient';
import { aShareCodeToSecid } from './a-share';

const UA = 'Mozilla/5.0 (compatible; AI-studio/1.0)';

function normalizeSymbol(input: string): string {
  return input
    .trim()
    .replace(/^(sh|sz|bj)\s*/i, '')
    .replace(/\s/g, '');
}

function fv(v: unknown): string {
  if (v === undefined || v === null || v === '-') return '-';
  if (typeof v === 'number' && !Number.isFinite(v)) return '-';
  return String(v);
}

async function fetchEmStockProfile(secid: string): Promise<Record<string, string>> {
  const u = new URL('https://push2delay.eastmoney.com/api/qt/stock/get');
  u.searchParams.set('secid', secid);
  u.searchParams.set('invt', '2');
  u.searchParams.set('fltt', '2');
  u.searchParams.set(
    'fields',
    'f57,f58,f84,f85,f100,f162,f163,f167,f168,f173,' +
      'f183,f184,f185,f186,f187,f188,f189,f190,f191,' +
      'f116,f117,f277,f278,f43,f44,f45,f46,f60,f169,f170,f55'
  );

  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`东财 HTTP ${res.status}`);
  const json = (await res.json()) as { rc?: number; data?: Record<string, unknown> };
  if (json.rc !== 0 || !json.data) return {};
  const d = json.data;
  return {
    代码: fv(d.f57),
    名称: fv(d.f58),
    最新价: fv(d.f43),
    涨跌幅_百分比: fv(d.f170),
    涨跌额: fv(d.f169),
    今开: fv(d.f46),
    最高: fv(d.f44),
    最低: fv(d.f45),
    昨收: fv(d.f60),
    换手率_百分比: fv(d.f168),
    市盈率_动态: fv(d.f162),
    市盈率_TTM: fv(d.f163),
    市净率_PB: fv(d.f167),
    ROE_百分比: fv(d.f173),
    总营收_元: fv(d.f183),
    营收同比_百分比: fv(d.f184),
    净利润同比_百分比: fv(d.f185),
    毛利率_百分比: fv(d.f186),
    净利率_百分比: fv(d.f187),
    资产负债率_百分比: fv(d.f188),
    未分配利润每股: fv(d.f190),
    所属板块: fv(d.f100),
    总股本_股: fv(d.f84),
    流通股本_股: fv(d.f85),
    总市值_元: fv(d.f116),
    流通市值_元: fv(d.f117),
    限售股_股: fv(d.f278),
    上市日期: fv(d.f189),
    每股收益: fv(d.f55),
  };
}

async function fetchEmFinancials(code6: string): Promise<unknown[]> {
  const u = new URL(
    'https://datacenter-web.eastmoney.com/api/data/v1/get'
  );
  u.searchParams.set('reportName', 'RPT_LICO_FN_CPD');
  u.searchParams.set('columns', 'ALL');
  u.searchParams.set(
    'filter',
    `(SECURITY_CODE="${code6}")`
  );
  u.searchParams.set('pageNumber', '1');
  u.searchParams.set('pageSize', '4');
  u.searchParams.set('sortTypes', '-1');
  u.searchParams.set('sortColumns', 'REPORTDATE');
  u.searchParams.set('source', 'WEB');
  u.searchParams.set('client', 'WEB');

  const res = await fetch(u.toString(), {
    headers: {
      'User-Agent': UA,
      Referer: 'https://data.eastmoney.com/',
    },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    success?: boolean;
    result?: { data?: unknown[] };
  };
  if (!json.success || !json.result?.data) return [];

  return json.result.data.map((row: unknown) => {
    const r = row as Record<string, unknown>;
    return {
      报告期: fv(r.REPORTDATE)?.slice(0, 10) ?? '',
      报告类型: fv(r.DATATYPE),
      每股收益_EPS: fv(r.BASIC_EPS),
      每股净资产: fv(r.BPS),
      加权ROE_百分比: fv(r.WEIGHTAVG_ROE),
      毛利率_百分比: fv(r.XSMLL),
      营收_元: fv(r.TOTAL_OPERATE_INCOME),
      营收同比_百分比: fv(r.YSTZ),
      归母净利润_元: fv(r.PARENT_NETPROFIT),
      净利润同比_百分比: fv(r.SJLTZ),
      分红方案: fv(r.ASSIGNDSCRPT),
      所属行业: fv(r.PUBLISHNAME),
    };
  });
}

async function fetchTushareCompanyInfo(
  token: string,
  tsCode: string
): Promise<Record<string, string> | null> {
  const r = await tushareQuery(
    token,
    'stock_company',
    { ts_code: tsCode },
    'ts_code,chairman,manager,secretary,reg_capital,setup_date,province,city,introduction,website,office,employees,main_business'
  );
  if (!r.ok || !r.rows.length) return null;
  const d = r.rows[0];
  return {
    董事长: fv(d.chairman),
    总经理: fv(d.manager),
    注册资本_万元: fv(d.reg_capital),
    成立日期: fv(d.setup_date),
    省份: fv(d.province),
    城市: fv(d.city),
    办公地址: fv(d.office),
    员工人数: fv(d.employees),
    公司官网: fv(d.website),
    主营业务: fv(d.main_business),
    公司简介: fv(d.introduction)?.slice(0, 500),
  };
}

async function fetchTushareTopHolders(
  token: string,
  tsCode: string
): Promise<unknown[] | null> {
  const r = await tushareQuery(
    token,
    'top10_holders',
    { ts_code: tsCode },
    'ts_code,ann_date,end_date,holder_name,hold_amount,hold_ratio'
  );
  if (!r.ok || !r.rows.length) return null;
  const latest = r.rows[0].end_date;
  return r.rows
    .filter((row) => row.end_date === latest)
    .slice(0, 10)
    .map((row) => ({
      截止日期: fv(row.end_date),
      股东名称: fv(row.holder_name),
      持股数_股: fv(row.hold_amount),
      持股比例_百分比: fv(row.hold_ratio),
    }));
}

async function fetchTushareDividend(
  token: string,
  tsCode: string
): Promise<unknown[] | null> {
  const r = await tushareQuery(
    token,
    'dividend',
    { ts_code: tsCode },
    'ts_code,end_date,ann_date,div_proc,stk_div,cash_div,cash_div_tax,record_date,ex_date,pay_date'
  );
  if (!r.ok || !r.rows.length) return null;
  return r.rows.slice(0, 8).map((row) => ({
    分红年度: fv(row.end_date),
    公告日: fv(row.ann_date),
    实施进度: fv(row.div_proc),
    每股送转: fv(row.stk_div),
    每股派息_税前: fv(row.cash_div),
    每股派息_税后: fv(row.cash_div_tax),
    登记日: fv(row.record_date),
    除权日: fv(row.ex_date),
    派息日: fv(row.pay_date),
  }));
}

export const aShareStockInfoTool = new DynamicStructuredTool({
  name: 'aShareStockInfo',
  description: `查询 A 股个股的详细信息：公司简况、财务指标（PE/PB/ROE/毛利率/净利率等）、最近 4 期财报摘要、前十大股东、分红记录。
当用户问「某股票的基本面」「市盈率多少」「公司介绍」「股东」「分红」等个股非行情类问题时使用此工具。
若仅需要 OHLC 行情/K线，请用 aShareQuote。`,

  schema: z.object({
    symbol: z
      .string()
      .describe('股票代码，6 位数字，如 600519、000001、688001'),
    sections: z
      .array(
        z.enum(['profile', 'financials', 'holders', 'dividend'])
      )
      .optional()
      .describe(
        '可选指定返回哪些板块（默认全部）：profile=公司简况+估值指标，financials=最近4期财报摘要，holders=前十大股东，dividend=分红记录'
      ),
  }),

  func: async ({ symbol, sections }) => {
    const code6 = normalizeSymbol(symbol);
    if (!/^\d{6}$/.test(code6)) {
      return JSON.stringify({
        error: '代码格式无效，请使用 6 位数字（可带 sh/sz/bj 前缀）',
        symbol,
      });
    }

    const secid = aShareCodeToSecid(code6);
    const token = getTushareToken();
    const tsCode = code6ToTsCode(code6);

    const want = new Set(sections ?? ['profile', 'financials', 'holders', 'dividend']);
    const out: Record<string, unknown> = {
      数据源: '东方财富公开接口 + Tushare Pro（若配置）',
      代码: code6,
    };

    console.log(
      `📊 aShareStockInfo ${code6} sections=[${[...want].join(',')}]`
    );

    try {
      if (want.has('profile')) {
        if (secid) {
          const emProfile = await fetchEmStockProfile(secid);
          out.行情与估值 = emProfile;
        }
        if (token && tsCode) {
          const company = await fetchTushareCompanyInfo(token, tsCode);
          if (company) out.公司简况 = company;
        }
      }

      if (want.has('financials')) {
        const fin = await fetchEmFinancials(code6);
        if (fin.length) {
          out.最近财报摘要 = fin;
        } else if (token && tsCode) {
          const r = await tushareQuery(
            token,
            'fina_indicator',
            { ts_code: tsCode },
            'ts_code,ann_date,end_date,eps,roe,grossprofit_margin,netprofit_margin,debt_to_assets,current_ratio'
          );
          if (r.ok && r.rows.length) {
            out.最近财报摘要 = r.rows.slice(0, 4).map((row) => ({
              报告期: fv(row.end_date),
              EPS: fv(row.eps),
              ROE_百分比: fv(row.roe),
              毛利率_百分比: fv(row.grossprofit_margin),
              净利率_百分比: fv(row.netprofit_margin),
              资产负债率_百分比: fv(row.debt_to_assets),
              流动比率: fv(row.current_ratio),
            }));
          }
        }
      }

      if (want.has('holders') && token && tsCode) {
        const holders = await fetchTushareTopHolders(token, tsCode);
        if (holders) out.前十大股东 = holders;
      }

      if (want.has('dividend') && token && tsCode) {
        const div = await fetchTushareDividend(token, tsCode);
        if (div) out.分红记录 = div;
      }

      if (!token && (want.has('holders') || want.has('dividend'))) {
        out.提示 =
          '前十大股东与分红记录需配置 TUSHARE_TOKEN，当前仅返回东财公开数据部分。';
      }

      out.说明 = '仅供参考，不构成投资建议。';
      return JSON.stringify(out, null, 2);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('❌ aShareStockInfo:', msg);
      return JSON.stringify({ error: msg, code: code6 });
    }
  },
});
