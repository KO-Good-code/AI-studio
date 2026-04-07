/**
 * trend-strategy.ts — 趋势策略（V15）回测
 *
 * 核心思路：
 *   - 不追当日最强涨幅（去掉 quote_rate >= 3% 的高门槛 + 涨幅排序）
 *   - 明确过滤涨停股（is_limit_up = 0），确保收盘价实际可执行
 *   - 选均线多头排列（MA5>MA20>MA60），MA20 向上，量能温和放大
 *   - 持股时间更长，以趋势持续为驱动，MA5 跌破 MA20 为主要离场信号
 *
 * 与 V14 打板策略对比：
 *   V14  - quote_rate≥3% + 涨幅排序 → 100% 涨停板 → 回测乐观，实盘难执行
 *   V15  - is_limit_up=0 + 量比排序 → 0% 涨停板 → 可在尾盘/次日开盘实际买入
 */

import { runCustomBacktest } from '../lib/backtest/custom-engine';
import type { ConditionRule } from '../lib/backtest/condition';
import type { CustomBacktestConfig } from '../lib/backtest/custom-engine';

// ── V14 打板策略（基准对比）──────────────────────────────────────────────────
const V14_BUY: ConditionRule[] = [
  { field: 'ma5',            op: '>',  value: 'ma20'      },
  { field: 'ma20',           op: '>',  value: 'prev_ma20' },
  { field: 'volume_ratio',   op: '>=', value: 1.5         },
  { field: 'quote_rate',     op: '>=', value: 3           },
  { field: 'is_st',          op: '=',  value: 0           },
  { field: 'pct_above_ma60', op: '<=', value: 20          },
  { field: 'open_pct',       op: '<=', value: 5           },
];

// ── V15 趋势策略：三线向上（MA5/MA10/MA20斜率均为正） + 非涨停 ───────────────
const V15_BUY: ConditionRule[] = [
  // 三线各自斜率向上（当前值 > 前一日值）
  { field: 'ma5',          op: '>',  value: 'prev_ma5'  }, // 5日线向上
  { field: 'ma10',         op: '>',  value: 'prev_ma10' }, // 10日线向上
  { field: 'ma20',         op: '>',  value: 'prev_ma20' }, // 20日线向上
  // 短期多头排列（5日在20日上方）
  { field: 'ma5',          op: '>',  value: 'ma20'      },
  // 量能温和放大
  { field: 'volume_ratio', op: '>=', value: 1.2         },
  // 有涨幅但不封板
  { field: 'quote_rate',   op: '>=', value: 1           },
  { field: 'is_limit_up',  op: '=',  value: 0           }, // 非涨停，可实际执行
  // 过滤 ST、追高开盘
  { field: 'is_st',        op: '=',  value: 0           },
  { field: 'open_pct',     op: '<=', value: 3           },
];

// V15 卖出规则：收盘价跌破 MA20 超过 3%
const V15_SELL: ConditionRule[] = [
  { field: 'pct_above_ma20', op: '<=', value: -3 }, // close < MA20 * 0.97
];

const PROXY = {
  ma1Days: 20, ma2Days: 60,
  bullMaxPositions: 5,
  oscillatingMaxPositions: 3,
  bearMaxPositions: 0,
};

const QUARTERS = [
  ['2023-04-01','2023-06-30'], ['2023-07-01','2023-09-30'],
  ['2023-10-01','2023-12-31'], ['2024-01-01','2024-03-31'],
  ['2024-04-01','2024-06-30'], ['2024-07-01','2024-09-30'],
  ['2024-10-01','2024-12-31'], ['2025-01-01','2025-03-31'],
  ['2025-04-01','2025-06-30'], ['2025-07-01','2025-09-30'],
  ['2025-10-01','2025-12-31'], ['2026-01-01','2026-03-31'],
];

const STRATEGIES: Array<{
  name: string;
  buyRules: ConditionRule[];
  sellRules: ConditionRule[];
  extra: Partial<CustomBacktestConfig>;
  label: string;
}> = [
  {
    name: 'V14 打板(基准)',
    label: '涨幅排序+涨停板，回测乐观',
    buyRules: V14_BUY, sellRules: [],
    extra: { candidateSortBy: 'quote_rate', trailingStopPct: 8 },
  },
  {
    name: 'V15 趋势-涨幅(非涨停)',
    label: '三线向上+非涨停，最强非涨停股',
    buyRules: V15_BUY, sellRules: V15_SELL,
    extra: { candidateSortBy: 'quote_rate', trailingStopPct: 8 },
  },
  {
    name: 'V15 趋势-量比',
    label: '三线向上+非涨停，量比排序',
    buyRules: V15_BUY, sellRules: V15_SELL,
    extra: { candidateSortBy: 'volume_ratio', trailingStopPct: 8 },
  },
  {
    name: 'V15 趋势-代码',
    label: '三线向上+非涨停，代码顺序',
    buyRules: V15_BUY, sellRules: V15_SELL,
    extra: { candidateSortBy: 'code', trailingStopPct: 8 },
  },
];

interface PeriodResult { totalReturn: number; trades: number; wins: number; endCapital: number; }

function runQuarter(
  buyRules: ConditionRule[], sellRules: ConditionRule[],
  extra: Partial<CustomBacktestConfig>,
  start: string, end: string, startCapital: number,
): PeriodResult {
  const r = runCustomBacktest({
    strategyName: 'cmp', startDate: start, endDate: end,
    scanMode: 'market', buyRules, sellRules,
    initialCapital: startCapital, maxPositions: 5,
    proxyRegime: PROXY, ...extra,
  });
  return {
    totalReturn: r.totalReturn,
    trades: r.totalTrades,
    wins: Math.round(r.winRate / 100 * r.totalTrades),
    endCapital: startCapital * (1 + r.totalReturn / 100),
  };
}

console.log('='.repeat(90));
console.log(' 趋势策略 V15 vs 打板策略 V14 — 近3年（2023-04 ~ 2026-03）');
console.log(' 初始资金 10万 | 最多5仓 | 追踪止损8% | 代理指数MA切换');
console.log('='.repeat(90));

interface AggResult {
  name: string; label: string;
  yearRet: Record<string,number>; qRets: number[]; qTrades: number[];
  total3y: number; finalCapital: number;
  totalTrades: number; winRate: number;
}

const aggResults: AggResult[] = [];

for (const s of STRATEGIES) {
  process.stdout.write(`\n正在回测: ${s.name} ${s.label}\n`);
  let capital = 100_000;
  const yearStart: Record<string,number> = {};
  const yearEnd:   Record<string,number> = {};
  let totalTrades = 0, totalWins = 0;
  const qRets: number[] = [], qTrades: number[] = [];

  for (const [start, end] of QUARTERS) {
    const year = start.slice(0,4);
    if (!yearStart[year]) yearStart[year] = capital;
    const r = runQuarter(s.buyRules, s.sellRules, s.extra, start, end, capital);
    totalTrades += r.trades;
    totalWins   += r.wins;
    qRets.push(r.totalReturn);
    qTrades.push(r.trades);
    capital = r.endCapital;
    yearEnd[year] = capital;
    process.stdout.write(`  ${start.slice(0,7)}: ${r.totalReturn>=0?'+':''}${r.totalReturn.toFixed(1)}%  ${r.trades}笔\n`);
  }

  const total3y = (capital - 100_000) / 100_000 * 100;
  const yr = (y: string) => yearStart[y] ? (yearEnd[y]-yearStart[y])/yearStart[y]*100 : 0;

  aggResults.push({
    name: s.name, label: s.label,
    yearRet: { '2023': yr('2023'), '2024': yr('2024'), '2025': yr('2025'), '2026': yr('2026') },
    qRets, qTrades,
    total3y, finalCapital: capital,
    totalTrades, winRate: totalTrades > 0 ? totalWins/totalTrades*100 : 0,
  });

  process.stdout.write(`  ✅ 3年: ${total3y>=0?'+':''}${total3y.toFixed(1)}%  ¥${Math.round(capital).toLocaleString()}\n`);
}

// ── 汇总表 ──
const fmt = (v: number) => (v>=0?'+':'')+v.toFixed(1)+'%';
const W = 22;
console.log('\n');
console.log('='.repeat(90));
console.log('策略'.padEnd(W), '2023年'.padStart(8), '2024年'.padStart(8),
  '2025年'.padStart(8), '2026Q1'.padStart(8), '3年总收益'.padStart(10),
  '最终资金'.padStart(10), '胜率'.padStart(6), '笔数'.padStart(5));
console.log('-'.repeat(90));

aggResults.sort((a,b) => b.total3y - a.total3y);
for (const r of aggResults) {
  console.log(
    r.name.padEnd(W),
    fmt(r.yearRet['2023']).padStart(8), fmt(r.yearRet['2024']).padStart(8),
    fmt(r.yearRet['2025']).padStart(8), fmt(r.yearRet['2026']).padStart(8),
    fmt(r.total3y).padStart(10),
    ('¥'+Math.round(r.finalCapital).toLocaleString()).padStart(10),
    (r.winRate.toFixed(1)+'%').padStart(6),
    String(r.totalTrades).padStart(5),
  );
}
console.log('='.repeat(90));

// 找出 V15 最优版本
const v15Best = aggResults.filter(r => r.name.startsWith('V15')).sort((a,b)=>b.total3y-a.total3y)[0];
console.log(`\n📊 V15 趋势策略最优版本: ${v15Best.name}`);
console.log(`   3年收益 ${fmt(v15Best.total3y)}  最终资金 ¥${Math.round(v15Best.finalCapital).toLocaleString()}`);
console.log(`   胜率 ${v15Best.winRate.toFixed(1)}%  总交易 ${v15Best.totalTrades}笔`);
console.log('\n各季度详情:');
console.log('季度'.padEnd(12), '收益'.padStart(8), '笔数'.padStart(6));
console.log('-'.repeat(28));
QUARTERS.forEach(([s], i) => {
  console.log(s.slice(0,7).padEnd(12), fmt(v15Best.qRets[i]).padStart(8), String(v15Best.qTrades[i]+'笔').padStart(6));
});
console.log('='.repeat(90));
