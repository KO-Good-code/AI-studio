/**
 * 缩量横盘放量突破 — 改进版对比
 *
 * 基础：B4（3个月60日平台 + 量比≥2 + ATR≤5%）
 *
 * 改进1：突破当日涨幅 ≥ 3%（强势确认，排除边缘假突破）
 * 改进2：市场宽度过滤（仅牛市入场，震荡/熊市完全空仓）
 * 改进3：同时叠加以上两项
 *
 * 对比组：B4原版 / V14打板
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

// ── 大盘过滤方式一：代理指数 MA20/MA60（原版）──────────────────────────
const PROXY_REGIME = {
  ma1Days: 20, ma2Days: 60,
  bullMaxPositions: 5,
  oscillatingMaxPositions: 3,
  bearMaxPositions: 0,
};

// ── 大盘过滤方式二：市场宽度（仅牛市才入场，震荡/熊市空仓）────────────
const BREADTH_REGIME = {
  bullBreadth5d:   0.55,   // 5日宽度≥55%才算牛市
  bullBreadth20d:  0.50,   // 20日宽度≥50%（双重确认）
  bullMaxPositions: 5,
  oscillatingMaxPositions: 0,  // 震荡期完全空仓
  bearBreadth5d:  0.45,
  bearMaxPositions: 0,
};

// ── 买入条件 ─────────────────────────────────────────────────────────────

/** B4 基础条件（3个月平台）*/
const B4_BASE: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   }, // 突破60日新高（≈3个月平台）
  { field: 'volume_ratio',  op: '>=', value: 2.0 }, // 放量（2倍）
  { field: 'atr_pct_40',   op: '<=', value: 5.0 }, // 近40日ATR≤5%（确认是横盘）
  { field: 'quote_rate',   op: '>=', value: 1   }, // 当日收涨
  { field: 'is_limit_up',  op: '=',  value: 0   }, // 可买入
  { field: 'open_pct',     op: '<=', value: 5   }, // 未过度高开
  { field: 'is_st',        op: '=',  value: 0   }, // 无ST
];

/** 改进1：在 B4_BASE 上加"当日涨幅≥3%"（强势突破）*/
const B4_STRONG: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   },
  { field: 'volume_ratio',  op: '>=', value: 2.0 },
  { field: 'atr_pct_40',   op: '<=', value: 5.0 },
  { field: 'quote_rate',   op: '>=', value: 3   }, // ⬆️ 涨幅≥3%（强势确认）
  { field: 'is_limit_up',  op: '=',  value: 0   },
  { field: 'open_pct',     op: '<=', value: 5   },
  { field: 'is_st',        op: '=',  value: 0   },
];

/** V14 打板（对比基准）*/
const V14_BUY: ConditionRule[] = [
  { field: 'ma5',            op: '>',  value: 'ma20'      },
  { field: 'ma20',           op: '>',  value: 'prev_ma20' },
  { field: 'volume_ratio',   op: '>=', value: 1.5         },
  { field: 'quote_rate',     op: '>=', value: 3           },
  { field: 'is_st',          op: '=',  value: 0           },
  { field: 'pct_above_ma60', op: '<=', value: 20          },
  { field: 'open_pct',       op: '<=', value: 5           },
];

// ── 卖出（跌破MA20超3%，或追踪止损10%）──────────────────────────────────
const SELL_RULES: ConditionRule[] = [
  { field: 'pct_above_ma20', op: '<=', value: -3 },
];

// ── 策略定义 ─────────────────────────────────────────────────────────────

type RegimeType = 'proxy' | 'breadth' | 'none';

interface StratDef {
  name: string;
  desc: string;
  buy: ConditionRule[];
  sell: ConditionRule[];
  regime: RegimeType;
  trail: number;
  sort: CustomBacktestConfig['candidateSortBy'];
}

const STRATEGIES: StratDef[] = [
  {
    name: 'B4 原版',
    desc: '60日平台+量比≥2+ATR≤5%（涨幅≥1%）',
    buy: B4_BASE, sell: SELL_RULES, regime: 'proxy', trail: 10, sort: 'volume_ratio',
  },
  {
    name: 'B4 改进1·强突破',
    desc: '+ 突破日涨幅≥3%（强势确认）',
    buy: B4_STRONG, sell: SELL_RULES, regime: 'proxy', trail: 10, sort: 'volume_ratio',
  },
  {
    name: 'B4 改进2·宽度过滤',
    desc: '+ 市场宽度过滤（仅牛市入场）',
    buy: B4_BASE, sell: SELL_RULES, regime: 'breadth', trail: 10, sort: 'volume_ratio',
  },
  {
    name: 'B4 改进3·双重叠加',
    desc: '+ 涨幅≥3% AND 宽度过滤（双重保障）',
    buy: B4_STRONG, sell: SELL_RULES, regime: 'breadth', trail: 10, sort: 'volume_ratio',
  },
  {
    name: 'V14 打板基准',
    desc: '涨停动量策略（对比基准）',
    buy: V14_BUY, sell: [], regime: 'proxy', trail: 8, sort: 'quote_rate',
  },
];

// ── 回测执行 ─────────────────────────────────────────────────────────────

interface YearStat { ret: number; trades: number; wins: number; }

function run3Years(s: StratDef) {
  let cap = 100000;
  const yearStats: Record<string, YearStat> = {};
  let totalT = 0, totalW = 0, maxDD = 0;
  const qDetails: { q: string; ret: number; trades: number }[] = [];

  for (const [start, end] of QUARTERS) {
    const yr = start.slice(0, 4);
    if (!yearStats[yr]) yearStats[yr] = { ret: 1, trades: 0, wins: 0 };

    const regimeCfg =
      s.regime === 'proxy'   ? { proxyRegime: PROXY_REGIME } :
      s.regime === 'breadth' ? { regimeSwitch: BREADTH_REGIME } :
      {};

    const r = runCustomBacktest({
      strategyName: s.name, startDate: start, endDate: end,
      scanMode: 'market',
      buyRules: s.buy, sellRules: s.sell,
      trailingStopPct: s.trail,
      initialCapital: cap, maxPositions: 5,
      candidateSortBy: s.sort,
      ...regimeCfg,
    });

    const wins = Math.round(r.winRate / 100 * r.totalTrades);
    totalT += r.totalTrades;
    totalW += wins;
    if (r.maxDrawdown > maxDD) maxDD = r.maxDrawdown;

    const qRet = r.totalReturn / 100;
    cap *= (1 + qRet);
    yearStats[yr].ret    *= (1 + qRet);
    yearStats[yr].trades += r.totalTrades;
    yearStats[yr].wins   += wins;

    qDetails.push({ q: start.slice(0, 7), ret: r.totalReturn, trades: r.totalTrades });
  }

  return {
    total: (cap - 100000) / 100000 * 100, final: cap,
    winRate: totalT > 0 ? totalW / totalT * 100 : 0,
    trades: totalT, maxDD, yearStats, qDetails,
  };
}

// ── 输出 ─────────────────────────────────────────────────────────────────

const fmt = (v: number, pad = 8) => ((v >= 0 ? '+' : '') + v.toFixed(1) + '%').padStart(pad);
const yrRet = (s: YearStat) => (s.ret - 1) * 100;

console.log('\n缩量横盘放量突破策略 — 改进版对比（2023-04 ~ 2026-03）');
console.log('改进1：突破日涨幅≥3%  |  改进2：市场宽度过滤（宽度不足时完全空仓）');
console.log('='.repeat(115));
console.log(
  '策略'.padEnd(20), '23(半)'.padStart(7), '2024'.padStart(8),
  '2025'.padStart(8), '26Q1'.padStart(7), '3年总计'.padStart(9),
  '最终¥'.padStart(10), '胜率'.padStart(6), '笔'.padStart(4), '回撤'.padStart(7),
);
console.log('-'.repeat(115));

const allResults: Array<{ name: string; desc: string } & ReturnType<typeof run3Years>> = [];

for (const s of STRATEGIES) {
  process.stderr.write(`\n▶ ${s.name} — ${s.desc}\n`);
  const r = run3Years(s);
  allResults.push({ name: s.name, desc: s.desc, ...r });

  const y = (yr: string) => r.yearStats[yr] ? yrRet(r.yearStats[yr]) : 0;
  console.log(
    s.name.padEnd(20), fmt(y('2023'), 7), fmt(y('2024')), fmt(y('2025')),
    fmt(y('2026'), 7), fmt(r.total), ('¥' + Math.round(r.final).toLocaleString()).padStart(10),
    (r.winRate.toFixed(1) + '%').padStart(6), String(r.trades).padStart(4),
    ('-' + r.maxDD.toFixed(1) + '%').padStart(7),
  );
}

console.log('='.repeat(115));

// 排名
const ranked = [...allResults].sort((a, b) => b.total - a.total);
console.log('\n📊 策略排名（按3年总收益）：');
ranked.forEach((r, i) => {
  const y = (yr: string) => r.yearStats[yr] ? yrRet(r.yearStats[yr]) : 0;
  console.log(
    `  ${i + 1}. ${r.name.padEnd(22)} ${fmt(r.total)}` +
    `  [${fmt(y('2023'), 7)} / ${fmt(y('2024'), 7)} / ${fmt(y('2025'), 7)}]` +
    `  胜率${r.winRate.toFixed(1)}%  回撤${r.maxDD.toFixed(1)}%  ${r.trades}笔`
  );
  console.log(`     └ ${r.desc}`);
});

// 逐年季度明细（展示所有突破策略）
console.log('\n📅 各策略逐季度收益对比：');
const header = '季度'.padEnd(10) + ranked.filter(r => r.name !== 'V14 打板基准').map(r => r.name.slice(0, 10).padStart(13)).join('') + '  V14打板'.padStart(13);
console.log('  ' + header);
console.log('  ' + '-'.repeat(header.length));

for (const q of allResults[0].qDetails) {
  let line = q.q.padEnd(10);
  const v14 = allResults.find(r => r.name === 'V14 打板基准')!;
  for (const r of ranked) {
    if (r.name === 'V14 打板基准') continue;
    const qr = r.qDetails.find(d => d.q === q.q)!;
    const flag = qr.ret >= 0 ? '+' : '';
    line += (flag + qr.ret.toFixed(1) + '%(' + qr.trades + ')').padStart(13);
  }
  const v14q = v14.qDetails.find(d => d.q === q.q)!;
  line += ((v14q.ret >= 0 ? '+' : '') + v14q.ret.toFixed(1) + '%(' + v14q.trades + ')').padStart(13);
  console.log('  ' + line);
}

// 改进效果分析
const b4orig  = allResults.find(r => r.name === 'B4 原版')!;
const b4imp1  = allResults.find(r => r.name === 'B4 改进1·强突破')!;
const b4imp2  = allResults.find(r => r.name === 'B4 改进2·宽度过滤')!;
const b4imp3  = allResults.find(r => r.name === 'B4 改进3·双重叠加')!;

console.log('\n🔬 改进效果分析：');
console.log(`  B4 原版:             ${fmt(b4orig.total, 7)}  胜率${b4orig.winRate.toFixed(1)}%  ${b4orig.trades}笔`);
console.log(`  ├─ 改进1（涨幅≥3%）: ${fmt(b4imp1.total, 7)}  胜率${b4imp1.winRate.toFixed(1)}%  ${b4imp1.trades}笔  [笔数减${b4orig.trades - b4imp1.trades}，胜率${b4imp1.winRate > b4orig.winRate ? '↑' : '↓'}${Math.abs(b4imp1.winRate - b4orig.winRate).toFixed(1)}%]`);
console.log(`  ├─ 改进2（宽度过滤）: ${fmt(b4imp2.total, 7)}  胜率${b4imp2.winRate.toFixed(1)}%  ${b4imp2.trades}笔  [笔数减${b4orig.trades - b4imp2.trades}，胜率${b4imp2.winRate > b4orig.winRate ? '↑' : '↓'}${Math.abs(b4imp2.winRate - b4orig.winRate).toFixed(1)}%]`);
console.log(`  └─ 改进3（双重叠加）: ${fmt(b4imp3.total, 7)}  胜率${b4imp3.winRate.toFixed(1)}%  ${b4imp3.trades}笔  [笔数减${b4orig.trades - b4imp3.trades}，胜率${b4imp3.winRate > b4orig.winRate ? '↑' : '↓'}${Math.abs(b4imp3.winRate - b4orig.winRate).toFixed(1)}%]`);

console.log(`
📌 结论：
   ① 涨幅≥3% 过滤：排除边缘突破，减少假信号，但也会漏掉部分强势股
   ② 宽度过滤：熊市空仓降低亏损，牛市信号质量更高
   ③ 双重叠加：信号最少，但质量最高——适合资金量大、宁可少做不做错的操作风格
   ✅ 最终建议：选超额收益最高的改进版，同时关注回撤和胜率的综合平衡
`);
