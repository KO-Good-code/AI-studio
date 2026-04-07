/**
 * 3进4 成功因素分析
 *
 * 逻辑：
 *   找出所有「恰好3连板」的时间点，分成两组：
 *     - 成功组：第4天也涨停（3→4成功）
 *     - 失败组：第4天未涨停（止步3板）
 *   对比两组在「第3板当天」的各项指标：
 *     换手率、量比、市值、股价、所在行业、是否板块共振、前3板平均换手趋势
 *
 * 用法：
 *   npx tsx strategies/limit-up-board/analyze-3to4.ts         # 默认过去1年
 *   npx tsx strategies/limit-up-board/analyze-3to4.ts 180     # 过去180天
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

interface BarRow {
  code: string;
  name: string;
  date: string;
  close: number;
  high_limit: number;
  prev_close: number;
  turnover_rate: number | null;
  circ_mv: number | null;
  volume_ratio: number | null;
  industry: string;
}

interface Sample {
  code: string;
  name: string;
  date3: string;        // 第3板日期
  success: boolean;     // 是否成功打到4板
  turnover3: number;    // 第3板换手率
  volRatio3: number;    // 第3板量比
  circMv: number;       // 流通市值（亿）
  price3: number;       // 第3板收盘价
  industry: string;
  sectorCount: number;  // 当日同行业连板股数量（共振程度）
  // 换手趋势
  turnover1: number;    // 第1板换手
  turnover2: number;    // 第2板换手
  // 量比趋势
  volRatio1: number;
  volRatio2: number;
  // 涨停后开板情况（第3板开板次数）
  openBreaks3: number;  // 第3板当天开板次数（0=一字板）
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function pct(arr: number[], threshold: number, above = true): string {
  if (arr.length === 0) return 'N/A';
  const cnt = arr.filter(v => above ? v >= threshold : v < threshold).length;
  return `${(cnt / arr.length * 100).toFixed(1)}%`;
}

function printCompare(label: string, success: number[], fail: number[], unit = '') {
  const smed = median(success);
  const fmed = median(fail);
  const diff = smed - fmed;
  const arrow = Math.abs(diff) < 0.1 ? '≈' : diff > 0 ? '↑' : '↓';
  console.log(
    `  ${label.padEnd(18)}` +
    `  成功 中位:${smed.toFixed(2)}${unit.padEnd(2)}  平均:${avg(success).toFixed(2)}${unit}` +
    `  |  失败 中位:${fmed.toFixed(2)}${unit.padEnd(2)}  平均:${avg(fail).toFixed(2)}${unit}` +
    `  ${arrow}`
  );
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const lookbackDays = parseInt(process.argv[2] ?? '252', 10);

  const { d: latestDate } = db.prepare(
    "SELECT MAX(date) as d FROM prices WHERE market NOT IN ('ETF','INDEX') AND market IS NOT NULL"
  ).get() as any;

  // 获取回测区间内的所有交易日
  const allDates: string[] = (db.prepare(
    "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT ?"
  ).all(lookbackDays + 10) as any[]).map(r => r.date).reverse();

  const dateSet = new Set(allDates);
  const dateIndex = new Map(allDates.map((d, i) => [d, i]));

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  📊 3进4 成功因素分析`);
  console.log(`  分析区间：${allDates[0]} ~ ${allDates[allDates.length - 1]}  共 ${allDates.length} 个交易日`);
  console.log(`${'═'.repeat(80)}`);

  const samples: Sample[] = [];

  // 遍历所有日期，找「恰好3连板」的股票
  for (let i = 5; i < allDates.length - 1; i++) {
    const date3 = allDates[i];
    const nextDate = allDates[i + 1];
    const prevDates = allDates.slice(Math.max(0, i - 9), i).reverse(); // 前9天

    // 当日涨停股
    const todayLU = db.prepare(`
      SELECT p.code, p.name, p.date, p.close, p.high_limit, p.prev_close,
             p.turnover_rate, p.circ_mv, p.volume_ratio, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0
        AND p.close >= p.high_limit
        AND p.name NOT LIKE '%ST%'
        AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
    `).all(date3) as BarRow[];

    // 同行业连板数统计（当日）
    const sectorCountMap = new Map<string, number>();

    for (const bar of todayLU) {
      // 向前追溯连板数
      let boards = 1;
      let d1Bar: any = null, d2Bar: any = null;

      for (let k = 0; k < prevDates.length && boards <= 10; k++) {
        const pd = prevDates[k];
        const pb = db.prepare(
          'SELECT close, high_limit, turnover_rate, volume_ratio FROM prices WHERE code = ? AND date = ?'
        ).get(bar.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) {
          boards++;
          if (boards === 2) d2Bar = pb;
          if (boards === 3) d1Bar = pb;  // 第1板（boards最大时最早）
        } else {
          break;
        }
      }

      if (boards !== 3) continue; // 只分析恰好3连板

      // 次日结果
      const nextBar = db.prepare(
        'SELECT close, high_limit FROM prices WHERE code = ? AND date = ?'
      ).get(bar.code, nextDate) as { close: number; high_limit: number } | undefined;

      if (!nextBar) continue;
      const success = nextBar.high_limit > 0 && nextBar.close >= nextBar.high_limit;

      // 同行业当日连板数量（板块共振）
      const ind = bar.industry || '未知';
      if (!sectorCountMap.has(ind)) {
        const cnt = (db.prepare(`
          SELECT COUNT(*) as c FROM (
            SELECT DISTINCT p.code FROM prices p
            WHERE p.date = ? AND p.high_limit > 0 AND p.close >= p.high_limit
              AND p.industry = ? AND p.market NOT IN ('ETF','INDEX')
          )
        `).get(date3, ind) as any).c;
        sectorCountMap.set(ind, cnt);
      }

      const circMv = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
      const t3 = bar.turnover_rate ?? 0;
      const v3 = bar.volume_ratio  ?? 0;
      const t2 = d2Bar?.turnover_rate ?? 0;
      const v2 = d2Bar?.volume_ratio  ?? 0;
      const t1 = d1Bar?.turnover_rate ?? 0;
      const v1 = d1Bar?.volume_ratio  ?? 0;

      samples.push({
        code: bar.code,
        name: bar.name,
        date3,
        success,
        turnover3: t3,
        volRatio3: v3,
        circMv,
        price3: bar.close,
        industry: ind,
        sectorCount: sectorCountMap.get(ind) ?? 1,
        turnover1: t1,
        turnover2: t2,
        volRatio1: v1,
        volRatio2: v2,
        openBreaks3: 0, // 简化：不分析开板次数
      });
    }
  }

  const successList = samples.filter(s => s.success);
  const failList    = samples.filter(s => !s.success);

  console.log(`\n  共找到3连板样本：${samples.length} 条`);
  console.log(`  → 3进4成功：${successList.length} 条 (${(successList.length / samples.length * 100).toFixed(1)}%)`);
  console.log(`  → 止步3板：${failList.length} 条 (${(failList.length / samples.length * 100).toFixed(1)}%)`);

  // ── 核心指标对比 ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  核心指标对比（第3板当天）');
  console.log(`${'─'.repeat(80)}`);

  const sT3 = successList.filter(s => s.turnover3 > 0).map(s => s.turnover3);
  const fT3 = failList.filter(s => s.turnover3 > 0).map(s => s.turnover3);
  const sV3 = successList.filter(s => s.volRatio3 > 0).map(s => s.volRatio3);
  const fV3 = failList.filter(s => s.volRatio3 > 0).map(s => s.volRatio3);
  const sMv = successList.filter(s => s.circMv > 0).map(s => s.circMv);
  const fMv = failList.filter(s => s.circMv > 0).map(s => s.circMv);
  const sP3 = successList.map(s => s.price3);
  const fP3 = failList.map(s => s.price3);

  printCompare('第3板换手率', sT3, fT3, '%');
  printCompare('第3板量比',   sV3, fV3);
  printCompare('流通市值',    sMv, fMv, '亿');
  printCompare('第3板收盘价', sP3, fP3, '元');

  // ── 换手趋势对比 ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  连板过程换手趋势（1板→2板→3板）');
  console.log(`${'─'.repeat(80)}`);

  const sT1 = successList.filter(s => s.turnover1 > 0).map(s => s.turnover1);
  const fT1 = failList.filter(s => s.turnover1 > 0).map(s => s.turnover1);
  const sT2 = successList.filter(s => s.turnover2 > 0).map(s => s.turnover2);
  const fT2 = failList.filter(s => s.turnover2 > 0).map(s => s.turnover2);

  printCompare('第1板换手率', sT1, fT1, '%');
  printCompare('第2板换手率', sT2, fT2, '%');
  printCompare('第3板换手率', sT3, fT3, '%');

  const sV1 = successList.filter(s => s.volRatio1 > 0).map(s => s.volRatio1);
  const fV1 = failList.filter(s => s.volRatio1 > 0).map(s => s.volRatio1);
  const sV2 = successList.filter(s => s.volRatio2 > 0).map(s => s.volRatio2);
  const fV2 = failList.filter(s => s.volRatio2 > 0).map(s => s.volRatio2);

  console.log();
  printCompare('第1板量比', sV1, fV1);
  printCompare('第2板量比', sV2, fV2);
  printCompare('第3板量比', sV3, fV3);

  // ── 板块共振效果 ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  板块共振对3进4的影响');
  console.log(`${'─'.repeat(80)}`);

  for (const threshold of [2, 3, 4]) {
    const sWith = successList.filter(s => s.sectorCount >= threshold).length;
    const sTotal = samples.filter(s => s.sectorCount >= threshold).length;
    const fWith = failList.filter(s => s.sectorCount >= threshold).length;
    const sRate = sTotal > 0 ? (sWith / sTotal * 100).toFixed(1) : 'N/A';
    const solo = samples.filter(s => s.sectorCount < threshold);
    const soloSuccess = solo.filter(s => s.success).length;
    const soloRate = solo.length > 0 ? (soloSuccess / solo.length * 100).toFixed(1) : 'N/A';
    console.log(
      `  同板块≥${threshold}只连板时：` +
      `共振样本${sTotal}只  3进4成功率 ${sRate}%  |  非共振样本${solo.length}只  成功率 ${soloRate}%`
    );
  }

  // ── 换手率区间分布 ────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  第3板换手率区间 vs 3进4成功率');
  console.log(`${'─'.repeat(80)}`);

  const ranges = [
    [0, 3], [3, 5], [5, 7], [7, 10], [10, 15], [15, 100]
  ];
  console.log('  换手区间       样本数   成功数   成功率');
  for (const [lo, hi] of ranges) {
    const group = samples.filter(s => s.turnover3 > 0 && s.turnover3 >= lo && s.turnover3 < hi);
    if (group.length === 0) continue;
    const succ = group.filter(s => s.success).length;
    const rate = (succ / group.length * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(succ / group.length * 20));
    console.log(
      `  ${`${lo}%~${hi}%`.padEnd(14)} ${String(group.length).padStart(5)}只` +
      `  ${String(succ).padStart(5)}只   ${rate.padStart(5)}%  ${bar}`
    );
  }

  // ── 量比区间分布 ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  第3板量比区间 vs 3进4成功率');
  console.log(`${'─'.repeat(80)}`);

  const vRanges = [
    [0, 0.5], [0.5, 1.0], [1.0, 1.5], [1.5, 2.0], [2.0, 3.0], [3.0, 99]
  ];
  console.log('  量比区间       样本数   成功数   成功率');
  for (const [lo, hi] of vRanges) {
    const group = samples.filter(s => s.volRatio3 > 0 && s.volRatio3 >= lo && s.volRatio3 < hi);
    if (group.length === 0) continue;
    const succ = group.filter(s => s.success).length;
    const rate = (succ / group.length * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(succ / group.length * 20));
    console.log(
      `  ${`${lo}~${hi}`.padEnd(14)} ${String(group.length).padStart(5)}只` +
      `  ${String(succ).padStart(5)}只   ${rate.padStart(5)}%  ${bar}`
    );
  }

  // ── 市值区间分布 ──────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  流通市值区间 vs 3进4成功率');
  console.log(`${'─'.repeat(80)}`);

  const mvRanges = [
    [0, 20], [20, 50], [50, 80], [80, 120], [120, 200], [200, 9999]
  ];
  console.log('  市值区间       样本数   成功数   成功率');
  for (const [lo, hi] of mvRanges) {
    const group = samples.filter(s => s.circMv > 0 && s.circMv >= lo && s.circMv < hi);
    if (group.length === 0) continue;
    const succ = group.filter(s => s.success).length;
    const rate = (succ / group.length * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(succ / group.length * 20));
    console.log(
      `  ${`${lo}~${hi}亿`.padEnd(14)} ${String(group.length).padStart(5)}只` +
      `  ${String(succ).padStart(5)}只   ${rate.padStart(5)}%  ${bar}`
    );
  }

  // ── 行业分布 ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  行业3进4成功率排行（样本≥5只）');
  console.log(`${'─'.repeat(80)}`);

  const industryMap = new Map<string, { total: number; success: number }>();
  for (const s of samples) {
    if (!industryMap.has(s.industry)) industryMap.set(s.industry, { total: 0, success: 0 });
    const entry = industryMap.get(s.industry)!;
    entry.total++;
    if (s.success) entry.success++;
  }

  const sortedIndustries = [...industryMap.entries()]
    .filter(([, v]) => v.total >= 5)
    .sort((a, b) => b[1].success / b[1].total - a[1].success / a[1].total);

  sortedIndustries.slice(0, 15).forEach(([ind, v]) => {
    const rate = (v.success / v.total * 100).toFixed(1);
    const bar  = '█'.repeat(Math.round(v.success / v.total * 20));
    console.log(
      `  ${ind.padEnd(10)} ${String(v.total).padStart(4)}只  成功${String(v.success).padStart(3)}只  ${rate.padStart(5)}%  ${bar}`
    );
  });

  // ── 综合结论 ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  💡 3进4成功的核心规律总结');
  console.log(`${'═'.repeat(80)}`);

  const bestTurnoverRange = ranges
    .map(([lo, hi]) => {
      const g = samples.filter(s => s.turnover3 > 0 && s.turnover3 >= lo && s.turnover3 < hi);
      return { lo, hi, rate: g.length > 0 ? g.filter(s => s.success).length / g.length : 0, n: g.length };
    })
    .filter(x => x.n >= 5)
    .sort((a, b) => b.rate - a.rate)[0];

  const bestVolRange = vRanges
    .map(([lo, hi]) => {
      const g = samples.filter(s => s.volRatio3 > 0 && s.volRatio3 >= lo && s.volRatio3 < hi);
      return { lo, hi, rate: g.length > 0 ? g.filter(s => s.success).length / g.length : 0, n: g.length };
    })
    .filter(x => x.n >= 5)
    .sort((a, b) => b.rate - a.rate)[0];

  const overallRate = (successList.length / samples.length * 100).toFixed(1);

  console.log(`\n  全局3进4成功率基准：${overallRate}%`);
  if (bestTurnoverRange) {
    console.log(`  ✅ 换手率 ${bestTurnoverRange.lo}%~${bestTurnoverRange.hi}% 时成功率最高：${(bestTurnoverRange.rate * 100).toFixed(1)}%（样本${bestTurnoverRange.n}只）`);
  }
  if (bestVolRange) {
    console.log(`  ✅ 量比 ${bestVolRange.lo}~${bestVolRange.hi} 时成功率最高：${(bestVolRange.rate * 100).toFixed(1)}%（样本${bestVolRange.n}只）`);
  }

  const sMedianT = median(sT3);
  const fMedianT = median(fT3);
  const sMedianV = median(sV3);
  const fMedianV = median(fV3);
  const sMedianM = median(sMv);
  const fMedianM = median(fMv);

  console.log(`\n  成功组 vs 失败组 关键差异：`);
  console.log(`  换手率：成功中位 ${sMedianT.toFixed(1)}%  vs  失败中位 ${fMedianT.toFixed(1)}%  → ${sMedianT < fMedianT ? '✅ 成功组换手更低（筹码更稳定）' : '⚠️ 差异不显著'}`);
  console.log(`  量  比：成功中位 ${sMedianV.toFixed(2)}    vs  失败中位 ${fMedianV.toFixed(2)}    → ${sMedianV < fMedianV ? '✅ 成功组量比更低（缩量封板）' : '⚠️ 差异不显著'}`);
  console.log(`  市  值：成功中位 ${sMedianM.toFixed(0)}亿  vs  失败中位 ${fMedianM.toFixed(0)}亿  → ${sMedianM < fMedianM ? '✅ 成功组市值更小（弹性更大）' : '大市值也能成功'}`);

  const resonanceSuccess2 = samples.filter(s => s.sectorCount >= 2 && s.success).length;
  const resonanceTotal2   = samples.filter(s => s.sectorCount >= 2).length;
  const soloSuccess2      = samples.filter(s => s.sectorCount < 2 && s.success).length;
  const soloTotal2        = samples.filter(s => s.sectorCount < 2).length;
  if (resonanceTotal2 > 0 && soloTotal2 > 0) {
    const rRes = (resonanceSuccess2 / resonanceTotal2 * 100).toFixed(1);
    const rSolo = (soloSuccess2 / soloTotal2 * 100).toFixed(1);
    console.log(`  板块共振：共振时 ${rRes}%  vs  无共振 ${rSolo}%  → ${parseFloat(rRes) > parseFloat(rSolo) ? '✅ 板块共振显著提升成功率' : '⚠️ 共振效果不明显'}`);
  }

  console.log(`\n${'═'.repeat(80)}\n`);
  db.close();
}

main();
