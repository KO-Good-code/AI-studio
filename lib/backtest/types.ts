/** 日线行情 */
export interface DayBar {
  code: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prev_close: number;
  quote_rate: number;
  volume: number;
  turnover: number;
  high_limit: number;
  low_limit: number;
  turnover_rate: number;
  turnover_rate_f: number;
  volume_ratio: number;
  pe: number;
  pe_ttm: number;
  pb: number;
  ps: number;
  ps_ttm: number;
  total_mv: number;
  circ_mv: number;
  name: string;
  industry: string;
  market: string;
}

/** 买卖信号 */
export interface Signal {
  date: string;
  code: string;
  name: string;
  action: 'buy' | 'sell';
  price: number;
  reason: string;
}

/** 单笔交易记录 */
export interface TradeDetail {
  code: string;
  name: string;
  buyDate: string;
  buyPrice: number;
  sellDate: string;
  sellPrice: number;
  returnPct: number;
  holdDays: number;
  reason: string;
}

/** 回测配置 */
export interface BacktestConfig {
  strategy: 'limitUp' | 'consecutive' | 'maGoldenCross' | 'lowPE' | 'custom';
  startDate: string;
  endDate: string;
  params: Record<string, number>;
  filters?: {
    industry?: string;
    minMV?: number;
    market?: string;
  };
}

/** 回测结果 */
export interface BacktestResult {
  strategy: string;
  startDate: string;
  endDate: string;
  totalReturn: number;
  annualReturn: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  avgHoldDays: number;
  trades: TradeDetail[];
  equityCurve: { date: string; value: number }[];
  summary: string;
}

/** 策略函数签名（市场扫描型，每日全市场数据） */
export type MarketScanStrategy = (
  dailyMap: Map<string, DayBar[]>,
  tradingDates: string[],
  params: Record<string, number>
) => Signal[];

/** 策略函数签名（单股技术型） */
export type SingleStockStrategy = (
  bars: DayBar[],
  params: Record<string, number>
) => Signal[];
