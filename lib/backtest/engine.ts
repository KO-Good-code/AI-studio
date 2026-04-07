import type {
  BacktestConfig,
  BacktestResult,
  DayBar,
  Signal,
  TradeDetail,
} from './types';
import {
  queryByDateRange,
  getTradingDates,
  queryByCode,
} from './db';
import {
  limitUpStrategy,
  consecutiveStrategy,
  maGoldenCrossStrategy,
  lowPEStrategy,
} from './strategies';

const STRATEGY_NAMES: Record<string, string> = {
  limitUp: '涨停打板',
  consecutive: '连板追击',
  maGoldenCross: '均线金叉',
  lowPE: '低PE价值',
  custom: '自定义',
};

function buildDailyMap(bars: DayBar[]): Map<string, DayBar[]> {
  const map = new Map<string, DayBar[]>();
  for (const bar of bars) {
    let arr = map.get(bar.date);
    if (!arr) {
      arr = [];
      map.set(bar.date, arr);
    }
    arr.push(bar);
  }
  return map;
}

function generateSignals(config: BacktestConfig): Signal[] {
  const { strategy, startDate, endDate, params, filters } = config;

  if (strategy === 'limitUp' || strategy === 'consecutive') {
    const bars = queryByDateRange(startDate, endDate, filters);
    const tradingDates = getTradingDates(startDate, endDate);
    const dailyMap = buildDailyMap(bars);

    return strategy === 'limitUp'
      ? limitUpStrategy(dailyMap, tradingDates, params)
      : consecutiveStrategy(dailyMap, tradingDates, params);
  }

  if (strategy === 'maGoldenCross' || strategy === 'lowPE') {
    const code = params.code as unknown as string;
    if (!code) throw new Error('技术/基本面策略需要指定 code（股票代码）');

    const bars = queryByCode(code, startDate, endDate);
    if (bars.length === 0) throw new Error(`未找到 ${code} 的数据`);

    return strategy === 'maGoldenCross'
      ? maGoldenCrossStrategy(bars, params)
      : lowPEStrategy(bars, params);
  }

  throw new Error(`未知策略: ${strategy}`);
}

function signalsToTrades(signals: Signal[]): TradeDetail[] {
  const trades: TradeDetail[] = [];
  const openPositions = new Map<string, Signal>();

  for (const sig of signals) {
    if (sig.action === 'buy') {
      if (!openPositions.has(sig.code)) {
        openPositions.set(sig.code, sig);
      }
    } else {
      const buy = openPositions.get(sig.code);
      if (buy) {
        const returnPct =
          buy.price > 0 ? ((sig.price - buy.price) / buy.price) * 100 : 0;
        const buyD = new Date(buy.date);
        const sellD = new Date(sig.date);
        const holdDays = Math.max(
          1,
          Math.round((sellD.getTime() - buyD.getTime()) / 86400000)
        );

        trades.push({
          code: sig.code,
          name: sig.name,
          buyDate: buy.date,
          buyPrice: +buy.price.toFixed(2),
          sellDate: sig.date,
          sellPrice: +sig.price.toFixed(2),
          returnPct: +returnPct.toFixed(2),
          holdDays,
          reason: `${buy.reason} → ${sig.reason}`,
        });
        openPositions.delete(sig.code);
      }
    }
  }

  return trades;
}

function calcStats(
  trades: TradeDetail[],
  startDate: string,
  endDate: string
): Omit<BacktestResult, 'strategy' | 'startDate' | 'endDate' | 'trades' | 'equityCurve' | 'summary'> {
  if (trades.length === 0) {
    return {
      totalReturn: 0,
      annualReturn: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      totalTrades: 0,
      avgHoldDays: 0,
    };
  }

  const wins = trades.filter((t) => t.returnPct > 0).length;
  const totalHoldDays = trades.reduce((s, t) => s + t.holdDays, 0);

  const sorted = [...trades].sort((a, b) => a.buyDate.localeCompare(b.buyDate));

  const allDates = new Set<string>();
  for (const t of sorted) { allDates.add(t.buyDate); allDates.add(t.sellDate); }
  const dateList = [...allDates].sort();

  const dailyReturns: number[] = [];
  let equity = 1;
  const equityPoints: { date: string; value: number }[] = [
    { date: startDate, value: 1 },
  ];

  for (let di = 0; di < dateList.length; di++) {
    const d = dateList[di];
    const settling = sorted.filter((t) => t.sellDate === d);
    if (settling.length === 0) continue;

    const avgReturn =
      settling.reduce((s, t) => s + t.returnPct, 0) / settling.length;
    const positionWeight = Math.min(1, settling.length * 0.1);
    const portfolioReturn = avgReturn * positionWeight;

    dailyReturns.push(portfolioReturn);
    equity *= 1 + portfolioReturn / 100;
    equityPoints.push({ date: d, value: +equity.toFixed(4) });
  }

  const totalReturn = (equity - 1) * 100;

  const startD = new Date(startDate);
  const endD = new Date(endDate);
  const years = Math.max(
    0.01,
    (endD.getTime() - startD.getTime()) / (365.25 * 86400000)
  );
  const annualReturn = (Math.pow(Math.max(0.001, equity), 1 / years) - 1) * 100;

  let peak = 0;
  let maxDd = 0;
  for (const pt of equityPoints) {
    if (pt.value > peak) peak = pt.value;
    const dd = (peak - pt.value) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const returns = trades.map((t) => t.returnPct);
  const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - meanR) ** 2, 0) / returns.length;
  const stdR = Math.sqrt(variance);
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(252) : 0;

  return {
    totalReturn: +totalReturn.toFixed(2),
    annualReturn: +annualReturn.toFixed(2),
    winRate: +((wins / trades.length) * 100).toFixed(1),
    maxDrawdown: +(maxDd * 100).toFixed(2),
    sharpeRatio: +sharpe.toFixed(2),
    totalTrades: trades.length,
    avgHoldDays: +(totalHoldDays / trades.length).toFixed(1),
  };
}

function buildEquityCurve(
  trades: TradeDetail[],
  startDate: string
): { date: string; value: number }[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  const allDates = new Set<string>();
  for (const t of sorted) allDates.add(t.sellDate);
  const dateList = [...allDates].sort();

  const curve: { date: string; value: number }[] = [{ date: startDate, value: 1 }];
  let equity = 1;

  for (const d of dateList) {
    const settling = sorted.filter((t) => t.sellDate === d);
    if (settling.length === 0) continue;
    const avgReturn = settling.reduce((s, t) => s + t.returnPct, 0) / settling.length;
    const positionWeight = Math.min(1, settling.length * 0.1);
    equity *= 1 + (avgReturn * positionWeight) / 100;
    curve.push({ date: d, value: +equity.toFixed(4) });
  }

  return curve;
}

function buildSummary(result: Omit<BacktestResult, 'summary'>): string {
  const lines = [
    `📊 ${result.strategy} 回测报告`,
    `期间: ${result.startDate} ~ ${result.endDate}`,
    `总交易: ${result.totalTrades} 笔 | 平均持仓: ${result.avgHoldDays} 天`,
    `总收益: ${result.totalReturn}% | 年化: ${result.annualReturn}%`,
    `胜率: ${result.winRate}% | 最大回撤: ${result.maxDrawdown}%`,
    `夏普比率: ${result.sharpeRatio}`,
  ];

  if (result.trades.length > 0) {
    lines.push('', '--- 最近交易明细 (前20笔) ---');
    for (const t of result.trades.slice(0, 20)) {
      const flag = t.returnPct >= 0 ? '🟢' : '🔴';
      lines.push(
        `${flag} ${t.name}(${t.code}) ${t.buyDate}→${t.sellDate} ` +
          `买${t.buyPrice} 卖${t.sellPrice} 收益${t.returnPct}% [${t.reason}]`
      );
    }
  }

  return lines.join('\n');
}

export function runBacktest(config: BacktestConfig): BacktestResult {
  const t0 = Date.now();
  console.log(`[backtest] 开始回测 ${config.strategy} ${config.startDate}~${config.endDate}`);

  const signals = generateSignals(config);
  const trades = signalsToTrades(signals);
  const stats = calcStats(trades, config.startDate, config.endDate);
  const equityCurve = buildEquityCurve(trades, config.startDate);

  const partial = {
    strategy: STRATEGY_NAMES[config.strategy] ?? config.strategy,
    startDate: config.startDate,
    endDate: config.endDate,
    ...stats,
    trades: trades.slice(0, 50),
    equityCurve,
  };

  const result: BacktestResult = {
    ...partial,
    summary: buildSummary(partial),
  };

  console.log(
    `[backtest] 完成: ${trades.length}笔交易 总收益${result.totalReturn}% ` +
      `耗时${Date.now() - t0}ms`
  );

  return result;
}
