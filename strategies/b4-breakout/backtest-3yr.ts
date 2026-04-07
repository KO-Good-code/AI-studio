/**
 * B4 平台突破（原版）— 3年半年度分段回测
 * 每半年一段，资金连续继承（不跨季强制平仓）
 * 2023-04-01 ~ 2026-03-26
 */

import { runCustomBacktest } from '../lib/backtest/custom-engine';
import type { ConditionRule } from '../lib/backtest/condition';

// 半年度分段（共6段）
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

const PROXY = {
  ma1Days: 20, ma2Days: 60,
  bullMaxPositions: 5,
  oscillatingMaxPositions: 3,
  bearMaxPositions: 0,
};

interface PeriodResult {
  label: string;
  start: string;
  end: string;
  ret: number;
  trades: number;
  wins: number;
  maxDD: number;
  capStart: number;
  capEnd: number;
}

let capital = 100_000;
const results: PeriodResult[] = [];
const allTrades: Array<{
  code: string; buyDate: string; sellDate: string;
  buyPrice: number; sellPrice: number;
}> = [];

console.log('B4 平台突破（原版）3年回测 — 半年度分段（资金连续）');
console.log('='.repeat(72));
console.log('分段'.padEnd(10), '收益'.padStart(8), '最终¥'.padStart(12), '胜率'.padStart(6), '笔'.padStart(4), '回撤'.padStart(7));
console.log('-'.repeat(55));

for (const [label, start, end] of PERIODS) {
  const capStart = capital;
  const r = runCustomBacktest({
    strategyName: `B4 ${label}`,
    startDate: start, endDate: end,
    scanMode: 'market',
    buyRules: BUY_RULES, sellRules: SELL_RULES,
    trailingStopPct: 10,
    initialCapital: capital,
    maxPositions: 5,
    candidateSortBy: 'volume_ratio',
    proxyRegime: PROXY,
  });

  const wins = Math.round(r.winRate / 100 * r.totalTrades);
  capital *= (1 + r.totalReturn / 100);

  results.push({
    label, start, end,
    ret: r.totalReturn,
    trades: r.totalTrades, wins,
    maxDD: r.maxDrawdown,
    capStart, capEnd: capital,
  });

  if (r.trades) allTrades.push(...r.trades);

  const retStr = (r.totalReturn >= 0 ? '+' : '') + r.totalReturn.toFixed(1) + '%';
  const capStr = '¥' + Math.round(capital).toLocaleString();
  const wrStr = r.winRate.toFixed(0) + '%';
  const ddStr = '-' + r.maxDrawdown.toFixed(1) + '%';
  console.log(label.padEnd(10), retStr.padStart(8), capStr.padStart(12), wrStr.padStart(6), String(r.totalTrades).padStart(4), ddStr.padStart(7));
}

// 汇总
const totalRet = (capital - 100_000) / 100_000 * 100;
const totalTrades = results.reduce((s, r) => s + r.trades, 0);
const totalWins = results.reduce((s, r) => s + r.wins, 0);
const maxDD = Math.max(...results.map(r => r.maxDD));

console.log('='.repeat(55));
console.log(
  '3年合计'.padEnd(10),
  ((totalRet >= 0 ? '+' : '') + totalRet.toFixed(1) + '%').padStart(8),
  ('¥' + Math.round(capital).toLocaleString()).padStart(12),
  (totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(0) + '%' : '-').padStart(6),
  String(totalTrades).padStart(4),
  ('-' + maxDD.toFixed(1) + '%').padStart(7),
);

// 逐年汇总（按结果推算）
console.log('\n📅 逐年收益（半年度复合）：');
const yr2023 = (1 + results[0].ret / 100) * (1 + results[1].ret / 100) - 1;
const yr2024 = (1 + results[2].ret / 100) * (1 + results[3].ret / 100) - 1;
const yr2025H1 = results[4].ret / 100;
const yr2025H2 = results[5].ret / 100;
const yr2025 = (1 + yr2025H1) * (1 + yr2025H2) - 1;

console.log(`  2023（H1+H2）: ${(yr2023 * 100 >= 0 ? '+' : '')}${(yr2023 * 100).toFixed(1)}%`);
console.log(`  2024（H1+H2）: ${(yr2024 * 100 >= 0 ? '+' : '')}${(yr2024 * 100).toFixed(1)}%`);
console.log(`  2025（H1+H2）: ${(yr2025 * 100 >= 0 ? '+' : '')}${(yr2025 * 100).toFixed(1)}%`);
console.log(`  2026 Q1:       ${(results[5].ret >= 0 ? '+' : '')}...（含在2025H2内）`);

// 逐月汇总（按所有交易卖出日）
if (allTrades.length > 0) {
  const monthMap: Record<string, { wins: number; total: number; pnls: number[] }> = {};
  for (const t of allTrades) {
    const pct = (t.sellPrice - t.buyPrice) / t.buyPrice * 100;
    const mo = t.sellDate.slice(0, 7);
    if (!monthMap[mo]) monthMap[mo] = { wins: 0, total: 0, pnls: [] };
    monthMap[mo].total++;
    if (pct > 0) monthMap[mo].wins++;
    monthMap[mo].pnls.push(pct);
  }

  console.log('\n📅 逐月成交汇总（按卖出日）：');
  console.log('月份'.padEnd(10), '笔'.padStart(3), '胜率'.padStart(6), '均盈亏'.padStart(8), '最优'.padStart(8), '最差'.padStart(8));
  console.log('-'.repeat(48));
  for (const [mo, v] of Object.entries(monthMap).sort()) {
    const wr = (v.wins / v.total * 100).toFixed(0) + '%';
    const avg = (v.pnls.reduce((a, b) => a + b, 0) / v.total).toFixed(1);
    const best = Math.max(...v.pnls).toFixed(1);
    const worst = Math.min(...v.pnls).toFixed(1);
    console.log(
      mo.padEnd(10), String(v.total).padStart(3), wr.padStart(6),
      ((+avg >= 0 ? '+' : '') + avg + '%').padStart(8),
      ('+' + best + '%').padStart(8),
      ((+worst >= 0 ? '+' : '') + worst + '%').padStart(8),
    );
  }
}

// 排名前5的赢家
if (allTrades.length > 0) {
  const ranked = [...allTrades]
    .map(t => ({ ...t, pct: (t.sellPrice - t.buyPrice) / t.buyPrice * 100 }))
    .sort((a, b) => b.pct - a.pct);

  console.log('\n🏆 盈利最大的10笔：');
  console.log('股票代码'.padEnd(14), '买入日'.padEnd(12), '卖出日'.padEnd(12), '涨跌'.padStart(9));
  console.log('-'.repeat(52));
  for (const t of ranked.slice(0, 10)) {
    console.log(t.code.padEnd(14), t.buyDate.padEnd(12), t.sellDate.padEnd(12), ((t.pct >= 0 ? '+' : '') + t.pct.toFixed(1) + '%').padStart(9));
  }

  console.log('\n💸 亏损最大的10笔：');
  console.log('股票代码'.padEnd(14), '买入日'.padEnd(12), '卖出日'.padEnd(12), '涨跌'.padStart(9));
  console.log('-'.repeat(52));
  for (const t of ranked.slice(-10).reverse()) {
    console.log(t.code.padEnd(14), t.buyDate.padEnd(12), t.sellDate.padEnd(12), ((t.pct >= 0 ? '+' : '') + t.pct.toFixed(1) + '%').padStart(9));
  }
}
