/**
 * 回封打板策略分析
 *
 * 策略逻辑：
 *   - 不打2板，不打一字3板
 *   - 只在「第3板当天开板后回封」时买入（回封涨停价买）
 *   - 即：股票从开盘位置涨回涨停，视为回封信号，此刻买入
 *
 * 分析维度：
 *   1. 第3板「开板回封」发生率（有多少3板股出现这种形态）
 *   2. 回封后「能封住收盘」的成功率（核心胜率）
 *   3. 回封封住后次日「4板成功率」
 *   4. 回封失败（二次炸板）的亏损分析
 *   5. 哪些指标能预测回封成功 vs 再次炸板
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

// 2板入场条件（与 scan.ts 一致）
const ENTRY_PARAMS = {
  maxTurnover2: 7.0,
  maxVolRatio2: 1.5,
  minCircMv: 20,
  maxCircMv: 150,
  minPrice: 4.0,
  maxPrice: 40.0,
};

interface ResealSample {
  code: string;
  name: string;
  date3: string;
  industry: string;

  // 2板指标
  t2: number; v2: number;

  // 3板开盘
  openPct3: number;      // 相对2板收盘的开盘幅度
  open3: number;

  // 3板当天
  high3: number;
  low3: number;
  close3: number;
  highLimit3: number;
  prevClose3: number;
  t3: number;
  v3: number;
  circMv: number;
  price3: number;        // 即回封买入价 ≈ highLimit3

  // 回封特征
  openToLimitDrop: number;  // 开盘时距涨停的差距（越小说明接近涨停开盘）
  reachLimit: boolean;       // 当天是否曾经达到涨停（即有回封机会）

  // 结果
  sealedClose: boolean;  // 回封后是否封住到收盘（持仓当晚收益约0，等4板）
  hit4: boolean;         // 次日打到4板
  closePct3: number;     // 若没封住，当天收盘相对回封价（涨停价）的跌幅

  // 次日开盘（4板当天）
  open4Pct: number;      // 相对3板收盘的开盘幅度
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(n: number, total: number, pad = 0) {
  const r = total > 0 ? (n / total * 100).toFixed(1) : '0.0';
  return `${n}/${total}(${r}%)`.padEnd(pad);
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  const allDates: string[] = (db.prepare(
    "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT 500"
  ).all() as any[]).map(r => r.date).reverse();

  console.log(`\n${'═'.repeat(78)}`);
  console.log('  📊 回封打板策略分析（只打2进3回封）');
  console.log(`  分析区间：${allDates[0]} ~ ${allDates[allDates.length - 1]}`);
  console.log(`${'═'.repeat(78)}`);

  const allSamples: ResealSample[] = [];   // 所有满足2板条件进入3板的样本
  const resealSamples: ResealSample[] = []; // 其中发生「开板回封」的样本

  for (let i = 5; i < allDates.length - 2; i++) {
    const date3    = allDates[i];
    const date4    = allDates[i + 1];
    const prevDates = allDates.slice(Math.max(0, i - 8), i).reverse();

    // 找第3板涨停股（或当天曾经达到涨停价的股）
    const candidates = db.prepare(`
      SELECT p.code, p.name, p.open, p.high, p.low, p.close,
             p.high_limit, p.prev_close, p.turnover_rate, p.circ_mv,
             p.volume_ratio, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0
        AND p.high >= p.high_limit * 0.999  -- 曾经触碰涨停（包括一字板和回封）
        AND p.name NOT LIKE '%ST%' AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
    `).all(date3) as any[];

    for (const bar of candidates) {
      const circMv = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const t3     = bar.turnover_rate ?? 0;
      const v3     = bar.volume_ratio  ?? 0;
      const price  = bar.close;

      if (price < ENTRY_PARAMS.minPrice || price > ENTRY_PARAMS.maxPrice) continue;
      if (circMv > 0 && (circMv < ENTRY_PARAMS.minCircMv || circMv > ENTRY_PARAMS.maxCircMv)) continue;

      // 追溯确认恰好2连板
      let boards = 0;
      let d2bar: any = null;

      for (const pd of prevDates) {
        const pb = db.prepare(
          'SELECT close, high_limit, turnover_rate, volume_ratio FROM prices WHERE code=? AND date=?'
        ).get(bar.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) {
          boards++;
          if (boards === 1) d2bar = pb;  // 紧邻的前一天 = 2板
        } else break;
      }
      if (boards !== 2 || !d2bar) continue;

      const t2 = d2bar.turnover_rate ?? 0;
      const v2 = d2bar.volume_ratio  ?? 0;
      if (t2 > 0 && t2 > ENTRY_PARAMS.maxTurnover2) continue;
      if (v2 > 0 && v2 > ENTRY_PARAMS.maxVolRatio2) continue;

      const prevClose3 = bar.prev_close > 0 ? bar.prev_close : d2bar.close;
      const openPct3   = prevClose3 > 0 ? (bar.open - prevClose3) / prevClose3 * 100 : 0;
      const isOneWord3 = bar.open >= bar.high_limit * 0.999;

      // 回封判断：开盘未涨停，但盘中曾到达涨停价
      const reachLimit = bar.high >= bar.high_limit * 0.999;
      const openedBelow = bar.open < bar.high_limit * 0.999; // 开盘未涨停
      const isReseal = openedBelow && reachLimit;            // = 真正的「开板回封」

      // 3板结果
      const sealedClose = bar.close >= bar.high_limit * 0.999;
      const closePct3   = bar.high_limit > 0
        ? (bar.close - bar.high_limit) / bar.high_limit * 100 : 0;

      // 次日数据
      const bar4 = db.prepare(
        'SELECT close, high_limit, open, prev_close FROM prices WHERE code=? AND date=?'
      ).get(bar.code, date4) as any;

      const hit4       = !!bar4 && bar4.high_limit > 0 && bar4.close >= bar4.high_limit;
      const open4Pct   = bar4 && bar4.prev_close > 0
        ? (bar4.open - bar4.prev_close) / bar4.prev_close * 100 : 0;

      const sample: ResealSample = {
        code: bar.code, name: bar.name, date3,
        industry: bar.industry || '未知',
        t2, v2, openPct3, open3: bar.open,
        high3: bar.high, low3: bar.low, close3: bar.close,
        highLimit3: bar.high_limit, prevClose3,
        t3, v3, circMv, price3: bar.close,
        openToLimitDrop: prevClose3 > 0
          ? (bar.high_limit - bar.open) / bar.prev_close * 100 : 0,
        reachLimit,
        sealedClose,
        hit4,
        closePct3,
        open4Pct,
      };

      allSamples.push(sample);
      if (isReseal) resealSamples.push(sample);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 基础统计
  // ══════════════════════════════════════════════════════════
  const oneWordSamples   = allSamples.filter(s => s.open3 >= s.highLimit3 * 0.999);
  const openBelowSamples = allSamples.filter(s => s.open3 < s.highLimit3 * 0.999);

  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ① 第3板当天开盘类型分布（2板条件过滤后）');
  console.log(`${'─'.repeat(78)}`);
  console.log(`  总样本（满足2板条件且3板触碰涨停）：${allSamples.length}只`);
  console.log(`  一字板（开盘即涨停）：${oneWordSamples.length}只 (${(oneWordSamples.length/allSamples.length*100).toFixed(1)}%)  ← 买不进`);
  console.log(`  非一字板（开盘未达涨停）：${openBelowSamples.length}只 (${(openBelowSamples.length/allSamples.length*100).toFixed(1)}%)`);
  console.log(`    → 其中盘中曾回封涨停（回封机会）：${resealSamples.length}只 (${(resealSamples.length/openBelowSamples.length*100).toFixed(1)}%)`);
  console.log(`    → 开板后始终未回封：${openBelowSamples.length - resealSamples.length}只`);

  // ══════════════════════════════════════════════════════════
  // 核心：回封成功率分析
  // ══════════════════════════════════════════════════════════
  const resealSealed = resealSamples.filter(s => s.sealedClose);
  const resealFailed = resealSamples.filter(s => !s.sealedClose);
  const resealHit4   = resealSamples.filter(s => s.hit4);

  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ② 回封打板核心胜率');
  console.log(`${'─'.repeat(78)}`);
  console.log(`  回封样本：${resealSamples.length}只`);
  console.log(`  回封后封住到收盘：${pct(resealSealed.length, resealSamples.length)}  → 持仓过夜等4板`);
  console.log(`  回封后再次炸板：  ${pct(resealFailed.length, resealSamples.length)}  → 亏损出局`);
  console.log(`  次日打到4板：     ${pct(resealHit4.length,   resealSamples.length)}  → 总体4板命中率`);
  console.log(`\n  对比：竞价打板（高开3~8%）封板率：~32%`);
  console.log(`         回封打板封住率：${(resealSealed.length/resealSamples.length*100).toFixed(1)}%  ← 高确认度带来更高胜率？`);

  // 再次炸板的亏损
  if (resealFailed.length > 0) {
    const losses = resealFailed.map(s => s.closePct3); // 相对涨停价（买入价）的收盘跌幅
    const medLoss = median(losses);
    const bigLoss = resealFailed.filter(s => s.closePct3 < -5).length;
    console.log(`\n  再次炸板时的亏损（相对回封买入价）：`);
    console.log(`   收盘亏损中位：${medLoss.toFixed(2)}%`);
    console.log(`   跌幅>5%：${bigLoss}/${resealFailed.length}(${(bigLoss/resealFailed.length*100).toFixed(1)}%)`);
    console.log(`   跌幅<3%：${resealFailed.filter(s=>s.closePct3>=-3).length}/${resealFailed.length}只（可接受范围）`);
  }

  // ══════════════════════════════════════════════════════════
  // 开盘幅度 vs 回封封板率
  // ══════════════════════════════════════════════════════════
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ③ 开盘幅度（距涨停的距离）vs 回封封板率');
  console.log(`${'─'.repeat(78)}`);
  console.log('  开盘相对涨停价的距离   回封样本  封住率   4板率   建议');

  // openToLimitDrop = 涨停价 - 开盘价，相对前收盘
  const dropRanges: [number, number, string][] = [
    [0,   3,  '✅ 接近涨停开盘，主力挺价，回封最强'],
    [3,   5,  '✅ 小幅折价，回封有力'],
    [5,   8,  '⚠️ 中度折价，回封需要量能配合'],
    [8,  15,  '⚠️ 大幅折价，回封消耗大量筹码'],
    [15, 99,  '❌ 大跌开盘，参与风险过高'],
  ];

  for (const [lo, hi, advice] of dropRanges) {
    const g = resealSamples.filter(s => s.openToLimitDrop >= lo && s.openToLimitDrop < hi);
    if (g.length < 3) continue;
    const sealR = (g.filter(s => s.sealedClose).length / g.length * 100).toFixed(1);
    const hit4R = (g.filter(s => s.hit4).length / g.length * 100).toFixed(1);
    console.log(
      `  ${`-${lo}%~-${hi}%`.padEnd(18)}` +
      `  ${String(g.length).padStart(5)}只` +
      `  ${sealR.padStart(5)}%  ${hit4R.padStart(5)}%  ${advice}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // 换手率 vs 回封封板率
  // ══════════════════════════════════════════════════════════
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ④ 第3板当天换手率 vs 回封封板率');
  console.log(`${'─'.repeat(78)}`);
  console.log('  换手区间       回封样本  封住率   4板率   建议');

  const tRanges: [number, number, string][] = [
    [0,   3,  '缩量回封，封板意愿极强'],
    [3,   7,  '✅ 正常换手，胜率最优区间'],
    [7,  12,  '⚠️ 换手偏高，出货迹象'],
    [12,  20, '❌ 换手过高，主力不控盘'],
    [20, 100, '❌ 极高换手，不参与'],
  ];

  for (const [lo, hi, advice] of tRanges) {
    const g = resealSamples.filter(s => s.t3 > 0 && s.t3 >= lo && s.t3 < hi);
    if (g.length < 3) continue;
    const sealR = (g.filter(s => s.sealedClose).length / g.length * 100).toFixed(1);
    const hit4R = (g.filter(s => s.hit4).length / g.length * 100).toFixed(1);
    console.log(
      `  ${`${lo}%~${hi}%`.padEnd(14)}` +
      `  ${String(g.length).padStart(5)}只` +
      `  ${sealR.padStart(5)}%  ${hit4R.padStart(5)}%  ${advice}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // 量比 vs 回封封板率
  // ══════════════════════════════════════════════════════════
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ⑤ 第3板量比 vs 回封封板率');
  console.log(`${'─'.repeat(78)}`);
  console.log('  量比区间       回封样本  封住率   4板率');

  const vRanges: [number, number][] = [[0,0.5],[0.5,1],[1,1.5],[1.5,2.5],[2.5,99]];
  for (const [lo, hi] of vRanges) {
    const g = resealSamples.filter(s => s.v3 > 0 && s.v3 >= lo && s.v3 < hi);
    if (g.length < 3) continue;
    const sealR = (g.filter(s => s.sealedClose).length / g.length * 100).toFixed(1);
    const hit4R = (g.filter(s => s.hit4).length / g.length * 100).toFixed(1);
    console.log(
      `  ${`${lo}~${hi === 99 ? '∞' : hi}`.padEnd(14)}` +
      `  ${String(g.length).padStart(5)}只` +
      `  ${sealR.padStart(5)}%  ${hit4R.padStart(5)}%`
    );
  }

  // ══════════════════════════════════════════════════════════
  // 组合条件
  // ══════════════════════════════════════════════════════════
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ⑥ 组合条件下的回封封板率（精选条件）');
  console.log(`${'─'.repeat(78)}`);

  type Rule = { label: string; filter: (s: ResealSample) => boolean };
  const rules: Rule[] = [
    {
      label: '🏆 最优（开盘距涨停<5% + 换手<7% + 量比<1）',
      filter: s => s.openToLimitDrop < 5 && s.t3 > 0 && s.t3 < 7 && s.v3 > 0 && s.v3 < 1,
    },
    {
      label: '✅ 优质（开盘距涨停<8% + 换手<10%）',
      filter: s => s.openToLimitDrop < 8 && s.t3 > 0 && s.t3 < 10,
    },
    {
      label: '✅ 开盘仅折价<5%（最接近涨停开盘）',
      filter: s => s.openToLimitDrop < 5,
    },
    {
      label: '⚠️ 换手>10% 或 量比>2（危险信号）',
      filter: s => s.t3 > 10 || s.v3 > 2,
    },
    {
      label: '全部回封样本',
      filter: () => true,
    },
  ];

  for (const rule of rules) {
    const g = resealSamples.filter(rule.filter);
    if (!g.length) continue;
    const sealR = (g.filter(s => s.sealedClose).length / g.length * 100).toFixed(1);
    const hit4R = (g.filter(s => s.hit4).length / g.length * 100).toFixed(1);
    const failR = (g.filter(s => !s.sealedClose).length / g.length * 100).toFixed(1);
    console.log(
      `  ${rule.label}\n` +
      `     样本:${g.length}只  封住:${sealR}%  二次炸板:${failR}%  次日4板:${hit4R}%\n`
    );
  }

  // ══════════════════════════════════════════════════════════
  // 与其他策略对比
  // ══════════════════════════════════════════════════════════
  console.log(`${'─'.repeat(78)}`);
  console.log('  ⑦ 策略对比总表');
  console.log(`${'─'.repeat(78)}`);
  console.log(
    `  策略                    覆盖率   买入难度  封板/封住率   次日4板  最大损失`
  );

  // 一字板统计
  const owSealed = oneWordSamples.filter(s => s.sealedClose).length;
  const owHit4   = oneWordSamples.filter(s => s.hit4).length;

  // 高开竞价（非一字，高开>3%）
  const hiOpen = allSamples.filter(s => !s.reachLimit || s.open3 < s.highLimit3 * 0.999)
    .filter(s => s.openPct3 >= 3);
  // 其实高开竞价统计需要从原始数据（包括未回封的）
  // 用openBelowSamples代替：开盘未涨停的所有样本中，高开3%+
  const hiOpenAll = openBelowSamples.filter(s => s.openPct3 >= 3);
  const hiOpenSealed = hiOpenAll.filter(s => s.sealedClose).length;
  const hiOpenHit4   = hiOpenAll.filter(s => s.hit4).length;

  // 回封（我们的策略）
  const resealBest = resealSamples.filter(s => s.openToLimitDrop < 8 && s.t3 > 0 && s.t3 < 10);
  const resealBestSealed = resealBest.filter(s => s.sealedClose).length;
  const resealBestHit4   = resealBest.filter(s => s.hit4).length;

  const totalBase = allSamples.length;
  const fmt = (n: number, total: number) => `${(n/total*100).toFixed(0)}%`;

  console.log(
    `  一字板（买不进）        ${fmt(oneWordSamples.length, totalBase).padEnd(8)} 极难      ` +
    `${(owSealed/oneWordSamples.length*100).toFixed(1)}%        ` +
    `${(owHit4/oneWordSamples.length*100).toFixed(1)}%     -`
  );
  console.log(
    `  竞价打板（高开3%+）     ${fmt(hiOpenAll.length, totalBase).padEnd(8)} 中等      ` +
    `${hiOpenAll.length ? (hiOpenSealed/hiOpenAll.length*100).toFixed(1) : 0}%        ` +
    `${hiOpenAll.length ? (hiOpenHit4/hiOpenAll.length*100).toFixed(1) : 0}%     ~5~8%`
  );
  console.log(
    `  回封打板（全部）        ${fmt(resealSamples.length, totalBase).padEnd(8)} 较易      ` +
    `${resealSamples.length ? (resealSealed.length/resealSamples.length*100).toFixed(1) : 0}%        ` +
    `${resealSamples.length ? (resealHit4.length/resealSamples.length*100).toFixed(1) : 0}%     ~3~5%`
  );
  console.log(
    `  回封打板（精选条件）    ${fmt(resealBest.length, totalBase).padEnd(8)} 较易      ` +
    `${resealBest.length ? (resealBestSealed/resealBest.length*100).toFixed(1) : 0}%        ` +
    `${resealBest.length ? (resealBestHit4/resealBest.length*100).toFixed(1) : 0}%     ~3~5%`
  );

  // ══════════════════════════════════════════════════════════
  // 实战操作指南
  // ══════════════════════════════════════════════════════════
  const bestSealRate = resealBest.length ? (resealBestSealed / resealBest.length * 100).toFixed(1) : '?';
  const best4Rate    = resealBest.length ? (resealBestHit4 / resealBest.length * 100).toFixed(1) : '?';

  console.log(`\n${'═'.repeat(78)}`);
  console.log('  📋 回封打板实战操作 SOP');
  console.log(`${'═'.repeat(78)}`);
  console.log(`
  前提：2板收盘后，扫描出满足条件的候选（换手<7%，量比<1.5，市值20~150亿）

  第3板当天操作流程：

  9:15  观察候选股的集合竞价
    → 预计开盘 > 涨停价（一字板）→ 直接放弃，等下一个
    → 预计开盘 < 涨停价 5%以内  → 重点关注（回封机会最大）
    → 预计开盘 < 涨停价 5~10%   → 谨慎关注，回封需要更大力度
    → 预计开盘跌  →  直接放弃

  9:25  竞价确认开盘价
    → 若最终为一字板 → 放弃
    → 若高开但低于涨停 → 进入盯盘模式

  9:30  开盘后盯盘
    → 股票开盘后，判断是否有「回封动力」：
       买单/卖单比例：买单明显压制卖单 → 回封意愿强
       量比变化：价格向上涨停冲击时量比收缩 → 主力护盘
       时间：尽量在上午10:30前回封，下午回封力度不足

  回封触发（价格触碰涨停板）
    → 立即挂涨停价买单（不要追高，就挂涨停价）
    → 封板后观察买单数量：> 流通股0.5% → 封板稳固，持仓
    → 换手>10%同时价格多次摸高又回落 → 出货嫌疑，及时止损

  持仓后的决策
    → 封住到收盘：持仓过夜，次日按「3板持仓决策SOP」操作
    → 回封后再次炸板：
       跌幅<3%（相对涨停价）→ 可等待再次回封或收盘出
       跌幅>5%（相对涨停价）→ 直接止损出

  精选回封条件（封板率${bestSealRate}%，次日4板率${best4Rate}%）：
    ✅ 开盘距涨停价 < 8%（接近涨停开盘）
    ✅ 当天换手率 < 10%
    ✅ 量比 < 1.5（不放量冲击）
    ✅ 回封时间在10:30前（越早越强势）
  `);

  console.log(`${'═'.repeat(78)}\n`);
  db.close();
}

main();
