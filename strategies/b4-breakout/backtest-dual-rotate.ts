/**
 * B4 双策略轮动回测
 *
 * 核心思路：
 *   牛市   → B4 原版（突破日直接买入，不错过快速行情）
 *   震荡市  → B4-RT10（回踩确认，减少假突破）
 *   熊市   → 空仓（保留现金）
 *
 * 使用两种大盘过滤方案分别测试：
 *   方案A-双策略：涨停比（5日均值）判断牛/震/熊
 *   方案C-双策略：三信号综合评分判断牛/震/熊
 *
 * 对比基准：
 *   B4 原版（无过滤）
 *   B4-RT10（无过滤）
 *   方案A 单策略（涨停比过滤 + 原版）
 */

import { runCustomBacktest } from '../lib/backtest/custom-engine';
import type { ConditionRule } from '../lib/backtest/condition';

const PERIODS: [string, string, string][] = [
  ['2023H1', '2023-04-01', '2023-09-30'],
  ['2023H2', '2023-10-01', '2024-03-31'],
  ['2024H1', '2024-04-01', '2024-09-30'],
  ['2024H2', '2024-10-01', '2025-03-31'],
  ['2025H1', '2025-04-01', '2025-09-30'],
  ['2025H2', '2025-10-01', '2026-03-26'],
];

const SELL_RULES: ConditionRule[] = [
  { field: 'pct_above_ma20', op: '<=', value: -3 },
];

const BASE: ConditionRule[] = [
  { field: 'is_limit_up', op: '=',  value: 0 },
  { field: 'open_pct',    op: '<=', value: 5 },
  { field: 'is_st',       op: '=',  value: 0 },
];

// ── B4 原版（突破日买入）──────────────────────────────
const B4_ORIG: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   },
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  { field: 'quote_rate',   op: '>=', value: 1   },
  ...BASE,
];

// ── B4-RT10（10日窗口回踩确认）─────────────────────────
const B4_RT10: ConditionRule[] = [
  { field: 'had_break_60_in_10d',     op: '=',  value: 1   },
  { field: 'close_pct_vs_60d_high',   op: '>=', value: -5  },
  { field: 'close_pct_vs_60d_high',   op: '<=', value: 2   },
  { field: 'high_break_5',            op: '=',  value: 1   },
  { field: 'volume_ratio',            op: '>=', value: 1.5 },
  { field: 'pct_above_ma20',          op: '>=', value: 0   },
  { field: 'atr_pct_40',             op: '<=', value: 5.0 },
  ...BASE,
];

// ── 策略配置 ────────────────────────────────────────────

interface SchemeConfig {
  name: string;
  buyRules: ConditionRule[];
  limitUpRegime?: Parameters<typeof runCustomBacktest>[0]['limitUpRegime'];
  compositeRegime?: Parameters<typeof runCustomBacktest>[0]['compositeRegime'];
}

const SCHEMES: SchemeConfig[] = [
  // 基准1：原版无过滤
  {
    name: 'B4 原版（无过滤）',
    buyRules: B4_ORIG,
  },
  // 基准2：RT10 无过滤
  {
    name: 'B4-RT10（无过滤）',
    buyRules: B4_RT10,
  },
  // 方案A 单策略：涨停比过滤 + 原版（牛/熊切换，无震荡仓位）
  {
    name: 'A-单策略（涨停比+原版）',
    buyRules: B4_ORIG,
    limitUpRegime: {
      bullLimitUpPct:  0.02,
      bearLimitUpPct:  0.008,
      bullMaxPositions:         5,
      oscillatingMaxPositions:  0, // 震荡市空仓
      bearMaxPositions:         0, // 熊市空仓
    },
  },
  // 方案A 双策略：牛市=原版，震荡=RT10，熊市=空仓
  {
    name: 'A-双策略（牛:原版/震:RT10/熊:空）',
    buyRules: B4_ORIG,  // 默认（牛市）
    limitUpRegime: {
      bullLimitUpPct:          0.02,
      bearLimitUpPct:          0.008,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,   // 牛市用原版快攻
      oscillatingMaxPositions:  5,
      oscillatingBuyRules:      B4_RT10,   // 震荡市用回踩确认
      bearMaxPositions:         0,         // 熊市空仓
    },
  },
  // 方案A 双策略（保守）：牛市=原版，震荡=RT10+减仓，熊市=空仓
  {
    name: 'A-双策略保守（牛:原版/震:RT10×3仓/熊:空）',
    buyRules: B4_ORIG,
    limitUpRegime: {
      bullLimitUpPct:          0.02,
      bearLimitUpPct:          0.008,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,
      oscillatingMaxPositions:  3,       // 震荡市最多3仓
      oscillatingBuyRules:      B4_RT10,
      bearMaxPositions:         0,
    },
  },
  // 方案C 双策略：综合评分判断 + 策略切换
  {
    name: 'C-双策略（综合评分+策略切换）',
    buyRules: B4_ORIG,
    compositeRegime: {
      momentumDays:            5,
      breadthBull:             0.50,
      limitUpBull:             0.012,
      bullScore:               0.33,
      bearScore:               -0.33,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,   // 牛市用原版
      oscillatingMaxPositions:  5,
      oscillatingBuyRules:      B4_RT10,   // 震荡市用回踩
      bearMaxPositions:         0,
    },
  },
  // 方案C 双策略（严格）：震荡市减仓
  {
    name: 'C-双策略严格（牛:原版/震:RT10×3仓/熊:空）',
    buyRules: B4_ORIG,
    compositeRegime: {
      momentumDays:            5,
      breadthBull:             0.50,
      limitUpBull:             0.012,
      bullScore:               0.33,
      bearScore:               -0.33,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,
      oscillatingMaxPositions:  3,
      oscillatingBuyRules:      B4_RT10,
      bearMaxPositions:         0,
    },
  },
];

function runScheme(s: SchemeConfig) {
  let cap = 100_000;
  const periodStats: Record<string, { ret: number; trades: number; wins: number; maxDD: number }> = {};

  for (const [label, start, end] of PERIODS) {
    const r = runCustomBacktest({
      strategyName: `${s.name} ${label}`,
      startDate: start, endDate: end,
      scanMode: 'market',
      buyRules: s.buyRules,
      sellRules: SELL_RULES,
      trailingStopPct: 10,
      initialCapital: cap, maxPositions: 5,
      candidateSortBy: 'volume_ratio',
      limitUpRegime:   s.limitUpRegime,
      compositeRegime: s.compositeRegime,
    });
    const wins = Math.round(r.winRate / 100 * r.totalTrades);
    cap *= (1 + r.totalReturn / 100);
    periodStats[label] = { ret: r.totalReturn, trades: r.totalTrades, wins, maxDD: r.maxDrawdown };
  }

  const total  = (cap - 100_000) / 100_000 * 100;
  const totalT = Object.values(periodStats).reduce((s, v) => s + v.trades, 0);
  const totalW = Object.values(periodStats).reduce((s, v) => s + v.wins, 0);
  const maxDD  = Math.max(...Object.values(periodStats).map(v => v.maxDD));
  return { cap, total, totalT, totalW, maxDD, periodStats };
}

const fR = (v: number) => ((v >= 0 ? '+' : '') + v.toFixed(1) + '%').padStart(8);

console.log('\nB4 双策略轮动对比（牛:原版 / 震荡:回踩确认 / 熊:空仓）');
console.log('半年度分段·资金连续');
console.log('='.repeat(118));
console.log(
  '策略'.padEnd(28), '2023H1'.padStart(8), '2023H2'.padStart(8), '2024H1'.padStart(8),
  '2024H2'.padStart(8), '2025H1'.padStart(8), '2025H2'.padStart(8),
  '3年'.padStart(8), '最终¥'.padStart(10), '胜率'.padStart(6), '笔'.padStart(4), '回撤'.padStart(7),
);
console.log('-'.repeat(118));

type Result = ReturnType<typeof runScheme> & { name: string };
const results: Result[] = [];

for (const s of SCHEMES) {
  process.stderr.write(`▶ ${s.name}\n`);
  const r = runScheme(s);
  results.push({ ...r, name: s.name });

  const p  = r.periodStats;
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) + '%' : '-';
  console.log(
    s.name.padEnd(28),
    fR(p['2023H1'].ret), fR(p['2023H2'].ret), fR(p['2024H1'].ret),
    fR(p['2024H2'].ret), fR(p['2025H1'].ret), fR(p['2025H2'].ret),
    fR(r.total),
    ('¥' + Math.round(r.cap).toLocaleString()).padStart(10),
    wr.padStart(6), String(r.totalT).padStart(4),
    ('-' + r.maxDD.toFixed(1) + '%').padStart(7),
  );
}

console.log('='.repeat(118));

// 逐年
console.log('\n📅 逐年复合收益：');
console.log('策略'.padEnd(28), '2023'.padStart(9), '2024'.padStart(9), '2025(H1+H2)'.padStart(13));
console.log('-'.repeat(64));
for (const r of results) {
  const p = r.periodStats;
  const y23 = ((1 + p['2023H1'].ret/100) * (1 + p['2023H2'].ret/100) - 1) * 100;
  const y24 = ((1 + p['2024H1'].ret/100) * (1 + p['2024H2'].ret/100) - 1) * 100;
  const y25 = ((1 + p['2025H1'].ret/100) * (1 + p['2025H2'].ret/100) - 1) * 100;
  console.log(r.name.padEnd(28), fR(y23).padStart(9), fR(y24).padStart(9), fR(y25).padStart(13));
}

// 笔数
console.log('\n📊 各段交易笔数（牛=无回踩/震=有回踩）：');
console.log('策略'.padEnd(28), PERIODS.map(([l]) => l.padStart(8)).join(''), '合计'.padStart(8));
console.log('-'.repeat(90));
for (const r of results) {
  console.log(r.name.padEnd(28), PERIODS.map(([l]) => String(r.periodStats[l].trades).padStart(8)).join(''), String(r.totalT).padStart(8));
}

// 排名
const ranked = [...results].sort((a, b) => b.total - a.total);
console.log('\n🏆 排名（3年总收益）：');
ranked.forEach((r, i) => {
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) : '0';
  console.log(`  ${i+1}. ${r.name.padEnd(32)} ${fR(r.total)}  胜率${wr}%  ${r.totalT}笔  最大回撤-${r.maxDD.toFixed(1)}%`);
});

// 关键指标对比
console.log('\n📈 每万元投入收益对比（风险调整）：');
for (const r of ranked) {
  const calmar = r.maxDD > 0 ? (r.total / r.maxDD).toFixed(2) : 'N/A';
  console.log(`  ${r.name.padEnd(32)} 总收益${fR(r.total)}  最大回撤-${r.maxDD.toFixed(1)}%  卡玛比率${calmar}`);
}
