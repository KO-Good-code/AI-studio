/**
 * 策略召回率分析：近1年5板以上的股，有多少在2板时被策略识别
 *
 * 逻辑：
 *   1. 找出近1年所有达到 ≥5 连板的股票
 *   2. 回溯到每只股的「第2板」那天，检查是否满足策略条件
 *   3. 统计：识别率（召回率）、漏掉的原因
 */
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

const PARAMS = {
  maxTurnover2: 15.0,  // 换手上限15%
  maxVolRatio2:  2.0,
  minCircMv:     0,
  maxCircMv:   150,
  minPrice:     4.0,
  maxPrice:     40.0,
  minSectorLU:  2,
};

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  // 近365交易日
  const allDates: string[] = (db.prepare(
    `SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT 380`
  ).all() as any[]).map(r => r.date).reverse();

  const backStart = allDates[0];
  const backEnd   = allDates[allDates.length - 1];

  console.log(`\n${'═'.repeat(90)}`);
  console.log('  🔍 策略召回率分析（放宽版）：近1年5板以上的股，2板时策略是否识别');
  console.log(`  参数：换手<${PARAMS.maxTurnover2}% | 量比<${PARAMS.maxVolRatio2} | 市值${PARAMS.minCircMv}~${PARAMS.maxCircMv}亿 | 板块共振≥${PARAMS.minSectorLU}只`);
  console.log(`  区间：${backStart} ~ ${backEnd}`);
  console.log(`${'═'.repeat(90)}`);

  // Step1: 找出所有连续涨停的股，计算最高连板数
  // 方法：遍历每只股，计算最长连板段
  const stockDates = new Map<string, { date: string; isLimit: boolean; name: string; industry: string }[]>();

  // 取所有主板股的每日数据
  const rows = db.prepare(`
    SELECT code, name, date, close, high_limit, industry
    FROM prices
    WHERE date >= ? AND date <= ?
      AND market NOT IN ('ETF','INDEX')
      AND (
        code LIKE '600%' OR code LIKE '601%' OR code LIKE '603%' OR code LIKE '605%'
        OR code LIKE '000%' OR code LIKE '001%' OR code LIKE '002%' OR code LIKE '003%'
      )
      AND high_limit > 0
      AND name NOT LIKE '%ST%' AND name NOT LIKE '%退%'
    ORDER BY code, date
  `).all(backStart, backEnd) as any[];

  for (const r of rows) {
    if (!stockDates.has(r.code)) stockDates.set(r.code, []);
    stockDates.get(r.code)!.push({
      date: r.date,
      isLimit: r.close >= r.high_limit * 0.999,
      name: r.name,
      industry: r.industry ?? '',
    });
  }

  // Step2: 找出每只股的连板段，筛选 ≥5板
  interface Streak {
    code: string; name: string; industry: string;
    startDate: string; endDate: string;
    maxBoards: number;
    date2Board: string;  // 第2板那天
    price2Board: number;
    turnover2: number | null;
    volRatio2: number | null;
    circMv2: number | null;
  }

  const streaks: Streak[] = [];

  for (const [code, bars] of stockDates) {
    let i = 0;
    while (i < bars.length) {
      if (!bars[i].isLimit) { i++; continue; }
      // 找连板段
      let j = i;
      while (j < bars.length && bars[j].isLimit) j++;
      const len = j - i;
      if (len >= 5) {
        const date2Board = bars[i + 1]?.date;  // 第2板日期
        if (date2Board) {
          const d2 = db.prepare(
            'SELECT close, turnover_rate, volume_ratio, circ_mv FROM prices WHERE code=? AND date=?'
          ).get(code, date2Board) as any;
          streaks.push({
            code, name: bars[i].name, industry: bars[i].industry,
            startDate: bars[i].date, endDate: bars[j - 1].date,
            maxBoards: len,
            date2Board,
            price2Board:  d2?.close ?? 0,
            turnover2:    d2?.turnover_rate ?? null,
            volRatio2:    d2?.volume_ratio  ?? null,
            circMv2:      d2?.circ_mv       ?? null,
          });
        }
      }
      i = j;
    }
  }

  streaks.sort((a, b) => b.maxBoards - a.maxBoards || a.startDate.localeCompare(b.startDate));

  console.log(`\n  近1年主板 ≥5连板事件：${streaks.length} 个\n`);

  // Step3: 逐个检查2板时策略条件
  interface CheckResult {
    streak: Streak;
    captured: boolean;
    failReasons: string[];
    hasSectorLU: boolean;
    sectorLUCount: number;
  }

  const results: CheckResult[] = [];

  for (const s of streaks) {
    const failReasons: string[] = [];

    // 价格
    if (s.price2Board < PARAMS.minPrice) failReasons.push(`价格¥${s.price2Board.toFixed(2)}<${PARAMS.minPrice}`);
    if (s.price2Board > PARAMS.maxPrice) failReasons.push(`价格¥${s.price2Board.toFixed(2)}>${PARAMS.maxPrice}`);

    // 市值
    const circMvYi = s.circMv2 != null ? s.circMv2 / 10000 : 0;
    if (circMvYi > 0 && circMvYi < PARAMS.minCircMv) failReasons.push(`市值${circMvYi.toFixed(0)}亿<${PARAMS.minCircMv}亿`);
    if (circMvYi > 0 && circMvYi > PARAMS.maxCircMv) failReasons.push(`市值${circMvYi.toFixed(0)}亿>${PARAMS.maxCircMv}亿`);

    // 换手
    const t2 = s.turnover2 ?? 0;
    if (t2 > 0 && t2 > PARAMS.maxTurnover2) failReasons.push(`换手${t2.toFixed(1)}%>${PARAMS.maxTurnover2}%`);

    // 量比
    const v2 = s.volRatio2 ?? 0;
    if (v2 > 0 && v2 > PARAMS.maxVolRatio2) failReasons.push(`量比${v2.toFixed(2)}>${PARAMS.maxVolRatio2}`);

    // 主线板块：第2板那天同行业涨停数
    let sectorLUCount = 0;
    if (s.industry) {
      const res = db.prepare(`
        SELECT COUNT(*) as cnt FROM prices
        WHERE date = ? AND industry = ?
          AND high_limit > 0 AND close >= high_limit
          AND name NOT LIKE '%ST%' AND market NOT IN ('ETF','INDEX')
      `).get(s.date2Board, s.industry) as any;
      sectorLUCount = res?.cnt ?? 0;
    }
    const hasSectorLU = sectorLUCount >= PARAMS.minSectorLU;
    if (!hasSectorLU) failReasons.push(`板块共振不足(${s.industry}仅${sectorLUCount}只涨停)`);

    results.push({
      streak: s,
      captured: failReasons.length === 0,
      failReasons,
      hasSectorLU,
      sectorLUCount,
    });
  }

  // 输出明细
  const captured = results.filter(r => r.captured);
  const missed   = results.filter(r => !r.captured);

  console.log(`${'─'.repeat(90)}`);
  console.log(`  📋 逐个明细（按连板数降序）`);
  console.log(`${'─'.repeat(90)}`);
  console.log(
    `  ${'代码'.padEnd(12)} ${'名称'.padEnd(10)} ${'最高板'.padStart(5)} ${'起止时间'.padEnd(24)}` +
    ` ${'2板日'.padEnd(12)} ${'换手'.padStart(6)} ${'量比'.padStart(6)} ${'市值'.padStart(7)} ${'板块共振'.padStart(6)} 是否识别`
  );
  console.log(`  ${'─'.repeat(110)}`);

  for (const r of results) {
    const s = r.streak;
    const t2str = s.turnover2 != null ? s.turnover2.toFixed(1) + '%' : 'N/A';
    const v2str = s.volRatio2 != null ? s.volRatio2.toFixed(2) : 'N/A';
    const mvStr = s.circMv2   != null ? (s.circMv2 / 10000).toFixed(0) + '亿' : 'N/A';
    const secStr = `${s.industry.slice(0, 4)}(${r.sectorLUCount})`;
    const captureStr = r.captured
      ? '✅ 识别'
      : `❌ 漏选：${r.failReasons.join(' | ')}`;

    console.log(
      `  ${s.code}  ${s.name.padEnd(10)}` +
      `  ${String(s.maxBoards).padStart(3)}板` +
      `  ${s.startDate}~${s.endDate.slice(5)}` +
      `  ${s.date2Board}` +
      `  ${t2str.padStart(6)}` +
      `  ${v2str.padStart(6)}` +
      `  ${mvStr.padStart(7)}` +
      `  ${secStr.padEnd(10)}` +
      `  ${captureStr}`
    );
  }

  // 汇总
  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  📊 召回率汇总`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  ≥5板事件总数：${streaks.length} 个`);
  console.log(`  ✅ 策略识别：${captured.length} 个  召回率 ${(captured.length / streaks.length * 100).toFixed(1)}%`);
  console.log(`  ❌ 策略漏选：${missed.length} 个`);

  // 漏选原因统计
  const reasonCount = new Map<string, number>();
  for (const r of missed) {
    for (const reason of r.failReasons) {
      const key = reason.replace(/[\d.]+/g, 'N');  // 泛化数字
      reasonCount.set(key, (reasonCount.get(key) ?? 0) + 1);
    }
  }

  console.log(`\n  漏选原因分布（可重叠）：`);
  const sortedReasons = [...reasonCount.entries()].sort((a, b) => b[1] - a[1]);
  for (const [reason, cnt] of sortedReasons) {
    console.log(`    ${reason.padEnd(30)}：${cnt} 次`);
  }

  // 按板块共振单独统计
  const missedOnlySector = missed.filter(r =>
    r.failReasons.length === 1 && !r.hasSectorLU
  );
  const missedOnlyParams = missed.filter(r =>
    r.hasSectorLU && r.failReasons.some(f => !f.includes('板块'))
  );
  console.log(`\n  仅因板块共振不足漏选：${missedOnlySector.length} 个（放宽门槛可捕获）`);
  console.log(`  因参数条件漏选（市值/换手/量比/价格）：${missedOnlyParams.length} 个`);

  // 按板数分组召回率
  console.log(`\n  按最高板数分组召回率：`);
  const boardGroups: Record<string, { total: number; hit: number }> = {};
  for (const r of results) {
    const key = r.streak.maxBoards >= 8 ? '8板+' :
                r.streak.maxBoards >= 6 ? '6~7板' : `${r.streak.maxBoards}板`;
    if (!boardGroups[key]) boardGroups[key] = { total: 0, hit: 0 };
    boardGroups[key].total++;
    if (r.captured) boardGroups[key].hit++;
  }
  for (const [key, { total, hit }] of Object.entries(boardGroups)) {
    console.log(`    ${key.padEnd(8)}：${hit}/${total} 识别  (${(hit/total*100).toFixed(0)}%)`);
  }

  console.log(`${'═'.repeat(90)}\n`);
  db.close();
}

main();
