/**
 * 回封打板策略 — 后续连板数统计（近半年）
 *
 * 逻辑：
 *   1. 每个交易日扫描满足条件的2板候选（主板、市值50~150亿、换手<7%、量比<1.5）
 *   2. 检查是否属于主线板块（同行业涨停 ≥2 只）
 *   3. 次日（入场日）检查是否有回封机会：open < high_limit 且 high >= high_limit
 *   4. 有回封机会 → 继续追踪后续每天是否封板，统计最终到达的连板数
 *   5. 输出：封板率、最多几板、分布统计
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

const PARAMS = {
  maxTurnover2:  7.0,
  maxVolRatio2:  1.5,
  minCircMv:    50,
  maxCircMv:   150,
  minPrice:      4.0,
  maxPrice:     40.0,
  minSectorLU:   2,   // 主线板块：同行业涨停 ≥2 只
};

interface Record {
  scanDate: string;
  entryDate: string;
  code: string;
  name: string;
  industry: string;
  isLeader: boolean;
  boardsBefore: number;    // 入场前连板数（2板）
  resealResult: 'seal' | 'zhaban' | 'no_chance'; // 回封日结果
  openDrop: number;        // 回封日开盘折扣%
  maxBoards: number;       // 最终达到的最高连板数（从第1板算起）
  exitDay: number;         // 持有天数
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  // 支持命令行指定天数，默认200，传 400 约覆盖近1年
  const lookback = parseInt(process.argv[2] ?? '200', 10) + 10;
  const allDates: string[] = (db.prepare(
    `SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT ?`
  ).all(lookback) as any[]).map(r => r.date).reverse();

  const backStart = allDates[0];
  const backEnd   = allDates[allDates.length - 1];

  console.log(`\n${'═'.repeat(76)}`);
  console.log(`  📊 2进3 回封打板 → 后续连板数统计（近${process.argv[2] ?? 200}交易日）`);
  console.log(`  区间：${backStart} ~ ${backEnd}`);
  console.log(`  条件：主板 | 市值50~150亿 | 换手<7% | 量比<1.5 | 主线板块≥${PARAMS.minSectorLU}只涨停`);
  console.log(`${'═'.repeat(76)}`);

  const records: Record[] = [];

  for (let i = 5; i < allDates.length - 1; i++) {
    const scanDate  = allDates[i];
    const entryDate = allDates[i + 1]; // 次日
    const prev5     = allDates.slice(i - 5, i).reverse();

    // 统计 scanDate 各行业涨停数
    const sectorLUCount = new Map<string, number>();
    const allLU = db.prepare(`
      SELECT industry FROM prices
      WHERE date = ? AND high_limit > 0 AND close >= high_limit
        AND name NOT LIKE '%ST%' AND name NOT LIKE '%退%'
        AND market NOT IN ('ETF','INDEX')
        AND industry IS NOT NULL AND industry != ''
    `).all(scanDate) as any[];
    for (const r of allLU) {
      sectorLUCount.set(r.industry, (sectorLUCount.get(r.industry) ?? 0) + 1);
    }

    // 取当日主板涨停股
    const todayLU = db.prepare(`
      SELECT code, name, close, high_limit, turnover_rate, volume_ratio, circ_mv, industry
      FROM prices
      WHERE date = ?
        AND high_limit > 0 AND close >= high_limit
        AND name NOT LIKE '%ST%' AND name NOT LIKE '%退%'
        AND market NOT IN ('ETF','INDEX')
        AND (
          code LIKE '600%' OR code LIKE '601%' OR code LIKE '603%' OR code LIKE '605%'
          OR code LIKE '000%' OR code LIKE '001%' OR code LIKE '002%' OR code LIKE '003%'
        )
    `).all(scanDate) as any[];

    // 按行业分组，找候选
    const sectorCandidates = new Map<string, any[]>();

    for (const bar of todayLU) {
      const price   = bar.close;
      const circMv  = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const t2      = bar.turnover_rate ?? 0;
      const v2      = bar.volume_ratio  ?? 0;
      const ind     = bar.industry ?? '';

      if (price < PARAMS.minPrice || price > PARAMS.maxPrice) continue;
      if (circMv > 0 && (circMv < PARAMS.minCircMv || circMv > PARAMS.maxCircMv)) continue;
      if (t2 > 0 && t2 > PARAMS.maxTurnover2) continue;
      if (v2 > 0 && v2 > PARAMS.maxVolRatio2) continue;

      // 确认恰好2连板
      let boards = 0;
      for (const pd of prev5) {
        const pb = db.prepare(
          'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
        ).get(bar.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) boards++;
        else break;
      }
      if (boards !== 2) continue;

      // 主线板块过滤
      if (!ind || (sectorLUCount.get(ind) ?? 0) < PARAMS.minSectorLU) continue;

      if (!sectorCandidates.has(ind)) sectorCandidates.set(ind, []);
      sectorCandidates.get(ind)!.push({ ...bar, boards });
    }

    // 确定龙头（板数最多+分最高，这里用量比最小作为简化）
    for (const [ind, group] of sectorCandidates) {
      const sorted = [...group].sort((a, b) => {
        const va = a.volume_ratio ?? 99;
        const vb = b.volume_ratio ?? 99;
        return va - vb; // 量比越小越靠前
      });

      for (let gi = 0; gi < sorted.length; gi++) {
        const bar      = sorted[gi];
        const isLeader = gi === 0;

        // ── 次日入场检查 ─────────────────────────────────
        const d1 = db.prepare(
          'SELECT open, high, close, high_limit FROM prices WHERE code=? AND date=?'
        ).get(bar.code, entryDate) as any;

        if (!d1 || !d1.high_limit) continue;

        const isYiZi  = d1.open >= d1.high_limit * 0.999;
        const touched = d1.high >= d1.high_limit * 0.999;
        const sealed1 = d1.close >= d1.high_limit * 0.999;
        const openDrop = (d1.high_limit - d1.open) / d1.high_limit * 100;

        let resealResult: Record['resealResult'];
        if (isYiZi || !touched) {
          resealResult = 'no_chance';
        } else if (sealed1) {
          resealResult = 'seal';
        } else {
          resealResult = 'zhaban';
        }

        // ── 追踪后续连板数 ───────────────────────────────
        // 从第1板算起，总连板数
        let maxBoards = 2; // 已有2板
        let exitDay   = 1;

        if (resealResult === 'seal') {
          maxBoards = 3; // 回封封板 = 3板
          for (let d = i + 2; d < allDates.length; d++) {
            const nextBar = db.prepare(
              'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
            ).get(bar.code, allDates[d]) as any;
            if (!nextBar || !nextBar.high_limit) break;
            if (nextBar.close >= nextBar.high_limit * 0.999) {
              maxBoards++;
              exitDay++;
            } else {
              break;
            }
          }
        } else if (resealResult === 'zhaban') {
          maxBoards = 2; // 炸板，停留在2板水平
          exitDay   = 1;
        }

        records.push({
          scanDate, entryDate, code: bar.code, name: bar.name,
          industry: ind, isLeader,
          boardsBefore: 2, resealResult, openDrop, maxBoards, exitDay,
        });
      }
    }
  }

  // ── 汇总统计 ─────────────────────────────────────────────────────────────
  const withChance = records.filter(r => r.resealResult !== 'no_chance');
  const sealed     = records.filter(r => r.resealResult === 'seal');
  const zhaban     = records.filter(r => r.resealResult === 'zhaban');
  const noChance   = records.filter(r => r.resealResult === 'no_chance');
  const leaders    = withChance.filter(r => r.isLeader);
  const followers  = withChance.filter(r => !r.isLeader);

  console.log(`\n  总候选次数：${records.length} 次`);
  console.log(`  ├─ 无回封机会（一字板/未触封）：${noChance.length} 次 (${(noChance.length/records.length*100).toFixed(0)}%)`);
  console.log(`  ├─ 有回封机会合计：${withChance.length} 次`);
  console.log(`  │  ├─ 封板成功：${sealed.length} 次 (${(sealed.length/withChance.length*100).toFixed(0)}%)`);
  console.log(`  │  └─ 炸板：    ${zhaban.length} 次 (${(zhaban.length/withChance.length*100).toFixed(0)}%)`);

  // 连板数分布
  console.log(`\n${'─'.repeat(76)}`);
  console.log('  📈 封板成功后最终连板数分布');
  console.log(`${'─'.repeat(76)}`);
  const boardDist: Record<number, number> = {};
  for (const r of sealed) {
    boardDist[r.maxBoards] = (boardDist[r.maxBoards] ?? 0) + 1;
  }
  const maxBoard = Math.max(...Object.keys(boardDist).map(Number));
  for (let b = 3; b <= maxBoard; b++) {
    const cnt  = boardDist[b] ?? 0;
    const pct  = sealed.length > 0 ? (cnt / sealed.length * 100).toFixed(1) : '0';
    const bar2 = '█'.repeat(Math.round(cnt / sealed.length * 30));
    console.log(`  ${b}板：${String(cnt).padStart(3)} 次  ${(pct + '%').padStart(6)}  ${bar2}`);
  }
  const above5 = sealed.filter(r => r.maxBoards >= 5).length;
  console.log(`\n  ≥5板比例：${above5}/${sealed.length} = ${sealed.length > 0 ? (above5/sealed.length*100).toFixed(1) : 0}%`);
  console.log(`  最高连板：${maxBoard} 板`);

  // 龙头 vs 跟风对比
  if (leaders.length > 0 && followers.length > 0) {
    const lSeal = leaders.filter(r => r.resealResult === 'seal');
    const fSeal = followers.filter(r => r.resealResult === 'seal');
    const lRate = (lSeal.length / leaders.length * 100).toFixed(1);
    const fRate = (fSeal.length / followers.length * 100).toFixed(1);
    const lAvg  = lSeal.length > 0 ? (lSeal.reduce((s,r)=>s+r.maxBoards,0)/lSeal.length).toFixed(1) : '-';
    const fAvg  = fSeal.length > 0 ? (fSeal.reduce((s,r)=>s+r.maxBoards,0)/fSeal.length).toFixed(1) : '-';
    console.log(`\n${'─'.repeat(76)}`);
    console.log('  🏆 龙头 vs 跟风对比（有回封机会样本）');
    console.log(`${'─'.repeat(76)}`);
    console.log(`  板块龙头：${leaders.length} 次  封板率 ${lRate}%  封板后平均连板数 ${lAvg}`);
    console.log(`  板块跟风：${followers.length} 次  封板率 ${fRate}%  封板后平均连板数 ${fAvg}`);
  }

  // 逐笔明细（封板成功的）
  console.log(`\n${'─'.repeat(76)}`);
  console.log('  📋 封板成功逐笔明细（按最终连板数降序）');
  console.log(`${'─'.repeat(76)}`);
  console.log(`  ${'扫描日'.padEnd(12)} ${'入场日'.padEnd(12)} ${'代码'.padEnd(12)} ${'名称'.padEnd(10)} ${'行业'.padEnd(10)} ${'龙头'.padEnd(5)} ${'开盘折扣'.padEnd(9)} ${'最终板数'}`);
  const sortedSealed = [...sealed].sort((a,b) => b.maxBoards - a.maxBoards);
  for (const r of sortedSealed) {
    console.log(
      `  ${r.scanDate}  ${r.entryDate}  ${r.code}  ${r.name.padEnd(10)}` +
      `  ${r.industry.slice(0,8).padEnd(10)}  ${r.isLeader ? '👑' : '  '}` +
      `  -${r.openDrop.toFixed(1)}%`.padStart(9) +
      `  ${r.maxBoards}板`
    );
  }

  // 炸板明细（简略）
  if (zhaban.length > 0) {
    console.log(`\n${'─'.repeat(76)}`);
    console.log(`  💥 炸板明细（${zhaban.length} 次）`);
    console.log(`${'─'.repeat(76)}`);
    for (const r of zhaban) {
      console.log(
        `  ${r.entryDate}  ${r.code} ${r.name.padEnd(10)}  ${r.industry.slice(0,8).padEnd(10)}` +
        `  ${r.isLeader ? '👑龙头' : '  跟风'}  开盘折扣-${r.openDrop.toFixed(1)}%`
      );
    }
  }

  console.log(`\n${'═'.repeat(76)}\n`);
  db.close();
}

main();
