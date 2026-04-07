/**
 * B4 平台突破 — 突破回踩确认版对比测试
 *
 * B4-原版:  当天放量突破60日高点即买入
 * B4-RT5:   近5天内有过60日突破 + 今日在突破位附近回踩反弹 + 缩量回踩
 * B4-RT10:  近10天内有过60日突破 + 回踩反弹（窗口更宽）
 * B4-RT强:  RT10 + 要求回踩量 < 突破日50% + 今日量 >= 突破日60%（缩量回踩、放量确认）
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

// 基础条件（通用）
const BASE: ConditionRule[] = [
  { field: 'is_limit_up', op: '=',  value: 0 },
  { field: 'open_pct',    op: '<=', value: 5 },
  { field: 'is_st',       op: '=',  value: 0 },
];

// B4 原版：当天突破
const B4_ORIG: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   },
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  { field: 'quote_rate',   op: '>=', value: 1   },
  ...BASE,
];

// B4-RT5：近5天内突破 + 回踩反弹买入
// 核心逻辑：
//   had_break_60_in_5d = 1   → 近5天有过突破日
//   close_pct_vs_60d_high >= -4% 且 <= 2%  → 价格在突破位附近（-4%~+2%）
//   high_break_5 = 1         → 今日创5日新高（从回踩位反弹向上）
//   volume_ratio >= 1.5      → 反弹时有量
//   pct_above_ma20 >= 0      → 价格仍在MA20上方（平台结构完整）
const B4_RT5: ConditionRule[] = [
  { field: 'had_break_60_in_5d',      op: '=',  value: 1   },
  { field: 'close_pct_vs_60d_high',   op: '>=', value: -4  },
  { field: 'close_pct_vs_60d_high',   op: '<=', value: 2   },
  { field: 'high_break_5',            op: '=',  value: 1   },
  { field: 'volume_ratio',            op: '>=', value: 1.5 },
  { field: 'pct_above_ma20',          op: '>=', value: 0   },
  { field: 'atr_pct_40',             op: '<=', value: 5.0 },
  ...BASE,
];

// B4-RT10：窗口放宽到10天
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

// B4-RT强：RT10 + 量能结构验证
// vol_pct_vs_break_10d < 60  → 今日量 < 突破日量的 60%（回踩缩量）
// 注：vol_pct_vs_break_Nd 返回今日量/突破日量 * 100
const B4_RT_STRONG: ConditionRule[] = [
  { field: 'had_break_60_in_10d',     op: '=',  value: 1   },
  { field: 'close_pct_vs_60d_high',   op: '>=', value: -5  },
  { field: 'close_pct_vs_60d_high',   op: '<=', value: 2   },
  { field: 'high_break_5',            op: '=',  value: 1   },
  { field: 'vol_pct_vs_break_10d',    op: '<=', value: 80  }, // 今日量 ≤ 突破日 80%（缩量确认）
  { field: 'volume_ratio',            op: '>=', value: 1.2 },
  { field: 'pct_above_ma20',          op: '>=', value: 0   },
  { field: 'atr_pct_40',             op: '<=', value: 5.0 },
  ...BASE,
];

const STRATEGIES = [
  { name: 'B4 原版（突破日买入）', buy: B4_ORIG,      sort: 'volume_ratio' as const },
  { name: 'B4-RT5（5日窗口回踩）', buy: B4_RT5,       sort: 'volume_ratio' as const },
  { name: 'B4-RT10（10日窗口）',   buy: B4_RT10,      sort: 'volume_ratio' as const },
  { name: 'B4-RT强（缩量回踩）',   buy: B4_RT_STRONG, sort: 'volume_ratio' as const },
];

const PROXY = { ma1Days: 20, ma2Days: 60, bullMaxPositions: 5, oscillatingMaxPositions: 3, bearMaxPositions: 0 };

function runScheme(s: typeof STRATEGIES[0]) {
  let cap = 100_000;
  const periodStats: Record<string, { ret: number; trades: number; wins: number; maxDD: number }> = {};

  for (const [label, start, end] of PERIODS) {
    const r = runCustomBacktest({
      strategyName: `${s.name} ${label}`,
      startDate: start, endDate: end,
      scanMode: 'market',
      buyRules: s.buy, sellRules: SELL_RULES,
      trailingStopPct: 10,
      initialCapital: cap, maxPositions: 5,
      candidateSortBy: s.sort,
      proxyRegime: PROXY,
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

console.log('\nB4 突破回踩确认策略对比（半年度分段·资金连续）');
console.log('='.repeat(112));
console.log(
  '策略'.padEnd(22), '2023H1'.padStart(8), '2023H2'.padStart(8), '2024H1'.padStart(8),
  '2024H2'.padStart(8), '2025H1'.padStart(8), '2025H2'.padStart(8),
  '3年'.padStart(8), '最终¥'.padStart(10), '胜率'.padStart(6), '笔'.padStart(4), '回撤'.padStart(7),
);
console.log('-'.repeat(112));

type Result = ReturnType<typeof runScheme> & { name: string };
const results: Result[] = [];

for (const s of STRATEGIES) {
  process.stderr.write(`▶ ${s.name}\n`);
  const r = runScheme(s);
  results.push({ ...r, name: s.name });

  const p  = r.periodStats;
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) + '%' : '-';
  console.log(
    s.name.padEnd(22),
    fR(p['2023H1'].ret), fR(p['2023H2'].ret), fR(p['2024H1'].ret),
    fR(p['2024H2'].ret), fR(p['2025H1'].ret), fR(p['2025H2'].ret),
    fR(r.total),
    ('¥' + Math.round(r.cap).toLocaleString()).padStart(10),
    wr.padStart(6), String(r.totalT).padStart(4),
    ('-' + r.maxDD.toFixed(1) + '%').padStart(7),
  );
}

console.log('='.repeat(112));

// 逐年
console.log('\n📅 逐年复合收益：');
console.log('策略'.padEnd(22), '2023'.padStart(9), '2024'.padStart(9), '2025(H1+H2)'.padStart(13));
console.log('-'.repeat(58));
for (const r of results) {
  const p = r.periodStats;
  const y23 = ((1 + p['2023H1'].ret/100) * (1 + p['2023H2'].ret/100) - 1) * 100;
  const y24 = ((1 + p['2024H1'].ret/100) * (1 + p['2024H2'].ret/100) - 1) * 100;
  const y25 = ((1 + p['2025H1'].ret/100) * (1 + p['2025H2'].ret/100) - 1) * 100;
  console.log(r.name.padEnd(22), fR(y23).padStart(9), fR(y24).padStart(9), fR(y25).padStart(13));
}

// 笔数
console.log('\n📊 各段交易笔数：');
console.log('策略'.padEnd(22), PERIODS.map(([l]) => l.padStart(8)).join(''), '合计'.padStart(8));
console.log('-'.repeat(82));
for (const r of results) {
  console.log(r.name.padEnd(22), PERIODS.map(([l]) => String(r.periodStats[l].trades).padStart(8)).join(''), String(r.totalT).padStart(8));
}

// 胜率
console.log('\n📊 各段胜率：');
console.log('策略'.padEnd(22), PERIODS.map(([l]) => l.padStart(8)).join(''));
console.log('-'.repeat(74));
for (const r of results) {
  const wrs = PERIODS.map(([l]) => {
    const { wins, trades } = r.periodStats[l];
    return trades > 0 ? (wins/trades*100).toFixed(0)+'%' : '- ';
  });
  console.log(r.name.padEnd(22), wrs.map(w => w.padStart(8)).join(''));
}

const ranked = [...results].sort((a, b) => b.total - a.total);
console.log('\n🏆 排名（3年总收益）：');
ranked.forEach((r, i) => {
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) : '0';
  console.log(`  ${i+1}. ${r.name.padEnd(24)} ${fR(r.total)}  胜率${wr}%  ${r.totalT}笔  最大回撤-${r.maxDD.toFixed(1)}%`);
});
