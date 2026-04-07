import type { DayBar, Signal } from './types';

/**
 * 涨停打板策略：当日涨停 → 买入，持有 N 天后卖出
 */
export function limitUpStrategy(
  dailyMap: Map<string, DayBar[]>,
  tradingDates: string[],
  params: Record<string, number>
): Signal[] {
  const holdDays = params.holdDays ?? 1;
  const signals: Signal[] = [];

  for (let i = 0; i < tradingDates.length; i++) {
    const date = tradingDates[i];
    const bars = dailyMap.get(date);
    if (!bars) continue;

    for (const bar of bars) {
      if (
        bar.high_limit > 0 &&
        bar.close >= bar.high_limit &&
        bar.turnover_rate_f > 0
      ) {
        signals.push({
          date,
          code: bar.code,
          name: bar.name,
          action: 'buy',
          price: bar.close,
          reason: `涨停板买入 换手${bar.turnover_rate_f.toFixed(1)}%`,
        });

        const sellIdx = i + holdDays;
        if (sellIdx < tradingDates.length) {
          const sellDate = tradingDates[sellIdx];
          const sellBars = dailyMap.get(sellDate);
          const sellBar = sellBars?.find((b) => b.code === bar.code);
          if (sellBar) {
            signals.push({
              date: sellDate,
              code: bar.code,
              name: bar.name,
              action: 'sell',
              price: sellBar.open,
              reason: `持有${holdDays}天后次日开盘卖出`,
            });
          }
        }
      }
    }
  }

  return signals;
}

/**
 * 连板策略：连续 N 天涨停的股票买入，开板卖出
 */
export function consecutiveStrategy(
  dailyMap: Map<string, DayBar[]>,
  tradingDates: string[],
  params: Record<string, number>
): Signal[] {
  const minBoards = params.minBoards ?? 2;
  const signals: Signal[] = [];
  const streaks = new Map<string, number>();
  const positions = new Set<string>();

  for (let i = 0; i < tradingDates.length; i++) {
    const date = tradingDates[i];
    const bars = dailyMap.get(date);
    if (!bars) continue;

    const todayCodes = new Set<string>();

    for (const bar of bars) {
      todayCodes.add(bar.code);
      const isLimitUp = bar.high_limit > 0 && bar.close >= bar.high_limit;

      if (isLimitUp) {
        const prev = streaks.get(bar.code) ?? 0;
        streaks.set(bar.code, prev + 1);

        if (prev + 1 >= minBoards && !positions.has(bar.code)) {
          signals.push({
            date,
            code: bar.code,
            name: bar.name,
            action: 'buy',
            price: bar.close,
            reason: `${prev + 1}连板买入`,
          });
          positions.add(bar.code);
        }
      } else {
        if (positions.has(bar.code)) {
          signals.push({
            date,
            code: bar.code,
            name: bar.name,
            action: 'sell',
            price: bar.open,
            reason: `开板卖出(开盘价)`,
          });
          positions.delete(bar.code);
        }
        streaks.set(bar.code, 0);
      }
    }

    for (const code of [...positions]) {
      if (!todayCodes.has(code)) {
        positions.delete(code);
        streaks.delete(code);
      }
    }
  }

  return signals;
}

/**
 * 均线金叉策略（单股）：短均线上穿长均线买入，死叉卖出
 */
export function maGoldenCrossStrategy(
  bars: DayBar[],
  params: Record<string, number>
): Signal[] {
  const shortPeriod = params.shortMA ?? 5;
  const longPeriod = params.longMA ?? 20;
  const signals: Signal[] = [];

  if (bars.length < longPeriod + 1) return signals;

  const calcMA = (end: number, period: number): number => {
    let sum = 0;
    for (let j = end - period + 1; j <= end; j++) sum += bars[j].close;
    return sum / period;
  };

  let prevShort = 0;
  let prevLong = 0;
  let holding = false;

  for (let i = longPeriod; i < bars.length; i++) {
    const shortMA = calcMA(i, shortPeriod);
    const longMA = calcMA(i, longPeriod);

    if (prevShort > 0 && prevLong > 0) {
      if (prevShort <= prevLong && shortMA > longMA && !holding) {
        signals.push({
          date: bars[i].date,
          code: bars[i].code,
          name: bars[i].name,
          action: 'buy',
          price: bars[i].close,
          reason: `MA${shortPeriod}上穿MA${longPeriod}`,
        });
        holding = true;
      } else if (prevShort >= prevLong && shortMA < longMA && holding) {
        signals.push({
          date: bars[i].date,
          code: bars[i].code,
          name: bars[i].name,
          action: 'sell',
          price: bars[i].close,
          reason: `MA${shortPeriod}下穿MA${longPeriod}`,
        });
        holding = false;
      }
    }

    prevShort = shortMA;
    prevLong = longMA;
  }

  return signals;
}

/**
 * 低 PE 策略（单股）：PE 低于阈值且换手率突增时买入，持有 N 天卖出
 */
export function lowPEStrategy(
  bars: DayBar[],
  params: Record<string, number>
): Signal[] {
  const maxPE = params.maxPE ?? 15;
  const minTurnoverRatio = params.minTurnoverRatio ?? 2;
  const holdDays = params.holdDays ?? 10;
  const signals: Signal[] = [];
  let holdUntilIdx = -1;

  for (let i = 5; i < bars.length; i++) {
    if (i <= holdUntilIdx) continue;

    const bar = bars[i];
    if (bar.pe <= 0 || bar.pe > maxPE) continue;

    let avgTurnover = 0;
    for (let j = i - 5; j < i; j++) avgTurnover += bars[j].turnover_rate;
    avgTurnover /= 5;

    if (avgTurnover > 0 && bar.turnover_rate / avgTurnover >= minTurnoverRatio) {
      signals.push({
        date: bar.date,
        code: bar.code,
        name: bar.name,
        action: 'buy',
        price: bar.close,
        reason: `PE=${bar.pe.toFixed(1)} 换手率突增${(bar.turnover_rate / avgTurnover).toFixed(1)}x`,
      });

      const sellIdx = Math.min(i + holdDays, bars.length - 1);
      holdUntilIdx = sellIdx;
      signals.push({
        date: bars[sellIdx].date,
        code: bars[sellIdx].code,
        name: bars[sellIdx].name,
        action: 'sell',
        price: bars[sellIdx].close,
        reason: `持有${sellIdx - i}天卖出`,
      });
    }
  }

  return signals;
}
