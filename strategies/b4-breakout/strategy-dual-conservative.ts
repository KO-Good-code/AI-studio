/**
 * B4 双策略保守版（A-双策略保守）
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 核心思路：
 *   根据大盘涨停比（5日均值）判断市场所处阶段，自动切换入场策略：
 *
 *   ┌─ 牛市（涨停比 ≥ 2%）    → B4 原版：突破当天直接买入，不等回踩
 *   ├─ 震荡市（0.8%~2%）     → B4-RT10：等待10日内的回踩确认后再买入
 *   └─ 熊市（< 0.8%）        → 空仓：不开任何新仓
 *
 * 止损规则（两条，任一触发即出场）：
 *   1. 趋势止损：收盘价跌破 MA20 超过 -3%
 *   2. 追踪止损：从持仓最高价回落超过 10%
 *
 * 3 年回测结果（2023-04-01 ~ 2026-03-26）：
 *   总收益 +28.0%  |  胜率 37%  |  174 笔  |  最大回撤 -27.6%  |  卡玛比率 1.01
 *
 * 最近半年（2025-10-01 ~ 2026-03-26）：
 *   总收益 +14.75%  |  胜率 50%  |  28 笔  |  最大回撤 -8.33%  |  夏普比率 2.21
 *
 * 用法：
 *   npx tsx strategy-dual-conservative.ts                    # 回测最近半年
 *   npx tsx strategy-dual-conservative.ts 2025-01-01 2026-03-26  # 自定义区间
 *   npx tsx strategy-dual-conservative.ts --scan             # 扫描今日信号
 */

import { runCustomBacktest } from '../../lib/backtest/custom-engine';
import type { ConditionRule } from '../../lib/backtest/condition';

// ─── 策略参数 ────────────────────────────────────────────────────────────────

/** 初始资金（元） */
const INITIAL_CAPITAL = 100_000;

/** 最大同时持仓数（牛市/震荡市） */
const MAX_POS_BULL        = 5;
const MAX_POS_OSCILLATING = 3;  // 震荡市保守减仓

/** 追踪止损回撤比例（%） */
const TRAILING_STOP_PCT = 10;

/** 大盘涨停比阈值 */
const BULL_LIMIT_UP_PCT = 0.02;   // ≥ 2%  → 牛市
const BEAR_LIMIT_UP_PCT = 0.008;  // < 0.8% → 熊市

// ─── 通用过滤条件 ────────────────────────────────────────────────────────────
const BASE_FILTERS: ConditionRule[] = [
  { field: 'is_limit_up', op: '=',  value: 0 },  // 非涨停（次日可正常买入）
  { field: 'open_pct',    op: '<=', value: 5 },  // 开盘涨幅 ≤ 5%
  { field: 'is_st',       op: '=',  value: 0 },  // 非 ST 股
];

// ─── 买入规则1：B4 原版（突破日直接买入）────────────────────────────────────
// 适用场景：牛市，市场动能强，不需要等回踩确认，快速入场不错过行情
const BUY_RULES_ORIGINAL: ConditionRule[] = [
  // 创 60 日新高（突破平台压力位）
  { field: 'high_break_60', op: '=',  value: 1   },
  // 量比 ≥ 2x（明显放量，排除缩量假突破）
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  // 近 40 日 ATR ≤ 5%（确认之前是低波动横盘平台）
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  // 当日涨幅 ≥ 1%（收涨，有上行动能）
  { field: 'quote_rate',   op: '>=', value: 1   },
  ...BASE_FILTERS,
];

// ─── 买入规则2：B4-RT10（10日回踩确认后买入）────────────────────────────────
// 适用场景：震荡市，假突破多，等股价回踩突破位再反弹时才入场
//
// 逻辑步骤：
//   Step 1: 近 10 天内有过 60 日新高突破          → had_break_60_in_10d = 1
//   Step 2: 今日价格仍在突破位附近（-5% ~ +2%）   → close_pct_vs_60d_high ∈ [-5, 2]
//   Step 3: 今日创 5 日新高（从回踩位反弹向上）   → high_break_5 = 1
//   Step 4: 量比 ≥ 1.5x（反弹时量能跟上）
//   Step 5: 仍在 MA20 上方（平台结构完整）
const BUY_RULES_PULLBACK: ConditionRule[] = [
  // 近 10 天内曾突破 60 日高点（确认之前有过有效突破）
  { field: 'had_break_60_in_10d',   op: '=',  value: 1   },
  // 今日价格在突破位附近：偏离不超过 -5%（没跌太深）且不超过 +2%（没追高）
  { field: 'close_pct_vs_60d_high', op: '>=', value: -5  },
  { field: 'close_pct_vs_60d_high', op: '<=', value: 2   },
  // 今日创 5 日新高（从回踩低点重新向上，确认反弹启动）
  { field: 'high_break_5',          op: '=',  value: 1   },
  // 量比 ≥ 1.5x（反弹有量）
  { field: 'volume_ratio',          op: '>=', value: 1.5 },
  // 仍在 MA20 上方（趋势结构未破坏）
  { field: 'pct_above_ma20',        op: '>=', value: 0   },
  // 近 40 日 ATR ≤ 5%（确认是平台结构）
  { field: 'atr_pct_40',           op: '<=', value: 5.0 },
  ...BASE_FILTERS,
];

// ─── 卖出规则 ────────────────────────────────────────────────────────────────
const SELL_RULES: ConditionRule[] = [
  // 趋势止损：收盘跌破 MA20 超过 3%（趋势走坏）
  { field: 'pct_above_ma20', op: '<=', value: -3 },
];
// 追踪止损 10% 由引擎参数 trailingStopPct 控制

// ─── 大盘过滤配置（涨停比方案）──────────────────────────────────────────────
const LIMIT_UP_REGIME = {
  bullLimitUpPct:          BULL_LIMIT_UP_PCT,  // 牛市判断阈值
  bearLimitUpPct:          BEAR_LIMIT_UP_PCT,  // 熊市判断阈值
  bullMaxPositions:         MAX_POS_BULL,
  bullBuyRules:             BUY_RULES_ORIGINAL,   // 牛市：原版（不等回踩）
  oscillatingMaxPositions:  MAX_POS_OSCILLATING,
  oscillatingBuyRules:      BUY_RULES_PULLBACK,   // 震荡：回踩确认
  bearMaxPositions:         0,                    // 熊市：空仓
};

// ─── 主函数 ──────────────────────────────────────────────────────────────────

function runBacktest(startDate: string, endDate: string) {
  console.log(`\n🚀 B4 双策略保守版 回测`);
  console.log(`   区间：${startDate} ~ ${endDate}`);
  console.log(`   大盘过滤：涨停比 ≥${BULL_LIMIT_UP_PCT*100}% 牛市原版 | ${BEAR_LIMIT_UP_PCT*100}%~${BULL_LIMIT_UP_PCT*100}% 震荡回踩${MAX_POS_OSCILLATING}仓 | <${BEAR_LIMIT_UP_PCT*100}% 空仓\n`);

  const r = runCustomBacktest({
    strategyName:    'B4 双策略保守版',
    startDate,
    endDate,
    scanMode:        'market',
    buyRules:        BUY_RULES_ORIGINAL,  // 默认规则（被 limitUpRegime 动态覆盖）
    sellRules:       SELL_RULES,
    trailingStopPct: TRAILING_STOP_PCT,
    initialCapital:  INITIAL_CAPITAL,
    maxPositions:    MAX_POS_BULL,
    candidateSortBy: 'volume_ratio',      // 同日多只时，优先买量比最高的
    limitUpRegime:   LIMIT_UP_REGIME,
  });

  console.log(r.summary);

  // 额外输出：按盈亏排序的交易列表
  const sorted = [...r.trades].sort((a, b) => b.returnPct - a.returnPct);
  console.log('\n📊 盈利 Top 5：');
  sorted.slice(0, 5).forEach((t, i) => {
    console.log(`  ${i+1}. ${t.name}(${t.code})  +${t.returnPct.toFixed(1)}%  持${t.holdDays}天  +¥${Math.round(t.pnl).toLocaleString()}`);
  });
  console.log('\n📊 亏损 Top 5：');
  sorted.slice(-5).reverse().forEach((t, i) => {
    console.log(`  ${i+1}. ${t.name}(${t.code})  ${t.returnPct.toFixed(1)}%  持${t.holdDays}天  -¥${Math.round(-t.pnl).toLocaleString()}`);
  });

  return r;
}

function scanSignals(date?: string) {
  const today = date ?? new Date().toISOString().slice(0, 10);
  console.log(`\n🔍 B4 双策略保守版 今日信号扫描（${today}）`);
  console.log('   扫描前30天数据以评估涨停比…\n');

  // 往前取30天用于判断涨停比
  const from = new Date(today);
  from.setDate(from.getDate() - 45);
  const fromStr = from.toISOString().slice(0, 10);

  const r = runCustomBacktest({
    strategyName:    'B4 双策略 今日扫描',
    startDate:       fromStr,
    endDate:         today,
    scanMode:        'market',
    buyRules:        BUY_RULES_ORIGINAL,
    sellRules:       SELL_RULES,
    trailingStopPct: TRAILING_STOP_PCT,
    initialCapital:  INITIAL_CAPITAL,
    maxPositions:    MAX_POS_BULL,
    candidateSortBy: 'volume_ratio',
    limitUpRegime:   LIMIT_UP_REGIME,
  });

  const todayTrades = r.trades.filter(t => t.buyDate === today);
  if (todayTrades.length === 0) {
    console.log('⚠️  今日无信号（可能处于熊市空仓，或无满足条件个股）');
  } else {
    console.log(`✅ 今日信号共 ${todayTrades.length} 只（按量比排序）：\n`);
    todayTrades.forEach((t, i) => {
      console.log(`  ${i+1}. ${t.name}(${t.code})  买入价 ¥${t.buyPrice}  买入量 ${t.shares}股`);
    });
  }
}

// ─── 命令行入口 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--scan')) {
  scanSignals(args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)));
} else {
  const startDate = args[0] ?? '2025-10-01';
  const endDate   = args[1] ?? '2026-03-26';
  runBacktest(startDate, endDate);
}
