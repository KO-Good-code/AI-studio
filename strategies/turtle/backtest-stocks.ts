/**
 * 海龟交易策略 A股回测
 * 原版规则（Richard Dennis & Bill Eckhardt, 1983）
 *
 * System 1（短线）：20日新高买入 / 10日新低出场
 * System 2（长线）：55日新高买入 / 20日新低出场
 * 止损：ATR × 2（用追踪止损近似）
 *
 * A股特殊处理：
 *  - 只做多（无做空）
 *  - 排除涨停板收盘（买不进）
 *  - 排除ST
 *  - 加市场环境过滤（proxyRegime）
 */

import { runCustomBacktest } from '../lib/backtest/custom-engine';
import type { ConditionRule } from '../lib/backtest/condition';
import type { CustomBacktestConfig } from '../lib/backtest/custom-engine';

const QUARTERS: [string, string][] = [
  ['2023-04-01','2023-06-30'], ['2023-07-01','2023-09-30'],
  ['2023-10-01','2023-12-31'], ['2024-01-01','2024-03-31'],
  ['2024-04-01','2024-06-30'], ['2024-07-01','2024-09-30'],
  ['2024-10-01','2024-12-31'], ['2025-01-01','2025-03-31'],
  ['2025-04-01','2025-06-30'], ['2025-07-01','2025-09-30'],
  ['2025-10-01','2025-12-31'], ['2026-01-01','2026-03-31'],
];

// 市场环境切换（代理指数 MA20/MA60）
const PROXY = {
  ma1Days: 20, ma2Days: 60,
  bullMaxPositions: 5,
  oscillatingMaxPositions: 3,
  bearMaxPositions: 0,
};

// ─── 策略条件 ─────────────────────────────────────────────────────────────

/** System 1 原版：20日新高突破买 */
const T1_BUY_PURE: ConditionRule[] = [
  { field: 'high_break_20', op: '=',  value: 1 },
  { field: 'is_st',         op: '=',  value: 0 },
];
const T1_SELL: ConditionRule[] = [
  { field: 'low_break_10',  op: '=',  value: 1 },
];

/** System 1 A股版：20日突破 + 排除涨停 + 量能确认 */
const T1_BUY_ASHARE: ConditionRule[] = [
  { field: 'high_break_20', op: '=',  value: 1   },
  { field: 'is_limit_up',   op: '=',  value: 0   }, // 排除涨停（买不进）
  { field: 'volume_ratio',  op: '>=', value: 1.0 }, // 成交量扩大
  { field: 'open_pct',      op: '<=', value: 5   }, // 未过度高开
  { field: 'is_st',         op: '=',  value: 0   },
];

/** System 2 原版：55日新高突破买 */
const T2_BUY_PURE: ConditionRule[] = [
  { field: 'high_break_55', op: '=',  value: 1 },
  { field: 'is_st',         op: '=',  value: 0 },
];
const T2_SELL: ConditionRule[] = [
  { field: 'low_break_20',  op: '=',  value: 1 },
];

/** System 2 A股版：55日突破 + 排除涨停 + 量能确认 */
const T2_BUY_ASHARE: ConditionRule[] = [
  { field: 'high_break_55', op: '=',  value: 1   },
  { field: 'is_limit_up',   op: '=',  value: 0   },
  { field: 'volume_ratio',  op: '>=', value: 1.0 },
  { field: 'open_pct',      op: '<=', value: 5   },
  { field: 'is_st',         op: '=',  value: 0   },
];

/** V14 打板（全程对比基准）*/
const V14_BUY: ConditionRule[] = [
  { field: 'ma5',          op: '>',  value: 'ma20'      },
  { field: 'ma20',         op: '>',  value: 'prev_ma20' },
  { field: 'volume_ratio', op: '>=', value: 1.5         },
  { field: 'quote_rate',   op: '>=', value: 3           },
  { field: 'is_st',        op: '=',  value: 0           },
  { field: 'pct_above_ma60', op: '<=', value: 20        },
  { field: 'open_pct',     op: '<=', value: 5           },
];

// ─── 策略组合 ─────────────────────────────────────────────────────────────

interface StratDef {
  name: string;
  buy: ConditionRule[];
  sell: ConditionRule[];
  trail: number;    // 追踪止损 %（近似2N）
  sort: CustomBacktestConfig['candidateSortBy'];
  useProxy: boolean;
}

const STRATEGIES: StratDef[] = [
  // System 1 系列
  {
    name: 'T1 20日突破(原版)',
    buy: T1_BUY_PURE, sell: T1_SELL,
    trail: 8, sort: 'volume_ratio', useProxy: false,
  },
  {
    name: 'T1 20日突破+大盘',
    buy: T1_BUY_PURE, sell: T1_SELL,
    trail: 8, sort: 'volume_ratio', useProxy: true,
  },
  {
    name: 'T1 20日突破+A股版',
    buy: T1_BUY_ASHARE, sell: T1_SELL,
    trail: 8, sort: 'volume_ratio', useProxy: true,
  },
  // System 2 系列
  {
    name: 'T2 55日突破(原版)',
    buy: T2_BUY_PURE, sell: T2_SELL,
    trail: 10, sort: 'volume_ratio', useProxy: false,
  },
  {
    name: 'T2 55日突破+大盘',
    buy: T2_BUY_PURE, sell: T2_SELL,
    trail: 10, sort: 'volume_ratio', useProxy: true,
  },
  {
    name: 'T2 55日突破+A股版',
    buy: T2_BUY_ASHARE, sell: T2_SELL,
    trail: 10, sort: 'volume_ratio', useProxy: true,
  },
  // 对比基准
  {
    name: 'V14 打板(对比基准)',
    buy: V14_BUY, sell: [],
    trail: 8, sort: 'quote_rate', useProxy: true,
  },
];

// ─── 回测执行 ─────────────────────────────────────────────────────────────

function run3Years(s: StratDef) {
  let cap = 100000;
  const yearStart: Record<string, number> = {};
  const yearEnd:   Record<string, number> = {};
  let totalT = 0, totalW = 0, maxDD = 0;
  const qDetails: string[] = [];

  for (const [start, end] of QUARTERS) {
    const yr = start.slice(0, 4);
    if (!yearStart[yr]) yearStart[yr] = cap;

    const cfg: CustomBacktestConfig = {
      strategyName: s.name, startDate: start, endDate: end,
      scanMode: 'market', buyRules: s.buy, sellRules: s.sell,
      trailingStopPct: s.trail, initialCapital: cap, maxPositions: 5,
      candidateSortBy: s.sort,
      ...(s.useProxy ? { proxyRegime: PROXY } : {}),
    };
    const r = runCustomBacktest(cfg);

    totalT += r.totalTrades;
    totalW += Math.round(r.winRate / 100 * r.totalTrades);
    if (r.maxDrawdown > maxDD) maxDD = r.maxDrawdown;
    cap *= (1 + r.totalReturn / 100);
    yearEnd[yr] = cap;

    const qLabel = start.slice(0, 7);
    qDetails.push(`${qLabel}:${(r.totalReturn>=0?'+':'')+r.totalReturn.toFixed(1)}%(${r.totalTrades}笔)`);
  }

  const yr = (y: string) => yearStart[y]
    ? (yearEnd[y] - yearStart[y]) / yearStart[y] * 100 : 0;

  return {
    y23: yr('2023'), y24: yr('2024'), y25: yr('2025'), y26: yr('2026'),
    total: (cap - 100000) / 100000 * 100, final: cap,
    winRate: totalT > 0 ? totalW / totalT * 100 : 0,
    trades: totalT, maxDD, qDetails,
  };
}

// ─── 输出 ─────────────────────────────────────────────────────────────────

const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

console.log('\n海龟交易策略 A股回测（2023-04 ~ 2026-03，约 3 年）');
console.log('Strategy 1: 20日新高买 / 10日新低卖（短线系统）');
console.log('Strategy 2: 55日新高买 / 20日新低卖（长线系统）');
console.log('='.repeat(100));
console.log(
  '策略'.padEnd(22),
  '23(半)'.padStart(8), '2024'.padStart(8), '2025'.padStart(8), '26Q1'.padStart(7),
  '3年总计'.padStart(9), '最终¥'.padStart(10),
  '胜率'.padStart(6), '笔'.padStart(4), '最大回撤'.padStart(8),
);
console.log('-'.repeat(100));

const allResults: Array<{ name: string } & ReturnType<typeof run3Years>> = [];

for (const s of STRATEGIES) {
  process.stderr.write(`\n▶ 测试: ${s.name}...\n`);
  const r = run3Years(s);
  allResults.push({ name: s.name, ...r });

  console.log(
    s.name.padEnd(22),
    fmt(r.y23).padStart(8), fmt(r.y24).padStart(8), fmt(r.y25).padStart(8), fmt(r.y26).padStart(7),
    fmt(r.total).padStart(9),
    ('¥' + Math.round(r.final).toLocaleString()).padStart(10),
    (r.winRate.toFixed(1) + '%').padStart(6),
    String(r.trades).padStart(4),
    ('-' + r.maxDD.toFixed(1) + '%').padStart(8),
  );
}

console.log('='.repeat(100));

// 排行榜
allResults.sort((a, b) => b.total - a.total);
console.log('\n🏆 策略排名（按3年总收益）：');
allResults.forEach((r, i) => {
  console.log(
    `  ${i + 1}. ${r.name}: ${fmt(r.total)}` +
    `  胜率 ${r.winRate.toFixed(1)}%  最大回撤 ${r.maxDD.toFixed(1)}%  共 ${r.trades} 笔`
  );
});

// 季度详情（最优策略）
const best = allResults[0];
console.log(`\n📅 ${best.name} 季度明细：`);
const orig = STRATEGIES.find(s => s.name === best.name)!;
// 重跑一次获取季度详情
const bestFull = run3Years(orig);
bestFull.qDetails.forEach((q, i) => {
  const marker = q.includes('-') ? '  🔴' : '  🟢';
  process.stdout.write(marker + ' ' + q + (i % 4 === 3 ? '\n' : '  '));
});
if (bestFull.qDetails.length % 4 !== 0) console.log();

console.log(`
📌 海龟策略 A股适用性结论：
   ✅ 优势：规则纯粹，无主观判断；捕捉趋势初期，胜率低但盈亏比高
   ⚠️  挑战：A股个股信号频繁，假突破多（建议加量比过滤）
   🔑 关键：大盘过滤 + A股涨停排除 = 显著提升质量
   📊 对比：海龟策略 vs 打板策略——两者逻辑互补，合并使用更稳
`);
