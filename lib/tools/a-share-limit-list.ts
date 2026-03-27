import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  chinaTodayYmd,
  getTushareToken,
  tushareQuery,
} from './tushareClient';
import { fetchEastMoneyLimitListFallback } from './eastmoney-limit-list';

const LIMIT_LIST_FIELDS =
  'trade_date,ts_code,name,industry,close,pct_chg,amount,fd_amount,first_time,last_time,open_times,up_stat,limit_times,limit,float_mv,total_mv,turnover_ratio';

/** 成功结果缓存，避免同日同参数重复请求 */
const limitListOkCache = new Map<
  string,
  { expiresAt: number; body: string }
>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

function cacheKey(
  date: string,
  limit_type: string,
  exchange: string | undefined,
  max_rows: number
): string {
  return `${date}|${limit_type}|${exchange ?? ''}|${max_rows}`;
}

function evictCacheIfNeeded() {
  if (limitListOkCache.size <= CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of limitListOkCache) {
    if (v.expiresAt < now || limitListOkCache.size > CACHE_MAX_ENTRIES) {
      limitListOkCache.delete(k);
    }
  }
}

function tushareLimitListHint(code: number, msg: string): string {
  if (code === 40203) {
    return (
      '当前账号对 limit_list_d 的权限为「每天最多调用 1 次」。今日已成功调用过后，再次请求会失败。' +
      '已自动尝试东方财富兜底（若查询日为今日）。亦可提升积分：https://tushare.pro/document/1?doc_id=108 。' +
      ` 官方说明：${msg}`
    );
  }
  return (
    '该接口需足够积分与权限；已尝试东财兜底（若适用）。详情见 Tushare 文档。'
  );
}

/**
 * Tushare limit_list_d + 东方财富 clist 兜底（无 Token / 限额 / 失败时，且仅涨停U、跌停D、且查询日为今日）
 */
export const aShareLimitListTool = new DynamicStructuredTool({
  name: 'aShareLimitList',
  description: `查询 A 股某一交易日的全市场涨停(U)、跌停(D)、炸板(Z) 列表。
优先使用 Tushare limit_list_d（需 TUSHARE_TOKEN，部分账号每日限调用次数）。
若 Tushare 不可用或超限失败：对「涨停/跌停」且查询日为**今天**时，自动改用东方财富公开接口近似筛选（非官方封板口径，无连板/封单等字段）。
炸板(Z) 暂无东财等价兜底，主要依赖 Tushare。`,

  schema: z.object({
    trade_date: z
      .string()
      .optional()
      .describe(
        '交易日，格式 YYYYMMDD。省略时默认按东八区「今天」；若无数据可改填最近交易日'
      ),
    limit_type: z
      .enum(['U', 'D', 'Z'])
      .describe('U=涨停 D=跌停 Z=炸板'),
    exchange: z
      .enum(['SH', 'SZ', 'BJ'])
      .optional()
      .describe('可选：只保留上交所/深交所/北交所'),
    max_rows: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('最多返回条数，默认 200，避免消息过长'),
  }),

  func: async ({
    trade_date,
    limit_type,
    exchange,
    max_rows = 200,
  }) => {
    const date = (trade_date?.replace(/\D/g, '') || chinaTodayYmd()).slice(0, 8);
    if (date.length !== 8) {
      return JSON.stringify({ error: 'trade_date 须为 8 位 YYYYMMDD' });
    }

    const ck = cacheKey(date, limit_type, exchange, max_rows);
    const hit = limitListOkCache.get(ck);
    if (hit && Date.now() < hit.expiresAt) {
      console.log(`📊 aShareLimitList 命中缓存 ${ck}`);
      return hit.body;
    }

    const token = getTushareToken();
    let tushareErr: { code: number; msg: string } | null = null;

    if (token) {
      const params: Record<string, string> = {
        trade_date: date,
        limit_type,
      };
      if (exchange) params.exchange = exchange;

      console.log(
        `📊 aShareLimitList Tushare ${date} type=${limit_type} ex=${exchange ?? 'ALL'}`
      );

      const r = await tushareQuery(token, 'limit_list_d', params, LIMIT_LIST_FIELDS);

      if (r.ok) {
        const rows = r.rows.slice(0, max_rows);
        if (rows.length > 0) {
          const out = {
            数据源: 'Tushare Pro / limit_list_d',
            交易日期: date,
            类型: limit_type === 'U' ? '涨停' : limit_type === 'D' ? '跌停' : '炸板',
            交易所筛选: exchange ?? '全部',
            返回条数: rows.length,
            是否截断: r.rows.length > max_rows,
            列表: rows,
            说明:
              '不含 ST 等口径以 Tushare 为准；不构成投资建议。若条数为 0 可能是非交易日或当日无涨跌停记录。',
          };
          const body = JSON.stringify(out, null, 2);
          evictCacheIfNeeded();
          limitListOkCache.set(ck, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            body,
          });
          return body;
        }
        if (limit_type === 'Z') {
          const out = {
            数据源: 'Tushare Pro / limit_list_d',
            交易日期: date,
            类型: '炸板',
            交易所筛选: exchange ?? '全部',
            返回条数: 0,
            列表: [],
            说明:
              '当日无炸板记录或非交易日；不构成投资建议。',
          };
          const body = JSON.stringify(out, null, 2);
          evictCacheIfNeeded();
          limitListOkCache.set(ck, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            body,
          });
          return body;
        }
        console.warn(
          `[aShareLimitList] Tushare 返回 0 条，尝试东财兜底（U/D 且今日）`
        );
      } else {
        tushareErr = { code: r.code, msg: r.msg };
        console.warn(
          `[aShareLimitList] Tushare 失败 ${r.code}，尝试东财兜底:`,
          r.msg
        );
      }
    } else {
      console.warn('[aShareLimitList] 未配置 TUSHARE_TOKEN，使用东财兜底（若适用）');
    }

    if (limit_type === 'Z') {
      return JSON.stringify(
        {
          error: '无法获取炸板(Z) 数据',
          tushare: tushareErr
            ? { code: tushareErr.code, msg: tushareErr.msg }
            : token
              ? undefined
              : '未配置 TUSHARE_TOKEN',
          hint:
            '炸板榜单暂无东方财富等价兜底。请配置 TUSHARE_TOKEN 并确保 limit_list_d 权限，或隔日再试。',
        },
        null,
        2
      );
    }

    if (date !== chinaTodayYmd()) {
      return JSON.stringify(
        {
          error: '无法使用东财兜底：仅支持查询「今日」快照',
          请求日期: date,
          今日: chinaTodayYmd(),
          tushare: tushareErr,
          hint:
            '历史交易日涨跌停名单需 Tushare limit_list_d 成功返回；请提升积分或改日重试。',
        },
        null,
        2
      );
    }

    const emBody = await fetchEastMoneyLimitListFallback({
      limit_type,
      max_rows,
      exchange,
      trade_date: date,
    });

    try {
      const parsed = JSON.parse(emBody) as { error?: string; 列表?: unknown };
      if (parsed.error && parsed.列表 === undefined) {
        return JSON.stringify(
          {
            ...parsed,
            tushare: tushareErr,
          },
          null,
          2
        );
      }
    } catch {
      return emBody;
    }

    const hint40203 =
      tushareErr?.code === 40203
        ? tushareLimitListHint(40203, tushareErr.msg)
        : undefined;

    const finalObj = JSON.parse(emBody) as Record<string, unknown>;
    if (hint40203) {
      finalObj.Tushare说明 = hint40203;
    }
    if (tushareErr && !hint40203) {
      finalObj.Tushare失败 = { code: tushareErr.code, msg: tushareErr.msg };
    }

    const body = JSON.stringify(finalObj, null, 2);
    evictCacheIfNeeded();
    limitListOkCache.set(ck, { expiresAt: Date.now() + CACHE_TTL_MS, body });
    return body;
  },
});
