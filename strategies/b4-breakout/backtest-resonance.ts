/**
 * B4 大盘共振版 对比回测
 *
 * 在"双策略保守版"基础上加入大盘共振：
 *   当单日涨停比突增（≥ 3%，约150只涨停）时，即使5日均值未达牛市门槛，
 *   也视为"共振日"，直接用 B4 原版（突破日买入），不等回踩。
 *
 * 对比策略：
 *   基准A：双策略保守版（无共振，原版）
 *   方案B：双策略保守版 + 大盘共振（单日≥3%触发，3仓）
 *   方案C：双策略保守版 + 大盘共振（单日≥2.5%触发，3仓）
 *   方案D：双策略保守版 + 大盘共振（单日≥3%，5仓满打）
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

// B4 原版：突破日直接买入
const B4_ORIG: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   },
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  { field: 'quote_rate',   op: '>=', value: 1   },
  ...BASE,
];

// B4-RT10：回踩确认
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

// ─── 策略配置 ────────────────────────────────────────────────────────────────

const STRATEGIES = [
  {
    name: '基准A：保守版（无共振）',
    limitUpRegime: {
      bullLimitUpPct:          0.02,
      bearLimitUpPct:          0.008,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,
      oscillatingMaxPositions:  3,
      oscillatingBuyRules:      B4_RT10,
      bearMaxPositions:         0,
      // resonanceLimitUpPct 不设 → 无共振逻辑
    },
  },
  {
    name: '方案B：共振≥3%触发（3仓）',
    limitUpRegime: {
      bullLimitUpPct:          0.02,
      bearLimitUpPct:          0.008,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,
      resonanceLimitUpPct:      0.03,    // 单日≥3%（~150只涨停）→ 共振
      resonanceMaxPositions:    3,       // 共振时3仓（保守）
      resonanceBuyRules:        B4_ORIG, // 共振时用原版（不等回踩）
      oscillatingMaxPositions:  3,
      oscillatingBuyRules:      B4_RT10,
      bearMaxPositions:         0,
    },
  },
  {
    name: '方案C：共振≥2.5%触发（3仓）',
    limitUpRegime: {
      bullLimitUpPct:          0.02,
      bearLimitUpPct:          0.008,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,
      resonanceLimitUpPct:      0.025,   // 单日≥2.5%（~125只涨停）→ 共振
      resonanceMaxPositions:    3,
      resonanceBuyRules:        B4_ORIG,
      oscillatingMaxPositions:  3,
      oscillatingBuyRules:      B4_RT10,
      bearMaxPositions:         0,
    },
  },
  {
    name: '方案D：共振≥3%满仓（5仓）',
    limitUpRegime: {
      bullLimitUpPct:          0.02,
      bearLimitUpPct:          0.008,
      bullMaxPositions:         5,
      bullBuyRules:             B4_ORIG,
      resonanceLimitUpPct:      0.03,
      resonanceMaxPositions:    5,       // 共振时敢打满仓
      resonanceBuyRules:        B4_ORIG,
      oscillatingMaxPositions:  3,
      oscillatingBuyRules:      B4_RT10,
      bearMaxPositions:         0,
    },
  },
];

function runScheme(s: typeof STRATEGIES[0]) {
  let cap = 100_000;
  const ps: Record<string, { ret: number; trades: number; wins: number; maxDD: number }> = {};
  for (const [label, start, end] of PERIODS) {
    const r = runCustomBacktest({
      strategyName:    `${s.name} ${label}`,
      startDate: start, endDate: end,
      scanMode:        'market',
      buyRules:        B4_ORIG,
      sellRules:       SELL,
      trailingStopPct: 10,
      initialCapital:  cap, maxPositions: 5,
      candidateSortBy: 'volume_ratio',
      limitUpRegime:   s.limitUpRegime,
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

console.log('\nB4 大盘共振版 对比（半年度分段·资金连续）');
console.log('='.repeat(112));
console.log(
  '策略'.padEnd(26), '2023H1'.padStart(8), '2023H2'.padStart(8), '2024H1'.padStart(8),
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
  const p  = r.ps;
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) + '%' : '-';
  console.log(
    s.name.padEnd(26),
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
console.log('策略'.padEnd(26), '2023'.padStart(9), '2024'.padStart(9), '2025'.padStart(9));
console.log('-'.repeat(58));
for (const r of results) {
  const p = r.ps;
  const y23 = ((1 + p['2023H1'].ret/100) * (1 + p['2023H2'].ret/100) - 1) * 100;
  const y24 = ((1 + p['2024H1'].ret/100) * (1 + p['2024H2'].ret/100) - 1) * 100;
  const y25 = ((1 + p['2025H1'].ret/100) * (1 + p['2025H2'].ret/100) - 1) * 100;
  console.log(r.name.padEnd(26), fR(y23).padStart(9), fR(y24).padStart(9), fR(y25).padStart(9));
}

// 笔数对比（共振增加了多少交易）
console.log('\n📊 各段交易笔数：');
console.log('策略'.padEnd(26), PERIODS.map(([l]) => l.padStart(8)).join(''), '合计'.padStart(8));
console.log('-'.repeat(90));
for (const r of results) {
  console.log(r.name.padEnd(26), PERIODS.map(([l]) => String(r.ps[l].trades).padStart(8)).join(''), String(r.totalT).padStart(8));
}

// 排名
console.log('\n🏆 排名（3年总收益）：');
[...results].sort((a, b) => b.total - a.total).forEach((r, i) => {
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) : '0';
  const calmar = r.maxDD > 0 ? (r.total / r.maxDD).toFixed(2) : '-';
  console.log(`  ${i+1}. ${r.name.padEnd(30)} ${fR(r.total)}  胜率${wr}%  ${r.totalT}笔  回撤-${r.maxDD.toFixed(1)}%  卡玛${calmar}`);
});
