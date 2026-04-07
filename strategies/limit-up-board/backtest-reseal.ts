/**
 * 2进3 回封打板策略 — 资金回测（T+1 + 优化参数版）
 *
 * 入场条件（全部满足）：
 *   ① 2板满足条件：换手<15%，量比<2.0，价格4~40元（仅主板，无市值下限）
 *   ② Day3 开盘低于涨停价（非一字板）且盘中触碰涨停价（回封确认）
 *   ③ Day3 市值 ≤150亿
 *   ④ 【主线板块】Day3 当天同行业涨停股 ≥ 2 只
 *   以涨停价买入
 *
 * 出场（T+1 合规）：
 *   买入当天不能出，从次日（Day4）起：
 *     收盘涨停 → 继续持有
 *     炸板（触碰涨停后回落）→ 涨停价回调3%出场
 *     未触及涨停价 → 当日收盘出
 *   次日开盘跌幅 > 8% → 开盘止损
 *   最多持 MAX_HOLD_DAYS 天强平
 *
 * 资金管理：
 *   初始资金 10 万，最多同时持 2 只，每只 ~50%，
 *   手续费：买入 0.03%，卖出 0.13%（含印花税）
 *
 * 用法：
 *   npx tsx strategies/limit-up-board/backtest-reseal.ts        # 近365天
 *   npx tsx strategies/limit-up-board/backtest-reseal.ts 500    # 指定天数
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH       = path.join(process.cwd(), 'data/prices.db');
const INIT_CAPITAL  = 100_000;
const MAX_POSITIONS = 1;       // 全仓单只，每次只持1只
const FEE_BUY       = 0.0003;
const FEE_SELL      = 0.0013;
const MAX_HOLD_DAYS = 7;       // 最多持 7 天（含买入当天）
const STOP_OPEN_PCT = -0.08;   // 次日开盘跌幅 > 8% 则开盘止损

const ENTRY_PARAMS = {
  // Day2 连板条件（基于近1年回测优化）
  maxTurnover2: 15.0,   // 换手<15%（放宽后封板率不变，召回率+23%）
  maxVolRatio2:  2.0,   // 量比<2.0
  minPrice:      4.0,
  maxPrice:     40.0,

  // Day3 入场条件
  minCircMv:     0,     // 无市值下限（去掉后封板率反升至63.6%）
  maxCircMv:   150,     // 市值≤150亿
  maxOpenDrop:   0.08,  // 低开超过8%封板率降至40%，谨慎（不设下限，任意低开均可）
  maxTurnover3: 15.0,   // Day3 换手 < 15%

  // 主线板块判断
  minSectorLU:   2,     // 同行业至少 2 只涨停才算主线（去掉后炸板率+4%）
};

interface Position {
  code: string; name: string; industry: string;
  entryDate: string;
  entryPrice: number;   // 回封涨停价
  shares: number;
  cost: number;         // 含买入手续费的总成本
  holdDays: number;     // 持仓天数（含买入当天）
}

interface TradeLog {
  no: number;
  code: string; name: string; industry: string;
  entryDate: string; exitDate: string;
  entryPrice: number; exitPrice: number;
  shares: number;
  netPnl: number;
  netPct: number;
  holdDays: number;
  reason: string;
  capital: number;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  // 支持两种参数模式：
  //   模式A: npx tsx backtest-reseal.ts 365          (最近N天)
  //   模式B: npx tsx backtest-reseal.ts 2024-01-01 2024-12-31 (指定日期区间)
  const arg2 = process.argv[2];
  const arg3 = process.argv[3];

  let allDates: string[];
  if (arg2 && arg3 && arg2.includes('-') && arg3.includes('-')) {
    // 模式B：日期区间，多取20天用于lookback
    allDates = (db.prepare(
      "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') AND date >= ? AND date <= ? ORDER BY date"
    ).all(arg2, arg3) as any[]).map(r => r.date);
  } else {
    const lookback = parseInt(arg2 ?? '365', 10);
    allDates = (db.prepare(
      "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT ?"
    ).all(lookback + 20) as any[]).map(r => r.date).reverse();
  }

  const backStart = allDates[5];
  const backEnd   = allDates[allDates.length - 1];

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  💰 2进3 回封打板策略回测（T+1 + 主线板块版）');
  console.log(`  回测区间：${backStart} ~ ${backEnd}  初始资金：¥${INIT_CAPITAL.toLocaleString()}`);
  console.log(`  入场过滤：任意低开(<8%) | Day2换手<15% 量比<2 | 市值≤150亿(无下限) | 主线≥${ENTRY_PARAMS.minSectorLU}只 | 仅主板`);
  console.log(`  T+1规则：买入次日起可卖 | 最多持${MAX_HOLD_DAYS}天 | 次日跌>${Math.abs(STOP_OPEN_PCT*100)}%开盘止损`);
  console.log(`${'═'.repeat(80)}`);

  let capital = INIT_CAPITAL;
  const positions = new Map<string, Position>();
  const logs: TradeLog[] = [];
  let tradeNo = 0;

  function getBar(code: string, date: string) {
    return db.prepare(
      `SELECT open, high, low, close, high_limit, prev_close, turnover_rate, volume_ratio
       FROM prices WHERE code=? AND date=?`
    ).get(code, date) as any | undefined;
  }

  function closePos(pos: Position, exitPrice: number, exitDate: string, reason: string) {
    const gross  = (exitPrice - pos.entryPrice) * pos.shares;
    const fee    = pos.cost * FEE_SELL;
    const netPnl = gross - fee - pos.cost * FEE_BUY;
    capital     += pos.cost + gross - fee;

    logs.push({
      no: ++tradeNo,
      code: pos.code, name: pos.name, industry: pos.industry,
      entryDate: pos.entryDate, exitDate,
      entryPrice: pos.entryPrice, exitPrice,
      shares: pos.shares,
      netPnl,
      netPct: netPnl / (pos.shares * pos.entryPrice) * 100,
      holdDays: pos.holdDays,
      reason,
      capital: Math.round(capital),
    });
    positions.delete(pos.code);
  }

  for (let i = 5; i < allDates.length; i++) {
    const today = allDates[i];

    // ── 1. 持仓出场（T+1：holdDays >= 1 才能卖）──────────────────────────
    for (const [code, pos] of [...positions.entries()]) {
      const bar = getBar(code, today);
      pos.holdDays++;

      if (pos.holdDays < 1) continue; // 买入当天不能卖（T+1）

      if (!bar) {
        // 停牌/退市，以买入价平仓（保守）
        closePos(pos, pos.entryPrice, today, '停牌/无数据，按买入价平仓');
        continue;
      }

      const isOpenSealed = bar.high_limit > 0 && bar.open >= bar.high_limit * 0.999;
      const isLimitUp    = bar.high_limit > 0 && bar.close >= bar.high_limit * 0.999;
      const touchedLimit = bar.high_limit > 0 && bar.high  >= bar.high_limit * 0.999;

      // ── T+1 第一个可卖日（Day4）特殊处理 ──────────────────────────────────
      if (pos.holdDays === 1) {
        // ① 开盘跌幅 > 8% → 开盘止损
        const openDropPct = (bar.open - pos.entryPrice) / pos.entryPrice;
        if (openDropPct <= STOP_OPEN_PCT) {
          closePos(pos, bar.open, today,
            `4板开盘跌${(openDropPct*100).toFixed(1)}%止损，开盘¥${bar.open.toFixed(2)}出`);
          continue;
        }
        // ② 开盘未封板（开盘价 < 涨停价）→ 直接开盘卖出，不等盘中
        if (!isOpenSealed) {
          closePos(pos, bar.open, today,
            `4板开盘未封¥${bar.open.toFixed(2)}，开盘直接出`);
          continue;
        }
        // ③ 开盘已封（一字或竞价封板）→ 持有，后续按炸板/收盘逻辑处理
      }

      // ── Day5+ 出场逻辑 ────────────────────────────────────────────────────
      // 超出最大持仓天数 → 收盘强平
      if (pos.holdDays >= MAX_HOLD_DAYS) {
        closePos(pos, bar.close, today,
          `持仓${pos.holdDays}天达上限，收盘¥${bar.close.toFixed(2)}出`);
        continue;
      }

      if (!isLimitUp) {
        if (touchedLimit) {
          // 炸板：盘中触碰涨停价后回落，以涨停价回调3%出场
          const exitPrice = bar.high_limit * 0.97;
          closePos(pos, exitPrice, today,
            `炸板，涨停价回调3%¥${exitPrice.toFixed(2)}出（持${pos.holdDays}天）`);
        } else {
          // 未触及涨停价，收盘出
          closePos(pos, bar.close, today,
            `收盘未涨停¥${bar.close.toFixed(2)}出（持${pos.holdDays}天）`);
        }
      }
      // 否则继续持有
    }

    // ── 2. 扫描新的回封入场信号 ──────────────────────────────────────────
    if (positions.size >= MAX_POSITIONS) continue;

    const prev5 = allDates.slice(Math.max(0, i - 8), i).reverse();

    // 当天「非一字板开盘，盘中曾触碰涨停」的股票
    // 仅主板（沪 600/601/603/605，深 000/001/002/003），排除创业板/科创板
    const candidates = db.prepare(`
      SELECT p.code, p.name, p.open, p.high, p.low, p.close,
             p.high_limit, p.prev_close, p.turnover_rate, p.volume_ratio,
             p.circ_mv, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0
        AND p.open  < p.high_limit * 0.999
        AND p.high >= p.high_limit * 0.999
        AND p.name NOT LIKE '%ST%' AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
        AND (
          p.code LIKE '600%' OR p.code LIKE '601%'
          OR p.code LIKE '603%' OR p.code LIKE '605%'
          OR p.code LIKE '000%' OR p.code LIKE '001%'
          OR p.code LIKE '002%' OR p.code LIKE '003%'
        )
      ORDER BY p.turnover_rate ASC NULLS LAST
    `).all(today) as any[];

    // 统计今日各行业涨停数量（用于主线板块判断）
    const sectorLUCount = new Map<string, number>();
    const allLU = db.prepare(`
      SELECT industry FROM prices
      WHERE date = ?
        AND high_limit > 0
        AND close >= high_limit
        AND name NOT LIKE '%ST%' AND name NOT LIKE '%退%'
        AND market NOT IN ('ETF','INDEX')
        AND industry IS NOT NULL AND industry != ''
    `).all(today) as any[];
    for (const r of allLU) {
      sectorLUCount.set(r.industry, (sectorLUCount.get(r.industry) ?? 0) + 1);
    }

    for (const bar of candidates) {
      if (positions.size >= MAX_POSITIONS) break;
      if (positions.has(bar.code)) continue;

      const circMv   = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const t3       = bar.turnover_rate ?? 0;
      const v3       = bar.volume_ratio  ?? 0;
      const openDrop = (bar.high_limit - bar.open) / bar.high_limit; // 开盘折扣（正数=低开幅度）

      if (bar.close < ENTRY_PARAMS.minPrice || bar.close > ENTRY_PARAMS.maxPrice) continue;
      if (circMv > 0 && circMv > ENTRY_PARAMS.maxCircMv) continue;

      // ── 入场过滤 ──────────────────────────────────────────────────────────
      // ① 低开超过 8% 封板率仅40%，谨慎
      if (openDrop > ENTRY_PARAMS.maxOpenDrop) continue;
      // ② Day3 换手 < 15%
      if (t3 > 0 && t3 > ENTRY_PARAMS.maxTurnover3) continue;
      // ③ 主线板块过滤
      const industry   = bar.industry ?? '';
      const sectorSize = sectorLUCount.get(industry) ?? 0;
      if (!industry || sectorSize < ENTRY_PARAMS.minSectorLU) continue;

      // 确认恰好2连板
      let boards = 0;
      let d2bar: any = null;
      for (const pd of prev5) {
        const pb = db.prepare(
          'SELECT close, high_limit, turnover_rate, volume_ratio FROM prices WHERE code=? AND date=?'
        ).get(bar.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) {
          boards++;
          if (boards === 1) d2bar = pb;
        } else break;
      }
      if (boards !== 2 || !d2bar) continue;

      const t2 = d2bar.turnover_rate ?? 0;
      const v2 = d2bar.volume_ratio  ?? 0;
      if (t2 > 0 && t2 > ENTRY_PARAMS.maxTurnover2) continue;
      if (v2 > 0 && v2 > ENTRY_PARAMS.maxVolRatio2) continue;

      // ── 入场 ─────────────────────────────────────────────────────────
      const entryPrice = bar.high_limit;
      const invest     = capital / Math.max(1, MAX_POSITIONS - positions.size);
      const capped     = Math.min(invest, capital * 0.55);
      if (capped < 3000) continue;

      const shares = Math.floor(capped / entryPrice / 100) * 100;
      if (shares <= 0) continue;

      const cost = shares * entryPrice * (1 + FEE_BUY);
      capital   -= cost;

      // 注意：T+1，今天买入不管涨停还是炸板都不能出，直接入仓等明天
      positions.set(bar.code, {
        code: bar.code,
        name: bar.name,
        industry: `${industry}(板块${sectorSize}板)`,
        entryDate: today, entryPrice, shares, cost,
        holdDays: 0,  // 今天是第0天（买入日），明天holdDays变成1才可卖
      });
    }
  }

  // 强平未平仓持仓
  for (const [, pos] of positions) {
    const lastBar = db.prepare(
      'SELECT close FROM prices WHERE code=? ORDER BY date DESC LIMIT 1'
    ).get(pos.code) as any;
    const exitPrice = lastBar?.close ?? pos.entryPrice;
    closePos(pos, exitPrice, backEnd, '回测结束强平');
  }

  // ── 输出交易记录 ─────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  📋 逐笔交易记录');
  console.log(`${'─'.repeat(80)}`);
  console.log(
    `  ${'No'.padEnd(4)} ${'入场日'.padEnd(11)} ${'出场日'.padEnd(6)} ${'代码'.padEnd(10)} ${'名称'.padEnd(8)}` +
    ` ${'买价'.padStart(7)} ${'卖价'.padStart(7)} ${'股数'.padStart(6)}` +
    ` ${'净盈亏'.padStart(8)} ${'收益%'.padStart(7)} ${'持天'.padStart(4)} ${'资金余额'.padStart(10)} 原因`
  );
  console.log(`  ${'─'.repeat(124)}`);

  let winCount = 0, lossCount = 0, totalFee = 0;
  let peakCapital = INIT_CAPITAL, maxDrawdown = 0;
  let maxConsecLoss = 0, consecLoss = 0;
  let bigWins = 0, bigLosses = 0;

  for (const log of logs) {
    if (log.netPnl >= 0) { winCount++; consecLoss = 0; }
    else { lossCount++; consecLoss++; maxConsecLoss = Math.max(maxConsecLoss, consecLoss); }
    if (log.netPct >= 10) bigWins++;
    if (log.netPct <= -8) bigLosses++;

    totalFee += log.shares * log.entryPrice * (FEE_BUY + FEE_SELL);

    if (log.capital > peakCapital) peakCapital = log.capital;
    const dd = (peakCapital - log.capital) / peakCapital * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;

    const mark = log.netPnl >= 0 ? '▲' : '▼';
    const sign = log.netPnl >= 0 ? '+' : '';
    console.log(
      `  ${String(log.no).padStart(3)}. ${log.entryDate}~${log.exitDate.slice(5)}` +
      `  ${log.code}  ${log.name.padEnd(8)}` +
      `  ¥${log.entryPrice.toFixed(2).padStart(6)}→¥${log.exitPrice.toFixed(2).padStart(6)}` +
      `  ${String(log.shares).padStart(5)}股` +
      `  ${mark}${sign}${log.netPnl.toFixed(0).padStart(6)}` +
      `  ${(sign + log.netPct.toFixed(1) + '%').padStart(7)}` +
      `  ${String(log.holdDays).padStart(3)}天` +
      `  ¥${String(log.capital).padStart(8)}` +
      `  ${log.reason}`
    );
  }

  // ── 月度统计 ─────────────────────────────────────────────────────────────
  const monthMap = new Map<string, { pnl: number; win: number; lose: number }>();
  for (const log of logs) {
    const m = log.exitDate.slice(0, 7);
    if (!monthMap.has(m)) monthMap.set(m, { pnl: 0, win: 0, lose: 0 });
    const e = monthMap.get(m)!;
    e.pnl += log.netPnl;
    if (log.netPnl >= 0) e.win++; else e.lose++;
  }

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  📅 月度盈亏');
  console.log(`${'─'.repeat(80)}`);
  for (const [month, s] of [...monthMap.entries()].sort()) {
    const bar  = Math.abs(s.pnl) > 0
      ? (s.pnl >= 0 ? '█' : '▓').repeat(Math.min(20, Math.round(Math.abs(s.pnl) / 2000)))
      : '·';
    const sign = s.pnl >= 0 ? '+' : '';
    console.log(
      `  ${month}  ${sign}¥${s.pnl.toFixed(0).padStart(9)}  ${s.win}胜${s.lose}负  ${bar}`
    );
  }

  // ── 汇总 ─────────────────────────────────────────────────────────────────
  const finalCapital = Math.round(capital);
  const totalReturn  = (finalCapital - INIT_CAPITAL) / INIT_CAPITAL * 100;
  const totalTrades  = logs.length;
  const winRate      = totalTrades > 0 ? winCount / totalTrades * 100 : 0;
  const wins         = logs.filter(l => l.netPnl > 0);
  const losses       = logs.filter(l => l.netPnl < 0);
  const avgWin       = wins.length   > 0 ? wins.reduce((s, l) => s + l.netPnl, 0)   / wins.length   : 0;
  const avgLoss      = losses.length > 0 ? losses.reduce((s, l) => s + l.netPnl, 0) / losses.length : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : Infinity;

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  📊 回测统计汇总');
  console.log(`${'═'.repeat(80)}`);
  const tradingDays = allDates.length;
  console.log(`  回测区间：${backStart} ~ ${backEnd}（约${tradingDays}个交易日）`);
  console.log(`  初始资金：¥${INIT_CAPITAL.toLocaleString()}`);
  console.log(`  最终资金：¥${finalCapital.toLocaleString()}`);
  console.log(`  总收益：  ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%  ` +
              `(${totalReturn >= 0 ? '+' : ''}¥${(finalCapital - INIT_CAPITAL).toLocaleString()})`);
  console.log(`  年化收益：约 ${(totalReturn / tradingDays * 252).toFixed(1)}%（以252交易日/年估算）`);
  console.log();
  console.log(`  交易次数：${totalTrades} 笔`);
  console.log(`  胜率：    ${winRate.toFixed(1)}%（${winCount}胜 ${lossCount}负）`);
  console.log(`  平均盈利：+¥${avgWin.toFixed(0)}`);
  console.log(`  平均亏损：-¥${Math.abs(avgLoss).toFixed(0)}`);
  console.log(`  盈亏比：  ${isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}`);
  console.log(`  大赢(≥10%)：${bigWins} 笔  大亏(≤-8%)：${bigLosses} 笔`);
  console.log(`  最大连败：${maxConsecLoss} 笔`);
  console.log(`  总手续费：¥${totalFee.toFixed(0)}`);
  console.log(`  最大回撤：${maxDrawdown.toFixed(2)}%`);
  console.log(`\n  T+1 规则说明：`);
  console.log(`    买入当天（炸板或封板）均不能出，最早次日才可卖`);
  console.log(`    次日开盘跌>${Math.abs(STOP_OPEN_PCT*100)}% 时，开盘止损`);
  console.log(`    其余以「收盘未涨停即收盘出」为出场标准`);
  console.log(`${'═'.repeat(80)}\n`);

  db.close();
}

main();
