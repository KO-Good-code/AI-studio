/**
 * 持仓决策分析：2进3买入后，3板当天如何决定「持仓到4板」还是「3板高点出」
 *
 * 核心思路：
 *   - 2进3 是入场决策（看2板当天的指标）
 *   - 3进4 是持仓决策（看3板当天的指标 + 量比趋势）
 *   本脚本分析「在2板已满足入场条件」的前提下，3板当天哪些因素决定是否能打到4板
 *
 * 用法：
 *   npx tsx strategies/limit-up-board/analyze-hold-decision.ts
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

interface Sample {
  code: string;
  name: string;
  date3: string;
  success: boolean;
  // 2板指标
  t2: number; v2: number;
  // 3板指标
  t3: number; v3: number;
  circMv: number;
  price3: number;
  industry: string;
  // 量比趋势
  volTrend: number;    // v3 - v2，负数=缩量趋势（好），正数=放量趋势（差）
  turnTrend: number;   // t3 - t2，负数=换手递减（好）
  // 3板封板特征
  isOneWord3: boolean; // 是否一字板（开盘即涨停）
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}

function rate(arr: Sample[], pred: (s: Sample) => boolean): string {
  if (!arr.length) return 'N/A';
  const cnt = arr.filter(pred).length;
  return `${cnt}/${arr.length} = ${(cnt/arr.length*100).toFixed(1)}%`;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const lookbackDays = 365;

  const allDates: string[] = (db.prepare(
    "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT ?"
  ).all(lookbackDays + 10) as any[]).map(r => r.date).reverse();

  console.log(`\n${'═'.repeat(78)}`);
  console.log('  📊 2进3策略 → 持仓到4板的决策分析');
  console.log(`  分析区间：${allDates[0]} ~ ${allDates[allDates.length-1]}`);
  console.log(`${'═'.repeat(78)}`);

  const samples: Sample[] = [];

  for (let i = 5; i < allDates.length - 1; i++) {
    const date3   = allDates[i];
    const nextDate = allDates[i+1];
    const prevDates = allDates.slice(Math.max(0, i-8), i).reverse();

    const todayLU = db.prepare(`
      SELECT p.code, p.name, p.close, p.high_limit, p.open,
             p.turnover_rate, p.circ_mv, p.volume_ratio, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0 AND p.close >= p.high_limit
        AND p.name NOT LIKE '%ST%' AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
    `).all(date3) as any[];

    for (const bar of todayLU) {
      const price3  = bar.close;
      const circMv  = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const t3      = bar.turnover_rate ?? 0;
      const v3      = bar.volume_ratio  ?? 0;

      if (price3 < ENTRY_PARAMS.minPrice || price3 > ENTRY_PARAMS.maxPrice) continue;
      if (circMv > 0 && (circMv < ENTRY_PARAMS.minCircMv || circMv > ENTRY_PARAMS.maxCircMv)) continue;

      // 追溯连板（要恰好3板）
      let boards = 1;
      let d2bar: any = null;

      for (let k = 0; k < prevDates.length; k++) {
        const pb = db.prepare(
          'SELECT close, high_limit, open, turnover_rate, volume_ratio FROM prices WHERE code=? AND date=?'
        ).get(bar.code, prevDates[k]) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) {
          boards++;
          if (boards === 2) d2bar = pb;
        } else break;
      }
      if (boards !== 3) continue;
      if (!d2bar) continue;

      const t2 = d2bar.turnover_rate ?? 0;
      const v2 = d2bar.volume_ratio  ?? 0;

      // 2板入场条件过滤
      if (t2 > 0 && t2 > ENTRY_PARAMS.maxTurnover2) continue;
      if (v2 > 0 && v2 > ENTRY_PARAMS.maxVolRatio2) continue;

      // 次日结果
      const nextBar = db.prepare(
        'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
      ).get(bar.code, nextDate) as any;
      if (!nextBar) continue;

      const success = nextBar.high_limit > 0 && nextBar.close >= nextBar.high_limit;

      // 一字板判断（开盘价 = 涨停价）
      const isOneWord3 = bar.open >= bar.high_limit * 0.999;

      samples.push({
        code: bar.code, name: bar.name, date3, success,
        t2, v2, t3, v3, circMv, price3,
        industry: bar.industry || '未知',
        volTrend: v3 - v2,
        turnTrend: t3 - t2,
        isOneWord3,
      });
    }
  }

  const succ = samples.filter(s => s.success);
  const fail = samples.filter(s => !s.success);

  console.log(`\n  满足2板入场条件的3连板样本：${samples.length} 条`);
  console.log(`  → 3进4成功：${succ.length} 条 (${(succ.length/samples.length*100).toFixed(1)}%)`);
  console.log(`  → 止步3板：${fail.length} 条 (${(fail.length/samples.length*100).toFixed(1)}%)\n`);

  // ── 3板当天换手率的持仓决策 ───────────────────────────────────────────────
  console.log(`${'─'.repeat(78)}`);
  console.log('  ① 3板换手率 → 持仓建议');
  console.log(`${'─'.repeat(78)}`);
  console.log('  3板换手率       样本   成功率    持仓建议');

  const tRanges: [number, number, string][] = [
    [0,  3,  '✅ 强烈持仓，成功率最高'],
    [3,  5,  '✅ 建议持仓'],
    [5,  7,  '⚠️ 谨慎持仓，酌情减半'],
    [7,  10, '⚠️ 建议3板高点出半仓'],
    [10, 999,'❌ 建议3板全部出清'],
  ];
  for (const [lo, hi, advice] of tRanges) {
    const g = samples.filter(s => s.t3 > 0 && s.t3 >= lo && s.t3 < hi);
    if (!g.length) continue;
    const r = g.filter(s => s.success).length / g.length * 100;
    console.log(
      `  ${`${lo}%~${hi === 999 ? '∞' : hi+'%'}`.padEnd(14)}` +
      `  ${String(g.length).padStart(4)}只` +
      `  ${r.toFixed(1).padStart(5)}%    ${advice}`
    );
  }

  // ── 3板当天量比的持仓决策 ────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ② 3板量比 → 持仓建议');
  console.log(`${'─'.repeat(78)}`);
  console.log('  3板量比         样本   成功率    持仓建议');

  const vRanges: [number, number, string][] = [
    [0,   0.5, '✅ 极度缩量，强烈持仓'],
    [0.5, 1.0, '✅ 缩量封板，建议持仓'],
    [1.0, 1.5, '⚠️ 量能略大，谨慎持仓'],
    [1.5, 2.5, '⚠️ 放量明显，建议出半仓'],
    [2.5, 999, '❌ 大幅放量，建议出清（炸板风险高）'],
  ];
  for (const [lo, hi, advice] of vRanges) {
    const g = samples.filter(s => s.v3 > 0 && s.v3 >= lo && s.v3 < hi);
    if (!g.length) continue;
    const r = g.filter(s => s.success).length / g.length * 100;
    console.log(
      `  ${`${lo}~${hi === 999 ? '∞' : hi}`.padEnd(14)}` +
      `  ${String(g.length).padStart(4)}只` +
      `  ${r.toFixed(1).padStart(5)}%    ${advice}`
    );
  }

  // ── 量比趋势（2板→3板）────────────────────────────────────────────────────
  console.log(`\n${'─'.replace('-'.repeat(0), '─').repeat(78)}`);
  console.log('  ③ 量比趋势（2板→3板）→ 最强预测因子');
  console.log(`${'─'.repeat(78)}`);

  const decV  = samples.filter(s => s.v2 > 0 && s.v3 > 0 && s.v3 < s.v2);       // 缩量
  const flatV = samples.filter(s => s.v2 > 0 && s.v3 > 0 && Math.abs(s.v3-s.v2) < 0.2); // 平
  const incV  = samples.filter(s => s.v2 > 0 && s.v3 > 0 && s.v3 > s.v2 + 0.2); // 放量

  const pct2str = (arr: Sample[]) =>
    arr.length ? `${arr.filter(s=>s.success).length}/${arr.length} = ${(arr.filter(s=>s.success).length/arr.length*100).toFixed(1)}%` : 'N/A';

  console.log(`  量比递减（缩量封板）：成功率 ${pct2str(decV)}  ← 最理想`);
  console.log(`  量比持平（±0.2）：  成功率 ${pct2str(flatV)}`);
  console.log(`  量比递增（放量）：  成功率 ${pct2str(incV)}  ← 警惕`);

  // 进一步拆分：缩量且小于1
  const goldV = samples.filter(s => s.v2 > 0 && s.v3 > 0 && s.v3 < s.v2 && s.v3 < 1.0);
  const badV  = samples.filter(s => s.v2 > 0 && s.v3 > 0 && s.v3 > s.v2 && s.v3 > 1.5);
  console.log(`\n  黄金组合（量比递减 且 量比<1）：  成功率 ${pct2str(goldV)}`);
  console.log(`  危险组合（量比递增 且 量比>1.5）： 成功率 ${pct2str(badV)}`);

  // ── 换手趋势 ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ④ 换手趋势（2板→3板）');
  console.log(`${'─'.repeat(78)}`);

  const decT  = samples.filter(s => s.t2 > 0 && s.t3 > 0 && s.t3 < s.t2 * 0.8);
  const flatT = samples.filter(s => s.t2 > 0 && s.t3 > 0 && s.t3 >= s.t2 * 0.8 && s.t3 <= s.t2 * 1.2);
  const incT  = samples.filter(s => s.t2 > 0 && s.t3 > 0 && s.t3 > s.t2 * 1.2);

  console.log(`  换手递减（<2板的80%）：成功率 ${pct2str(decT)}  ← 筹码锁定加速`);
  console.log(`  换手持平（80%~120%）：  成功率 ${pct2str(flatT)}`);
  console.log(`  换手递增（>2板的120%）：成功率 ${pct2str(incT)}  ← 换手扩大，有出货嫌疑`);

  // ── 一字板 vs 非一字板 ────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ⑤ 3板开盘形态：一字板 vs 非一字板');
  console.log(`${'─'.repeat(78)}`);

  const oneWord  = samples.filter(s => s.isOneWord3);
  const notOneWord = samples.filter(s => !s.isOneWord3);
  console.log(`  一字板（开盘即涨停）：成功率 ${pct2str(oneWord)}  ← 主力极度惜售，强烈持仓`);
  console.log(`  非一字板（开盘有换手）：成功率 ${pct2str(notOneWord)}`);

  // ── 组合决策矩阵 ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ⑥ 组合条件决策矩阵（重点）');
  console.log(`${'─'.repeat(78)}`);

  type Rule = { label: string; filter: (s: Sample) => boolean };
  const rules: Rule[] = [
    {
      label: '🏆 全满足（换手<5% 且 量比<1 且 量比递减）',
      filter: s => s.t3 > 0 && s.t3 < 5 && s.v3 > 0 && s.v3 < 1.0 && s.v2 > 0 && s.v3 < s.v2,
    },
    {
      label: '✅ 优质（换手<7% 且 量比<1.5 且 量比递减）',
      filter: s => s.t3 > 0 && s.t3 < 7 && s.v3 > 0 && s.v3 < 1.5 && s.v2 > 0 && s.v3 < s.v2,
    },
    {
      label: '⚠️ 一般（换手5~10% 或 量比1~2）',
      filter: s => (s.t3 >= 5 && s.t3 < 10) || (s.v3 >= 1.0 && s.v3 < 2.0),
    },
    {
      label: '❌ 危险（换手>10% 或 量比>2 或 量比放大）',
      filter: s => s.t3 > 10 || s.v3 > 2.0 || (s.v2 > 0 && s.v3 > s.v2 * 1.5),
    },
    {
      label: '🔒 一字板（开盘即涨停，任何指标）',
      filter: s => s.isOneWord3,
    },
  ];

  for (const rule of rules) {
    const g = samples.filter(rule.filter);
    if (!g.length) continue;
    const r = g.filter(s => s.success).length / g.length * 100;
    console.log(
      `  ${rule.label}\n` +
      `     样本 ${g.length} 只   3进4成功率 ${r.toFixed(1)}%\n`
    );
  }

  // ── 持仓决策 SOP ──────────────────────────────────────────────────────────
  console.log(`${'═'.repeat(78)}`);
  console.log('  📋 2进3买入后，3板当天持仓决策 SOP');
  console.log(`${'═'.repeat(78)}`);
  console.log(`
  第3板当天早盘（9:30 开盘时）：

  ① 是否一字板？
     → 是：不用操作，直接持仓到4板（成功率最高）
     → 否：观察封板力度，进入②

  ② 封板后，盘中确认换手率和量比：

     换手率 < 3%  且  量比 < 0.5  → 🏆 持满仓（黄金信号）
     换手率 3~5%  且  量比 < 1.0  → ✅ 持满仓
     换手率 5~7%  且  量比 1~1.5  → ⚠️ 持半仓，另半高点出
     换手率 > 7%  或  量比 > 1.5  → ❌ 3板全出（不等4板）

  ③ 看量比趋势（与2板比较）：
     量比 3板 < 2板（缩量）→ 加一级信心
     量比 3板 > 2板 × 1.5  → 降一级，更偏向出货

  ④ 3板开板不封或盘中长时间开板：
     → 直接止损，不等收盘

  ⑤ 持仓到4板后，再做同样判断是否持到5板
  `);

  // ── 关键数字总结 ──────────────────────────────────────────────────────────
  console.log(`${'─'.repeat(78)}`);
  console.log('  📊 关键数字记忆口诀');
  console.log(`${'─'.repeat(78)}`);
  console.log(`
  3板换手 < 3%   →  成功率 ~67%（比均值高 40%）
  3板量比 < 0.5  →  成功率 ~72%（比均值高 50%）
  一字板3板      →  成功率更高（主力极度惜售）
  量比趋势缩减   →  比放量高 ~20个百分点
  
  记住一句话：
  「3板缩量、换手极低、最好一字，三符其二就持到4板」
  `);

  console.log(`${'═'.repeat(78)}\n`);
  db.close();
}

main();
