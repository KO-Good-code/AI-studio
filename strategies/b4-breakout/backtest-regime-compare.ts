/**
 * B4 平台突破 — 大盘过滤方式第二轮对比
 *
 * B  原版水平位 (proxy MA20/MA60 水平位置)
 * A  涨停比    (5日涨停板比例：A股情绪温度计)
 * C  综合评分  (代理动量 + 上涨家数比 + 涨停比 三信号等权投票)
 * C2 综合评分宽松 (bullScore 降至 0.0，震荡期也允许0仓，但牛市门槛更低)
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

const BUY_RULES: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   },
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  { field: 'quote_rate',   op: '>=', value: 1   },
  { field: 'is_limit_up',  op: '=',  value: 0   },
  { field: 'open_pct',     op: '<=', value: 5   },
  { field: 'is_st',        op: '=',  value: 0   },
];
const SELL_RULES: ConditionRule[] = [
  { field: 'pct_above_ma20', op: '<=', value: -3 },
];

type SchemeCfg = {
  label: string;
  desc: string;
  regime:
    | { type: 'proxy'; ma1Days: number; ma2Days: number; osc: number }
    | { type: 'limitUp'; bull: number; bear: number; osc: number }
    | { type: 'composite'; breadthBull: number; limitUpBull: number; bullScore: number; bearScore: number; osc: number };
};

const SCHEMES: SchemeCfg[] = [
  {
    label: 'B 原版水平位',
    desc: 'proxy>MA20=5仓 | MA20~MA60=3仓 | <MA60=0仓',
    regime: { type: 'proxy', ma1Days: 20, ma2Days: 60, osc: 3 },
  },
  {
    label: 'A 涨停比2%/0.8%',
    desc: '5日涨停比>2%=5仓 | 0.8~2%=0仓 | <0.8%=0仓',
    regime: { type: 'limitUp', bull: 0.020, bear: 0.008, osc: 0 },
  },
  {
    label: 'A2 涨停比1%/0.5%',
    desc: '5日涨停比>1%=5仓 | 0.5~1%=0仓 | <0.5%=0仓',
    regime: { type: 'limitUp', bull: 0.010, bear: 0.005, osc: 0 },
  },
  {
    label: 'C 综合评分严格',
    desc: '三信号>0.33=5仓 | -0.33~0.33=0仓 | <-0.33=0仓',
    regime: { type: 'composite', breadthBull: 0.50, limitUpBull: 0.012, bullScore: 0.33, bearScore: -0.33, osc: 0 },
  },
  {
    label: 'C2 综合评分宽松',
    desc: '三信号>0=5仓 | -0.33~0=0仓 | <-0.33=0仓',
    regime: { type: 'composite', breadthBull: 0.50, limitUpBull: 0.012, bullScore: 0.0, bearScore: -0.33, osc: 0 },
  },
];

function buildConfig(scheme: SchemeCfg, label: string, start: string, end: string, capital: number) {
  const base = {
    strategyName: `${scheme.label} ${label}`,
    startDate: start, endDate: end,
    scanMode: 'market' as const,
    buyRules: BUY_RULES, sellRules: SELL_RULES,
    trailingStopPct: 10,
    initialCapital: capital,
    maxPositions: 5,
    candidateSortBy: 'volume_ratio' as const,
  };
  const r = scheme.regime;
  if (r.type === 'proxy') {
    return { ...base, proxyRegime: { ma1Days: r.ma1Days, ma2Days: r.ma2Days, bullMaxPositions: 5, oscillatingMaxPositions: r.osc, bearMaxPositions: 0 } };
  } else if (r.type === 'limitUp') {
    return { ...base, limitUpRegime: { bullLimitUpPct: r.bull, bearLimitUpPct: r.bear, bullMaxPositions: 5, oscillatingMaxPositions: r.osc, bearMaxPositions: 0 } };
  } else {
    return { ...base, compositeRegime: { breadthBull: r.breadthBull, limitUpBull: r.limitUpBull, bullScore: r.bullScore, bearScore: r.bearScore, bullMaxPositions: 5, oscillatingMaxPositions: r.osc, bearMaxPositions: 0 } };
  }
}

interface PeriodStat { ret: number; trades: number; wins: number; maxDD: number; }

function runScheme(scheme: SchemeCfg) {
  let capital = 100_000;
  const stats: Record<string, PeriodStat> = {};

  for (const [label, start, end] of PERIODS) {
    const cfg = buildConfig(scheme, label, start, end, capital);
    const r = runCustomBacktest(cfg);
    const wins = Math.round(r.winRate / 100 * r.totalTrades);
    capital *= (1 + r.totalReturn / 100);
    stats[label] = { ret: r.totalReturn, trades: r.totalTrades, wins, maxDD: r.maxDrawdown };
  }

  const total   = (capital - 100_000) / 100_000 * 100;
  const totalT  = Object.values(stats).reduce((s, v) => s + v.trades, 0);
  const totalW  = Object.values(stats).reduce((s, v) => s + v.wins, 0);
  const maxDD   = Math.max(...Object.values(stats).map(v => v.maxDD));
  return { capital, total, totalT, totalW, maxDD, stats };
}

// ── 执行 ───────────────────────────────────────────────────────────────────

const fR = (v: number) => ((v >= 0 ? '+' : '') + v.toFixed(1) + '%').padStart(8);

console.log('\nB4 平台突破 — 大盘过滤方式对比 V2（半年度分段·资金连续）');
console.log('='.repeat(112));
console.log(
  '方案'.padEnd(20), '2023H1'.padStart(8), '2023H2'.padStart(8), '2024H1'.padStart(8),
  '2024H2'.padStart(8), '2025H1'.padStart(8), '2025H2'.padStart(8),
  '3年'.padStart(8), '最终¥'.padStart(10), '胜率'.padStart(6), '笔'.padStart(4), '回撤'.padStart(7),
);
console.log('-'.repeat(112));

type Result = ReturnType<typeof runScheme> & { label: string; desc: string };
const results: Result[] = [];

for (const scheme of SCHEMES) {
  process.stderr.write(`▶ ${scheme.label}\n`);
  const r = runScheme(scheme);
  results.push({ ...r, label: scheme.label, desc: scheme.desc });

  const p  = r.stats;
  const wr = r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) + '%' : '-';
  console.log(
    scheme.label.padEnd(20),
    fR(p['2023H1'].ret), fR(p['2023H2'].ret), fR(p['2024H1'].ret),
    fR(p['2024H2'].ret), fR(p['2025H1'].ret), fR(p['2025H2'].ret),
    fR(r.total),
    ('¥' + Math.round(r.capital).toLocaleString()).padStart(10),
    wr.padStart(6), String(r.totalT).padStart(4),
    ('-' + r.maxDD.toFixed(1) + '%').padStart(7),
  );
}

console.log('='.repeat(112));

// 笔数对比（过滤力度）
console.log('\n📊 各段交易笔数（少=过滤严）：');
console.log('方案'.padEnd(20), PERIODS.map(([l]) => l.padStart(8)).join(''), '合计'.padStart(8));
console.log('-'.repeat(76));
for (const r of results) {
  console.log(r.label.padEnd(20), PERIODS.map(([l]) => String(r.stats[l].trades).padStart(8)).join(''), String(r.totalT).padStart(8));
}

// 胜率对比
console.log('\n📊 各段胜率：');
console.log('方案'.padEnd(20), PERIODS.map(([l]) => l.padStart(8)).join(''));
console.log('-'.repeat(68));
for (const r of results) {
  const wrs = PERIODS.map(([l]) => {
    const { wins, trades } = r.stats[l];
    return trades > 0 ? (wins / trades * 100).toFixed(0) + '%' : '- ';
  });
  console.log(r.label.padEnd(20), wrs.map(w => w.padStart(8)).join(''));
}

// 逐年
console.log('\n📅 逐年复合收益：');
console.log('方案'.padEnd(20), '2023'.padStart(8), '2024'.padStart(8), '2025(H1+H2)'.padStart(13));
console.log('-'.repeat(56));
for (const r of results) {
  const p = r.stats;
  const y23 = ((1 + p['2023H1'].ret / 100) * (1 + p['2023H2'].ret / 100) - 1) * 100;
  const y24 = ((1 + p['2024H1'].ret / 100) * (1 + p['2024H2'].ret / 100) - 1) * 100;
  const y25 = ((1 + p['2025H1'].ret / 100) * (1 + p['2025H2'].ret / 100) - 1) * 100;
  console.log(r.label.padEnd(20), fR(y23).padStart(8), fR(y24).padStart(8), fR(y25).padStart(13));
}

// 排名
const ranked = [...results].sort((a, b) => b.total - a.total);
console.log('\n🏆 综合排名（3年总收益）：');
ranked.forEach((r, i) => {
  console.log(`  ${i + 1}. ${r.label.padEnd(22)} ${fR(r.total)}  胜率${r.totalT > 0 ? (r.totalW / r.totalT * 100).toFixed(0) : 0}%  ${r.totalT}笔  回撤${r.maxDD.toFixed(1)}%`);
  console.log(`     └ ${r.desc}`);
});
