import type { DayBar, Signal, TradeDetail, BacktestResult } from './types';
import type { ConditionRule } from './condition';
import { evaluateAll } from './condition';
import { queryByDateRange, getTradingDates, queryByCode } from './db';

export interface CustomBacktestConfig {
  strategyName: string;
  startDate: string;
  endDate: string;
  scanMode: 'market' | 'single';
  code?: string;
  buyRules: ConditionRule[];
  sellRules: ConditionRule[];
  sellAfterDays?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  buyOnNext?: 'open' | 'close';
  filters?: { industry?: string; market?: string; minMV?: number };
  /** 大盘宽度过滤：5日滚动上涨占比须 >= 此值才允许开新仓（0~1，如 0.5 表示50%）*/
  marketBreadthMinPct?: number;
  /** 初始资金（元），用于资金曲线和实际盈亏模拟，默认 100000 */
  initialCapital?: number;
  /** 最大同时持仓数，默认 10 */
  maxPositions?: number;
  /**
   * 连续亏损熔断：连续亏损达到此笔数后，暂停开新仓 lossCooldownDays 天。
   * 默认不启用。建议值: 2~3
   */
  maxConsecutiveLosses?: number;
  /** 熔断后冷静期天数，默认 3 天 */
  lossCooldownDays?: number;
  /**
   * 追踪止损：持仓期间记录最高价，当价格回落超过此比例时止损卖出。
   * 例如 trailingStopPct=10 表示从最高点回落 10% 即卖出。
   * 与 stopLossPct 同时存在时，两者取先触发的。
   */
  trailingStopPct?: number;
  /**
   * 板块动量过滤：每个交易日按各板块近 N 日平均涨幅排名，
   * 只允许买入排名前 topSectorN 的板块内的个股。
   * 默认不启用（undefined）。建议值: 5~15。
   * sectorMomentumDays: 计算板块动量用的回看天数，默认 5。
   */
  topSectorN?: number;
  sectorMomentumDays?: number;
  /**
   * 多市场环境切换配置：根据每日大盘宽度自动切换买入规则和最大持仓数
   * - 牛市 (5日宽度 >= bullBreadth5d AND 20日宽度 >= bullBreadth20d)
   * - 震荡市 (5日宽度介于 bearBreadth5d 和 bullBreadth5d 之间)
   * - 熊市 (5日宽度 < bearBreadth5d)
   * 启用后，marketBreadthMinPct / maxPositions / buyRules 将被各模式覆盖
   */
  regimeSwitch?: {
    bullBreadth5d: number;          // 牛市5日宽度门槛，如 0.55
    bullBreadth20d: number;         // 牛市20日宽度门槛，如 0.50
    bullMaxPositions: number;       // 牛市最大持仓，如 5
    bullBuyRules?: ConditionRule[]; // 牛市买入规则（不填=用外层 buyRules）
    oscillatingMaxPositions: number;       // 震荡市最大持仓，如 3
    oscillatingBuyRules?: ConditionRule[]; // 震荡市买入规则
    bearBreadth5d: number;          // 熊市5日宽度上限，如 0.40
    bearMaxPositions: number;       // 熊市最大持仓，如 0（全现金）
    bearBuyRules?: ConditionRule[]; // 熊市买入规则（为空则不开新仓）
    bearIndustry?: string;          // 熊市限定板块，如 '银行'
  };
  /**
   * 代理指数 MA 切换：把每日全市场平均涨幅累积成一个等权指数，
   * 根据该指数与短/长均线的位置关系判断牛/震/熊，动态切换策略参数。
   *
   * - 牛市：proxy > MA(ma1Days)         → bullMaxPositions / bullBuyRules
   * - 震荡：MA(ma2Days) < proxy ≤ MA(ma1Days) → oscillatingMaxPositions / oscillatingBuyRules
   * - 熊市：proxy ≤ MA(ma2Days)         → bearMaxPositions（通常 0 = 全现金）
   *
   * 优势：直接反映市场涨跌方向和趋势，比宽度信号更精准。
   */
  proxyRegime?: {
    ma1Days?: number;              // 短均线天数，默认 20
    ma2Days?: number;              // 长均线天数，默认 60
    bullMaxPositions: number;      // 牛市最大持仓，如 5
    bullBuyRules?: ConditionRule[];
    oscillatingMaxPositions: number; // 震荡市最大持仓，如 3
    oscillatingBuyRules?: ConditionRule[];
    bearMaxPositions: number;      // 熊市最大持仓，如 0（全现金）
    bearBuyRules?: ConditionRule[];
    /**
     * 启用 MA2 方向模式（拐头判断）：
     * - 牛市：MA60 今天 > 昨天（MA60 向上）
     * - 熊市：MA60 今天 < 昨天（MA60 向下）
     * - 不再使用 proxy 水平位置，改用斜率方向判断市场状态
     */
    useMa2Direction?: boolean;
  };
  /**
   * 方案A：涨停比过滤（支持大盘共振）
   * 每日涨停股数占比（5日滚动均值）判断牛/熊，直接反映A股市场热度。
   * 可选加入"大盘共振"：当单日涨停比突然飙升（即使5日均值尚未达到牛市门槛），
   * 也允许使用牛市策略快速入场，捕捉强势股不回踩的行情。
   *
   * 四档判断（优先级从高到低）：
   * - 持续牛市：5日涨停比 >= bullLimitUpPct               → bullBuyRules
   * - 单日共振：单日涨停比 >= resonanceLimitUpPct（可选）  → resonanceBuyRules（默认=bullBuyRules）
   * - 震荡市：  5日涨停比 >= bearLimitUpPct               → oscillatingBuyRules
   * - 熊市：   5日涨停比 <  bearLimitUpPct               → bearBuyRules（默认=空仓）
   */
  limitUpRegime?: {
    bullLimitUpPct: number;              // 持续牛市门槛（5日均值），如 0.02（2%）
    bearLimitUpPct: number;              // 熊市上限（5日均值），如 0.008（0.8%）
    bullMaxPositions: number;
    bullBuyRules?: ConditionRule[];      // 牛市买入规则（不填=用外层 buyRules）
    /** 大盘共振：单日涨停比突增时，即使5日均值未达牛市门槛，也视为牛市操作 */
    resonanceLimitUpPct?: number;        // 单日共振门槛，如 0.03（3%，约150只涨停）
    resonanceMaxPositions?: number;      // 共振时最大持仓（默认同 bullMaxPositions）
    resonanceBuyRules?: ConditionRule[]; // 共振时买入规则（默认同 bullBuyRules）
    oscillatingMaxPositions: number;
    oscillatingBuyRules?: ConditionRule[]; // 震荡市买入规则（不填=用外层 buyRules）
    bearMaxPositions: number;
    bearBuyRules?: ConditionRule[];      // 熊市买入规则（不填=[] 即不开新仓）
  };
  /**
   * 方案C：三信号综合评分（仿华泰证券多维度择时体系）
   *
   * 三个等权信号投票：
   *   信号1（代理动量）: proxy[今天] > proxy[N天前] → +1，否则 -1
   *   信号2（上涨家数比）: 5日上涨占比 > breadthBull → +1，否则 -1
   *   信号3（涨停热度）: 5日涨停比 > limitUpBull → +1，否则 -1
   *
   * 综合分 = (s1+s2+s3)/3，范围 [-1, +1]
   *   > bullScore  → 牛市
   *   < bearScore  → 熊市
   *   其余         → 震荡（建议 oscillatingMaxPositions = 0 完全空仓）
   */
  compositeRegime?: {
    momentumDays?: number;           // 代理动量回看天数，默认 5
    breadthBull?: number;            // 上涨家数比牛市门槛，默认 0.50
    limitUpBull?: number;            // 涨停比牛市门槛，默认 0.012（1.2%）
    bullScore?: number;              // 综合分 > 此值=牛市，默认 0.33
    bearScore?: number;              // 综合分 < 此值=熊市，默认 -0.33
    bullMaxPositions: number;
    bullBuyRules?: ConditionRule[];      // 牛市买入规则（不填=用外层 buyRules）
    oscillatingMaxPositions: number;
    oscillatingBuyRules?: ConditionRule[]; // 震荡市买入规则（不填=用外层 buyRules）
    bearMaxPositions: number;
    bearBuyRules?: ConditionRule[];      // 熊市买入规则（不填=[] 即不开新仓）
  };
  /**
   * 候选股排序方式：满足买入条件后，按此字段排序再选前 N 只进仓。
   * - 'quote_rate'    : **默认**，涨幅降序（优先当日最强势的股，但100%涨停）
   * - 'volume_ratio'  : 量比降序（优先成交最活跃的股，涨停率~27%）
   * - 'circ_mv_asc'   : 流通市值升序（小市值优先，弹性大）
   * - 'circ_mv_desc'  : 流通市值降序（大市值优先，流动性好，涨停率低）
   * - 'composite'     : 量比 × 涨幅综合得分降序
   * - 'code'          : 按股票代码升序（等价于随机，涨停率~15%，大市值偏多）
   */
  candidateSortBy?: 'code' | 'volume_ratio' | 'quote_rate' | 'composite' | 'circ_mv_asc' | 'circ_mv_desc';
  /**
   * 流通市值过滤（单位：亿元）
   * - minCircMv: 最小流通市值，如 20 表示只选 20亿以上
   * - maxCircMv: 最大流通市值，如 200 表示只选 200亿以下
   */
  minCircMv?: number;
  maxCircMv?: number;
  /**
   * 涨停板处理方式（解决"收盘涨停买不进"的真实性问题）：
   * - 'allow'     : 默认，允许按涨停价买入（回测乐观，高估实际收益）
   * - 'skip'      : 过滤掉收盘涨停的股票，只买未涨停的候选（保守）
   * - 'next_open' : 涨停股改为以次日开盘价买入（最贴近真实排板操作）
   */
  limitUpBuyMode?: 'allow' | 'skip' | 'next_open';
  /**
   * 板块共振过滤：当天满足买入条件的候选股中，同一行业（industry）至少有
   * minSectorCandidates 只，才允许买入该行业的股票。
   * 逻辑：多只同行业股票同日突破 → 板块资金共振，信号更可靠
   * 建议值：2（至少2只同行业信号）
   * 注意：会大幅减少交易次数，适合在牛市/活跃市场使用
   */
  minSectorCandidates?: number;
  /**
   * 入场日大盘共振门槛（0~1）：当天全市场涨停股占比（单日原始值）须达到此值才允许开新仓。
   * 作用：在回踩确认的个股基础上，进一步要求"当天大盘本身也活跃"再进场。
   * 参考值：0.008（约 0.8%，约 40 只涨停）、0.012（约 1.2%，约 60 只）。
   * 注意：此过滤在 limitUpRegime / compositeRegime / regimeSwitch 确认"可入场"之后叠加。
   *       与 resonanceLimitUpPct 区别：后者触发"切换到激进策略"，本参数是"额外的入场准入门槛"。
   */
  minDailyLimitUpForBuy?: number;
}

interface OpenPosition {
  code: string;
  name: string;
  buyDate: string;
  buyPrice: number;
  buyReason: string;
  dayCount: number;
  peakPrice: number; // 持仓期间最高价，用于追踪止损
}

function runMarketScan(config: CustomBacktestConfig): Signal[] {
  const { startDate, endDate, buyRules, sellRules, sellAfterDays, takeProfitPct, stopLossPct, filters } = config;

  // 全市场 + MA 条件：加载范围限制到 4 个月以内避免内存/速度问题
  const needsHistory = (rules: ConditionRule[]) =>
    rules.some((r) =>
      /^(prev_)?ma\d+$|consecutive_limit_up/.test(r.field) ||
      (typeof r.value === 'string' && /^(prev_)?ma\d+$/.test(r.value))
    );

  if (needsHistory(buyRules) || needsHistory(sellRules ?? [])) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = (end.getTime() - start.getTime()) / 86400000;
    if (diffDays > 150) {
      throw new Error(
        `全市场扫描 + MA 均线条件：日期范围不能超过 150 天（当前 ${Math.round(diffDays)} 天），` +
        '请缩短回测区间（建议 3 个月以内）以确保速度。'
      );
    }
  }
  const tradingDates = getTradingDates(startDate, endDate);

  // 为 MA 计算预取前 100 天数据（不产生信号，只供均线冷启动，支持最长 MA60）
  const warmupStart = (() => {
    const d = new Date(startDate);
    d.setDate(d.getDate() - 100);
    return d.toISOString().slice(0, 10);
  })();
  const allBars = queryByDateRange(warmupStart, endDate, filters);
  // 仅当期数据用于宽度/板块计算（不含 warmup 期）
  const bars = allBars.filter((b) => b.date >= startDate);

  const dailyMap = new Map<string, DayBar[]>();
  for (const bar of bars) {
    let arr = dailyMap.get(bar.date);
    if (!arr) { arr = []; dailyMap.set(bar.date, arr); }
    arr.push(bar);

  }

  const codeHistory = new Map<string, DayBar[]>();
  for (const bar of allBars) {  // allBars 含 warmup 期，确保 MA 计算有足够历史
    let arr = codeHistory.get(bar.code);
    if (!arr) { arr = []; codeHistory.set(bar.code, arr); }
    arr.push(bar);
  }
  for (const arr of codeHistory.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  // ── 大盘宽度：每日上涨比例（quote_rate > 0）的双重滚动均值 ──
  // 当 marketBreadthMinPct / regimeSwitch / compositeRegime 任一启用时都需要计算
  const dailyBreadth = new Map<string, number>();   // 5 日均值
  const dailyBreadth20 = new Map<string, number>(); // 20 日均值
  const needBreadth = config.marketBreadthMinPct !== undefined
    || config.regimeSwitch !== undefined
    || config.compositeRegime !== undefined;
  if (needBreadth) {
    const allDates = [...dailyMap.keys()].sort();
    const rawBreadth: number[] = [];
    for (const d of allDates) {
      const barsOnDay = dailyMap.get(d) ?? [];
      if (barsOnDay.length === 0) { rawBreadth.push(0); continue; }
      const upCount = barsOnDay.filter((b) => (b.quote_rate ?? 0) > 0).length;
      rawBreadth.push(upCount / barsOnDay.length);
    }
    for (let i = 0; i < allDates.length; i++) {
      const s5  = rawBreadth.slice(Math.max(0, i - 4),  i + 1);
      const s20 = rawBreadth.slice(Math.max(0, i - 19), i + 1);
      dailyBreadth.set(allDates[i],   s5.reduce((a, b) => a + b, 0) / s5.length);
      dailyBreadth20.set(allDates[i], s20.reduce((a, b) => a + b, 0) / s20.length);
    }
  }

  // ── 涨停比：每日涨停股数/总股数，同时保留5日均值和单日原始值 ──
  // limitUpRegime 或 compositeRegime 启用时计算
  const dailyLimitUpRatio    = new Map<string, number>(); // 5日均值（平滑）
  const dailyLimitUpRawMap   = new Map<string, number>(); // 单日原始值（用于共振判断）
  if (config.limitUpRegime !== undefined || config.compositeRegime !== undefined) {
    const allDates = [...dailyMap.keys()].sort();
    const rawLimitUp: number[] = [];
    for (const d of allDates) {
      const barsOnDay = dailyMap.get(d) ?? [];
      if (barsOnDay.length === 0) { rawLimitUp.push(0); continue; }
      // is_limit_up 是运行时计算字段：close >= high_limit（涨停价）
      const luCount = barsOnDay.filter((b) => b.high_limit > 0 && b.close >= b.high_limit).length;
      const raw = luCount / barsOnDay.length;
      rawLimitUp.push(raw);
      dailyLimitUpRawMap.set(d, raw);  // 保存单日原始值
    }
    for (let i = 0; i < allDates.length; i++) {
      const s5 = rawLimitUp.slice(Math.max(0, i - 4), i + 1);
      dailyLimitUpRatio.set(allDates[i], s5.reduce((a, b) => a + b, 0) / s5.length);
    }
  }

  // ── 代理指数：把全市场每日等权均涨幅累积成指数，供 proxyRegime / compositeRegime 共用 ──
  const proxyIndexValue = new Map<string, number>(); // date → 指数值
  const proxyMA1Map     = new Map<string, number>(); // date → 短MA
  const proxyMA2Map     = new Map<string, number>(); // date → 长MA
  if (config.proxyRegime || config.compositeRegime) {
    // 用 allBars（含 warmup 期）建立全量日图，确保均线有足够历史
    const allDailyMap2 = new Map<string, DayBar[]>();
    for (const bar of allBars) {
      let arr = allDailyMap2.get(bar.date);
      if (!arr) { arr = []; allDailyMap2.set(bar.date, arr); }
      arr.push(bar);
    }
    const allDates2 = [...allDailyMap2.keys()].sort();
    const proxyVals: number[] = [];
    let proxyNow = 100;
    for (const d of allDates2) {
      const barsOnDay = allDailyMap2.get(d) ?? [];
      const avgRet = barsOnDay.length === 0
        ? 0
        : barsOnDay.reduce((s, b) => s + (b.quote_rate ?? 0), 0) / barsOnDay.length;
      proxyNow = proxyNow * (1 + avgRet / 100);
      proxyVals.push(proxyNow);
    }
    const ma1 = config.proxyRegime?.ma1Days ?? 20;
    const ma2 = config.proxyRegime?.ma2Days ?? 60;
    for (let i = 0; i < allDates2.length; i++) {
      const d = allDates2[i];
      proxyIndexValue.set(d, proxyVals[i]);
      const s1 = proxyVals.slice(Math.max(0, i - ma1 + 1), i + 1);
      const s2 = proxyVals.slice(Math.max(0, i - ma2 + 1), i + 1);
      proxyMA1Map.set(d, s1.reduce((a, b) => a + b, 0) / s1.length);
      proxyMA2Map.set(d, s2.reduce((a, b) => a + b, 0) / s2.length);
    }
  }

  // ── 板块动量过滤：每日计算各板块相对强度（RS = 板块均涨幅 / 全市场均涨幅），只允许 Top-K 板块入场 ──
  // dailyTopSectors[date] = Set<industry>
  const dailyTopSectors = new Map<string, Set<string>>();
  if (config.topSectorN !== undefined) {
    const MOM_DAYS = config.sectorMomentumDays ?? 20;
    const allDates = [...dailyMap.keys()].sort();

    for (let di = 0; di < allDates.length; di++) {
      const date = allDates[di];
      const lookback = allDates.slice(Math.max(0, di - MOM_DAYS + 1), di + 1);

      // 每日市场均涨幅
      const marketDailyAvg: number[] = [];
      for (const d of lookback) {
        const dayBars = dailyMap.get(d) ?? [];
        if (dayBars.length === 0) { marketDailyAvg.push(0); continue; }
        marketDailyAvg.push(
          dayBars.reduce((s, b) => s + (b.quote_rate ?? 0), 0) / dayBars.length
        );
      }
      const marketMean = marketDailyAvg.reduce((a, b) => a + b, 0) / (marketDailyAvg.length || 1);

      // 每个板块的平均涨幅
      const sectorSum = new Map<string, number>();
      const sectorCnt = new Map<string, number>();
      for (const d of lookback) {
        for (const bar of dailyMap.get(d) ?? []) {
          const ind = (bar as DayBar & { industry?: string }).industry;
          if (!ind) continue;
          sectorSum.set(ind, (sectorSum.get(ind) ?? 0) + (bar.quote_rate ?? 0));
          sectorCnt.set(ind, (sectorCnt.get(ind) ?? 0) + 1);
        }
      }

      // RS = 板块均值 / 市场均值（市场均值为0时直接用绝对值）
      const sectorScores: { ind: string; score: number }[] = [];
      for (const [ind, sum] of sectorSum) {
        const cnt = sectorCnt.get(ind) ?? 1;
        const sectorAvg = sum / cnt;
        const rs = Math.abs(marketMean) > 0.001
          ? sectorAvg / Math.abs(marketMean)   // 相对强度
          : sectorAvg;                          // 市场近乎不动时用绝对值
        sectorScores.push({ ind, score: rs });
      }
      sectorScores.sort((a, b) => b.score - a.score);

      const topSet = new Set<string>(
        sectorScores.slice(0, config.topSectorN).map((s) => s.ind)
      );
      dailyTopSectors.set(date, topSet);
    }
  }

  const signals: Signal[] = [];
  const positions = new Map<string, OpenPosition>();
  // 次日开盘买入挂单队列（limitUpBuyMode='next_open' 时使用）
  const pendingNextOpen = new Map<string, string>(); // code → name

  // ── 连续亏损熔断 ──
  const MAX_LOSSES = config.maxConsecutiveLosses ?? 0; // 0 = 不启用
  const COOLDOWN_DAYS = config.lossCooldownDays ?? 3;
  let consecutiveLosses = 0;
  let cooldownUntil: string | null = null;

  // 工具：日期加N天
  const addDays = (dateStr: string, n: number) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const MAX_POS = config.maxPositions ?? 10;
  const rs = config.regimeSwitch; // 多策略切换配置（可选）

  // 用于 useMa2Direction：记录上一个交易日
  let prevTradingDate: string | null = null;

  for (const date of tradingDates) {
    const todayBars = dailyMap.get(date);
    if (!todayBars) continue;

    const b5  = dailyBreadth.get(date)   ?? 0;
    const b20 = dailyBreadth20.get(date) ?? 0;

    // ── 市场环境判断 ──────────────────────────────────────────────────────
    let activeBuyRules = config.buyRules;
    let activeMaxPos   = MAX_POS;
    let activeBreadthOk = true;
    let activeBearIndustry: string | undefined;

    if (config.proxyRegime) {
      // 代理指数 MA 三档切换
      const pr = config.proxyRegime;
      const proxyVal = proxyIndexValue.get(date) ?? 0;
      const pma1     = proxyMA1Map.get(date) ?? 0;
      const pma2     = proxyMA2Map.get(date) ?? 0;

      if (pr.useMa2Direction) {
        // MA60 拐头方向模式：用 MA60 斜率判断牛/熊，无震荡档
        const prevPma2 = prevTradingDate ? (proxyMA2Map.get(prevTradingDate) ?? 0) : pma2;
        if (pma2 >= prevPma2) {
          // MA60 向上（或持平）→ 牛市
          activeBuyRules  = pr.bullBuyRules ?? config.buyRules;
          activeMaxPos    = pr.bullMaxPositions;
          activeBreadthOk = true;
        } else {
          // MA60 向下 → 熊市
          activeBuyRules  = pr.bearBuyRules ?? [];
          activeMaxPos    = pr.bearMaxPositions;
          activeBreadthOk = pr.bearMaxPositions > 0;
        }
      } else if (proxyVal > pma1) {
        // 牛市：proxy 站上短MA
        activeBuyRules  = pr.bullBuyRules ?? config.buyRules;
        activeMaxPos    = pr.bullMaxPositions;
        activeBreadthOk = true;
      } else if (proxyVal > pma2) {
        // 震荡：proxy 在短MA与长MA之间
        activeBuyRules  = pr.oscillatingBuyRules ?? config.buyRules;
        activeMaxPos    = pr.oscillatingMaxPositions;
        activeBreadthOk = pr.oscillatingMaxPositions > 0;
      } else {
        // 熊市：proxy 跌破长MA
        activeBuyRules  = pr.bearBuyRules ?? [];
        activeMaxPos    = pr.bearMaxPositions;
        activeBreadthOk = pr.bearMaxPositions > 0;
      }
    } else if (config.limitUpRegime) {
      // 方案A：涨停比过滤（含大盘共振）
      const lr  = config.limitUpRegime;
      const lu5 = dailyLimitUpRatio.get(date) ?? 0;    // 5日均值
      const lu1 = dailyLimitUpRawMap.get(date) ?? 0;   // 单日原始值
      if (lu5 >= lr.bullLimitUpPct) {
        // 持续牛市：5日均值达标
        activeBuyRules  = lr.bullBuyRules ?? config.buyRules;
        activeMaxPos    = lr.bullMaxPositions;
        activeBreadthOk = true;
      } else if (lr.resonanceLimitUpPct !== undefined && lu1 >= lr.resonanceLimitUpPct) {
        // 大盘共振：单日涨停比突增（即使5日均值未达牛市门槛）
        // 说明当天资金集中爆发，强势股可能不等回踩直接拉升，用牛市策略快速入场
        activeBuyRules  = lr.resonanceBuyRules ?? lr.bullBuyRules ?? config.buyRules;
        activeMaxPos    = lr.resonanceMaxPositions ?? lr.bullMaxPositions;
        activeBreadthOk = true;
      } else if (lu5 >= lr.bearLimitUpPct) {
        // 震荡市：5日均值在熊/牛之间
        activeBuyRules  = lr.oscillatingBuyRules ?? config.buyRules;
        activeMaxPos    = lr.oscillatingMaxPositions;
        activeBreadthOk = lr.oscillatingMaxPositions > 0;
      } else {
        // 熊市：5日均值低于下限
        activeBuyRules  = lr.bearBuyRules ?? [];
        activeMaxPos    = lr.bearMaxPositions;
        activeBreadthOk = lr.bearMaxPositions > 0;
      }
    } else if (config.compositeRegime) {
      // 方案C：三信号综合评分
      const cr = config.compositeRegime;
      const momentumDays = cr.momentumDays ?? 5;
      const breadthBull  = cr.breadthBull  ?? 0.50;
      const limitUpBull  = cr.limitUpBull  ?? 0.012;
      const bullScore    = cr.bullScore    ?? 0.33;
      const bearScore    = cr.bearScore    ?? -0.33;

      // 信号1：代理指数 N 日动量
      const proxyToday = proxyIndexValue.get(date) ?? 0;
      const proxyPrev  = (() => {
        const tradingDatesArr = [...proxyIndexValue.keys()].sort();
        const idx = tradingDatesArr.indexOf(date);
        const prevIdx = Math.max(0, idx - momentumDays);
        return proxyIndexValue.get(tradingDatesArr[prevIdx]) ?? proxyToday;
      })();
      const s1 = proxyToday >= proxyPrev ? 1 : -1;

      // 信号2：5日上涨家数比
      const b5val = dailyBreadth.get(date) ?? 0;
      const s2 = b5val >= breadthBull ? 1 : -1;

      // 信号3：5日涨停比
      const lu5val = dailyLimitUpRatio.get(date) ?? 0;
      const s3 = lu5val >= limitUpBull ? 1 : -1;

      const score = (s1 + s2 + s3) / 3;

      if (score > bullScore) {
        activeBuyRules  = cr.bullBuyRules ?? config.buyRules;
        activeMaxPos    = cr.bullMaxPositions;
        activeBreadthOk = true;
      } else if (score < bearScore) {
        activeBuyRules  = cr.bearBuyRules ?? [];
        activeMaxPos    = cr.bearMaxPositions;
        activeBreadthOk = cr.bearMaxPositions > 0;
      } else {
        activeBuyRules  = cr.oscillatingBuyRules ?? config.buyRules;
        activeMaxPos    = cr.oscillatingMaxPositions;
        activeBreadthOk = cr.oscillatingMaxPositions > 0;
      }
    } else if (rs) {
      // 三档 regime 分类（宽度版）
      if (b5 >= rs.bullBreadth5d && b20 >= rs.bullBreadth20d) {
        activeBuyRules  = rs.bullBuyRules ?? config.buyRules;
        activeMaxPos    = rs.bullMaxPositions;
        activeBreadthOk = true;
      } else if (b5 < rs.bearBreadth5d) {
        activeBuyRules     = rs.bearBuyRules ?? [];
        activeMaxPos       = rs.bearMaxPositions;
        activeBreadthOk    = rs.bearMaxPositions > 0;
        activeBearIndustry = rs.bearIndustry;
      } else {
        activeBuyRules  = rs.oscillatingBuyRules ?? config.buyRules;
        activeMaxPos    = rs.oscillatingMaxPositions;
        activeBreadthOk = true;
      }
    } else {
      // 原有逻辑：双重宽度确认
      activeBreadthOk = config.marketBreadthMinPct === undefined || (
        b5  >= config.marketBreadthMinPct &&
        b20 >= config.marketBreadthMinPct - 0.05
      );
    }

    // 入场日大盘共振过滤：要求当日涨停比 ≥ minDailyLimitUpForBuy（叠加在 regime 之上）
    if (activeBreadthOk && config.minDailyLimitUpForBuy !== undefined) {
      const lu1Today = dailyLimitUpRawMap.get(date) ?? 0;
      if (lu1Today < config.minDailyLimitUpForBuy) {
        activeBreadthOk = false;
      }
    }

    // 冷静期内禁止新开仓
    const inCooldown = cooldownUntil !== null && date <= cooldownUntil;

    // ── 阶段一：处理卖出（先卖，释放仓位）──
    for (const bar of todayBars) {
      const pos = positions.get(bar.code);
      if (!pos) continue;

      pos.dayCount++;
      if (bar.high > pos.peakPrice) pos.peakPrice = bar.high;
      const currentReturn = ((bar.close - pos.buyPrice) / pos.buyPrice) * 100;
      const codeBars = codeHistory.get(bar.code) ?? [];
      const idx = codeBars.findIndex((b) => b.date === date);

      let shouldSell = false;
      let sellReason = '';

      if (sellAfterDays && pos.dayCount >= sellAfterDays) {
        shouldSell = true;
        sellReason = `持有${pos.dayCount}天`;
      }
      if (!shouldSell && takeProfitPct && currentReturn >= takeProfitPct) {
        shouldSell = true;
        sellReason = `止盈${currentReturn.toFixed(1)}%`;
      }
      if (!shouldSell && stopLossPct && currentReturn <= -stopLossPct) {
        shouldSell = true;
        sellReason = `止损${currentReturn.toFixed(1)}%`;
      }
      if (!shouldSell && config.trailingStopPct && pos.peakPrice > 0) {
        const drawFromPeak = ((bar.close - pos.peakPrice) / pos.peakPrice) * 100;
        if (drawFromPeak <= -config.trailingStopPct) {
          shouldSell = true;
          const peakReturn = ((pos.peakPrice - pos.buyPrice) / pos.buyPrice * 100).toFixed(1);
          sellReason = `追踪止损(峰值+${peakReturn}%回落${(-drawFromPeak).toFixed(1)}%)`;
        }
      }
      if (!shouldSell && sellRules.length > 0 && idx >= 0) {
        if (evaluateAll(sellRules, bar, codeBars, idx)) {
          shouldSell = true;
          sellReason = '卖出条件触发';
        }
      }

      if (shouldSell) {
        signals.push({
          date, code: bar.code, name: bar.name,
          action: 'sell', price: bar.close, reason: sellReason,
        });
        positions.delete(bar.code);

        if (MAX_LOSSES > 0) {
          if (currentReturn < 0) {
            consecutiveLosses++;
            if (consecutiveLosses >= MAX_LOSSES) {
              cooldownUntil = addDays(date, COOLDOWN_DAYS);
              consecutiveLosses = 0;
            }
          } else {
            consecutiveLosses = 0;
          }
        }
      }
    }

    // ── 阶段二：收集买入候选，排序后择优入场 ──
    if (!activeBreadthOk || inCooldown || positions.size >= activeMaxPos) continue;

    const topSectors = config.topSectorN !== undefined ? dailyTopSectors.get(date) : undefined;
    const candidates: DayBar[] = [];

    for (const bar of todayBars) {
      if (positions.has(bar.code)) continue; // 已持仓不重复买

      // 板块动量过滤
      if (topSectors !== undefined) {
        const ind = (bar as DayBar & { industry?: string }).industry;
        if (!ind || !topSectors.has(ind)) continue;
      }
      // 熊市板块限定
      if (activeBearIndustry) {
        const ind = (bar as DayBar & { industry?: string }).industry;
        if (ind !== activeBearIndustry) continue;
      }

      const codeBars = codeHistory.get(bar.code) ?? [];
      const idx = codeBars.findIndex((b) => b.date === date);
      if (idx < 0) continue;

      if (evaluateAll(activeBuyRules, bar, codeBars, idx)) {
        candidates.push(bar);
      }
    }

    // 市值过滤（单位：亿元 → DB 存储单位 万元，1亿=10000万）
    if (config.minCircMv !== undefined || config.maxCircMv !== undefined) {
      const minMv = (config.minCircMv ?? 0) * 10000;
      const maxMv = (config.maxCircMv ?? Infinity) * 10000;
      candidates.splice(0, candidates.length,
        ...candidates.filter(b => {
          const mv = b.circ_mv ?? 0;
          return mv >= minMv && mv <= maxMv;
        })
      );
    }

    // 板块共振过滤：同一行业当日至少有 minSectorCandidates 只满足条件才允许买入
    if (config.minSectorCandidates && config.minSectorCandidates > 1 && candidates.length > 0) {
      const sectorCount = new Map<string, number>();
      for (const c of candidates) {
        const ind = c.industry || '__unknown__';
        sectorCount.set(ind, (sectorCount.get(ind) ?? 0) + 1);
      }
      candidates.splice(0, candidates.length,
        ...candidates.filter(c =>
          (sectorCount.get(c.industry || '__unknown__') ?? 0) >= config.minSectorCandidates!
        )
      );
    }

    // 按 candidateSortBy 排序，默认 quote_rate（优先当日最强势股）
    const sortBy = config.candidateSortBy ?? 'quote_rate';
    if (sortBy !== 'code') {
      candidates.sort((a, b) => {
        const vr_a = a.volume_ratio ?? 0, vr_b = b.volume_ratio ?? 0;
        const qr_a = a.quote_rate  ?? 0, qr_b = b.quote_rate  ?? 0;
        const mv_a = a.circ_mv     ?? 0, mv_b = b.circ_mv     ?? 0;
        if (sortBy === 'volume_ratio') return vr_b - vr_a;
        if (sortBy === 'quote_rate')   return qr_b - qr_a;
        if (sortBy === 'circ_mv_asc')  return mv_a - mv_b; // 小市值优先
        if (sortBy === 'circ_mv_desc') return mv_b - mv_a; // 大市值优先
        // composite: 量比 × 涨幅
        return (vr_b * qr_b) - (vr_a * qr_a);
      });
    }

    // ── 处理上个交易日挂单的"次日开盘买入"订单 ──
    if (pendingNextOpen.size > 0) {
      for (const [pCode, pName] of pendingNextOpen) {
        if (positions.size >= activeMaxPos) break;
        if (positions.has(pCode)) { pendingNextOpen.delete(pCode); continue; }
        const pBar = todayBars.find(b => b.code === pCode);
        if (!pBar) { pendingNextOpen.delete(pCode); continue; }
        const buyPrice = pBar.open; // 次日开盘价成交
        signals.push({ date, code: pCode, name: pName, action: 'buy', price: buyPrice, reason: '次日开盘(涨停排板)' });
        positions.set(pCode, { code: pCode, name: pName, buyDate: date, buyPrice, buyReason: '次日开盘(涨停排板)', dayCount: 0, peakPrice: buyPrice });
        pendingNextOpen.delete(pCode);
      }
    }

    // 按排序后顺序依次开仓，直到仓位满
    const limitMode = config.limitUpBuyMode ?? 'allow';
    for (const bar of candidates) {
      if (positions.size >= activeMaxPos) break;
      const isLimitUp = bar.high_limit > 0 && bar.close >= bar.high_limit * 0.999;

      if (isLimitUp && limitMode === 'skip') continue; // 直接跳过涨停股

      if (isLimitUp && limitMode === 'next_open') {
        // 不立即建仓，挂单等次日开盘买
        pendingNextOpen.set(bar.code, bar.name);
        continue;
      }

      // allow 或非涨停：按收盘价买入
      const buyPrice = bar.close;
      signals.push({ date, code: bar.code, name: bar.name, action: 'buy', price: buyPrice, reason: '买入条件触发' });
      positions.set(bar.code, { code: bar.code, name: bar.name, buyDate: date, buyPrice, buyReason: '买入条件触发', dayCount: 0, peakPrice: buyPrice });
    }

    prevTradingDate = date;
  }

  return signals;
}

function runSingleStock(config: CustomBacktestConfig): Signal[] {
  if (!config.code) throw new Error('单股模式需指定 code');
  const bars = queryByCode(config.code, config.startDate, config.endDate);
  if (bars.length === 0) throw new Error(`未找到 ${config.code} 的数据`);

  const { buyRules, sellRules, sellAfterDays, takeProfitPct, stopLossPct } = config;
  const signals: Signal[] = [];
  let position: OpenPosition | null = null;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    if (position) {
      position.dayCount++;
      const currentReturn = ((bar.close - position.buyPrice) / position.buyPrice) * 100;

      let shouldSell = false;
      let sellReason = '';

      if (sellAfterDays && position.dayCount >= sellAfterDays) {
        shouldSell = true;
        sellReason = `持有${position.dayCount}天`;
      }
      if (!shouldSell && takeProfitPct && currentReturn >= takeProfitPct) {
        shouldSell = true;
        sellReason = `止盈${currentReturn.toFixed(1)}%`;
      }
      if (!shouldSell && stopLossPct && currentReturn <= -stopLossPct) {
        shouldSell = true;
        sellReason = `止损${currentReturn.toFixed(1)}%`;
      }
      if (!shouldSell && sellRules.length > 0) {
        if (evaluateAll(sellRules, bar, bars, i)) {
          shouldSell = true;
          sellReason = '卖出条件触发';
        }
      }

      if (shouldSell) {
        signals.push({
          date: bar.date, code: bar.code, name: bar.name,
          action: 'sell', price: bar.close, reason: sellReason,
        });
        position = null;
      }
    } else {
      if (evaluateAll(buyRules, bar, bars, i)) {
        signals.push({
          date: bar.date, code: bar.code, name: bar.name,
          action: 'buy', price: bar.close, reason: '买入条件触发',
        });
        position = {
          code: bar.code, name: bar.name,
          buyDate: bar.date, buyPrice: bar.close,
          buyReason: '买入条件触发', dayCount: 0, peakPrice: bar.close,
        };
      }
    }
  }

  return signals;
}

function signalsToTrades(signals: Signal[]): TradeDetail[] {
  const trades: TradeDetail[] = [];
  const open = new Map<string, Signal>();

  for (const sig of signals) {
    if (sig.action === 'buy') {
      if (!open.has(sig.code)) open.set(sig.code, sig);
    } else {
      const buy = open.get(sig.code);
      if (buy) {
        const ret = buy.price > 0 ? ((sig.price - buy.price) / buy.price) * 100 : 0;
        const hold = Math.max(1, Math.round(
          (new Date(sig.date).getTime() - new Date(buy.date).getTime()) / 86400000
        ));
        trades.push({
          code: sig.code, name: sig.name,
          buyDate: buy.date, buyPrice: +buy.price.toFixed(2),
          sellDate: sig.date, sellPrice: +sig.price.toFixed(2),
          returnPct: +ret.toFixed(2), holdDays: hold,
          reason: `${buy.reason} → ${sig.reason}`,
        });
        open.delete(sig.code);
      }
    }
  }
  return trades;
}

function calcResult(
  trades: TradeDetail[],
  config: CustomBacktestConfig
): BacktestResult {
  const n = trades.length;
  if (n === 0) {
    return {
      strategy: config.strategyName, startDate: config.startDate, endDate: config.endDate,
      totalReturn: 0, annualReturn: 0, winRate: 0, maxDrawdown: 0,
      sharpeRatio: 0, totalTrades: 0, avgHoldDays: 0,
      trades: [], equityCurve: [], summary: `${config.strategyName}: 无符合条件的交易`,
    };
  }

  const wins = trades.filter((t) => t.returnPct > 0).length;
  const totalHold = trades.reduce((s, t) => s + t.holdDays, 0);

  // ── 资金模拟 ──────────────────────────────────────────────
  const INITIAL = config.initialCapital ?? 100_000;
  const MAX_POS = config.maxPositions ?? 10;

  // 按买入日期排序，动态跟踪滚动资金（防止透支）
  const byBuyDate = [...trades].sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  let rollingCash = INITIAL;

  const tradesWithPnl = byBuyDate.map((t) => {
    // 每笔仓位大小 = 当前资金 / 最大持仓数，但最少 100 股
    const posSize = Math.max(0, rollingCash) / MAX_POS;
    const shares = Math.floor(posSize / t.buyPrice / 100) * 100 || 100;
    const cost = shares * t.buyPrice;
    const proceeds = shares * t.sellPrice;
    const pnl = proceeds - cost;
    rollingCash = Math.max(0, rollingCash + pnl); // 资金不能低于 0
    return { ...t, shares, cost, proceeds, pnl };
  });

  let cash = INITIAL;
  const capitalCurve: { date: string; capital: number }[] = [
    { date: config.startDate, capital: INITIAL },
  ];
  for (const t of tradesWithPnl) {
    cash += t.pnl;
    cash = Math.max(0, cash); // 保底 0，不允许资金变负
    capitalCurve.push({ date: t.sellDate, capital: +cash.toFixed(2) });
  }

  // 净值曲线（归一化）
  const curve = capitalCurve.map((p) => ({
    date: p.date,
    value: +(p.capital / INITIAL).toFixed(4),
  }));

  const finalCapital = capitalCurve[capitalCurve.length - 1]?.capital ?? INITIAL;
  const totalPnl = finalCapital - INITIAL;
  const totalReturn = +((totalPnl / INITIAL) * 100).toFixed(2);
  const years = Math.max(0.01,
    (new Date(config.endDate).getTime() - new Date(config.startDate).getTime()) / (365.25 * 86400000)
  );
  const annualReturn = +((Math.pow(Math.max(0.001, finalCapital / INITIAL), 1 / years) - 1) * 100).toFixed(2);

  let peak = INITIAL, maxDd = 0;
  for (const pt of capitalCurve) {
    if (pt.capital > peak) peak = pt.capital;
    const dd = (peak - pt.capital) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const returns = trades.map((t) => t.returnPct);
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n);
  const sharpe = std > 0 ? +(mean / std * Math.sqrt(252)).toFixed(2) : 0;

  const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  const pnlSign = (v: number) => v >= 0 ? `+${fmt(v)}` : fmt(v);

  const summary = [
    `📊 ${config.strategyName} 回测报告`,
    `期间: ${config.startDate} ~ ${config.endDate}`,
    `模式: ${config.scanMode === 'market' ? '全市场扫描' : `单股 ${config.code}`}`,
    '',
    `💰 资金模拟（初始 ${fmt(INITIAL)} 元 / 每仓≈${fmt(INITIAL / MAX_POS)} 元 / 最多 ${MAX_POS} 仓）`,
    `起始资金: ${fmt(INITIAL)} 元`,
    `最终资金: ${fmt(finalCapital)} 元`,
    `总盈亏:  ${pnlSign(totalPnl)} 元 (${totalReturn >= 0 ? '+' : ''}${totalReturn}%)`,
    `年化收益: ${annualReturn}%`,
    `最大回撤: ${(maxDd * 100).toFixed(2)}%`,
    '',
    `📈 交易统计`,
    `总交易: ${n} 笔 | 盈利: ${wins} 笔 | 亏损: ${n - wins} 笔`,
    `胜率: ${((wins / n) * 100).toFixed(1)}% | 平均持仓: ${(totalHold / n).toFixed(1)} 天`,
    `夏普比率: ${sharpe}`,
    '',
    '买入条件: ' + config.buyRules.map((r) => `${r.field} ${r.op} ${r.value}`).join(' AND '),
    '卖出条件: ' + [
      ...config.sellRules.map((r) => `${r.field} ${r.op} ${r.value}`),
      ...(config.sellAfterDays ? [`持有>=${config.sellAfterDays}天`] : []),
      ...(config.takeProfitPct ? [`止盈>=${config.takeProfitPct}%`] : []),
      ...(config.stopLossPct ? [`止损>=${config.stopLossPct}%`] : []),
    ].join(' OR '),
    '',
    '--- 交易明细 (前30笔) ---',
    ...tradesWithPnl.slice(0, 30).map((t) => {
      const flag = t.returnPct >= 0 ? '🟢' : '🔴';
      return `${flag} ${t.name}(${t.code}) ${t.buyDate}→${t.sellDate} ` +
        `买${t.buyPrice}×${t.shares}股 卖${t.sellPrice} ` +
        `收益${t.returnPct}% (${pnlSign(Math.round(t.pnl))}元)`;
    }),
  ].join('\n');

  return {
    strategy: config.strategyName, startDate: config.startDate, endDate: config.endDate,
    totalReturn, annualReturn, winRate: +((wins / n) * 100).toFixed(1),
    maxDrawdown: +(maxDd * 100).toFixed(2), sharpeRatio: sharpe,
    totalTrades: n, avgHoldDays: +(totalHold / n).toFixed(1),
    trades: tradesWithPnl.slice(0, 50) as TradeDetail[], equityCurve: curve, summary,
  };
}

export function runCustomBacktest(config: CustomBacktestConfig): BacktestResult {
  const t0 = Date.now();
  console.log(`[backtest] AI策略 "${config.strategyName}" ${config.startDate}~${config.endDate} mode=${config.scanMode}`);

  const signals = config.scanMode === 'market'
    ? runMarketScan(config)
    : runSingleStock(config);

  const trades = signalsToTrades(signals);
  const result = calcResult(trades, config);

  console.log(`[backtest] 完成: ${result.totalTrades}笔 收益${result.totalReturn}% 耗时${Date.now() - t0}ms`);
  return result;
}
