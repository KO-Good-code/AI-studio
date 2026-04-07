/**
 * ATR 自适应波段策略回测（单股T交易）
 *
 * 核心逻辑：
 *   用 ATR(14) 作为动态"尺子"，在 MA20 附近做高抛低吸：
 *   - 买入：收盘价 ≤ MA20 - buyAtr × ATR（回踩到均线下方超卖区）
 *   - 止盈：持仓后 收盘价 ≥ 买入价 + sellAtr × ATR
 *   - 止损：持仓后 收盘价 ≤ 买入价 - stopAtr × ATR
 *   - 超时：持仓超 maxDays 天强制平仓
 *
 *   ATR 会随波动自动缩放：
 *     震荡市 ATR 小 → 区间窄 → 频繁交易
 *     趋势市 ATR 大 → 区间宽 → 持仓周期长
 *
 * 穿越牛熊机制：
 *   大盘状态过滤（限制在偏强市场操作）：
 *     - 近5日大盘涨幅均值 > -0.2%（不在明显下跌趋势中）
 *     - 或直接关闭过滤（对比测试）
 */

import { queryByCode } from '../../lib/backtest/db';

// ─── 参数配置 ──────────────────────────────────────────────────────────────

const ATR_PERIOD = 14;
const MA_PERIOD  = 20;

interface Config {
  name: string;
  buyAtr:  number;   // 买入：价格低于 MA20 几个 ATR
  sellAtr: number;   // 止盈：涨幅超过几个 ATR
  stopAtr: number;   // 止损：跌幅超过几个 ATR
  maxDays: number;   // 超时平仓天数
  bearFilter: boolean; // 是否开启近期大盘回调过滤
}

const CONFIGS: Config[] = [
  { name: '基准版  (1×买/1.5×卖/2×损)',   buyAtr: 1.0, sellAtr: 1.5, stopAtr: 2.0, maxDays: 30, bearFilter: false },
  { name: '保守版  (1.5×买/1.5×卖/2×损)', buyAtr: 1.5, sellAtr: 1.5, stopAtr: 2.0, maxDays: 30, bearFilter: false },
  { name: '积极版  (0.5×买/2×卖/1.5×损)', buyAtr: 0.5, sellAtr: 2.0, stopAtr: 1.5, maxDays: 30, bearFilter: false },
  { name: '宽止盈  (1×买/2.5×卖/2×损)',   buyAtr: 1.0, sellAtr: 2.5, stopAtr: 2.0, maxDays: 40, bearFilter: false },
  { name: '基准+过滤(熊市空仓)',            buyAtr: 1.0, sellAtr: 1.5, stopAtr: 2.0, maxDays: 30, bearFilter: true  },
  { name: '保守+过滤(熊市空仓)',            buyAtr: 1.5, sellAtr: 1.5, stopAtr: 2.0, maxDays: 30, bearFilter: true  },
];

// 测试标的
const STOCKS = [
  // ── ETF（永不退市，均值回归性强）──
  { code: '510300.SH', name: '沪深300ETF' },
  { code: '510500.SH', name: '中证500ETF' },
  { code: '159915.SZ', name: '创业板ETF'  },
  // ── 龙头个股（对比）──
  { code: '600519.SH', name: '贵州茅台' },
  { code: '600036.SH', name: '招商银行' },
  { code: '601318.SH', name: '中国平安' },
];

// ETF 数据从2015起，统一用此区间
const START = '2015-01-05';
const END   = '2026-04-01';
const INITIAL_CAPITAL = 100_000;

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function calcMA(closes: number[], i: number, n: number): number {
  if (i < n - 1) return 0;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += closes[k];
  return sum / n;
}

/** Wilder 平滑 ATR */
function calcATRSeries(bars: Array<{ high: number; low: number; close: number }>): number[] {
  const atrs: number[] = new Array(bars.length).fill(0);
  const trs:  number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const hl = bars[i].high - bars[i].low;
    const hc = i > 0 ? Math.abs(bars[i].high - bars[i - 1].close) : 0;
    const lc = i > 0 ? Math.abs(bars[i].low  - bars[i - 1].close) : 0;
    trs.push(Math.max(hl, hc, lc));
    if (i === ATR_PERIOD - 1) {
      atrs[i] = trs.reduce((a, b) => a + b, 0) / ATR_PERIOD;
    } else if (i > ATR_PERIOD - 1) {
      atrs[i] = (atrs[i - 1] * (ATR_PERIOD - 1) + trs[i]) / ATR_PERIOD;
    }
  }
  return atrs;
}

// ─── 回测引擎 ──────────────────────────────────────────────────────────────

interface Trade {
  buyDate:  string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  reason: string;   // 止盈/止损/超时
  pnl: number;      // 收益率 %
}

function runBacktest(code: string, cfg: Config): {
  trades: Trade[];
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
} {
  const bars = queryByCode(code, START, END);
  if (bars.length < MA_PERIOD + ATR_PERIOD) return { trades: [], totalReturn: 0, maxDrawdown: 0, winRate: 0 };

  const closes = bars.map(b => b.close);
  const atrSeries = calcATRSeries(bars);

  const trades: Trade[] = [];
  let capital = INITIAL_CAPITAL;
  let peakCapital = INITIAL_CAPITAL;
  let maxDD = 0;

  let inPos = false;
  let buyPrice = 0;
  let buyDate = '';
  let daysHeld = 0;

  const warmup = Math.max(MA_PERIOD, ATR_PERIOD) - 1;

  for (let i = warmup; i < bars.length; i++) {
    const bar  = bars[i];
    const ma20 = calcMA(closes, i, MA_PERIOD);
    const atr  = atrSeries[i];
    if (ma20 === 0 || atr === 0) continue;

    // ── 大盘回调过滤：用该股自身近5日涨跌代替（无全市场数据时的替代方案）
    // 注：若需要全市场指数数据，需另行引入沪深300数据
    if (cfg.bearFilter && !inPos) {
      // 近5日均涨幅 < -0.3% 视为下行趋势，不开新仓
      if (i >= 5) {
        const chg5 = (closes[i] - closes[i - 5]) / closes[i - 5] * 100;
        if (chg5 < -5) continue; // 近5日跌幅超5%，不进场
      }
    }

    if (!inPos) {
      // ── 买入条件：收盘回踩到 MA20 下方 buyAtr×ATR
      const buyLine = ma20 - cfg.buyAtr * atr;
      if (bar.close <= buyLine) {
        inPos = true;
        buyPrice = bar.close;
        buyDate  = bar.date;
        daysHeld = 0;
      }
    } else {
      daysHeld++;
      const atrPct = atr / buyPrice;

      const sellLine = buyPrice * (1 + cfg.sellAtr * atrPct);
      const stopLine = buyPrice * (1 - cfg.stopAtr * atrPct);

      let sell = false;
      let reason = '';

      if (bar.close >= sellLine) {
        sell = true; reason = '止盈';
      } else if (bar.close <= stopLine) {
        sell = true; reason = '止损';
      } else if (daysHeld >= cfg.maxDays) {
        sell = true; reason = '超时';
      }

      if (sell) {
        const pnl = (bar.close - buyPrice) / buyPrice * 100;
        trades.push({ buyDate, sellDate: bar.date, buyPrice, sellPrice: bar.close, reason, pnl });
        capital *= (1 + pnl / 100);
        if (capital > peakCapital) peakCapital = capital;
        const dd = (peakCapital - capital) / peakCapital * 100;
        if (dd > maxDD) maxDD = dd;
        inPos = false;
      }
    }
  }

  const totalReturn = (capital - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100;
  const wins = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length > 0 ? wins / trades.length * 100 : 0;

  return { trades, totalReturn, maxDrawdown: maxDD, winRate };
}

// ─── 主程序 ────────────────────────────────────────────────────────────────

const fR = (v: number) => ((v >= 0 ? '+' : '') + v.toFixed(1) + '%').padStart(8);

console.log('\nATR 自适应波段策略回测（2015-01-05 ~ 2026-04-01，约11年）');
console.log('='.repeat(100));
console.log(
  '配置'.padEnd(28),
  '股票'.padEnd(8),
  '总收益'.padStart(9),
  '最大回撤'.padStart(9),
  '胜率'.padStart(7),
  '交易笔'.padStart(7),
  '均盈亏'.padStart(9),
);
console.log('-'.repeat(100));

for (const stock of STOCKS) {
  for (const cfg of CONFIGS) {
    const r = runBacktest(stock.code, cfg);
    const avgPnl = r.trades.length > 0
      ? r.trades.reduce((a, t) => a + t.pnl, 0) / r.trades.length
      : 0;
    console.log(
      cfg.name.padEnd(28),
      stock.name.padEnd(8),
      fR(r.totalReturn),
      fR(-r.maxDrawdown),
      `${r.winRate.toFixed(0)}%`.padStart(7),
      String(r.trades.length).padStart(7),
      fR(avgPnl),
    );
  }
  console.log('-'.repeat(100));
}

// 输出最佳组合的详细年度数据（对 ETF 和茅台各做一次）
for (const [detailCode, detailName] of [['510300.SH', '沪深300ETF'], ['600519.SH', '贵州茅台']]) {
console.log(`\n\n── 年度分析：保守版 × ${detailName} ──`);
const detailBars = queryByCode(detailCode, START, END);
const closes = detailBars.map(b => b.close);
const atrS   = calcATRSeries(detailBars);
const cfg    = CONFIGS[1]; // 保守版（买更深，更准）
const warmup = Math.max(MA_PERIOD, ATR_PERIOD) - 1;

const yearTrades: Record<string, Trade[]> = {};
let inPos = false, buyPrice = 0, buyDate = '', daysHeld = 0;

for (let i = warmup; i < detailBars.length; i++) {
  const bar  = detailBars[i];
  const ma20 = calcMA(closes, i, MA_PERIOD);
  const atr  = atrS[i];
  if (ma20 === 0 || atr === 0) continue;

  if (!inPos) {
    if (bar.close <= ma20 - cfg.buyAtr * atr) {
      inPos = true; buyPrice = bar.close; buyDate = bar.date; daysHeld = 0;
    }
  } else {
    daysHeld++;
    const atrPct = atr / buyPrice;
    const sellLine = buyPrice * (1 + cfg.sellAtr * atrPct);
    const stopLine = buyPrice * (1 - cfg.stopAtr * atrPct);
    let sell = false, reason = '';
    if (bar.close >= sellLine)          { sell = true; reason = '止盈'; }
    else if (bar.close <= stopLine)     { sell = true; reason = '止损'; }
    else if (daysHeld >= cfg.maxDays)   { sell = true; reason = '超时'; }
    if (sell) {
      const pnl  = (bar.close - buyPrice) / buyPrice * 100;
      const year = buyDate.slice(0, 4);
      if (!yearTrades[year]) yearTrades[year] = [];
      yearTrades[year].push({ buyDate, sellDate: bar.date, buyPrice, sellPrice: bar.close, reason, pnl });
      inPos = false;
    }
  }
}

console.log('年份  交易笔  胜率  总盈亏  平均每笔  止盈  止损  超时');
for (const [year, ts] of Object.entries(yearTrades).sort()) {
  const wins   = ts.filter(t => t.pnl > 0).length;
  const total  = ts.reduce((a, t) => a + t.pnl, 0);
  const avgPnl = total / ts.length;
  const stops  = ts.filter(t => t.reason === '止损').length;
  const profits= ts.filter(t => t.reason === '止盈').length;
  const timeout= ts.filter(t => t.reason === '超时').length;
  console.log(
    year,
    String(ts.length).padStart(5),
    `${(wins/ts.length*100).toFixed(0)}%`.padStart(5),
    fR(total),
    fR(avgPnl),
    String(profits).padStart(4),
    String(stops).padStart(4),
    String(timeout).padStart(4),
  );
}
} // end for detailCode loop
