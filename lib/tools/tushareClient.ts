/**
 * Tushare Pro HTTP API（无需安装 Python tushare）
 * 文档: https://tushare.pro/document/1?doc_id=130
 */

const TUSHARE_PRO_URL = 'https://api.tushare.pro';

export type TushareRow = Record<string, string | number | null>;
export type TushareRows = TushareRow[];

export function getTushareToken(): string | undefined {
  const t = process.env.TUSHARE_TOKEN?.trim();
  return t || undefined;
}

/** 6 位代码 → Tushare ts_code */
export function code6ToTsCode(code6: string): string | null {
  if (!/^\d{6}$/.test(code6)) return null;
  const c = code6;
  if (c.startsWith('920') || c.startsWith('8') || c.startsWith('4')) {
    return `${c}.BJ`;
  }
  if (c.startsWith('688') || c.startsWith('6')) {
    return `${c}.SH`;
  }
  if (c.startsWith('0') || c.startsWith('3')) {
    return `${c}.SZ`;
  }
  return null;
}

/** 东八区日历 YYYYMMDD */
export function chinaTodayYmd(): string {
  return new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    .replace(/-/g, '');
}

export function ymdMinusCalendarDays(ymd: string, days: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const u = Date.UTC(y, m, d) - days * 86_400_000;
  return new Date(u).toISOString().slice(0, 10).replace(/-/g, '');
}

function zipFieldsItems(
  fields: string[],
  items: unknown[][]
): TushareRows {
  return items.map((row) => {
    const o: Record<string, string | number | null> = {};
    for (let i = 0; i < fields.length; i++) {
      const v = row[i];
      o[fields[i]] =
        v === null || v === undefined
          ? null
          : typeof v === 'number' || typeof v === 'string'
            ? v
            : String(v);
    }
    return o;
  });
}

export type TushareQueryResult = {
  ok: true;
  rows: TushareRows;
} | {
  ok: false;
  code: number;
  msg: string;
};

/**
 * 调用 Tushare Pro。成功时返回行对象数组（字段名为接口文档中的英文名）。
 */
export async function tushareQuery(
  token: string,
  apiName: string,
  params: Record<string, string>,
  fields?: string
): Promise<TushareQueryResult> {
  const res = await fetch(TUSHARE_PRO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_name: apiName,
      token,
      params,
      ...(fields ? { fields } : {}),
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    return {
      ok: false,
      code: res.status,
      msg: `Tushare HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: { fields?: string[]; items?: unknown[][] } | null;
  };

  const code = json.code ?? -1;
  if (code !== 0) {
    return {
      ok: false,
      code,
      msg: json.msg ?? 'Tushare 返回异常',
    };
  }

  const fieldsArr = json.data?.fields ?? [];
  const items = json.data?.items ?? [];
  if (!fieldsArr.length) {
    return { ok: true, rows: [] };
  }

  return { ok: true, rows: zipFieldsItems(fieldsArr, items as unknown[][]) };
}

export async function tushareStockName(
  token: string,
  tsCode: string
): Promise<string | undefined> {
  const r = await tushareQuery(token, 'stock_basic', { ts_code: tsCode }, 'ts_code,name');
  if (!r.ok || !r.rows.length) return undefined;
  const n = r.rows[0].name;
  return n != null ? String(n) : undefined;
}
