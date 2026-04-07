/**
 * 提前入场分析：1板买入 vs 2板买入 vs 炸板低吸
 *
 * 核心矛盾：确认越充分，越买不进
 *   1板 → 容易买进（还有换手），但不确定能否2板
 *   2板 → 难买进（封板排队），但确认度高
 *   炸板低吸 → 能买进，但需要判断是否会回封
 *
 * 本脚本分析：
 *   A. 1板当天哪些指标预测「最终3板以上」
 *   B. 「炸板低吸」策略：1板或2板炸板时低吸
 *   C. 最优实战入场路径
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}

function pctStr(n: number, total: number) {
  return `${n}/${total}(${(n/total*100).toFixed(1)}%)`;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  const allDates: string[] = (db.prepare(
    "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT 400"
  ).all() as any[]).map(r => r.date).reverse();

  console.log(`\n${'═'.repeat(78)}`);
  console.log('  📊 提前入场策略分析：1板买入 / 炸板低吸');
  console.log(`  分析区间：${allDates[0]} ~ ${allDates[allDates.length-1]}`);
  console.log(`${'═'.repeat(78)}`);

  // ═══════════════════════════════════════════════════════════════
  // Part A：1板尾盘买入 → 追踪到3板以上
  // ═══════════════════════════════════════════════════════════════
  interface S1 {
    code: string; name: string;
    date1: string;
    t1: number; v1: number; circMv: number; price1: number;
    industry: string;
    hit2: boolean; hit3: boolean; hit4: boolean; hit5: boolean;
    maxBoards: number;
  }

  const samples1: S1[] = [];

  for (let i = 3; i < allDates.length - 5; i++) {
    const date1 = allDates[i];
    const prev2 = allDates.slice(Math.max(0, i-3), i).reverse();
    const next5 = allDates.slice(i+1, i+6);

    const todayLU = db.prepare(`
      SELECT p.code, p.name, p.close, p.high_limit, p.open,
             p.turnover_rate, p.circ_mv, p.volume_ratio, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0 AND p.close >= p.high_limit
        AND p.name NOT LIKE '%ST%' AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
    `).all(date1) as any[];

    for (const bar of todayLU) {
      const circMv = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const t1     = bar.turnover_rate ?? 0;
      const v1     = bar.volume_ratio  ?? 0;
      const price  = bar.close;

      // 基础过滤
      if (price < 4 || price > 40) continue;
      if (circMv > 0 && (circMv < 10 || circMv > 200)) continue;

      // 确认是第1板（之前没有连板）
      let prevBoards = 0;
      for (const pd of prev2) {
        const pb = db.prepare(
          'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
        ).get(bar.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) prevBoards++;
        else break;
      }
      if (prevBoards > 0) continue; // 不是第1板，跳过

      // 追踪后续连板
      let boards = 1;
      for (const nd of next5) {
        const nb = db.prepare(
          'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
        ).get(bar.code, nd) as any;
        if (nb && nb.high_limit > 0 && nb.close >= nb.high_limit) boards++;
        else break;
      }

      samples1.push({
        code: bar.code, name: bar.name, date1,
        t1, v1, circMv, price1: price,
        industry: bar.industry || '未知',
        hit2: boards >= 2,
        hit3: boards >= 3,
        hit4: boards >= 4,
        hit5: boards >= 5,
        maxBoards: boards,
      });
    }
  }

  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ① 1板尾盘买入 → 后续连板概率（1板后买入，总体命中率）');
  console.log(`${'─'.repeat(78)}`);
  console.log(`  1板样本（市值10~200亿，价格4~40元）：${samples1.length}只`);
  console.log(`  → 打到2板：${pctStr(samples1.filter(s=>s.hit2).length, samples1.length)}`);
  console.log(`  → 打到3板：${pctStr(samples1.filter(s=>s.hit3).length, samples1.length)}`);
  console.log(`  → 打到4板：${pctStr(samples1.filter(s=>s.hit4).length, samples1.length)}`);
  console.log(`  → 打到5板：${pctStr(samples1.filter(s=>s.hit5).length, samples1.length)}`);

  // 1板换手分区 → 3板成功率
  console.log(`\n  1板换手率区间 → 后续打到3板概率`);
  console.log(`  换手区间       样本   →2板    →3板    →4板   建议`);
  const tRanges1: [number, number, string][] = [
    [0,  3,  '缩量一字，极难买入'],
    [3,  7,  '✅ 主力吸筹，可尾盘买'],
    [7,  12, '⚠️ 散户追涨，慎重'],
    [12, 20, '❌ 换手过高，情绪板'],
    [20, 99, '❌ 换手极高，不参与'],
  ];
  for (const [lo, hi, advice] of tRanges1) {
    const g = samples1.filter(s => s.t1 > 0 && s.t1 >= lo && s.t1 < hi);
    if (g.length < 5) continue;
    const r2 = (g.filter(s=>s.hit2).length/g.length*100).toFixed(1);
    const r3 = (g.filter(s=>s.hit3).length/g.length*100).toFixed(1);
    const r4 = (g.filter(s=>s.hit4).length/g.length*100).toFixed(1);
    console.log(
      `  ${`${lo}~${hi}%`.padEnd(14)} ${String(g.length).padStart(5)}只` +
      `  ${r2.padStart(5)}%  ${r3.padStart(5)}%  ${r4.padStart(5)}%  ${advice}`
    );
  }

  // 1板量比分区 → 3板成功率
  console.log(`\n  1板量比区间 → 后续打到3板概率`);
  console.log(`  量比区间       样本   →2板    →3板    →4板`);
  const vRanges1: [number, number][] = [[0,1],[1,2],[2,3],[3,5],[5,99]];
  for (const [lo, hi] of vRanges1) {
    const g = samples1.filter(s => s.v1 > 0 && s.v1 >= lo && s.v1 < hi);
    if (g.length < 5) continue;
    const r2 = (g.filter(s=>s.hit2).length/g.length*100).toFixed(1);
    const r3 = (g.filter(s=>s.hit3).length/g.length*100).toFixed(1);
    const r4 = (g.filter(s=>s.hit4).length/g.length*100).toFixed(1);
    console.log(
      `  ${`${lo}~${hi === 99 ? '∞' : hi}`.padEnd(14)} ${String(g.length).padStart(5)}只` +
      `  ${r2.padStart(5)}%  ${r3.padStart(5)}%  ${r4.padStart(5)}%`
    );
  }

  // 1板市值区间
  console.log(`\n  1板市值区间 → 后续打到3板概率`);
  const mvRanges1: [number, number][] = [[0,20],[20,50],[50,80],[80,120],[120,200]];
  console.log(`  市值区间       样本   →2板    →3板    →4板`);
  for (const [lo, hi] of mvRanges1) {
    const g = samples1.filter(s => s.circMv > 0 && s.circMv >= lo && s.circMv < hi);
    if (g.length < 5) continue;
    const r2 = (g.filter(s=>s.hit2).length/g.length*100).toFixed(1);
    const r3 = (g.filter(s=>s.hit3).length/g.length*100).toFixed(1);
    const r4 = (g.filter(s=>s.hit4).length/g.length*100).toFixed(1);
    console.log(
      `  ${`${lo}~${hi}亿`.padEnd(14)} ${String(g.length).padStart(5)}只` +
      `  ${r2.padStart(5)}%  ${r3.padStart(5)}%  ${r4.padStart(5)}%`
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Part B：炸板低吸策略（在1板或2板炸板时买入）
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ② 炸板低吸策略（股票涨停后开板，低吸等回封）');
  console.log(`${'─'.repeat(78)}`);

  interface ZhaBan {
    code: string; name: string;
    date: string;
    boardNum: number;      // 第几板时炸板
    openPct: number;       // 开盘幅度
    lowPct: number;        // 最低回调幅度（相对涨停价）
    closePct: number;      // 收盘相对前收
    reSealed: boolean;     // 当天回封涨停
    hit2: boolean;         // 次日涨停
    hit3: boolean;         // 后天涨停
    t: number; v: number;
    circMv: number;
  }

  const zhaBanSamples: ZhaBan[] = [];

  for (let i = 3; i < allDates.length - 3; i++) {
    const date  = allDates[i];
    const prev5 = allDates.slice(Math.max(0, i-5), i).reverse();
    const next1 = allDates[i+1] ?? '';
    const next2 = allDates[i+2] ?? '';

    // 当日「曾经涨停但收盘未封板」的股票（炸板股）
    const zhaBanStocks = db.prepare(`
      SELECT p.code, p.name, p.open, p.high, p.low, p.close,
             p.high_limit, p.prev_close, p.turnover_rate, p.circ_mv, p.volume_ratio, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0
        AND p.high >= p.high_limit * 0.999   -- 曾经到过涨停
        AND p.close < p.high_limit            -- 但收盘未封
        AND p.name NOT LIKE '%ST%' AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
    `).all(date) as any[];

    for (const bar of zhaBanStocks) {
      const circMv = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      if (circMv > 0 && (circMv < 10 || circMv > 200)) continue;
      if (bar.close < 4 || bar.close > 50) continue;

      // 判断当前是第几板炸板
      let prevBoards = 0;
      for (const pd of prev5) {
        const pb = db.prepare(
          'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
        ).get(bar.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) prevBoards++;
        else break;
      }

      // 只看1板炸 和 2板炸
      if (prevBoards > 2) continue;
      const boardNum = prevBoards + 1; // 第1板炸 or 第2板炸

      const openPct  = bar.prev_close > 0 ? (bar.open - bar.prev_close) / bar.prev_close * 100 : 0;
      const lowPct   = bar.high_limit > 0 ? (bar.low  - bar.high_limit) / bar.high_limit * 100 : 0;
      const closePct = bar.prev_close > 0 ? (bar.close - bar.prev_close) / bar.prev_close * 100 : 0;
      const reSealed = false; // 收盘未封，所以肯定没回封到收盘

      const nb1 = next1 ? db.prepare('SELECT close, high_limit FROM prices WHERE code=? AND date=?').get(bar.code, next1) as any : null;
      const nb2 = next2 ? db.prepare('SELECT close, high_limit FROM prices WHERE code=? AND date=?').get(bar.code, next2) as any : null;

      zhaBanSamples.push({
        code: bar.code, name: bar.name, date, boardNum,
        openPct, lowPct, closePct, reSealed,
        hit2: !!nb1 && nb1.high_limit > 0 && nb1.close >= nb1.high_limit,
        hit3: !!nb2 && nb2.high_limit > 0 && nb2.close >= nb2.high_limit,
        t: bar.turnover_rate ?? 0,
        v: bar.volume_ratio  ?? 0,
        circMv,
      });
    }
  }

  const zb1 = zhaBanSamples.filter(s => s.boardNum === 1);
  const zb2 = zhaBanSamples.filter(s => s.boardNum === 2);

  console.log(`  总炸板样本：${zhaBanSamples.length}只`);
  console.log(`  → 1板炸板：${zb1.length}只  → 2板炸板：${zb2.length}只\n`);

  const printZb = (label: string, g: ZhaBan[]) => {
    if (!g.length) return;
    const hit2 = g.filter(s=>s.hit2).length;
    const hit3 = g.filter(s=>s.hit3).length;
    const closeMedian = median(g.map(s=>s.closePct));
    const lowMedian   = median(g.map(s=>s.lowPct));
    console.log(`  ${label}（${g.length}只）：`);
    console.log(`   收盘相对前收中位涨跌：${closeMedian.toFixed(2)}%`);
    console.log(`   炸板最低相对涨停价中位：${lowMedian.toFixed(2)}%`);
    console.log(`   次日涨停：${pctStr(hit2, g.length)}`);
    console.log(`   后天涨停：${pctStr(hit3, g.length)}`);
  };

  printZb('1板炸板', zb1);
  console.log();
  printZb('2板炸板', zb2);

  // 炸板低点回调幅度
  console.log(`\n  炸板低吸的最优买入区间（炸板后回调幅度）：`);
  console.log(`  低吸幅度（相对涨停价）   次日涨停   建议`);
  const lowRanges: [number, number, string][] = [
    [-3, 0,  '极浅回调，回封意愿强，可低吸'],
    [-5, -3, '正常调整，可低吸'],
    [-8, -5, '深度回调，风险增加'],
    [-99,-8, '暴跌，不参与'],
  ];
  for (const [lo, hi, advice] of lowRanges) {
    const g = zhaBanSamples.filter(s => s.lowPct >= lo && s.lowPct < hi);
    if (!g.length) continue;
    const r = (g.filter(s=>s.hit2).length / g.length * 100).toFixed(1);
    console.log(
      `  ${`${lo}%~${hi}%`.padEnd(20)} ${String(g.length).padStart(5)}只  ${r.padStart(5)}%  ${advice}`
    );
  }

  // 换手率与炸板低吸
  console.log(`\n  炸板当天换手率 → 次日涨停率`);
  console.log(`  换手区间       样本   次日涨停   建议`);
  const tRangesZb: [number, number, string][] = [
    [0,  5,  '✅ 炸板换手低，回封意愿强'],
    [5,  10, '⚠️ 中等换手'],
    [10, 20, '⚠️ 较高换手，出货嫌疑'],
    [20, 99, '❌ 极高换手，不参与'],
  ];
  for (const [lo, hi, advice] of tRangesZb) {
    const g = zhaBanSamples.filter(s => s.t > 0 && s.t >= lo && s.t < hi);
    if (g.length < 5) continue;
    const r = (g.filter(s=>s.hit2).length/g.length*100).toFixed(1);
    console.log(
      `  ${`${lo}~${hi}%`.padEnd(14)} ${String(g.length).padStart(5)}只  ${r.padStart(5)}%  ${advice}`
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 总结：实战入场路径决策树
  // ═══════════════════════════════════════════════════════════════
  // 1板黄金条件计算
  const gold1 = samples1.filter(s =>
    s.t1 > 0 && s.t1 >= 3 && s.t1 < 7 &&
    s.v1 > 0 && s.v1 >= 1 && s.v1 < 3 &&
    s.circMv >= 20 && s.circMv <= 80
  );
  const zbGold = zhaBanSamples.filter(s =>
    s.t > 0 && s.t < 10 && s.lowPct >= -5 && s.lowPct < 0
  );

  console.log(`\n${'═'.repeat(78)}`);
  console.log('  💡 实战入场路径决策树（终极版）');
  console.log(`${'═'.repeat(78)}`);
  console.log(`
  买不进怎么办？三条路：

  ┌─────────────────────────────────────────────────────────────────────┐
  │  路径①：提前到1板尾盘买（最推荐，能买进）                              │
  │                                                                     │
  │  入场时机：第1板当天 14:30~14:55                                      │
  │  入场条件（1板选股黄金标准）：                                         │
  │    换手率 3%~7%（3板+成功率最高区间）                                  │
  │    量比   1~3（放量启动，但不过热）                                    │
  │    市值   20~80亿（主力控盘最优区间）                                   │
  │    股价   4~30元，排除ST/退市                                          │
  │    行业   有板块联动更佳（供气供热/工程机械等强势行业）                    │
  │                                                                     │
  │  黄金1板(换手3~7%,量比1~3,市值20~80亿)共${gold1.length}只样本：         │
  │    →2板: ${pctStr(gold1.filter(s=>s.hit2).length, gold1.length).padEnd(15)}  │
  │    →3板: ${pctStr(gold1.filter(s=>s.hit3).length, gold1.length).padEnd(15)}  │
  │    →4板: ${pctStr(gold1.filter(s=>s.hit4).length, gold1.length).padEnd(15)}  │
  │                                                                     │
  │  止损：次日不封2板 → 开盘出（亏损通常 < 5%）                            │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  路径②：炸板低吸（1板或2板炸板时买入，等回封）                          │
  │                                                                     │
  │  入场时机：当天炸板后回调区间买入                                       │
  │  入场条件：                                                           │
  │    炸板后最低回调幅度 < 5%（浅回调，主力未放弃）                          │
  │    当天换手率 < 10%（出货量不大）                                       │
  │    量比不急速放大（没有砸盘迹象）                                        │
  │    时间：下午2点前还未回封则放弃                                        │
  │                                                                     │
  │  炸板低吸样本（换手<10%,回调<5%）共${zbGold.length}只：                   │
  │    次日涨停: ${pctStr(zbGold.filter(s=>s.hit2).length, zbGold.length).padEnd(15)}             │
  │    后天涨停: ${pctStr(zbGold.filter(s=>s.hit3).length, zbGold.length).padEnd(15)}             │
  │                                                                     │
  │  止损：当天跌回开盘价 或 跌超5%（相对涨停价）→ 直接出                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  路径③：次日集合竞价（前两路都错过时）                                   │
  │                                                                     │
  │  场景：2板一字，买不进；炸板也没低吸                                    │
  │  操作：次日（打3板当天）集合竞价 9:20 挂涨停价限价单                      │
  │  适用：竞价显示开盘预计 3~8%（不是一字板）                              │
  │  注意：封板率仅 32%，炸板率 25%，不及路径①②稳健                        │
  │  底线：若开盘 < 3% 或 > 10% → 撤单放弃                               │
  └─────────────────────────────────────────────────────────────────────┘

  选择逻辑：
    有提前发现 1板 → 选路径①（最优）
    错过1板，2板炸了 → 选路径②（低吸）
    错过1板，2板一字封死 → 选路径③（竞价）
    以上都错过 → 放弃，等下一个机会
  `);

  console.log(`${'═'.repeat(78)}\n`);
  db.close();
}

main();
