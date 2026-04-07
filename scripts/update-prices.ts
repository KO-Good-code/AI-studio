/**
 * update-prices.ts
 * 从 Tushare 拉取增量日线数据，追加到 prices.db
 *
 * 权限要求: daily + stock_basic（免费 token 均可访问）
 * volume_ratio 从历史 vol 自行计算（5日均量比）
 * high_limit/low_limit 按板块规则从 pre_close 推算
 *
 * 用法: npx tsx scripts/update-prices.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { tushareQuery } from '../lib/tools/tushareClient';

const TOKEN = process.env.TUSHARE_TOKEN ?? '';
const DB_PATH = path.join(process.cwd(), 'data', 'prices.db');
const VOL_RATIO_DAYS = 5; // 量比 = 今日量 / 近N日均量

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 生成两个 YYYYMMDD 之间的所有工作日（跳过周六/日） */
function genWorkdays(startYmd: string, endYmd: string): string[] {
  const result: string[] = [];
  const cur = new Date(`${startYmd.slice(0,4)}-${startYmd.slice(4,6)}-${startYmd.slice(6,8)}`);
  const end = new Date(`${endYmd.slice(0,4)}-${endYmd.slice(4,6)}-${endYmd.slice(6,8)}`);
  while (cur <= end) {
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) {
      result.push(cur.toISOString().slice(0,10).replace(/-/g, ''));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/** 按板块和ST状态计算涨跌停价 */
function calcLimits(preClose: number, tsCode: string, name: string) {
  const code6 = tsCode.split('.')[0];
  const isST = /ST/i.test(name);
  let rate: number;
  if (isST) {
    rate = 0.05;
  } else if (code6.startsWith('688') || code6.startsWith('689')) {
    rate = 0.20;
  } else if (code6.startsWith('300') || code6.startsWith('301') || code6.startsWith('302')) {
    rate = 0.20;
  } else if (code6.startsWith('8') || code6.startsWith('4') || code6.startsWith('920')) {
    rate = 0.30;
  } else {
    rate = 0.10;
  }
  return {
    high_limit: Math.round(preClose * (1 + rate) * 100) / 100,
    low_limit:  Math.round(preClose * (1 - rate) * 100) / 100,
  };
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

  // ── 1. 查当前最新日期（只看 A 股，排除 ETF/INDEX 数据干扰）────
  const lastRow = db.prepare(
    "SELECT MAX(date) as d FROM prices WHERE market NOT IN ('ETF','INDEX') AND market IS NOT NULL"
  ).get() as { d: string };
  const lastDate = lastRow.d ?? '2020-01-01';
  console.log(`\n📅 数据库最新日期: ${lastDate}`);

  const startDt = new Date(lastDate);
  startDt.setDate(startDt.getDate() + 1);
  const startYmd = startDt.toISOString().slice(0, 10).replace(/-/g, '');
  const todayYmd = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    .replace(/-/g, '');

  if (startYmd > todayYmd) {
    console.log('✅ 数据已是最新，无需更新');
    db.close();
    return;
  }

  // ── 2. 生成候选工作日（节假日会因 daily 返回0行被自动跳过）──
  const candidates = genWorkdays(startYmd, todayYmd);
  console.log(`📥 候选工作日(${candidates.length}天): ${candidates.join(', ')}`);

  // ── 3. 拉取 stock_basic（name / industry / market）────────
  console.log('\n📚 获取股票基本信息...');
  // 先从 DB 里建映射（大部分股票已有）
  const stockInfo = new Map<string, { name: string; industry: string; market: string }>();
  const dbStocks = db.prepare(
    'SELECT DISTINCT code, name, industry, market FROM prices WHERE date = ?'
  ).all(lastDate) as { code: string; name: string; industry: string; market: string }[];
  for (const r of dbStocks) stockInfo.set(r.code, r);
  console.log(`  DB 已有 ${stockInfo.size} 只`);

  // 再用 Tushare stock_basic 补全（含新上市股票）
  const sbRes = await tushareQuery(TOKEN, 'stock_basic', { list_status: 'L' }, 'ts_code,name,industry,market');
  if (sbRes.ok) {
    let newCnt = 0;
    for (const r of sbRes.rows) {
      const code = String(r.ts_code);
      if (!stockInfo.has(code)) {
        stockInfo.set(code, {
          name: String(r.name ?? ''),
          industry: String(r.industry ?? ''),
          market: String(r.market ?? ''),
        });
        newCnt++;
      }
    }
    console.log(`  stock_basic 补充 ${newCnt} 只新股`);
  } else {
    console.warn('  ⚠️ stock_basic 失败:', (sbRes as any).msg);
  }
  await sleep(500);

  // ── 4. 准备 vol 历史（用于计算量比）─────────────────────
  // 查每只股票最近 VOL_RATIO_DAYS 天的 vol 均值
  const avgVolStmt = db.prepare(
    `SELECT AVG(volume) as avg_vol FROM
     (SELECT volume FROM prices WHERE code = ? ORDER BY date DESC LIMIT ${VOL_RATIO_DAYS})`
  );

  // ── 5. 准备 INSERT ────────────────────────────────────────
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO prices
      (code, date, open, high, low, close, prev_close, quote_rate, volume, turnover,
       high_limit, low_limit, turnover_rate, turnover_rate_f, volume_ratio,
       pe, pe_ttm, pb, ps, ps_ttm, total_mv, circ_mv, name, industry, market)
    VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,null,null,?,null,null,null,null,null,null,null,?,?,?)
  `);

  // ── 6. 逐日拉取 ──────────────────────────────────────────
  let totalInserted = 0;
  const insertedDates: string[] = [];

  for (const ymd of candidates) {
    const dateDash = `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;
    process.stdout.write(`\n⏳ ${dateDash} `);

    const dailyRes = await tushareQuery(
      TOKEN, 'daily',
      { trade_date: ymd },
      'ts_code,open,high,low,close,pre_close,pct_chg,vol,amount'
    );
    await sleep(400);

    if (!dailyRes.ok) {
      process.stdout.write(`❌ ${(dailyRes as any).msg}`);
      continue;
    }
    if (dailyRes.rows.length === 0) {
      process.stdout.write('(非交易日，跳过)');
      continue;
    }
    process.stdout.write(`${dailyRes.rows.length}只 `);

    const insertBatch = db.transaction(() => {
      let cnt = 0;
      for (const d of dailyRes.rows) {
        const tsCode   = String(d.ts_code);
        const preClose = Number(d.pre_close) || 0;
        const vol      = Number(d.vol) || 0;
        const info     = stockInfo.get(tsCode) ?? { name: '', industry: '', market: '' };
        const { high_limit, low_limit } = calcLimits(preClose, tsCode, info.name);

        // 量比：今日量 / 近5日均量
        const avgRow = avgVolStmt.get(tsCode) as { avg_vol: number | null };
        const avgVol = avgRow?.avg_vol ?? 0;
        const volRatio = avgVol > 0 ? +(vol / avgVol).toFixed(4) : null;

        insertStmt.run(
          tsCode, dateDash,
          Number(d.open) || null,
          Number(d.high) || null,
          Number(d.low)  || null,
          Number(d.close)|| null,
          preClose || null,
          Number(d.pct_chg) || null,
          vol || null,
          Number(d.amount) || null,
          high_limit, low_limit,
          volRatio,
          info.name || null,
          info.industry || null,
          info.market || null,
        );
        cnt++;
      }
      return cnt;
    });

    const cnt = insertBatch();
    totalInserted += cnt;
    insertedDates.push(dateDash);
    process.stdout.write(`→ 写入${cnt}条`);
  }

  // ── 7. 汇总 ──────────────────────────────────────────────
  const newLast = (db.prepare('SELECT MAX(date) as d FROM prices').get() as { d: string }).d;
  const total   = (db.prepare('SELECT COUNT(*) as c FROM prices').get() as { c: number }).c;

  console.log(`\n\n✅ 更新完成！`);
  console.log(`   已更新日期: ${insertedDates.join(', ') || '无'}`);
  console.log(`   新增记录: ${totalInserted.toLocaleString()} 条`);
  console.log(`   数据库最新日期: ${newLast}`);
  console.log(`   数据库总行数: ${total.toLocaleString()}`);
  db.close();
}

main().catch((err) => {
  console.error('\n❌ 更新失败:', err);
  process.exit(1);
});
