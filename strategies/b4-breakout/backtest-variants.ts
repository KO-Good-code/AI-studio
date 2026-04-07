/**
 * 缩量横盘放量突破策略
 *
 * 核心逻辑：
 *   ① 缩量横盘 1-2个月：atr_pct_30 较低（波动收窄）
 *   ② 放量突破平台：收盘价突破 N 日新高 + 当日量比 >= 2.5
 *   ③ 非涨停（收盘可买）、无 ST
 *   ④ 出场：追踪止损 10%，或跌回平台（跌破 MA20 超 3%）
 *
 * 对比组：
 *   B1  20 日突破 + 量比≥2    (1个月平台)
 *   B2  40 日突破 + 量比≥2    (2个月平台)
 *   B3  40 日突破 + 量比≥3    (2个月平台·强量)
 *   B4  60 日突破 + 量比≥2    (3个月平台)
 *   V14 打板策略               (对比基准)
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

const PROXY = {
  ma1Days: 20, ma2Days: 60,
  bullMaxPositions: 5,
  oscillatingMaxPositions: 3,
  bearMaxPositions: 0,
};

// ── 公共过滤 ──────────────────────────────────────────────────────────────
const COMMON: ConditionRule[] = [
  { field: 'quote_rate',   op: '>=', value: 1   }, // 当日收涨（不买阴线突破）
  { field: 'is_limit_up',  op: '=',  value: 0   }, // 非涨停，可实际买入
  { field: 'open_pct',     op: '<=', value: 5   }, // 排除过度高开（跳空太大追不进）
  { field: 'is_st',        op: '=',  value: 0   }, // 排除 ST
];

// ── 各策略买入条件 ─────────────────────────────────────────────────────────

/** B1：1个月横盘（20日）+ 量比≥2 */
const B1_BUY: ConditionRule[] = [
  { field: 'high_break_20', op: '=',  value: 1   }, // 突破20日新高
  { field: 'volume_ratio',  op: '>=', value: 2.0 }, // 放量（2倍）
  { field: 'atr_pct_20',   op: '<=', value: 3.5 }, // 近20日ATR≤3.5%（横盘低波动）
  ...COMMON,
];

/** B2：2个月横盘（40日）+ 量比≥2 */
const B2_BUY: ConditionRule[] = [
  { field: 'high_break_40', op: '=',  value: 1   }, // 突破40日新高（≈2个月）
  { field: 'volume_ratio',  op: '>=', value: 2.0 }, // 放量（2倍）
  { field: 'atr_pct_30',   op: '<=', value: 4.5 }, // 近30日ATR≤4.5%（横盘）
  ...COMMON,
];

/** B3：2个月横盘（40日）+ 量比≥3（更强放量确认）*/
const B3_BUY: ConditionRule[] = [
  { field: 'high_break_40', op: '=',  value: 1   }, // 突破40日新高
  { field: 'volume_ratio',  op: '>=', value: 3.0 }, // 强放量（3倍以上）
  { field: 'atr_pct_30',   op: '<=', value: 4.5 }, // 近30日ATR≤4.5%
  ...COMMON,
];

/** B4：3个月横盘（60日）+ 量比≥2（更长平台，信号更稀少但更强）*/
const B4_BUY: ConditionRule[] = [
  { field: 'high_break_60', op: '=',  value: 1   }, // 突破60日新高（≈3个月）
  { field: 'volume_ratio',  op: '>=', value: 2.0 }, // 放量（2倍）
  { field: 'atr_pct_40',   op: '<=', value: 5.0 }, // 近40日ATR≤5%
  ...COMMON,
];

/** V14 打板基准 */
const V14_BUY: ConditionRule[] = [
  { field: 'ma5',            op: '>',  value: 'ma20'      },
  { field: 'ma20',           op: '>',  value: 'prev_ma20' },
  { field: 'volume_ratio',   op: '>=', value: 1.5         },
  { field: 'quote_rate',     op: '>=', value: 3           },
  { field: 'is_st',          op: '=',  value: 0           },
  { field: 'pct_above_ma60', op: '<=', value: 20          },
  { field: 'open_pct',       op: '<=', value: 5           },
];

// ── 卖出条件（跌回平台）─────────────────────────────────────────────────
const SELL_RULES: ConditionRule[] = [
  { field: 'pct_above_ma20', op: '<=', value: -3 }, // 跌破MA20超3%=跌回平台
];

// ── 策略定义 ─────────────────────────────────────────────────────────────

interface StratDef {
  name: string;
  desc: string;
  buy: ConditionRule[];
  sell: ConditionRule[];
  sort: CustomBacktestConfig['candidateSortBy'];
  trail: number;
}

const STRATEGIES: StratDef[] = [
  {
    name: 'B1 20日+量比2',
    desc: '1个月平台·量比≥2·ATR≤3.5%',
    buy: B1_BUY, sell: SELL_RULES, sort: 'volume_ratio', trail: 10,
  },
  {
    name: 'B2 40日+量比2',
    desc: '2个月平台·量比≥2·ATR≤4.5%',
    buy: B2_BUY, sell: SELL_RULES, sort: 'volume_ratio', trail: 10,
  },
  {
    name: 'B3 40日+量比3',
    desc: '2个月平台·量比≥3·ATR≤4.5%（强量确认）',
    buy: B3_BUY, sell: SELL_RULES, sort: 'volume_ratio', trail: 10,
  },
  {
    name: 'B4 60日+量比2',
    desc: '3个月平台·量比≥2·ATR≤5%',
    buy: B4_BUY, sell: SELL_RULES, sort: 'volume_ratio', trail: 10,
  },
  {
    name: 'V14 打板基准',
    desc: '对比：涨停板动量策略',
    buy: V14_BUY, sell: [], sort: 'quote_rate', trail: 8,
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

    const r = runCustomBacktest({
      strategyName: s.name, startDate: start, endDate: end,
      scanMode: 'market',
      buyRules: s.buy, sellRules: s.sell,
      trailingStopPct: s.trail,
      initialCapital: cap, maxPositions: 5,
      candidateSortBy: s.sort,
      proxyRegime: PROXY,
    });

    const wins = Math.round(r.winRate / 100 * r.totalTrades);
    totalT += r.totalTrades;
    totalW += wins;
    if (r.maxDrawdown > maxDD) maxDD = r.maxDrawdown;

    const qRet = r.totalReturn / 100;
    cap *= (1 + qRet);
    yearStats[yr].ret     *= (1 + qRet);
    yearStats[yr].trades  += r.totalTrades;
    yearStats[yr].wins    += wins;

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
const yr = (stat: YearStat) => (stat.ret - 1) * 100;

console.log('\n缩量横盘放量突破策略 A股3年回测（2023-04 ~ 2026-03）');
console.log('策略：横盘整理1-2个月后放量突破，追踪止损10%或跌破MA20离场');
console.log('='.repeat(108));
console.log(
  '策略'.padEnd(18), '说明'.padEnd(24),
  '23(半)'.padStart(7), '2024'.padStart(8), '2025'.padStart(8), '26Q1'.padStart(7),
  '3年总计'.padStart(9), '最终¥'.padStart(10), '胜率'.padStart(6), '笔'.padStart(4), '回撤'.padStart(7),
);
console.log('-'.repeat(108));

const allResults: Array<{ name: string; desc: string } & ReturnType<typeof run3Years>> = [];

for (const s of STRATEGIES) {
  process.stderr.write(`\n▶ ${s.name} ${s.desc}\n`);
  const r = run3Years(s);
  allResults.push({ name: s.name, desc: s.desc, ...r });

  const y23 = r.yearStats['2023'] ? yr(r.yearStats['2023']) : 0;
  const y24 = r.yearStats['2024'] ? yr(r.yearStats['2024']) : 0;
  const y25 = r.yearStats['2025'] ? yr(r.yearStats['2025']) : 0;
  const y26 = r.yearStats['2026'] ? yr(r.yearStats['2026']) : 0;
  console.log(
    s.name.padEnd(18), s.desc.padEnd(24),
    fmt(y23, 7), fmt(y24), fmt(y25), fmt(y26, 7),
    fmt(r.total), ('¥' + Math.round(r.final).toLocaleString()).padStart(10),
    (r.winRate.toFixed(1) + '%').padStart(6),
    String(r.trades).padStart(4),
    ('-' + r.maxDD.toFixed(1) + '%').padStart(7),
  );
}

console.log('='.repeat(108));

// 最优策略季度明细
const ranked = [...allResults].sort((a, b) => b.total - a.total);
const best = ranked[0];

console.log(`\n🏆 最优：${best.name}   3年 ${fmt(best.total)}   ¥${Math.round(best.final).toLocaleString()}\n`);

// 逐年明细
console.log('📅 逐年季度明细（最优策略）：');
let prevYr = '';
for (const q of best.qDetails) {
  const qYr = q.q.slice(0, 4);
  if (qYr !== prevYr) {
    const ys = best.yearStats[qYr];
    if (ys) {
      const yrRet = (ys.ret - 1) * 100;
      const wr = ys.trades > 0 ? (ys.wins / ys.trades * 100).toFixed(0) : '0';
      process.stdout.write(
        `\n  【${qYr}年】全年${fmt(yrRet, 7)}  共${ys.trades}笔  胜率${wr}%\n`
      );
    }
    prevYr = qYr;
  }
  const flag = q.ret >= 0 ? '🟢' : '🔴';
  process.stdout.write(`    ${flag} ${q.q}: ${fmt(q.ret, 7)}  (${q.trades}笔)  `);
}
console.log('\n');

// 策略排名
console.log('📊 策略排名（按3年总收益）：');
ranked.forEach((r, i) => {
  const y23 = r.yearStats['2023'] ? (r.yearStats['2023'].ret - 1) * 100 : 0;
  const y24 = r.yearStats['2024'] ? (r.yearStats['2024'].ret - 1) * 100 : 0;
  const y25 = r.yearStats['2025'] ? (r.yearStats['2025'].ret - 1) * 100 : 0;
  console.log(
    `  ${i + 1}. ${r.name}: ${fmt(r.total)}` +
    `  [${fmt(y23, 6)} / ${fmt(y24, 6)} / ${fmt(y25, 6)}]` +
    `  胜率${r.winRate.toFixed(1)}%  回撤${r.maxDD.toFixed(1)}%  共${r.trades}笔`
  );
});

console.log(`
📌 策略解读：
   ✅ 缩量横盘 = ATR 收窄，说明筹码在均价附近充分换手
   ✅ 放量突破 = 资金共识形成，多方强于空方
   🔑 平台时长：20日（1月）→ 40日（2月）→ 60日（3月），越长信号越可靠
   ⚠️  出场：追踪止损10% + 跌破MA20，防止假突破回踩
   💡 与打板相比：每季度交易笔数更少但持仓更长，更适合资金量大的操作
`);
