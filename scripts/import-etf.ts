/**
 * import-etf.ts
 * 从 Tushare index_daily 接口拉取指数日线数据，写入 prices.db
 * （fund_daily 需要付费权限，index_daily 免费可用）
 *
 * 用法: npx tsx scripts/import-etf.ts
 *
 * 目标指数（作为 ETF 的替代品，用于 ATR 波段策略回测）：
 *   000300.SH  沪深300指数  ↔ 510300.SH ETF
 *   000905.SH  中证500指数  ↔ 510500.SH ETF
 *   399006.SZ  创业板指     ↔ 159915.SZ ETF
 *   000016.SH  上证50指数
 */

import Database from 'better-sqlite3';
import path from 'path';
import { tushareQuery } from '../lib/tools/tushareClient';

const TOKEN   = process.env.TUSHARE_TOKEN ?? '';
const DB_PATH = path.join(process.cwd(), 'data', 'prices.db');

const ETF_LIST = [
  { code: '000300.SH', name: '沪深300指数', industry: 'INDEX', market: 'INDEX' },
  { code: '000905.SH', name: '中证500指数', industry: 'INDEX', market: 'INDEX' },
  { code: '399006.SZ', name: '创业板指',    industry: 'INDEX', market: 'INDEX' },
  { code: '000016.SH', name: '上证50指数',  industry: 'INDEX', market: 'INDEX' },
];

// ETF 没有涨跌停机制（理论无限制），设为 0
const ETF_HIGH_LIMIT = 0;
const ETF_LOW_LIMIT  = 0;

const START_DATE = '20150101'; // Tushare YYYYMMDD 格式
const VOL_RATIO_DAYS = 5;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!TOKEN) {
    console.error('❌ 缺少 TUSHARE_TOKEN，请在 .env.local 中配置');
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -256000');

  // 确保表结构存在（和 prices 同表）
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO prices
      (code, date, open, high, low, close, prev_close, quote_rate, volume, turnover,
       high_limit, low_limit, turnover_rate, turnover_rate_f, volume_ratio,
       pe, pe_ttm, pb, ps, ps_ttm, total_mv, circ_mv, name, industry, market)
    VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,null,null,?,null,null,null,null,null,null,null,?,?,?)
  `);

  for (const etf of ETF_LIST) {
    // 查该 ETF 在 DB 中已有的最新日期
    const lastRow = db.prepare('SELECT MAX(date) as d FROM prices WHERE code = ?').get(etf.code) as { d: string | null };
    const lastDate = lastRow.d;

    let startYmd: string;
    if (lastDate) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + 1);
      startYmd = d.toISOString().slice(0, 10).replace(/-/g, '');
      console.log(`\n📅 ${etf.code} (${etf.name}) 已有数据至 ${lastDate}，增量拉取 ${startYmd}~`);
    } else {
      startYmd = START_DATE;
      console.log(`\n📥 ${etf.code} (${etf.name}) 首次拉取，起始 ${startYmd}`);
    }

    const todayYmd = new Date()
      .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
      .replace(/-/g, '');

    if (startYmd > todayYmd) {
      console.log('  ✅ 数据已是最新，跳过');
      continue;
    }

    // index_daily 支持直接按 ts_code + start_date + end_date 批量拉取
    console.log(`  ⏳ 请求 index_daily ${startYmd} ~ ${todayYmd} ...`);
    const res = await tushareQuery(
      TOKEN,
      'index_daily',
      { ts_code: etf.code, start_date: startYmd, end_date: todayYmd },
      'ts_code,trade_date,open,high,low,close,pre_close,pct_chg,vol,amount'
    );
    await sleep(600);

    if (!res.ok) {
      console.error(`  ❌ 拉取失败: ${(res as any).msg}`);
      continue;
    }
    if (res.rows.length === 0) {
      console.log('  ℹ️ 无新数据');
      continue;
    }
    console.log(`  📦 获取 ${res.rows.length} 条记录`);

    // 收集已有量数据用于计算量比（按日期排序后逐行处理）
    const rows = [...res.rows].sort((a, b) =>
      String(a.trade_date).localeCompare(String(b.trade_date))
    );

    // 查 DB 中该 ETF 最近 VOL_RATIO_DAYS 条 volume（用于计算量比起点）
    const recentVols = (db.prepare(
      `SELECT volume FROM prices WHERE code = ? ORDER BY date DESC LIMIT ${VOL_RATIO_DAYS}`
    ).all(etf.code) as { volume: number }[]).map(r => r.volume).reverse();

    const volWindow: number[] = [...recentVols];

    const insertBatch = db.transaction(() => {
      let cnt = 0;
      for (const d of rows) {
        const dateDash = String(d.trade_date).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        const vol = Number(d.vol) || 0;

        // 计算量比
        const avgVol = volWindow.length > 0
          ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length
          : 0;
        const volRatio = avgVol > 0 ? +(vol / avgVol).toFixed(4) : null;

        // 滑动窗口更新
        volWindow.push(vol);
        if (volWindow.length > VOL_RATIO_DAYS) volWindow.shift();

        insertStmt.run(
          etf.code, dateDash,
          Number(d.open)      || null,
          Number(d.high)      || null,
          Number(d.low)       || null,
          Number(d.close)     || null,
          Number(d.pre_close) || null,
          Number(d.pct_chg)   || null,
          vol || null,
          Number(d.amount)    || null,
          ETF_HIGH_LIMIT,
          ETF_LOW_LIMIT,
          volRatio,
          etf.name,
          etf.industry,
          etf.market,
        );
        cnt++;
      }
      return cnt;
    });

    const cnt = insertBatch();
    console.log(`  ✅ 写入 ${cnt} 条`);
  }

  // 汇总
  console.log('\n\n── 写入后 ETF 数据概览 ──');
  for (const etf of ETF_LIST) {
    const r = db.prepare('SELECT COUNT(*) as cnt, MIN(date) as s, MAX(date) as e FROM prices WHERE code=?').get(etf.code) as any;
    console.log(`  ${etf.code} ${etf.name}: ${r.cnt} 条  ${r.s} ~ ${r.e}`);
  }

  db.close();
  console.log('\n✅ ETF 数据导入完成');
}

main().catch(err => {
  console.error('\n❌ 失败:', err);
  process.exit(1);
});
