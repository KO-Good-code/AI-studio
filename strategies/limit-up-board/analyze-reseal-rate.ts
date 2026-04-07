/**
 * 分析 2进3 回封打板的炸板概率
 * 回封定义：Day3 开盘 < 涨停价，盘中高点 >= 涨停价
 * 炸板定义：回封当日收盘 < 涨停价
 */
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');
const PARAMS = {
  maxTurnover2: 7.0,
  maxVolRatio2:  1.5,
  minCircMv:    20,
  maxCircMv:   150,
  minPrice:      4.0,
  maxPrice:     40.0,
};

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  // 取近1年所有交易日
  const allDates: string[] = (db.prepare(
    `SELECT DISTINCT date FROM prices
     WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT 400`
  ).all() as any[]).map(r => r.date).reverse();

  let total = 0;         // 总回封样本
  let zhabanCount = 0;   // 炸板数
  let sealCount   = 0;   // 封板数
  
  // 开盘折扣分段统计
  const openBuckets: Record<string, {total:number,zhaban:number}> = {
    '平开(0%)':       {total:0,zhaban:0},
    '低开1~3%':      {total:0,zhaban:0},
    '低开3~5%':      {total:0,zhaban:0},
    '低开5~8%':      {total:0,zhaban:0},
    '低开8%以上':    {total:0,zhaban:0},
  };

  // 换手分段
  const turnBuckets: Record<string, {total:number,zhaban:number}> = {
    '<2%':   {total:0,zhaban:0},
    '2~4%':  {total:0,zhaban:0},
    '4~7%':  {total:0,zhaban:0},
    '7~10%': {total:0,zhaban:0},
    '>10%':  {total:0,zhaban:0},
  };

  // 市值分段
  const mvBuckets: Record<string, {total:number,zhaban:number}> = {
    '<30亿':    {total:0,zhaban:0},
    '30~50亿':  {total:0,zhaban:0},
    '50~80亿':  {total:0,zhaban:0},
    '80~150亿': {total:0,zhaban:0},
    '>150亿':   {total:0,zhaban:0},
  };

  for (let i = 5; i < allDates.length; i++) {
    const today = allDates[i];
    const prev5  = allDates.slice(i - 5, i).reverse();

    // 取今日回封候选（开盘非一字板，盘中触碰涨停）—— 仅主板
    const bars = db.prepare(`
      SELECT code, name, open, high, low, close, high_limit, prev_close,
             turnover_rate, volume_ratio, circ_mv
      FROM prices
      WHERE date = ?
        AND high_limit > 0
        AND open  < high_limit * 0.999
        AND high >= high_limit * 0.999
        AND name NOT LIKE '%ST%' AND name NOT LIKE '%退%'
        AND market NOT IN ('ETF','INDEX')
        AND (
          code LIKE '600%' OR code LIKE '601%' OR code LIKE '603%' OR code LIKE '605%'
          OR code LIKE '000%' OR code LIKE '001%' OR code LIKE '002%' OR code LIKE '003%'
        )
    `).all(today) as any[];

    for (const bar of bars) {
      const price   = bar.close;
      const circMv  = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const t3      = bar.turnover_rate ?? 0;

      if (price < PARAMS.minPrice || price > PARAMS.maxPrice) continue;
      if (circMv > 0 && (circMv < PARAMS.minCircMv || circMv > PARAMS.maxCircMv)) continue;

      // 确认恰好2连板
      let boards = 0;
      let d2bar: any = null;
      for (const pd of prev5) {
        const pb = db.prepare(
          'SELECT close, high_limit, turnover_rate, volume_ratio FROM prices WHERE code=? AND date=?'
        ).get(bar.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) {
          boards++;
          if (boards === 1) d2bar = pb;
        } else break;
      }
      if (boards !== 2 || !d2bar) continue;

      const t2 = d2bar.turnover_rate ?? 0;
      const v2 = d2bar.volume_ratio  ?? 0;
      if (t2 > 0 && t2 > PARAMS.maxTurnover2) continue;
      if (v2 > 0 && v2 > PARAMS.maxVolRatio2) continue;

      // 判断炸板
      const isZhaban = bar.close < bar.high_limit * 0.999;
      total++;
      if (isZhaban) zhabanCount++; else sealCount++;

      // 开盘折扣分段
      const openDrop = (bar.open - bar.high_limit) / bar.high_limit;
      let ob: typeof openBuckets[string];
      if (openDrop >= -0.005)      ob = openBuckets['平开(0%)'];
      else if (openDrop >= -0.03)  ob = openBuckets['低开1~3%'];
      else if (openDrop >= -0.05)  ob = openBuckets['低开3~5%'];
      else if (openDrop >= -0.08)  ob = openBuckets['低开5~8%'];
      else                          ob = openBuckets['低开8%以上'];
      ob.total++;
      if (isZhaban) ob.zhaban++;

      // 换手分段（用Day3换手）
      let tb: typeof turnBuckets[string];
      if (t3 < 2)       tb = turnBuckets['<2%'];
      else if (t3 < 4)  tb = turnBuckets['2~4%'];
      else if (t3 < 7)  tb = turnBuckets['4~7%'];
      else if (t3 < 10) tb = turnBuckets['7~10%'];
      else               tb = turnBuckets['>10%'];
      tb.total++;
      if (isZhaban) tb.zhaban++;

      // 市值分段
      let mb: typeof mvBuckets[string];
      if (circMv < 30)       mb = mvBuckets['<30亿'];
      else if (circMv < 50)  mb = mvBuckets['30~50亿'];
      else if (circMv < 80)  mb = mvBuckets['50~80亿'];
      else if (circMv < 150) mb = mvBuckets['80~150亿'];
      else                    mb = mvBuckets['>150亿'];
      mb.total++;
      if (isZhaban) mb.zhaban++;
    }
  }

  const zhabanRate = total > 0 ? (zhabanCount / total * 100) : 0;
  const sealRate   = total > 0 ? (sealCount   / total * 100) : 0;

  console.log('\n' + '═'.repeat(60));
  console.log('  📊 2进3 回封打板 炸板率分析（近1年，仅主板）');
  console.log('═'.repeat(60));
  console.log(`  样本总数：${total} 只`);
  console.log(`  炸板数：  ${zhabanCount} 只   炸板率：${zhabanRate.toFixed(1)}%`);
  console.log(`  封板数：  ${sealCount} 只    封板率：${sealRate.toFixed(1)}%`);

  console.log('\n  ── 按开盘折扣分段 ─────────────────────────────────');
  console.log(`  ${'区间'.padEnd(12)} ${'样本'.padStart(6)} ${'炸板'.padStart(6)} ${'炸板率'.padStart(8)}`);
  for (const [label, s] of Object.entries(openBuckets)) {
    if (s.total === 0) continue;
    const rate = (s.zhaban / s.total * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(s.zhaban / s.total * 20));
    console.log(`  ${label.padEnd(12)} ${String(s.total).padStart(6)} ${String(s.zhaban).padStart(6)} ${(rate + '%').padStart(8)}  ${bar}`);
  }

  console.log('\n  ── 按Day3换手率分段 ────────────────────────────────');
  console.log(`  ${'区间'.padEnd(10)} ${'样本'.padStart(6)} ${'炸板'.padStart(6)} ${'炸板率'.padStart(8)}`);
  for (const [label, s] of Object.entries(turnBuckets)) {
    if (s.total === 0) continue;
    const rate = (s.zhaban / s.total * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(s.zhaban / s.total * 20));
    console.log(`  ${label.padEnd(10)} ${String(s.total).padStart(6)} ${String(s.zhaban).padStart(6)} ${(rate + '%').padStart(8)}  ${bar}`);
  }

  console.log('\n  ── 按流通市值分段 ──────────────────────────────────');
  console.log(`  ${'区间'.padEnd(10)} ${'样本'.padStart(6)} ${'炸板'.padStart(6)} ${'炸板率'.padStart(8)}`);
  for (const [label, s] of Object.entries(mvBuckets)) {
    if (s.total === 0) continue;
    const rate = (s.zhaban / s.total * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(s.zhaban / s.total * 20));
    console.log(`  ${label.padEnd(10)} ${String(s.total).padStart(6)} ${String(s.zhaban).padStart(6)} ${(rate + '%').padStart(8)}  ${bar}`);
  }

  console.log('\n  说明：');
  console.log('    回封 = Day3 开盘<涨停价 且 盘中最高价>=涨停价');
  console.log('    炸板 = 回封后当日收盘 < 涨停价');
  console.log('    样本须满足：2连板(换手<7%,量比<1.5)，市值20~150亿，价格4~40元');
  console.log('═'.repeat(60) + '\n');

  db.close();
}

main();
