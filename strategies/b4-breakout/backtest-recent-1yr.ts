/**
 * B4 平台突破（原版）— 最近1年回测
 * 2025-03-26 ~ 2026-03-26
 */

import { runCustomBacktest } from '../lib/backtest/custom-engine';
import type { ConditionRule } from '../lib/backtest/condition';

const START = '2025-03-26';
const END   = '2026-03-26';

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

const r = runCustomBacktest({
  strategyName: 'B4 平台突破（原版）',
  startDate: START,
  endDate:   END,
  scanMode: 'market',
  buyRules:  BUY_RULES,
  sellRules: SELL_RULES,
  trailingStopPct: 10,
  initialCapital:  100000,
  maxPositions:    5,
  candidateSortBy: 'volume_ratio',
  proxyRegime: {
    ma1Days: 20, ma2Days: 60,
    bullMaxPositions: 5,
    oscillatingMaxPositions: 3,
    bearMaxPositions: 0,
  },
});

console.log(`\nB4 平台突破 最近1年（${START} ~ ${END}）`);
console.log('='.repeat(70));
console.log(`总收益：${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(2)}%`);
console.log(`最终资金：¥${Math.round(r.finalCapital ?? 100000 * (1 + r.totalReturn / 100)).toLocaleString()}`);
console.log(`最大回撤：-${r.maxDrawdown.toFixed(2)}%`);
console.log(`总交易笔数：${r.totalTrades}  胜率：${r.winRate.toFixed(1)}%`);
console.log('='.repeat(70));

if (r.trades && r.trades.length > 0) {
  console.log('\n逐笔交易记录：');
  console.log(
    '股票代码'.padEnd(12), '买入日'.padEnd(12), '卖出日'.padEnd(12),
    '买价'.padStart(7), '卖价'.padStart(7), '涨跌'.padStart(8), '持仓天',
  );
  console.log('-'.repeat(70));

  for (const t of r.trades) {
    const pct = ((t.sellPrice - t.buyPrice) / t.buyPrice * 100);
    const days = Math.round((new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / 86400000);
    const flag = pct >= 0 ? '+' : '';
    console.log(
      t.code.padEnd(12), t.buyDate.padEnd(12), t.sellDate.padEnd(12),
      t.buyPrice.toFixed(2).padStart(7),
      t.sellPrice.toFixed(2).padStart(7),
      (flag + pct.toFixed(1) + '%').padStart(8),
      String(days).padStart(6),
    );
  }

  // 月度汇总
  const monthMap: Record<string, { wins: number; total: number; ret: number }> = {};
  for (const t of r.trades) {
    const m = t.sellDate.slice(0, 7);
    if (!monthMap[m]) monthMap[m] = { wins: 0, total: 0, ret: 0 };
    const pct = (t.sellPrice - t.buyPrice) / t.buyPrice * 100;
    monthMap[m].total++;
    if (pct > 0) monthMap[m].wins++;
    monthMap[m].ret += pct;
  }

  console.log('\n月度汇总（按卖出日）：');
  console.log('月份'.padEnd(10), '笔数'.padStart(4), '胜率'.padStart(7), '平均盈亏'.padStart(9));
  console.log('-'.repeat(35));
  for (const [m, v] of Object.entries(monthMap).sort()) {
    const wr = (v.wins / v.total * 100).toFixed(0) + '%';
    const avg = (v.ret / v.total).toFixed(1);
    console.log(m.padEnd(10), String(v.total).padStart(4), wr.padStart(7), (avg >= '0' ? '+' : '') + avg + '%'.padStart(9 - avg.length - 1));
  }
}
