/**
 * 2进3 打板龙头策略 — 回测命中率
 *
 * 逻辑：
 *   对过去 N 天每个交易日，用相同的筛选条件选出「2连板」候选；
 *   然后往后追踪每只股票最终连板数，统计命中 3板/4板/5板以上的比例。
 *
 * 用法：
 *   npx tsx strategies/limit-up-board/backtest-accuracy.ts         # 默认回测过去30天
 *   npx tsx strategies/limit-up-board/backtest-accuracy.ts 60      # 回测过去60天
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

const PARAMS = {
  maxTurnoverRate: 7.0,
  maxVolumeRatio:  1.5,
  minCircMv:       20,
  maxCircMv:       150,
  minPrice:         4.0,
  maxPrice:        40.0,
  optimalMvMin:    20,
  optimalMvMax:    50,
  optimalTurnover:  5.5,
  optimalVol:       1.2,
};

interface BarRow {
  code: string;
  name: string;
  date: string;
  close: number;
  high_limit: number;
  turnover_rate: number | null;
  circ_mv: number | null;
  volume_ratio: number | null;
  industry: string;
}

interface TradeRecord {
  scanDate: string;          // 2板扫描日期
  code: string;
  name: string;
  industry: string;
  grade: string;             // A/B/C
  score: number;
  circMvYi: number;
  turnover: number;
  volRatio: number;
  price: number;
  startBoards: number;       // 扫描时的连板数（应为2）
  maxBoards: number;         // 最终最大连板数（含扫描日之前的板）
  nextDayResult: string;     // 次日结果：涨停/涨/跌/无数据
  isLeader: boolean;         // 是否板块龙头
  sectorCount: number;       // 同板块连板股数量
}

function calcScore(turnover: number, volRatio: number, circMvYi: number): { score: number; grade: string } {
  let score = 100;

  if (circMvYi > 0 && (circMvYi < PARAMS.minCircMv || circMvYi > PARAMS.maxCircMv)) {
    if (circMvYi > 200) return { score: 0, grade: 'X' };
    score -= 20;
  }

  if (turnover > 0) {
    if      (turnover > 12) score -= 40;
    else if (turnover > 9)  score -= 20;
    else if (turnover > 7)  score -= 10;
    else if (turnover <= PARAMS.optimalTurnover) score += 15;
  } else {
    score -= 5;
  }

  if (volRatio > 0) {
    if      (volRatio > 3)   score -= 30;
    else if (volRatio > 2)   score -= 15;
    else if (volRatio > PARAMS.maxVolumeRatio) score -= 8;
    else if (volRatio <= PARAMS.optimalVol)    score += 15;
  } else {
    score -= 5;
  }

  if (circMvYi >= PARAMS.optimalMvMin && circMvYi <= PARAMS.optimalMvMax) score += 10;

  const corePassed = (turnover === 0 || turnover < PARAMS.maxTurnoverRate)
    && (volRatio === 0 || volRatio < PARAMS.maxVolumeRatio);
  if (!corePassed) score = Math.min(score, 50);

  let grade: string;
  if      (score >= 110) grade = 'A+';
  else if (score >= 90)  grade = 'A';
  else if (score >= 70)  grade = 'B';
  else if (score >= 50)  grade = 'C';
  else                   grade = 'D';

  return { score, grade };
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const lookbackDays = parseInt(process.argv[2] ?? '30', 10);

  // 获取最新日期
  const { d: latestDate } = db.prepare(
    "SELECT MAX(date) as d FROM prices WHERE market NOT IN ('ETF','INDEX') AND market IS NOT NULL"
  ).get() as any;

  // 获取所有交易日（从最新往前）
  const allDates: string[] = (db.prepare(
    "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT ?"
  ).all(lookbackDays + 20) as any[]).map(r => r.date);

  // 扫描区间：回测日期（前 lookbackDays 交易日，留出后续追踪窗口）
  const scanDates = allDates.slice(5, lookbackDays + 5).reverse(); // 留出5天追踪

  console.log(`\n${'═'.repeat(76)}`);
  console.log(`  📊 2进3 打板龙头策略 — 回测命中率`);
  console.log(`  扫描区间：${scanDates[0]} ~ ${scanDates[scanDates.length - 1]}  共 ${scanDates.length} 个交易日`);
  console.log(`${'═'.repeat(76)}`);

  const records: TradeRecord[] = [];

  for (const scanDate of scanDates) {
    // 获取 scanDate 前 10 天（含当天）的交易日
    const ctx10: string[] = (db.prepare(
      "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') AND date <= ? ORDER BY date DESC LIMIT 10"
    ).all(scanDate) as any[]).map(r => r.date);

    // 获取 scanDate 后 15 天的交易日（追踪后续连板）
    const fwdDates: string[] = (db.prepare(
      "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') AND date > ? ORDER BY date ASC LIMIT 15"
    ).all(scanDate) as any[]).map(r => r.date);

    // 今日涨停股
    const todayLimitUp = db.prepare(`
      SELECT p.code, p.name, p.date, p.close, p.high_limit,
             p.turnover_rate, p.circ_mv, p.volume_ratio, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0
        AND p.close >= p.high_limit
        AND p.name NOT LIKE '%ST%'
        AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
        AND (
          p.code LIKE '600%' OR p.code LIKE '601%'
          OR p.code LIKE '603%' OR p.code LIKE '605%'
          OR p.code LIKE '000%' OR p.code LIKE '001%'
          OR p.code LIKE '002%' OR p.code LIKE '003%'
        )
    `).all(scanDate) as BarRow[];

    for (const bar of todayLimitUp) {
      const price     = bar.close;
      const circMvYi  = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const turnover  = bar.turnover_rate ?? 0;
      const volRatio  = bar.volume_ratio  ?? 0;

      // 硬性过滤
      if (price < PARAMS.minPrice || price > PARAMS.maxPrice) continue;
      if (circMvYi > 200) continue;

      // 往前追溯连板（从 scanDate 开始的连板数）
      let startBoards = 1;
      for (let i = 1; i < ctx10.length; i++) {
        const prevBar = db.prepare(
          'SELECT close, high_limit FROM prices WHERE code = ? AND date = ?'
        ).get(bar.code, ctx10[i]) as { close: number; high_limit: number } | undefined;
        if (prevBar && prevBar.high_limit > 0 && prevBar.close >= prevBar.high_limit) {
          startBoards++;
        } else {
          break;
        }
      }

      // 只关心恰好2连板的
      if (startBoards !== 2) continue;

      const { score, grade } = calcScore(turnover, volRatio, circMvYi);
      if (grade === 'X') continue;

      // ── 往后追踪连板 ──
      let maxBoards = startBoards;
      let nextDayResult = '无数据';
      let consecutiveAfter = 0;

      for (let fi = 0; fi < fwdDates.length; fi++) {
        const fwdDate = fwdDates[fi];
        const fBar = db.prepare(
          'SELECT close, high_limit, prev_close FROM prices WHERE code = ? AND date = ?'
        ).get(bar.code, fwdDate) as { close: number; high_limit: number; prev_close: number } | undefined;

        if (!fBar) break;

        if (fi === 0) {
          // 次日结果
          if (fBar.high_limit > 0 && fBar.close >= fBar.high_limit) {
            nextDayResult = '涨停(3板)';
          } else if (fBar.prev_close > 0) {
            const pct = (fBar.close - fBar.prev_close) / fBar.prev_close * 100;
            if (pct >= 3) nextDayResult = `涨${pct.toFixed(1)}%`;
            else if (pct < 0) nextDayResult = `跌${pct.toFixed(1)}%`;
            else nextDayResult = `平${pct.toFixed(1)}%`;
          }
        }

        if (fBar.high_limit > 0 && fBar.close >= fBar.high_limit) {
          consecutiveAfter++;
          maxBoards = startBoards + consecutiveAfter;
        } else {
          break;
        }
      }

      records.push({
        scanDate,
        code: bar.code,
        name: bar.name,
        industry: bar.industry || '未知',
        grade,
        score,
        circMvYi,
        turnover,
        volRatio,
        price,
        startBoards,
        maxBoards,
        nextDayResult,
        isLeader: false,   // 在下面按日期分组后更新
        sectorCount: 0,
      });
    }

    // 按行业分组，标记当日板块龙头
    const sectorMap = new Map<string, TradeRecord[]>();
    const dayRecs = records.filter(r => r.scanDate === scanDate);
    for (const r of dayRecs) {
      if (!sectorMap.has(r.industry)) sectorMap.set(r.industry, []);
      sectorMap.get(r.industry)!.push(r);
    }
    for (const [, group] of sectorMap) {
      for (const r of group) r.sectorCount = group.length;
      if (group.length >= 2) {
        const sorted = [...group].sort((a, b) =>
          b.startBoards !== a.startBoards ? b.startBoards - a.startBoards : b.score - a.score
        );
        sorted[0].isLeader = true;
      }
    }
  }

  // ── 统计分析 ─────────────────────────────────────────────────────────────
  console.log(`\n  总计扫描到 2连板候选：${records.length} 条`);

  const gradeGroups: Record<string, TradeRecord[]> = { 'A+': [], 'A': [], 'B': [], 'C': [], 'D': [] };
  for (const r of records) {
    gradeGroups[r.grade]?.push(r);
  }

  const printStats = (label: string, recs: TradeRecord[]) => {
    if (recs.length === 0) return;
    const hit3  = recs.filter(r => r.maxBoards >= 3).length;
    const hit4  = recs.filter(r => r.maxBoards >= 4).length;
    const hit5  = recs.filter(r => r.maxBoards >= 5).length;
    const hit6p = recs.filter(r => r.maxBoards >= 6).length;
    const r3  = (hit3  / recs.length * 100).toFixed(1);
    const r4  = (hit4  / recs.length * 100).toFixed(1);
    const r5  = (hit5  / recs.length * 100).toFixed(1);
    const r6p = (hit6p / recs.length * 100).toFixed(1);
    console.log(`  ${label.padEnd(16)} 共${String(recs.length).padStart(4)}只  ` +
      `→3板:${String(hit3).padStart(3)}(${r3}%)  ` +
      `→4板:${String(hit4).padStart(3)}(${r4}%)  ` +
      `→5板:${String(hit5).padStart(3)}(${r5}%)  ` +
      `→6板+:${String(hit6p).padStart(3)}(${r6p}%)`);
  };

  console.log(`\n${'─'.repeat(76)}`);
  console.log('  按评级 & 板块龙头分组统计（次板成功=连板数≥3）');
  console.log(`${'─'.repeat(76)}`);

  const leaderRecs    = records.filter(r => r.isLeader);
  const nonLeaderRecs = records.filter(r => !r.isLeader && r.sectorCount >= 2);
  const soloRecs      = records.filter(r => r.sectorCount < 2);

  printStats('★ 板块龙头',    leaderRecs);
  printStats('  板块非龙头',  nonLeaderRecs);
  printStats('  无共振个股',  soloRecs);
  console.log(`  ${'·'.repeat(72)}`);
  printStats('A+级',          gradeGroups['A+']);
  printStats('A级',           gradeGroups['A']);
  printStats('A+A合计',       [...gradeGroups['A+'], ...gradeGroups['A']]);
  printStats('C级',           gradeGroups['C']);
  printStats('全部',          records);

  // ── 5板以上明细 ─────────────────────────────────────────────────────────
  const hit5List = records.filter(r => r.maxBoards >= 5).sort((a, b) => b.maxBoards - a.maxBoards);
  if (hit5List.length > 0) {
    console.log(`\n${'─'.repeat(76)}`);
    console.log(`  🔥 最终达到5板以上的候选（共 ${hit5List.length} 只）`);
    console.log(`${'─'.repeat(76)}`);
    console.log('  扫描日       代码      名称          评级  最高板  行业');
    hit5List.forEach(r => {
      console.log(
        `  ${r.scanDate}  ${r.code}  ${r.name.padEnd(8)}  ${r.grade.padEnd(4)}  ${r.maxBoards}板  ${r.industry}`
      );
    });
  }

  // ── 次日涨停命中率（2→3 次日即封板）────────────────────────────────────
  console.log(`\n${'─'.repeat(76)}`);
  console.log('  次日即封涨停（2→3直接打板成功）');
  console.log(`${'─'.repeat(76)}`);
  const nextHit = records.filter(r => r.nextDayResult.includes('涨停'));
  console.log(`  次日直接封板：${nextHit.length}/${records.length} = ${(nextHit.length/records.length*100).toFixed(1)}%`);
  const aRecs = [...gradeGroups['A+'], ...gradeGroups['A']];
  const aNextHit = aRecs.filter(r => r.nextDayResult.includes('涨停'));
  if (aRecs.length > 0) {
    console.log(`  A级次日直接封板：${aNextHit.length}/${aRecs.length} = ${(aNextHit.length/aRecs.length*100).toFixed(1)}%`);
  }

  // ── 每日明细 ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(76)}`);
  console.log('  逐条明细（含次日结果）');
  console.log(`${'─'.repeat(76)}`);
  console.log(
    '  扫描日       代码      名称          评级  换手   量比  市值   最高板  次日结果'
  );
  const sortedRecords = records.sort((a, b) => {
    if (a.scanDate !== b.scanDate) return a.scanDate.localeCompare(b.scanDate);
    return b.score - a.score;
  });
  for (const r of sortedRecords) {
    const tr  = r.turnover > 0  ? `${r.turnover.toFixed(1)}%` : ' N/A';
    const vr  = r.volRatio > 0  ? r.volRatio.toFixed(2) : ' N/A';
    const mv  = r.circMvYi > 0  ? `${r.circMvYi.toFixed(0)}亿` : ' N/A';
    const boardMark = r.maxBoards >= 5 ? ` 🔥${r.maxBoards}板` : ` ${r.maxBoards}板`;
    const leaderMark = r.isLeader ? '👑' : r.sectorCount >= 2 ? '📌' : '  ';
    console.log(
      `  ${r.scanDate}  ${r.code}  ${r.name.padEnd(8)}  ${r.grade.padEnd(4)}` +
      `  ${tr.padStart(6)}  ${vr.padStart(5)}  ${mv.padStart(5)}` +
      `  ${boardMark.padStart(6)}  ${leaderMark} ${r.nextDayResult}`
    );
  }

  console.log(`\n${'═'.repeat(76)}\n`);
  db.close();
}

main();
