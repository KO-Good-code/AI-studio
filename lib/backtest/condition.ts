import type { DayBar } from './types';

/**
 * AI 可组合的条件规则
 * 支持对 DayBar 字段的比较，以及 MA/连板等计算指标
 */
export interface ConditionRule {
  /** DayBar 字段名，或计算指标: ma5, ma10, ma20, ma60, prev_close, prev_quote_rate */
  field: string;
  op: '>' | '<' | '>=' | '<=' | '==' | '=' | '!=';
  /** 数值，或另一个字段名（如 "high_limit"） */
  value: number | string;
}

/** 计算 MA（需要前面的 bars 做上下文） */
function calcMA(bars: DayBar[], idx: number, period: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += bars[i].close;
  return sum / period;
}

/** 计算 RSI(N) — Wilder 平滑法 */
function calcRSI(bars: DayBar[], idx: number, period: number): number | null {
  if (idx < period) return null;
  // 初始平均盈亏（简单平均）
  let avgGain = 0, avgLoss = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const chg = bars[i].close - bars[i - 1 < 0 ? 0 : i - 1].close;
    if (chg > 0) avgGain += chg; else avgLoss += Math.abs(chg);
  }
  avgGain /= period; avgLoss /= period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** 计算布林带 (N, k): 返回 (close - MA_N) / (k * std_N) * 100（百分位）
 *  > 100 = 在上轨之上，< -100 = 在下轨之下 */
function calcBBPct(bars: DayBar[], idx: number, period: number, k: number): number | null {
  const ma = calcMA(bars, idx, period);
  if (ma === null || idx < period - 1) return null;
  let variance = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    variance += (bars[i].close - ma) ** 2;
  }
  const std = Math.sqrt(variance / period);
  if (std === 0) return 0;
  return (bars[idx].close - ma) / (k * std) * 100;
}

/** 计算 ATR(N) — 真实波动幅度均值（百分比，相对于收盘价） */
function calcATRPct(bars: DayBar[], idx: number, period: number): number | null {
  if (idx < period) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const prev = bars[i - 1 < 0 ? 0 : i - 1].close;
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prev), Math.abs(bars[i].low - prev));
    sum += tr / bars[i].close * 100;
  }
  return sum / period;
}

/** 计算连续涨停天数（截至当前 bar） */
function calcConsecutiveLimitUp(bars: DayBar[], idx: number): number {
  let count = 0;
  for (let i = idx; i >= 0; i--) {
    if (bars[i].high_limit > 0 && bars[i].close >= bars[i].high_limit) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/** 从 bar + 上下文中解析字段值 */
export function resolveField(
  fieldName: string,
  bar: DayBar,
  bars: DayBar[],
  idx: number
): number | null {
  const directFields: Record<string, number | undefined> = {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    prev_close: bar.prev_close,
    quote_rate: bar.quote_rate,
    volume: bar.volume,
    turnover: bar.turnover,
    high_limit: bar.high_limit,
    low_limit: bar.low_limit,
    turnover_rate: bar.turnover_rate,
    turnover_rate_f: bar.turnover_rate_f,
    volume_ratio: bar.volume_ratio,
    pe: bar.pe,
    pe_ttm: bar.pe_ttm,
    pb: bar.pb,
    ps: bar.ps,
    ps_ttm: bar.ps_ttm,
    total_mv: bar.total_mv,
    circ_mv: bar.circ_mv,
  };

  if (fieldName in directFields) {
    return directFields[fieldName] ?? null;
  }

  const maMatch = fieldName.match(/^ma(\d+)$/);
  if (maMatch) return calcMA(bars, idx, parseInt(maMatch[1]));

  if (fieldName === 'consecutive_limit_up') {
    return calcConsecutiveLimitUp(bars, idx);
  }

  if (fieldName === 'prev_quote_rate' && idx > 0) {
    return bars[idx - 1].quote_rate;
  }
  if (fieldName === 'prev_turnover_rate' && idx > 0) {
    return bars[idx - 1].turnover_rate;
  }
  if (fieldName === 'prev_volume_ratio' && idx > 0) {
    return bars[idx - 1].volume_ratio;
  }

  if (fieldName === 'is_limit_up') {
    return bar.high_limit > 0 && bar.close >= bar.high_limit ? 1 : 0;
  }
  if (fieldName === 'is_limit_down') {
    return bar.low_limit > 0 && bar.close <= bar.low_limit ? 1 : 0;
  }

  // 前一日是否涨停
  if (fieldName === 'prev_is_limit_up' && idx > 0) {
    const prev = bars[idx - 1];
    return prev.high_limit > 0 && prev.close >= prev.high_limit * 0.999 ? 1 : 0;
  }

  // high_break_N：今日收盘 > 过去N日最高收盘价（不含今日）→ 1，否则 0
  const highBreakMatch = fieldName.match(/^high_break_(\d+)$/);
  if (highBreakMatch) {
    const n = parseInt(highBreakMatch[1]);
    if (idx < n) return null;
    const past = bars.slice(idx - n, idx);
    const maxClose = Math.max(...past.map(b => b.close));
    return bar.close > maxClose ? 1 : 0;
  }

  // low_break_N：今日收盘 < 过去N日最低收盘价（不含今日）→ 1（跌破），否则 0
  const lowBreakMatch = fieldName.match(/^low_break_(\d+)$/);
  if (lowBreakMatch) {
    const n = parseInt(lowBreakMatch[1]);
    if (idx < n) return null;
    const past = bars.slice(idx - n, idx);
    const minClose = Math.min(...past.map(b => b.close));
    return bar.close < minClose ? 1 : 0;
  }

  // close_pct_vs_Nd_high：今日收盘相对过去N日最高收盘的偏离百分比（正=突破，负=未到）
  const closePctNdHigh = fieldName.match(/^close_pct_vs_(\d+)d_high$/);
  if (closePctNdHigh) {
    const n = parseInt(closePctNdHigh[1]);
    if (idx < n) return null;
    const past = bars.slice(idx - n, idx);
    const maxClose = Math.max(...past.map(b => b.close));
    return maxClose > 0 ? (bar.close - maxClose) / maxClose * 100 : null;
  }

  // had_break_N_in_Md：过去 M 天内（不含今日）是否曾出现过 N 日新高突破 → 1/0
  // 用法示例：had_break_60_in_10d = 1  表示近10天内有过60日新高突破
  const hadBreakMatch = fieldName.match(/^had_break_(\d+)_in_(\d+)d$/);
  if (hadBreakMatch) {
    const breakN = parseInt(hadBreakMatch[1]); // 判断是否为 N 日新高
    const lookM  = parseInt(hadBreakMatch[2]); // 往前看 M 天
    if (idx < lookM + breakN) return null;
    // 检查过去 M 天（不含今日）里，每一天是否满足 high_break_N
    for (let d = 1; d <= lookM; d++) {
      const di = idx - d;
      if (di < breakN) break;
      const bbar = bars[di];
      const past  = bars.slice(di - breakN, di);
      const maxC  = Math.max(...past.map(b => b.close));
      if (bbar.close > maxC) return 1; // 找到一天是 N 日新高就返回 1
    }
    return 0;
  }

  // vol_pct_vs_break：当日成交量相比"过去 M 天内突破日成交量"的比值
  // 用于判断回踩是否缩量：< 1 = 缩量回踩，> 1 = 放量
  // 用法示例：vol_pct_vs_break_10d（过去10天内突破日的量）
  const volVsBreakMatch = fieldName.match(/^vol_pct_vs_break_(\d+)d$/);
  if (volVsBreakMatch) {
    const lookM = parseInt(volVsBreakMatch[1]);
    const breakN = 60; // 固定用60日新高判断突破日
    if (idx < lookM + breakN) return null;
    // 找最近 M 天内的突破日
    let breakVol: number | null = null;
    for (let d = 1; d <= lookM; d++) {
      const di = idx - d;
      if (di < breakN) break;
      const bbar = bars[di];
      const past  = bars.slice(di - breakN, di);
      const maxC  = Math.max(...past.map(b => b.close));
      if (bbar.close > maxC) {
        breakVol = bbar.volume ?? null;
        break;
      }
    }
    if (!breakVol || breakVol === 0) return null;
    return ((bar.volume ?? 0) / breakVol) * 100; // 返回百分比，100 = 与突破日相同量
  }

  // 是否 ST / *ST
  if (fieldName === 'is_st') {
    return /\bST\b/.test(bar.name) ? 1 : 0;
  }

  // 前一日 MA（用于判断均线交叉和趋势）
  const prevMaMatch = fieldName.match(/^prev_ma(\d+)$/);
  if (prevMaMatch && idx > 0) {
    return calcMA(bars, idx - 1, parseInt(prevMaMatch[1]));
  }

  // 是否涨停中（开盘即封板）
  if (fieldName === 'is_open_limit_up') {
    return bar.high_limit > 0 && bar.open >= bar.high_limit ? 1 : 0;
  }

  // pct_above_maX：收盘价比 MAx 高出的百分比，如 pct_above_ma60 = (close - ma60) / ma60 * 100
  const pctAboveMaMatch = fieldName.match(/^pct_above_ma(\d+)$/);
  if (pctAboveMaMatch) {
    const ma = calcMA(bars, idx, parseInt(pctAboveMaMatch[1]));
    if (ma === null || ma === 0) return null;
    return ((bar.close - ma) / ma) * 100;
  }

  if (fieldName === 'amplitude') {    return bar.prev_close > 0
      ? ((bar.high - bar.low) / bar.prev_close) * 100
      : null;
  }

  if (fieldName === 'open_pct') {
    return bar.prev_close > 0
      ? ((bar.open - bar.prev_close) / bar.prev_close) * 100
      : null;
  }

  // ── 指数/ETF 专用技术指标 ─────────────────────────────────────────────

  // rsi_N：RSI(N)，如 rsi_14, rsi_6
  const rsiMatch = fieldName.match(/^rsi_(\d+)$/);
  if (rsiMatch) return calcRSI(bars, idx, parseInt(rsiMatch[1]));

  // bb_pct_N：布林带百分位（2σ），>100=突破上轨，<-100=突破下轨
  // 如 bb_pct_20（默认2σ）
  const bbPctMatch = fieldName.match(/^bb_pct_(\d+)$/);
  if (bbPctMatch) return calcBBPct(bars, idx, parseInt(bbPctMatch[1]), 2);

  // atr_pct_N：ATR(N) 百分比（相对收盘价），如 atr_pct_14
  const atrPctMatch = fieldName.match(/^atr_pct_(\d+)$/);
  if (atrPctMatch) return calcATRPct(bars, idx, parseInt(atrPctMatch[1]));

  // pe_pct_N：PE 相对过去 N 日 PE 的分位数（0~100），如 pe_pct_250
  // 用于估值驱动的高抛低吸
  const pePctMatch = fieldName.match(/^pe_pct_(\d+)$/);
  if (pePctMatch && bar.pe_ttm !== null && bar.pe_ttm !== undefined) {
    const n = parseInt(pePctMatch[1]);
    if (idx < n) return null;
    const pastPEs = bars.slice(idx - n, idx + 1)
      .map(b => b.pe_ttm)
      .filter((v): v is number => v !== null && v !== undefined && v > 0);
    if (pastPEs.length < n / 2) return null; // 数据不足
    const sorted = [...pastPEs].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= bar.pe_ttm!).length;
    return rank / sorted.length * 100;
  }

  return null;
}

/** 评估单个条件规则 */
export function evaluateCondition(
  rule: ConditionRule,
  bar: DayBar,
  bars: DayBar[],
  idx: number
): boolean {
  const leftVal = resolveField(rule.field, bar, bars, idx);
  if (leftVal === null) return false;

  let rightVal: number;
  if (typeof rule.value === 'number') {
    rightVal = rule.value;
  } else {
    const resolved = resolveField(rule.value, bar, bars, idx);
    if (resolved === null) return false;
    rightVal = resolved;
  }

  switch (rule.op) {
    case '>': return leftVal > rightVal;
    case '<': return leftVal < rightVal;
    case '>=': return leftVal >= rightVal;
    case '<=': return leftVal <= rightVal;
    case '=':
    case '==': return leftVal === rightVal;
    case '!=': return leftVal !== rightVal;
    default: return false;
  }
}

/** 所有条件都满足 */
export function evaluateAll(
  rules: ConditionRule[],
  bar: DayBar,
  bars: DayBar[],
  idx: number
): boolean {
  return rules.every((r) => evaluateCondition(r, bar, bars, idx));
}
