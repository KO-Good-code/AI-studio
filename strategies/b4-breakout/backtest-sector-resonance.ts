/**
 * B4 板块共振版 对比回测
 *
 * 核心思路：
 *   同一行业多只股票同日满足买入条件 → 板块资金共振 → 信号更可靠
 *
 * 对比策略（均基于"双策略保守版"框架）：
 *   基准A：保守版（无共振过滤）
 *   方案B：震荡市加板块共振（≥2只同行业），牛市不限
 *   方案C：全时段加板块共振（牛市+震荡均需≥2只同行业）
 *   方案D：震荡市加板块共振（≥3只同行业），条件更严
 */

import { runCustomBacktest } from '../../lib/backtest/custom-engine';
import type { ConditionRule } from '../../lib/backtest/condition';

const PERIODS: [string, string, string][] = [
  ['2023H1', '2023-04-01', '2023-09-30'],
  ['2023H2', '2023-10-01', '2024-03-31'],
  ['2024H1', '2024-04-01', '2024-09-30'],
  ['2024H2', '2024-10-01', '2025-03-31'],
  ['2025H1', '2025-04-01', '2025-09-30'],
  ['2025H2', '2025-10-01', '2026-03-26'],
];

const SELL: ConditionRule[] = [{ field: 'pct_above_ma20', op: '<=', value: -3 }];

const BASE: ConditionRule[] = [
  { field: 'is_limit_up', op: '=',  value: 0 },
  { field: 'open_pct',    op: '<=', value: 5 },
  { field: 'is_st',       op: '=',  value: 0 },
];

const B4_ORIG: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   },
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  { field: 'quote_rate',   op: '>=', value: 1   },
  ...BASE,
];

const B4_RT10: ConditionRule[] = [
  { field: 'had_break_60_in_10d',   op: '=',  value: 1   },
  { field: 'close_pct_vs_60d_high', op: '>=', value: -5  },
  { field: 'close_pct_vs_60d_high', op: '<=', value: 2   },
  { field: 'high_break_5',          op: '=',  value: 1   },
  { field: 'volume_ratio',          op: '>=', value: 1.5 },
  { field: 'pct_above_ma20',        op: '>=', value: 0   },
  { field: 'atr_pct_40',           op: '<=', value: 5.0 },
  ...BASE,
];

const BASE_REGIME = {
  bullLimitUpPct:          0.02,
  bearLimitUpPct:          0.008,
  bullMaxPositions:         5,
  bullBuyRules:             B4_ORIG,
  oscillatingMaxPositions:  3,
  oscillatingBuyRules:      B4_RT10,
  bearMaxPositions:         0,
};

interface Strategy {
  name: string;
  minSectorCandidates?: number;
  limitUpRegime: typeof BASE_REGIME;
}

const STRATEGIES: Strategy[] = [
  {
    name: '基准A：保守版（无共振）',
    limitUpRegime: BASE_REGIME,
    // minSectorCandidates 不设 → 不过滤
  },
  {
    // 震荡市用 RT10，但 RT10 条件满足的候选股中，需要 ≥2 只同行业
    // 牛市用原版，不加共振限制（原版本来门槛高，共振会太少）
    name: '方案B：共振≥2（仅震荡市生效）',
    // 通过在震荡 oscillatingBuyRules 中配合 minSectorCandidates 实现
    // 注意：minSectorCandidates 作用于所有 candidates，包括牛市原版
    // 所以这里对牛市用较宽松（实际牛市本来就少候选，共振≥2容易满足）
    minSectorCandidates: 2,
    limitUpRegime: BASE_REGIME,
  },
  {
    name: '方案C：共振≥2（全时段）',
    minSectorCandidates: 2,
    limitUpRegime: {
      ...BASE_REGIME,
      // 牛市也用共振，条件更严，适合强确认场景
    },
  },
  {
    name: '方案D：共振≥3（高确认度）',
    minSectorCandidates: 3,
    limitUpRegime: BASE_REGIME,
  },
];

function runScheme(s: Strategy) {
  let cap = 100_000;
  const ps: Record<string, { ret: number; trades: number; wins: number; maxDD: number }> = {};
  for (const [label, start, end] of PERIODS) {
    const r = runCustomBacktest({
      strategyName:        `${s.name} ${label}`,
      startDate: start, endDate: end,
      scanMode:            'market',
      buyRules:            B4_ORIG,
      sellRules:           SELL,
      trailingStopPct:     10,
      initialCapital:      cap,
      maxPositions:        5,
      candidateSortBy:     'volume_ratio',
      limitUpRegime:       s.limitUpRegime,
      minSectorCandidates: s.minSectorCandidates,
    });
    const wins = Math.round(r.winRate / 100 * r.totalTrades);
    cap *= (1 + r.totalReturn / 100);
    ps[label] = { ret: r.totalReturn, trades: r.totalTrades, wins, maxDD: r.maxDrawdown };
  }
  const total = (cap - 100_000) / 100_000 * 100;
  const totalT = Object.values(ps).reduce((a, v) => a + v.trades, 0);
  const totalW = Object.values(ps).reduce((a, v) => a + v.wins, 0);
  const maxDD  = Math.max(...Object.values(ps).map(v => v.maxDD));
  return { cap, total, totalT, totalW, maxDD, ps };
}

const fR = (v: number) => ((v >= 0 ? '+' : '') + v.toFixed(1) + '%').padStart(8);

console.log('\nB4 板块共振版 对比（半年度分段·资金连续）');
console.log('='.repeat(110));
console.log(
  '策略'.padEnd(24), '2023H1'.padStart(8), '2023H2'.padStart(8), '2024H1'.padStart(8),
  '2024H2'.padStart(8), '2025H1'.padStart(8), '2025H2'.padStart(8),
  '3年'.padStart(8), '最终¥'.padStart(10), '胜率'.padStart(6), '笔'.padStart(4), '回撤'.padStart(7),
);
console.log('-'.repeat(110));

type Result = ReturnType<typeof runScheme> & { name: string };
const results: Result[] = [];

for (const s of STRATEGIES) {
  process.stderr.write(`▶ ${s.name}\n`);
  const r = runScheme(s);
  results.push({ ...r, name: s.name });
  const p  = r.ps;
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) + '%' : '-';
  console.log(
    s.name.padEnd(24),
    fR(p['2023H1'].ret), fR(p['2023H2'].ret), fR(p['2024H1'].ret),
    fR(p['2024H2'].ret), fR(p['2025H1'].ret), fR(p['2025H2'].ret),
    fR(r.total),
    ('¥' + Math.round(r.cap).toLocaleString()).padStart(10),
    wr.padStart(6), String(r.totalT).padStart(4),
    ('-' + r.maxDD.toFixed(1) + '%').padStart(7),
  );
}
console.log('='.repeat(110));

console.log('\n📅 逐年复合收益：');
console.log('策略'.padEnd(24), '2023'.padStart(9), '2024'.padStart(9), '2025'.padStart(9));
console.log('-'.repeat(54));
for (const r of results) {
  const p = r.ps;
  const y23 = ((1 + p['2023H1'].ret/100) * (1 + p['2023H2'].ret/100) - 1) * 100;
  const y24 = ((1 + p['2024H1'].ret/100) * (1 + p['2024H2'].ret/100) - 1) * 100;
  const y25 = ((1 + p['2025H1'].ret/100) * (1 + p['2025H2'].ret/100) - 1) * 100;
  console.log(r.name.padEnd(24), fR(y23).padStart(9), fR(y24).padStart(9), fR(y25).padStart(9));
}

console.log('\n📊 各段交易笔数（共振过滤后）：');
console.log('策略'.padEnd(24), PERIODS.map(([l]) => l.padStart(8)).join(''), '合计'.padStart(8));
console.log('-'.repeat(88));
for (const r of results) {
  console.log(r.name.padEnd(24), PERIODS.map(([l]) => String(r.ps[l].trades).padStart(8)).join(''), String(r.totalT).padStart(8));
}

console.log('\n🏆 排名（3年总收益）：');
[...results].sort((a, b) => b.total - a.total).forEach((r, i) => {
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) : '0';
  const calmar = r.maxDD > 0 ? (r.total / r.maxDD).toFixed(2) : '-';
  console.log(`  ${i+1}. ${r.name.padEnd(28)} ${fR(r.total)}  胜率${wr}%  ${r.totalT}笔  回撤-${r.maxDD.toFixed(1)}%  卡玛${calmar}`);
});
