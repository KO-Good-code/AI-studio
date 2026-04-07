/**
 * B4 回踩确认 + 入场日大盘共振 对比回测
 *
 * 核心思路：
 *   RT10（回踩确认）= 过去10天内有60日新高突破，今日在高位附近放量拉起 → 过滤假突破
 *   入场日大盘共振  = 在个股回踩起来那天，同时要求当日全市场涨停比 ≥ 阈值 → 入场更谨慎
 *   两层叠加：个股条件 × 大盘条件，既减少假突破，又避免在市场疲弱时盲目进场
 *
 * 对比策略（均用 limitUpRegime 涨停比大盘过滤：牛市5仓ORIG，震荡3仓RT10，熊市空仓）：
 *   基准A ：双策略保守版（基准，无入场日过滤）
 *   方案B ：纯RT10全时段（牛/震荡均用RT10，熊市空仓）
 *   方案C ：纯RT10 + 入场日涨停≥0.8%（≈40只涨停）
 *   方案D ：纯RT10 + 入场日涨停≥1.0%（≈50只涨停）
 *   方案E ：纯RT10 + 入场日涨停≥1.2%（≈60只涨停）
 *   方案F ：双策略 + 入场日涨停≥0.8%（震荡RT10+大盘共振，牛市ORIG+大盘共振）
 *   方案G ：双策略 + 入场日涨停≥1.0%
 */

import { runCustomBacktest } from '../../lib/backtest/custom-engine';
import type { ConditionRule } from '../../lib/backtest/condition';

const PERIODS: [string, string, string][] = [
  ['2023H1', '2023-04-01', '2023-09-30'],
  ['2023H2', '2023-10-01', '2024-03-31'],
  ['2024H1', '2024-04-01', '2024-09-30'],
  ['2024H2', '2024-10-01', '2025-03-31'],
  ['2025H1', '2025-04-01', '2025-09-30'],
  ['2025H2', '2025-10-01', '2026-04-01'],
];

const SELL: ConditionRule[] = [{ field: 'pct_above_ma20', op: '<=', value: -3 }];

const BASE: ConditionRule[] = [
  { field: 'is_limit_up', op: '=',  value: 0 },
  { field: 'open_pct',    op: '<=', value: 5 },
  { field: 'is_st',       op: '=',  value: 0 },
];

// 原版 B4：平台缩量横盘后放量突破60日新高
const B4_ORIG: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   },
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  { field: 'quote_rate',   op: '>=', value: 1   },
  ...BASE,
];

// RT10：过去10天内有突破，今日回踩60日高位附近后5日新高放量拉起
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

// 双策略 limitUpRegime 基础配置
const DUAL_REGIME = {
  bullLimitUpPct:          0.02,
  bearLimitUpPct:          0.008,
  bullMaxPositions:         5,
  bullBuyRules:             B4_ORIG,
  oscillatingMaxPositions:  3,
  oscillatingBuyRules:      B4_RT10,
  bearMaxPositions:         0,
};

// 纯RT10 limitUpRegime（牛/震荡均用RT10，仅熊市空仓）
const RT10_ONLY_REGIME = {
  bullLimitUpPct:          0.02,
  bearLimitUpPct:          0.008,
  bullMaxPositions:         5,
  bullBuyRules:             B4_RT10,
  oscillatingMaxPositions:  3,
  oscillatingBuyRules:      B4_RT10,
  bearMaxPositions:         0,
};

interface Strategy {
  name: string;
  limitUpRegime: typeof DUAL_REGIME;
  minDailyLimitUpForBuy?: number;
}

const STRATEGIES: Strategy[] = [
  {
    name: '基准A：双策略保守版',
    limitUpRegime: DUAL_REGIME,
  },
  {
    name: '方案B：纯RT10（无入场日过滤）',
    limitUpRegime: RT10_ONLY_REGIME,
  },
  {
    name: '方案C：纯RT10 + 入场日涨停≥0.8%',
    limitUpRegime: RT10_ONLY_REGIME,
    minDailyLimitUpForBuy: 0.008,
  },
  {
    name: '方案D：纯RT10 + 入场日涨停≥1.0%',
    limitUpRegime: RT10_ONLY_REGIME,
    minDailyLimitUpForBuy: 0.01,
  },
  {
    name: '方案E：纯RT10 + 入场日涨停≥1.2%',
    limitUpRegime: RT10_ONLY_REGIME,
    minDailyLimitUpForBuy: 0.012,
  },
  {
    name: '方案F：双策略 + 入场日涨停≥0.8%',
    limitUpRegime: DUAL_REGIME,
    minDailyLimitUpForBuy: 0.008,
  },
  {
    name: '方案G：双策略 + 入场日涨停≥1.0%',
    limitUpRegime: DUAL_REGIME,
    minDailyLimitUpForBuy: 0.01,
  },
];

// ─── 运行 ─────────────────────────────────────────────────────────────────────

interface PeriodResult {
  name: string;
  period: string;
  trades: number;
  winRate: number;
  totalReturn: number;
  maxDD: number;
}

function runAll(): void {
  const results: Record<string, PeriodResult[]> = {};

  for (const strategy of STRATEGIES) {
    results[strategy.name] = [];
    let capital = 100_000;

    for (const [label, start, end] of PERIODS) {
      const res = runCustomBacktest({
        strategyName:    `${strategy.name} ${label}`,
        scanMode:        'market',
        startDate:       start,
        endDate:         end,
        initialCapital:  capital,
        maxPositions:    5,
        buyRules:        B4_RT10,
        sellRules:       SELL,
        trailingStopPct: 10,
        candidateSortBy: 'volume_ratio',
        limitUpRegime:   strategy.limitUpRegime,
        minDailyLimitUpForBuy: strategy.minDailyLimitUpForBuy,
      });

      const finalCapital = capital * (1 + res.totalReturn / 100);
      results[strategy.name].push({
        name:        strategy.name,
        period:      label,
        trades:      res.trades,
        winRate:     res.winRate,
        totalReturn: res.totalReturn,
        maxDD:       res.maxDrawdown,
      });
      capital = finalCapital;
    }
  }

  // ─── 输出 ─────────────────────────────────────────────────────────────────
  const COL = 36;
  const pad = (s: string, n = COL) => s.padEnd(n);

  const header = ['策略', '2023H1', '2023H2', '2024H1', '2024H2', '2025H1', '2025H2', '3年累计']
    .map((h, i) => (i === 0 ? pad(h) : h.padStart(10)))
    .join('');
  console.log('\n' + '='.repeat(header.length));
  console.log('回踩确认(RT10) + 入场日大盘共振 对比回测（资金复利，3年）');
  console.log('='.repeat(header.length));
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const strategy of STRATEGIES) {
    const rows = results[strategy.name];
    let compound = 1;
    const cells = rows.map(r => {
      compound *= (1 + r.totalReturn / 100);
      return `${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}%`.padStart(10);
    });
    const total3yr = ((compound - 1) * 100).toFixed(1);
    const totalStr = `${Number(total3yr) >= 0 ? '+' : ''}${total3yr}%`.padStart(10);
    console.log(pad(strategy.name) + cells.join('') + totalStr);
  }

  console.log('\n--- 各期详细（交易次数 / 胜率 / 最大回撤）---');
  for (const strategy of STRATEGIES) {
    console.log(`\n[${strategy.name}]`);
    const rows = results[strategy.name];
    console.log(
      '  ' + PERIODS.map(([l]) => l.padStart(12)).join('')
    );
    console.log(
      '  次数: ' + rows.map(r => String(r.trades).padStart(12)).join('')
    );
    console.log(
      '  胜率: ' + rows.map(r => `${r.winRate.toFixed(0)}%`.padStart(12)).join('')
    );
    console.log(
      '  回撤: ' + rows.map(r => `${r.maxDD.toFixed(1)}%`.padStart(12)).join('')
    );
  }
  console.log('');
}

runAll();
