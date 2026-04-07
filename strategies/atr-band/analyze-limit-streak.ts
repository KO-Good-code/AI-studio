/**
 * 连板股共性分析（5板及以上）
 *
 * 分析维度：
 *   1. 首板特征（市值、股价、换手、量比、行业）
 *   2. 2进3关键指标（2板换手、量比 → 成功/失败对比）
 *   3. 各板位平均换手、量比趋势
 *   4. 高度板（5+）的行业分布
 */

import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'data/prices.db'), { readonly: true });

// 过去一年（换手率/市值数据覆盖至 2026-03-03，之后用量比仍可分析连板特征）
const START = '2023-04-02';
const END   = '2026-04-02';

// ── 1. 获取区间内所有涨停记录 ────────────────────────────────────────────
const limitUpRows = db.prepare(`
  SELECT code, name, date, close, high_limit, low_limit,
         turnover_rate, circ_mv, volume_ratio, industry,
         open, prev_close
  FROM prices
  WHERE date >= ? AND date <= ?
    AND high_limit > 0 AND close >= high_limit
    AND name NOT LIKE '%ST%'
  ORDER BY code, date
`).all(START, END) as any[];

// ── 2. 获取交易日序列 ─────────────────────────────────────────────────────
const tradingDates: string[] = (db.prepare(
  'SELECT DISTINCT date FROM prices WHERE date >= ? AND date <= ? ORDER BY date'
).all(START, END) as any[]).map(r => r.date);

const dateIndex = new Map<string, number>();
tradingDates.forEach((d, i) => dateIndex.set(d, i));

// ── 3. 按股票分组，找连续涨停序列 ──────────────────────────────────────────
const byCode = new Map<string, any[]>();
for (const r of limitUpRows) {
  if (!byCode.has(r.code)) byCode.set(r.code, []);
  byCode.get(r.code)!.push(r);
}

interface LBEvent {
  code: string;
  name: string;
  industry: string;
  boards: number;       // 连板总数
  bars: any[];          // 每板的原始数据
  firstClose: number;   // 首板收盘价
  firstCircMv: number;  // 首板流通市值（亿元）
}

const allEvents: LBEvent[] = [];   // 所有 2+ 连板事件
const highEvents: LBEvent[] = [];  // 5+ 板事件

for (const [code, records] of byCode) {
  let current: any[] = [records[0]];

  const flush = () => {
    if (current.length >= 2) {
      const evt: LBEvent = {
        code: current[0].code,
        name: current[0].name,
        industry: current[0].industry || '未知',
        boards: current.length,
        bars: current,
        firstClose: current[0].close,
        firstCircMv: (current[0].circ_mv ?? 0) / 10000, // 万元→亿元
      };
      allEvents.push(evt);
      if (current.length >= 5) highEvents.push(evt);
    }
    current = [];
  };

  for (let i = 1; i < records.length; i++) {
    const prevIdx = dateIndex.get(records[i - 1].date);
    const curIdx  = dateIndex.get(records[i].date);
    if (prevIdx !== undefined && curIdx !== undefined && curIdx === prevIdx + 1) {
      current.push(records[i]);
    } else {
      flush();
      current = [records[i]];
    }
  }
  flush();
}

// ── 4. 统计辅助函数 ───────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * p)] ?? 0;
}
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

// ── 5. 输出开始 ───────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(70)}`);
console.log(`连板股共性分析  ${START} ~ ${END}（换手率/市值数据覆盖至2026-03-03）`);
console.log(`${'='.repeat(70)}`);
console.log(`总连板事件(2板以上): ${allEvents.length} 次`);
console.log(`高度板事件(5板以上): ${highEvents.length} 次`);

// ── 6. 高度板（5+）列表 ────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log('【一】5板及以上连板股明细');
console.log(`${'─'.repeat(70)}`);
console.log('股票          板数  首板价  首板市值   行业          板位时间');

const sorted5 = [...highEvents].sort((a, b) => b.boards - a.boards);
for (const e of sorted5) {
  const dates = e.bars.map((b: any) => b.date.slice(5)).join('→');
  console.log(
    `${e.code} ${e.name.padEnd(8)} ${String(e.boards).padStart(3)}板` +
    `  ¥${f2(e.firstClose).padStart(6)}` +
    `  ${f1(e.firstCircMv).padStart(7)}亿` +
    `  ${e.industry.padEnd(10)}` +
    `  ${dates}`
  );
}

// ── 7. 各板位换手率、量比均值 ─────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log('【二】各板位指标均值（基于5板以上样本）');
console.log(`${'─'.repeat(70)}`);
console.log('板位   样本数   均换手%   中位换手%   均量比   中位量比');

for (let board = 1; board <= 8; board++) {
  const bars = highEvents
    .filter(e => e.boards >= board)
    .map(e => e.bars[board - 1])
    .filter(Boolean);

  const trs  = bars.map((b: any) => b.turnover_rate).filter((v: any) => v != null) as number[];
  const vols = bars.map((b: any) => b.volume_ratio).filter((v: any) => v != null) as number[];

  if (bars.length === 0) break;
  console.log(
    `  第${board}板  ${String(bars.length).padStart(4)}只` +
    `    ${f1(avg(trs)).padStart(7)}%` +
    `    ${f1(median(trs)).padStart(8)}%` +
    `    ${f1(avg(vols)).padStart(6)}` +
    `    ${f1(median(vols)).padStart(7)}`
  );
}

// ── 8. 2进3 成功/失败 对比 ─────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log('【三】2进3 关键指标对比（"2板→成功封3" vs "2板→未封3"）');
console.log(`${'─'.repeat(70)}`);

// 成功 = 连板 >= 3；失败 = 连板恰好 2
const success3 = allEvents.filter(e => e.boards >= 3);
const fail3    = allEvents.filter(e => e.boards === 2);

console.log(`  成功封3（连板≥3）: ${success3.length} 次`);
console.log(`  失败止于2板:       ${fail3.length} 次`);

// 取各自2板那天的数据
function getBoardN(events: LBEvent[], n: number) {
  return events
    .filter(e => e.boards >= n)
    .map(e => e.bars[n - 1])
    .filter(Boolean);
}

const s2bars = getBoardN(success3, 2);
const f2bars = getBoardN(fail3, 2);

const metrics = [
  ['换手率(%)', (b: any) => b.turnover_rate],
  ['量比',      (b: any) => b.volume_ratio],
  ['股价(¥)',   (b: any) => b.close],
];

console.log(`\n  2板当天指标对比:`);
console.log(`  指标         成功中位   成功均值   失败中位   失败均值`);
for (const [label, fn] of metrics) {
  const sv = s2bars.map(fn).filter((v: any) => v != null) as number[];
  const fv = f2bars.map(fn).filter((v: any) => v != null) as number[];
  console.log(
    `  ${String(label).padEnd(12)}` +
    `  ${f1(median(sv)).padStart(8)}` +
    `  ${f1(avg(sv)).padStart(8)}` +
    `  ${f1(median(fv)).padStart(8)}` +
    `  ${f1(avg(fv)).padStart(8)}`
  );
}

// 2进3 以首板市值分层
console.log(`\n  按首板流通市值分层的2进3成功率:`);
const brackets = [
  [0, 20,   '< 20亿'],
  [20, 50,  '20~50亿'],
  [50, 100, '50~100亿'],
  [100, 300,'100~300亿'],
  [300, 1e9,'> 300亿'],
];
for (const [lo, hi, label] of brackets) {
  const sn = success3.filter(e => e.firstCircMv >= lo && e.firstCircMv < hi).length;
  const fn2 = fail3.filter(e => e.firstCircMv >= lo && e.firstCircMv < hi).length;
  const total = sn + fn2;
  if (total === 0) continue;
  const rate = (sn / total * 100).toFixed(0);
  const bar  = '█'.repeat(Math.round(sn / total * 20));
  console.log(`  ${String(label).padEnd(10)}  成功:${String(sn).padStart(3)}  失败:${String(fn2).padStart(3)}  成功率:${String(rate).padStart(3)}%  ${bar}`);
}

// ── 9. 首板特征分析（5板以上样本）───────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log('【四】5板以上首板特征分布');
console.log(`${'─'.repeat(70)}`);

const firstBars = highEvents.map(e => e.bars[0]);
const trs1 = firstBars.map((b: any) => b.turnover_rate).filter((v: any) => v != null) as number[];
const vols1 = firstBars.map((b: any) => b.volume_ratio).filter((v: any) => v != null) as number[];
const mvs   = highEvents.map(e => e.firstCircMv).filter(v => v > 0);
const prices= firstBars.map((b: any) => b.close).filter((v: any) => v != null) as number[];

console.log(`  首板换手率: 均值=${f1(avg(trs1))}%  中位=${f1(median(trs1))}%  25%=${f1(pct(trs1,0.25))}%  75%=${f1(pct(trs1,0.75))}%`);
console.log(`  首板量比:   均值=${f1(avg(vols1))}   中位=${f1(median(vols1))}   25%=${f1(pct(vols1,0.25))}   75%=${f1(pct(vols1,0.75))}`);
console.log(`  流通市值:   均值=${f1(avg(mvs))}亿  中位=${f1(median(mvs))}亿  25%=${f1(pct(mvs,0.25))}亿  75%=${f1(pct(mvs,0.75))}亿`);
console.log(`  首板股价:   均值=¥${f1(avg(prices))}  中位=¥${f1(median(prices))}  25%=¥${f1(pct(prices,0.25))}  75%=¥${f1(pct(prices,0.75))}`);

// ── 10. 行业分布 ──────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log('【五】5板以上行业分布');
console.log(`${'─'.repeat(70)}`);
const industryCount = new Map<string, number>();
for (const e of highEvents) {
  industryCount.set(e.industry, (industryCount.get(e.industry) ?? 0) + 1);
}
const sortedInd = [...industryCount.entries()].sort((a, b) => b[1] - a[1]);
for (const [ind, cnt] of sortedInd.slice(0, 15)) {
  const bar = '█'.repeat(cnt);
  console.log(`  ${ind.padEnd(12)} ${String(cnt).padStart(3)}次  ${bar}`);
}

// ── 11. 2板次日是否开高（涨停开板特征）───────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log('【六】2板次日开盘特征（影响3板能否封住）');
console.log(`${'─'.repeat(70)}`);

// 找每个成功/失败事件的 "2板当天 open vs prev_close"
function getOpenPct(b: any): number | null {
  if (!b || !b.open || !b.prev_close) return null;
  return (b.open - b.prev_close) / b.prev_close * 100;
}

// 2板次日 = bars[2]（第3板或失败后那天）
// 但失败事件里 bars[2] 不存在...
// 改成看成功事件的第3板 open_pct
const s3bars = success3.map(e => e.bars[2]).filter(Boolean);
const openPcts = s3bars.map(getOpenPct).filter((v): v is number => v != null);
const gapUp    = openPcts.filter(v => v > 5).length;
const flat3    = openPcts.filter(v => v >= 0 && v <= 5).length;
const gapDown  = openPcts.filter(v => v < 0).length;

console.log(`  3板（即2进3）开盘情况 (样本 ${openPcts.length} 只):`);
console.log(`  高开超5%: ${gapUp}只  (${(gapUp/openPcts.length*100).toFixed(0)}%)`);
console.log(`  平开~+5%: ${flat3}只  (${(flat3/openPcts.length*100).toFixed(0)}%)`);
console.log(`  低开:     ${gapDown}只  (${(gapDown/openPcts.length*100).toFixed(0)}%)`);
console.log(`  3板开盘平均涨幅: ${avg(openPcts).toFixed(1)}%`);

db.close();
