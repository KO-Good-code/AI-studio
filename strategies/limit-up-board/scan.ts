/**
 * 2进3 回封打板 选股扫描（优化版）
 *
 * 策略核心：
 *   今日扫描 ≥2 连板主板股，标记明日「回封打板」候选
 *
 * 参数依据（近1年回测，108次样本）：
 *   换手<15% + 量比<2 + 无市值下限 + 板块共振≥2只
 *   → 封板率 63.0%，炸板率 37.0%，≥5板召回率 33%
 *
 * 明日入场条件（全部满足才操作）：
 *   ① 今日换手率 < 15%（数据验证最优阈值）
 *   ② 今日量比 < 2.0
 *   ③ 所在板块为主线（同行业涨停股 ≥2 只）
 *   ④ 开盘低于涨停价（非一字板，有参与机会）
 *   ⑤ 盘中触碰涨停价（回封确认），以涨停价挂单买入
 *
 * 出场纪律（T+1，基于回测最优策略）：
 *   【4板日（T+1第一个可卖日）】
 *   - 开盘跌幅 > 8% → 开盘立刻止损
 *   - 开盘未封板（开盘价 < 涨停价）→ 开盘直接卖出，不等盘中
 *   - 开盘已封板（竞价封/一字）→ 继续持有，盘中观察
 *   【4板及后续持仓日】
 *   - 盘中触碰涨停价后回落（炸板）→ 涨停价回调3%时卖出
 *   - 当日未触及涨停价 → 收盘卖出
 *   - 连续封板则持有，最多持 7 天
 *
 * 用法：
 *   npx tsx strategies/limit-up-board/scan.ts            # 扫描最新日
 *   npx tsx strategies/limit-up-board/scan.ts 2026-04-02 # 指定日期
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

// ─── 策略参数（近1年回测优化版）────────────────────────────────────────────
const PARAMS = {
  // ── 今日2板筛选条件 ──────────────────────────────────────
  maxTurnoverRate: 15.0,   // 换手率上限（回测最优：<15%封板率63%）
  maxVolumeRatio:   2.0,   // 量比上限（>2放量异常，炸板率升高）
  minCircMv:         0,    // 流通市值下限（无限制：去掉下限封板率不变）
  maxCircMv:       150,    // 流通市值上限（亿）：>150亿弹性差
  minPrice:          4.0,  // 股价下限
  maxPrice:         40.0,  // 股价上限
  minBoards:         2,    // 最小连板数

  // ── 主线板块判断 ─────────────────────────────────────────
  sectorResonance:   2,    // 同行业涨停数 ≥2 才算主线（去掉后炸板率+4%）

  // ── 评分权重参数 ─────────────────────────────────────────
  optimalMvMax:    100,    // 最优市值上限（50~100亿弹性最佳）
  optimalTurnover:  5.0,   // 换手率优秀线（低换手缩量最佳）
  optimalVol:       1.0,   // 量比优秀线（缩量封板最稳）

  // ── 明日入场判断（提示用，需盘中人工确认）───────────────
  entryOpenDropMin: 0.00,  // 任意低开均可（只要非一字板）
  entryOpenDropMax: 0.08,  // 低开>8%封板率40%，谨慎
  entryMaxTurnover: 15.0,  // 与筛选条件一致
};

interface BarRow {
  code: string;
  name: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prev_close: number;
  high_limit: number;
  low_limit: number;
  volume: number;
  turnover_rate: number | null;
  circ_mv: number | null;
  volume_ratio: number | null;
  industry: string;
  quote_rate: number | null;
}

interface Candidate {
  code: string;
  name: string;
  industry: string;
  boards: number;
  todayBar: BarRow;
  circMvYi: number;
  score: number;
  grade: string;
  tips: string[];
  isLeader: boolean;       // 是否板块龙头
  sectorCount: number;     // 同板块连板股数量
}

// ─── 评分计算 ────────────────────────────────────────────────────────────────
function calcScore(
  turnover: number,
  volRatio: number,
  circMvYi: number,
  boards: number,
): { score: number; grade: string; tips: string[] } {
  let score = 100;
  const tips: string[] = [];

  if (circMvYi > 200) return { score: -1, grade: 'X', tips: [] };
  if (circMvYi > PARAMS.maxCircMv) {
    score -= 20; tips.push(`市值${circMvYi.toFixed(0)}亿偏大（弹性差）`);
  }

  if (turnover > 0) {
    if      (turnover > 20)  { score -= 50; tips.push(`⚠️ 换手${turnover.toFixed(1)}%极高，筹码不稳`); }
    else if (turnover > 15)  { score -= 30; tips.push(`⚠️ 换手${turnover.toFixed(1)}%过高`); }
    else if (turnover > 10)  { score -= 15; tips.push(`换手${turnover.toFixed(1)}%偏高`); }
    else if (turnover <= PARAMS.optimalTurnover) { score += 15; tips.push(`✅ 换手${turnover.toFixed(1)}%优秀`); }
    else                     { tips.push(`换手${turnover.toFixed(1)}%正常`); }
  } else {
    score -= 5; tips.push('换手率暂无');
  }

  if (volRatio > 0) {
    if      (volRatio > 3)   { score -= 30; tips.push(`⚠️ 量比${volRatio.toFixed(1)}放量异常`); }
    else if (volRatio > 2)   { score -= 15; tips.push(`量比${volRatio.toFixed(1)}偏大`); }
    else if (volRatio <= PARAMS.optimalVol) { score += 15; tips.push(`✅ 量比${volRatio.toFixed(1)}缩量`); }
    else                     { tips.push(`量比${volRatio.toFixed(1)}正常`); }
  } else {
    score -= 5; tips.push('量比暂无');
  }

  if (circMvYi > 0) {
    if (circMvYi <= PARAMS.optimalMvMax) {
      score += 10; tips.push(`✅ 市值${circMvYi.toFixed(0)}亿弹性佳`);
    } else if (circMvYi <= 150) {
      tips.push(`市值${circMvYi.toFixed(0)}亿尚可`);
    }
  }

  if      (boards >= 5) { score += 20; tips.push(`🔥 ${boards}连板高度板`); }
  else if (boards === 4) { score += 10; tips.push(`🔥 ${boards}连板打${boards+1}板`); }
  else if (boards === 3) { score +=  5; tips.push(`3连板打4板`); }

  const corePassed = (turnover === 0 || turnover <= PARAMS.maxTurnoverRate)
                  && (volRatio === 0 || volRatio <= PARAMS.maxVolumeRatio);
  if (!corePassed) score = Math.min(score, 50);

  // 换手率参与评估
  if (turnover > 0 && turnover < 1) {
    tips.push(`⚠️ 换手${turnover.toFixed(1)}%极低，明日可能一字板无法参与`);
  } else if (turnover >= 1 && turnover <= PARAMS.entryMaxTurnover) {
    score += 5; tips.push(`✅ 换手${turnover.toFixed(1)}%，回封机会概率高`);
  }

  let grade: string;
  if      (score >= 110) grade = 'A+';
  else if (score >= 90)  grade = 'A';
  else if (score >= 70)  grade = 'B';
  else if (score >= 50)  grade = 'C';
  else                   grade = 'D';

  return { score, grade, tips };
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
function main() {
  const db = new Database(DB_PATH, { readonly: true });

  const targetDate: string = process.argv[2]
    ?? (db.prepare("SELECT MAX(date) as d FROM prices WHERE market NOT IN ('ETF','INDEX') AND market IS NOT NULL").get() as any).d;

  const recentDates: string[] = (db.prepare(
    "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') AND date <= ? ORDER BY date DESC LIMIT 10"
  ).all(targetDate) as any[]).map(r => r.date);

  if (!recentDates.includes(targetDate)) {
    console.error(`❌ 日期 ${targetDate} 无数据`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(76)}`);
  console.log(`  📋 2进3 板块龙头选股   目标日期：${targetDate}`);
  console.log(`${'═'.repeat(76)}`);

  // ── 获取当日涨停股（仅主板：沪600/601/603/605，深000/001/002/003）──────
  const todayLimitUp = db.prepare(`
    SELECT * FROM prices
    WHERE date = ?
      AND high_limit > 0
      AND close >= high_limit
      AND name NOT LIKE '%ST%'
      AND name NOT LIKE '%退%'
      AND market NOT IN ('ETF','INDEX')
      AND (
        code LIKE '600%' OR code LIKE '601%' OR code LIKE '603%' OR code LIKE '605%'
        OR code LIKE '000%' OR code LIKE '001%' OR code LIKE '002%' OR code LIKE '003%'
      )
  `).all(targetDate) as BarRow[];

  if (todayLimitUp.length === 0) {
    console.log(`\n  ⚠️  ${targetDate} 无涨停股数据`);
    db.close();
    return;
  }
  console.log(`\n  今日涨停股：${todayLimitUp.length} 只`);

  // ── 计算每只股的连板数 + 评分 ──────────────────────────────────────────
  const candidates: Candidate[] = [];

  for (const bar of todayLimitUp) {
    const price    = bar.close;
    const circMvYi = bar.circ_mv != null ? bar.circ_mv / 10000 : 0;
    const turnover = bar.turnover_rate ?? 0;
    const volRatio = bar.volume_ratio  ?? 0;

    if (price < PARAMS.minPrice || price > PARAMS.maxPrice) continue;
    if (circMvYi > 200) continue;

    // 往前追溯连板
    let boards = 1;
    for (let i = 1; i < recentDates.length; i++) {
      const prev = db.prepare(
        'SELECT close, high_limit FROM prices WHERE code = ? AND date = ?'
      ).get(bar.code, recentDates[i]) as { close: number; high_limit: number } | undefined;
      if (prev && prev.high_limit > 0 && prev.close >= prev.high_limit) boards++;
      else break;
    }
    if (boards < PARAMS.minBoards) continue;

    const { score, grade, tips } = calcScore(turnover, volRatio, circMvYi, boards);
    if (grade === 'X') continue;

    candidates.push({
      code: bar.code,
      name: bar.name,
      industry: bar.industry || '未知',
      boards,
      todayBar: bar,
      circMvYi,
      score,
      grade,
      tips,
      isLeader: false,
      sectorCount: 0,
    });
  }

  // ── 按行业分组，统计板块共振 ───────────────────────────────────────────
  const sectorMap = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.industry;
    if (!sectorMap.has(key)) sectorMap.set(key, []);
    sectorMap.get(key)!.push(c);
  }

  // 更新 sectorCount 并标记龙头
  for (const [, group] of sectorMap) {
    for (const c of group) c.sectorCount = group.length;

    if (group.length >= PARAMS.sectorResonance) {
      // 排序找龙头：①板数最多 ②分数最高
      const sorted = [...group].sort((a, b) =>
        b.boards !== a.boards ? b.boards - a.boards : b.score - a.score
      );
      sorted[0].isLeader = true;
      // 龙头加分
      sorted[0].score += 15;
      sorted[0].tips.unshift(`🏆 板块龙头（板块${group.length}只共振）`);
      if (sorted[0].score >= 110) sorted[0].grade = 'A+';
      else if (sorted[0].score >= 90) sorted[0].grade = 'A';
    }
  }

  // ── 板块共振区（同行业 ≥2 只连板）────────────────────────────────────
  const resonanceSectors = [...sectorMap.entries()]
    .filter(([, g]) => g.length >= PARAMS.sectorResonance)
    .sort((a, b) => {
      const maxA = Math.max(...a[1].map(c => c.boards));
      const maxB = Math.max(...b[1].map(c => c.boards));
      return maxB !== maxA ? maxB - maxA : b[1].length - a[1].length;
    });

  const soloGroup = [...sectorMap.entries()]
    .filter(([, g]) => g.length < PARAMS.sectorResonance)
    .flatMap(([, g]) => g)
    .sort((a, b) => b.score - a.score);

  // ── 打印函数 ────────────────────────────────────────────────────────────
  const printCandidate = (c: Candidate, idx: number | string) => {
    const t   = c.todayBar;
    const tr  = t.turnover_rate != null ? `${t.turnover_rate.toFixed(1)}%` : 'N/A';
    const vr  = t.volume_ratio  != null ? t.volume_ratio.toFixed(2) : 'N/A';
    const mv  = c.circMvYi > 0 ? `${c.circMvYi.toFixed(0)}亿` : 'N/A';
    const prc = `¥${t.close.toFixed(2)}`;
    const leaderTag = c.isLeader ? ' 👑龙头' : '';

    const gradeLabel: Record<string, string> = {
      'A+': '★★★ A+', A: '★★★ A', B: '★★  B', C: '★   C', D: '✗   D',
    };

    // 明日回封打板入场建议
    const tr2 = c.todayBar.turnover_rate ?? 0;
    const hl  = c.todayBar.high_limit;
    const dropMax  = (hl * (1 - PARAMS.entryOpenDropMax)).toFixed(2);
    let entryAdvice: string;
    if (tr2 > 0 && tr2 < 1) {
      entryAdvice = `⚠️ 换手极低，明日若一字板无法参与；若低开则回封涨停价挂单买入`;
    } else if (c.boards >= 3) {
      entryAdvice = `✅ ${c.boards}板→打${c.boards+1}板：明日低开回封涨停价买入；` +
        `低开<3%封板率最高(84%)，低开>8%(¥${dropMax}以下)慎入(封板率仅37%)`;
    } else {
      entryAdvice = `✅ 2板→打3板：明日低开回封涨停价买入；低开<3%封板率73%，低开>8%(¥${dropMax}以下)慎入`;
    }

    console.log(
      `  ${String(idx).padStart(2)}. ${c.code} ${c.name.padEnd(8)}${leaderTag}` +
      `  ${(gradeLabel[c.grade] ?? c.grade).padEnd(9)}  ${c.boards}连板` +
      `  ${prc.padStart(7)}  市值:${mv.padStart(6)}  换手:${tr.padStart(5)}  量比:${vr.padStart(5)}`
    );
    console.log(`      ${c.tips.join('  ')}`);
    console.log(`      入场：${entryAdvice}`);
  };

  // ── 输出板块共振区 ──────────────────────────────────────────────────────
  if (resonanceSectors.length > 0) {
    console.log(`\n${'═'.repeat(76)}`);
    console.log(`  🔥 板块共振区（同行业 ≥${PARAMS.sectorResonance} 只连板，共 ${resonanceSectors.length} 个板块）`);
    console.log(`  ★★★ 优先操作：选龙头打板，胜率最高`);

    for (const [sector, group] of resonanceSectors) {
      const sorted = [...group].sort((a, b) =>
        b.boards !== a.boards ? b.boards - a.boards : b.score - a.score
      );
      const boardNums = sorted.map(c => `${c.boards}板`).join('/');
      console.log(`\n  ┌─ 📌 ${sector}  共${group.length}只连板（${boardNums}）${'─'.repeat(Math.max(0, 40 - sector.length))}`);
      sorted.forEach((c, i) => printCandidate(c, i + 1));
      const leader = sorted[0];
      const op = leader.boards >= 3
        ? `当前${leader.boards}板，次日打${leader.boards + 1}板；竞价高开3~8%可打`
        : `当前2板，明日打3板；竞价高开3~8%可打`;
      console.log(`  └─ 操作建议：${op}`);
    }
  } else {
    console.log('\n  （今日无板块共振，同行业连板数未达到门槛）');
  }

  // ── 输出个股区 ──────────────────────────────────────────────────────────
  const soloA  = soloGroup.filter(c => c.score >= 90);
  const soloB  = soloGroup.filter(c => c.score >= 70 && c.score < 90);
  const soloCD = soloGroup.filter(c => c.score < 70);

  if (soloGroup.length > 0) {
    console.log(`\n${'─'.repeat(76)}`);
    console.log(`  📌 无板块共振个股（共 ${soloGroup.length} 只，谨慎参与）`);

    if (soloA.length > 0) {
      console.log(`\n  A级个股（${soloA.length} 只）`);
      soloA.forEach((c, i) => printCandidate(c, i + 1));
    }
    if (soloB.length > 0) {
      console.log(`\n  B级个股（${soloB.length} 只）`);
      soloB.forEach((c, i) => printCandidate(c, i + 1));
    }
    if (soloCD.length > 0) {
      console.log(`\n  C/D级个股（${soloCD.length} 只，风险高，仅参考）`);
      soloCD.slice(0, 5).forEach((c, i) => printCandidate(c, i + 1));
      if (soloCD.length > 5) console.log(`  ... 还有 ${soloCD.length - 5} 只已折叠`);
    }
  }

  if (candidates.length === 0) {
    console.log(`\n  ℹ️  ${targetDate} 无符合条件的连板候选`);
  }

  // ── 大盘状态 ────────────────────────────────────────────────────────────
  const last5 = db.prepare(`
    SELECT date,
      COUNT(*) as total,
      SUM(CASE WHEN high_limit > 0 AND close >= high_limit THEN 1 ELSE 0 END) as lu
    FROM prices
    WHERE date <= ? AND market NOT IN ('ETF','INDEX') AND market IS NOT NULL
    GROUP BY date ORDER BY date DESC LIMIT 5
  `).all(targetDate) as any[];

  const avg5Lu = last5.reduce((s: number, r: any) => s + r.lu / r.total, 0) / last5.length * 100;

  console.log(`\n${'─'.repeat(76)}`);
  console.log('  📊 大盘涨停热度');
  last5.forEach((r: any) => {
    const pct = (r.lu / r.total * 100).toFixed(2);
    const bar = '█'.repeat(Math.min(20, Math.round(r.lu / r.total * 500)));
    console.log(`  ${r.date}  涨停:${String(r.lu).padStart(3)}只  占比:${pct}%  ${bar}`);
  });

  let marketState: string, marketAdvice: string;
  if      (avg5Lu >= 2.0) { marketState = '📗 牛市'; marketAdvice = '大盘强势，打板胜率高，可积极操作'; }
  else if (avg5Lu >= 0.8) { marketState = '📒 震荡市'; marketAdvice = '严格执行换手+量比过滤，只打板块共振龙头'; }
  else                    { marketState = '📕 熊市'; marketAdvice = '⚠️ 涨停效应差，建议暂停打板'; }

  console.log(`\n  5日均涨停比: ${avg5Lu.toFixed(3)}%   市场: ${marketState}  →  ${marketAdvice}`);

  // ── 操作总结 ────────────────────────────────────────────────────────────
  const topTargets = [
    ...resonanceSectors.flatMap(([, g]) =>
      g.filter(c => c.isLeader && c.score >= 90)
    ),
    ...soloA.slice(0, 2),
  ];

  console.log(`\n${'─'.repeat(76)}`);
  console.log('  🎯 明日重点关注清单（回封打板候选）');
  console.log(`${'─'.repeat(76)}`);
  if (topTargets.length === 0) {
    console.log('  （今日无高质量候选，明日观望）');
  } else {
    topTargets.forEach((c, i) => {
      const hl       = c.todayBar.high_limit;
      const dropLow  = (hl * (1 - PARAMS.entryOpenDropMax)).toFixed(2);
      const dropHigh = (hl * (1 - PARAMS.entryOpenDropMin)).toFixed(2);
      const tag = c.isLeader ? '主线龙头' : '主线跟风';
      console.log(
        `  ${i + 1}. ${c.code} ${c.name}（${c.boards}板 ${c.industry} ${tag}）` +
        `  涨停价:¥${hl.toFixed(2)}  明日入场区间:¥${dropLow}~¥${dropHigh}`
      );
    });
  }

  console.log('\n  ─ 操作纪律（回测验证：全年+135% 最大回撤<10%）─────');
  console.log('  【入场 — 3板日盘中】');
  console.log('  ① 集合竞价观察：任意低开（非一字板）均可关注');
  console.log('  ② 盘中触碰涨停价时，立刻以涨停价挂限价买单');
  console.log('  ③ 低开<3%封板率73%最优；低开>8%封板率降至40%，谨慎');
  console.log('  【出场 — 4板日开盘（T+1第一个可卖日）】');
  console.log('  ④ 开盘跌幅 > 8% → 立即开盘止损，不犹豫');
  console.log('  ⑤ 开盘未封板（开盘价 < 涨停价）→ 开盘直接卖出');
  console.log('     （无论高开低开，只要没竞价封板就走，不等盘中回封）');
  console.log('  ⑥ 开盘已封板（一字或竞价封）→ 持有，继续看');
  console.log('  【出场 — 持仓期间（4板日已封/5板+）】');
  console.log('  ⑦ 盘中炸板（触碰涨停后回落）→ 涨停价回调3%时挂单卖出');
  console.log('  ⑧ 当日未触及涨停价 → 收盘卖出');
  console.log('  ⑨ 连续封板持有，最多持 7 天强平');
  console.log(`${'═'.repeat(76)}\n`);

  db.close();
}

main();
