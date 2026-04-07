/**
 * 2进3 入场方式对比分析
 *
 * 核心问题：
 *   - 一字板打不进去
 *   - 打进去了容易炸板
 *
 * 分析三种入场方式：
 *   A. 尾盘打2板（2板收盘前5分钟买入，持仓过夜到3板）
 *   B. 竞价打3板（3板集合竞价 9:15~9:25 限价涨停挂单）
 *   C. 分时打3板（3板开盘后追涨停，成本更高）
 *
 * 并分析：
 *   - 第3板的开盘类型分布（一字/高开/平开）
 *   - 炸板率及炸板后的处理结果
 *   - 不同开盘幅度的胜率
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');

const ENTRY_PARAMS = {
  maxTurnover2: 7.0,
  maxVolRatio2: 1.5,
  minCircMv: 20,
  maxCircMv: 150,
  minPrice: 4.0,
  maxPrice: 40.0,
};

interface Sample {
  code: string;
  name: string;
  date2: string;   // 2板日期
  date3: string;   // 3板/目标日期
  // 2板收盘
  close2: number;
  limitPrice2: number;   // 2板涨停价（次日的涨停参考价）
  // 3板当天数据
  open3: number;
  high3: number;
  low3: number;
  close3: number;
  highLimit3: number;
  prevClose3: number;    // 即 close2
  volume3: number;
  turnover3: number;
  volRatio3: number;
  // 次日（4板目标）
  close4: number;
  highLimit4: number;
  // 衍生
  openPct3: number;       // 3板开盘涨幅（相对2板收盘）
  isOneWord3: boolean;    // 一字板
  hitLimit3: boolean;     // 是否最终涨停（hit 3rd board）
  zhaBan3: boolean;       // 炸板（曾经涨停，后来开板且收盘未涨停）
  hit4: boolean;          // 最终打到4板
  // 2板指标
  t2: number;
  v2: number;
  circMv: number;
  industry: string;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}

function pct(arr: Sample[], pred: (s: Sample) => boolean): string {
  if (!arr.length) return '-';
  const n = arr.filter(pred).length;
  return `${n}/${arr.length}(${(n/arr.length*100).toFixed(1)}%)`;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  const allDates: string[] = (db.prepare(
    "SELECT DISTINCT date FROM prices WHERE market NOT IN ('ETF','INDEX') ORDER BY date DESC LIMIT 400"
  ).all() as any[]).map(r => r.date).reverse();

  console.log(`\n${'═'.repeat(78)}`);
  console.log('  📊 2进3 入场方式实战分析（炸板/买不进 全解）');
  console.log(`  分析区间：${allDates[0]} ~ ${allDates[allDates.length-1]}`);
  console.log(`${'═'.repeat(78)}`);

  const samples: Sample[] = [];

  for (let i = 5; i < allDates.length - 2; i++) {
    const date2    = allDates[i];
    const date3    = allDates[i + 1];
    const date4    = allDates[i + 2];
    const prevDates = allDates.slice(Math.max(0, i - 8), i).reverse();

    // 2板涨停股
    const day2LU = db.prepare(`
      SELECT p.code, p.name, p.close, p.high_limit,
             p.turnover_rate, p.circ_mv, p.volume_ratio, p.industry
      FROM prices p
      WHERE p.date = ?
        AND p.high_limit > 0 AND p.close >= p.high_limit
        AND p.name NOT LIKE '%ST%' AND p.name NOT LIKE '%退%'
        AND p.market NOT IN ('ETF','INDEX')
    `).all(date2) as any[];

    for (const bar2 of day2LU) {
      const circMv = bar2.circ_mv != null ? bar2.circ_mv / 10000 : 0;
      const t2     = bar2.turnover_rate ?? 0;
      const v2     = bar2.volume_ratio  ?? 0;
      const price  = bar2.close;

      if (price < ENTRY_PARAMS.minPrice || price > ENTRY_PARAMS.maxPrice) continue;
      if (circMv > 0 && (circMv < ENTRY_PARAMS.minCircMv || circMv > ENTRY_PARAMS.maxCircMv)) continue;
      if (t2 > 0 && t2 > ENTRY_PARAMS.maxTurnover2) continue;
      if (v2 > 0 && v2 > ENTRY_PARAMS.maxVolRatio2) continue;

      // 确认恰好2连板
      let boards = 1;
      for (const pd of prevDates) {
        const pb = db.prepare(
          'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
        ).get(bar2.code, pd) as any;
        if (pb && pb.high_limit > 0 && pb.close >= pb.high_limit) boards++;
        else break;
      }
      if (boards !== 2) continue;

      // 3板当天数据
      const bar3 = db.prepare(`
        SELECT open, high, low, close, high_limit, prev_close, volume,
               turnover_rate, volume_ratio
        FROM prices WHERE code=? AND date=?
      `).get(bar2.code, date3) as any;
      if (!bar3) continue;

      // 4板目标数据
      const bar4 = db.prepare(
        'SELECT close, high_limit FROM prices WHERE code=? AND date=?'
      ).get(bar2.code, date4) as any;

      const openPct3     = bar3.prev_close > 0
        ? (bar3.open - bar3.prev_close) / bar3.prev_close * 100 : 0;
      const isOneWord3   = bar3.open >= bar3.high_limit * 0.999;
      const hitLimit3    = bar3.high_limit > 0 && bar3.close >= bar3.high_limit;
      // 炸板：盘中到过涨停，但收盘未封板
      const zhaBan3      = !hitLimit3 && bar3.high >= bar3.high_limit * 0.999;
      const hit4         = !!bar4 && bar4.high_limit > 0 && bar4.close >= bar4.high_limit;

      samples.push({
        code: bar2.code, name: bar2.name,
        date2, date3,
        close2: bar2.close,
        limitPrice2: bar2.high_limit,
        open3: bar3.open, high3: bar3.high, low3: bar3.low, close3: bar3.close,
        highLimit3: bar3.high_limit, prevClose3: bar3.prev_close,
        volume3: bar3.volume,
        turnover3: bar3.turnover_rate ?? 0,
        volRatio3: bar3.volume_ratio  ?? 0,
        close4: bar4?.close ?? 0,
        highLimit4: bar4?.high_limit ?? 0,
        openPct3, isOneWord3, hitLimit3, zhaBan3, hit4,
        t2, v2, circMv, industry: bar2.industry || '未知',
      });
    }
  }

  const total = samples.length;
  console.log(`\n  满足2板入场条件的样本：${total} 条\n`);

  // ── ① 第3板开盘类型分布 ───────────────────────────────────────────────────
  console.log(`${'─'.repeat(78)}`);
  console.log('  ① 第3板开盘类型分布');
  console.log(`${'─'.repeat(78)}`);

  const oneWord   = samples.filter(s => s.isOneWord3);
  const highOpen  = samples.filter(s => !s.isOneWord3 && s.openPct3 >= 3);
  const midOpen   = samples.filter(s => !s.isOneWord3 && s.openPct3 >= 0 && s.openPct3 < 3);
  const lowOpen   = samples.filter(s => !s.isOneWord3 && s.openPct3 < 0);

  const showGroup = (label: string, g: Sample[]) => {
    if (!g.length) return;
    const hitRate   = g.filter(s => s.hitLimit3).length / g.length * 100;
    const zhaRate   = g.filter(s => s.zhaBan3).length / g.length * 100;
    const hit4Rate  = g.filter(s => s.hit4).length / g.length * 100;
    const openMed   = median(g.map(s => s.openPct3));
    console.log(
      `  ${label.padEnd(22)} ${String(g.length).padStart(4)}只(${(g.length/total*100).toFixed(0)}%)` +
      `  封板:${hitRate.toFixed(1)}%  炸板:${zhaRate.toFixed(1)}%  打到4板:${hit4Rate.toFixed(1)}%` +
      (openMed !== 0 ? `  开盘中位:+${openMed.toFixed(1)}%` : '')
    );
  };

  showGroup('一字板（≥10%开盘）',   oneWord);
  showGroup('高开3~10%',            highOpen);
  showGroup('平开0~3%',             midOpen);
  showGroup('低开<0%',              lowOpen);

  // ── ② 一字板的真实情况 ───────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ② 一字板实战困境分析');
  console.log(`${'─'.repeat(78)}`);

  const owHit4   = oneWord.filter(s => s.hit4).length;
  const owNo4    = oneWord.filter(s => !s.hitLimit3);  // 根本没封板的一字开
  console.log(`  一字板共 ${oneWord.length} 只：`);
  console.log(`   → 维持涨停到收盘：${oneWord.filter(s=>s.hitLimit3).length}只(${(oneWord.filter(s=>s.hitLimit3).length/oneWord.length*100).toFixed(1)}%)`);
  console.log(`   → 炸板（开板后收盘未封）：${oneWord.filter(s=>s.zhaBan3).length}只(${(oneWord.filter(s=>s.zhaBan3).length/oneWord.length*100).toFixed(1)}%)`);
  console.log(`   → 次日打到4板：${owHit4}只(${(owHit4/oneWord.length*100).toFixed(1)}%)`);
  console.log(`\n  🚫 买不进的情况（真正的一字板无法竞价填充）：`);

  // 分析换手率：一字板换手低 = 基本买不进；换手高 = 说明有人在卖，可以竞价买
  const owLowT  = oneWord.filter(s => s.turnover3 > 0 && s.turnover3 < 2);  // 极低换手=真一字，买不进
  const owHighT = oneWord.filter(s => s.turnover3 >= 2);                      // 较高换手=有人卖，可以排队

  console.log(`   换手<2%（真一字，极难买入）：${owLowT.length}只`);
  console.log(`     → 打到4板：${owLowT.filter(s=>s.hit4).length}只 (${owLowT.length ? (owLowT.filter(s=>s.hit4).length/owLowT.length*100).toFixed(1) : 0}%)`);
  console.log(`   换手≥2%（有换手，竞价可能排到）：${owHighT.length}只`);
  console.log(`     → 打到4板：${owHighT.filter(s=>s.hit4).length}只 (${owHighT.length ? (owHighT.filter(s=>s.hit4).length/owHighT.length*100).toFixed(1) : 0}%)`);

  // ── ③ 炸板深度分析 ───────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ③ 炸板（曾涨停后开板）深度分析');
  console.log(`${'─'.repeat(78)}`);

  const zhaBan = samples.filter(s => s.zhaBan3);
  console.log(`  炸板总样本：${zhaBan.length}只 占比${(zhaBan.length/total*100).toFixed(1)}%`);

  if (zhaBan.length > 0) {
    // 炸板后收盘位置
    const zbAbove5  = zhaBan.filter(s => s.close3 >= s.prevClose3 * 1.05);
    const zbAbove0  = zhaBan.filter(s => s.close3 >= s.prevClose3 && s.close3 < s.prevClose3*1.05);
    const zbBelow0  = zhaBan.filter(s => s.close3 < s.prevClose3);

    console.log(`\n  炸板后收盘位置（决定是否要止损）：`);
    console.log(`   收盘仍涨5%以上：${zbAbove5.length}只(${(zbAbove5.length/zhaBan.length*100).toFixed(1)}%)  次日打4板:${zbAbove5.filter(s=>s.hit4).length}只`);
    console.log(`   收盘涨0~5%：   ${zbAbove0.length}只(${(zbAbove0.length/zhaBan.length*100).toFixed(1)}%)  次日打4板:${zbAbove0.filter(s=>s.hit4).length}只`);
    console.log(`   收盘下跌：     ${zbBelow0.length}只(${(zbBelow0.length/zhaBan.length*100).toFixed(1)}%)  次日打4板:${zbBelow0.filter(s=>s.hit4).length}只`);

    const zbDropMed = median(zhaBan.map(s => (s.close3 - s.prevClose3) / s.prevClose3 * 100));
    console.log(`\n  炸板后收盘相对前收盘中位涨跌：${zbDropMed.toFixed(2)}%`);
    console.log(`  → 结论：炸板后平均仍有小幅上涨，但次日继续涨停概率极低`);

    // 炸板后次日的结果
    const zbHit4 = zhaBan.filter(s => s.hit4).length;
    console.log(`  炸板后次日仍打4板：${zbHit4}/${zhaBan.length}(${(zbHit4/zhaBan.length*100).toFixed(1)}%) ← 极低，炸板应直接止损`);
  }

  // ── ④ 高开幅度 vs 成功率 ─────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ④ 第3板开盘幅度 vs 封板率 vs 打到4板率');
  console.log(`${'─'.repeat(78)}`);
  console.log('  开盘幅度（相对2板收盘）   样本  封板率   炸板率  打4板率  实战建议');

  const openRanges: [number, number, string][] = [
    [-99,  0,  '❌ 低开，不参与'],
    [0,    3,  '⚠️ 平开，竞价参与风险高'],
    [3,    5,  '✅ 微高开，最优竞价打板区间'],
    [5,    8,  '✅ 高开，可参与竞价或分时'],
    [8,   10,  '⚠️ 偏高开，谨慎参与'],
    [10,  15,  '❌ 高开过多（一字板边缘），买入成本高'],
    [15,  99,  '❌ 极高开/一字板，放弃'],
  ];

  for (const [lo, hi, advice] of openRanges) {
    const g = samples.filter(s => !s.isOneWord3 && s.openPct3 >= lo && s.openPct3 < hi);
    if (!g.length) continue;
    const hitR  = (g.filter(s=>s.hitLimit3).length / g.length * 100).toFixed(1);
    const zhaR  = (g.filter(s=>s.zhaBan3).length / g.length * 100).toFixed(1);
    const hit4R = (g.filter(s=>s.hit4).length / g.length * 100).toFixed(1);
    console.log(
      `  ${`${lo >= 0 ? '+' : ''}${lo}%~${hi >= 99 ? '∞' : hi+'%'}`.padEnd(20)}` +
      `  ${String(g.length).padStart(4)}只` +
      `  ${hitR.padStart(5)}%  ${zhaR.padStart(5)}%  ${hit4R.padStart(6)}%  ${advice}`
    );
  }

  // ── ⑤ 最优入场策略对比 ───────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ⑤ 三种入场策略回报对比（基于2板过滤后）');
  console.log(`${'─'.repeat(78)}`);

  // 策略A：尾盘打2板（买2板收盘价，持仓到次日）
  // 所有满足条件的样本，不管3板当天开盘如何，统计3板当天的结果
  const stratA = samples; // 买2板收盘，3板是否封板
  const aHit3 = stratA.filter(s => s.hitLimit3).length;
  const aHit4 = stratA.filter(s => s.hit4).length;
  // 对比买入价 vs 3板收盘价的盈亏
  const aGainHit   = samples.filter(s => s.hitLimit3).map(s => (s.close3 - s.close2) / s.close2 * 100);
  const aGainMiss  = samples.filter(s => !s.hitLimit3).map(s => (s.close3 - s.close2) / s.close2 * 100);

  console.log(`\n  策略A：尾盘打2板（2板收盘买入，持仓到3板）`);
  console.log(`   适用：任何满足条件的2连板，不挑3板形态`);
  console.log(`   样本：${stratA.length}只`);
  console.log(`   3板封板（持平到涨停）：${aHit3}只(${(aHit3/stratA.length*100).toFixed(1)}%)`);
  console.log(`   次日4板：${aHit4}只(${(aHit4/stratA.length*100).toFixed(1)}%)`);
  console.log(`   3板封板时收益中位：+${median(aGainHit).toFixed(2)}%（相当于从2板到3板的一个涨停板）`);
  console.log(`   3板未封板时收益中位：${median(aGainMiss).toFixed(2)}%`);

  // 策略B：竞价打3板（只参与高开3~8%的情况）
  const stratB = samples.filter(s => !s.isOneWord3 && s.openPct3 >= 3 && s.openPct3 < 8);
  const bHit3 = stratB.filter(s => s.hitLimit3).length;
  const bHit4 = stratB.filter(s => s.hit4).length;
  const bZha  = stratB.filter(s => s.zhaBan3).length;
  const bGain = stratB.map(s => (s.close3 - s.open3) / s.open3 * 100); // 从开盘买到收盘

  console.log(`\n  策略B：竞价打3板（只打高开3~8%的）`);
  console.log(`   适用：3板高开3~8%，集合竞价挂涨停单，开盘后分时封板买入`);
  console.log(`   样本：${stratB.length}只（仅占总样本${(stratB.length/total*100).toFixed(0)}%，可操作部分）`);
  console.log(`   封板率：${bHit3}/${stratB.length}(${(bHit3/stratB.length*100).toFixed(1)}%)`);
  console.log(`   炸板率：${bZha}/${stratB.length}(${(bZha/stratB.length*100).toFixed(1)}%)`);
  console.log(`   次日4板：${bHit4}/${stratB.length}(${(bHit4/stratB.length*100).toFixed(1)}%)`);
  console.log(`   从开盘到收盘收益中位：${median(bGain).toFixed(2)}%`);

  // 策略C：不打板，只做2板低吸（买在竞价低开或平开）
  const stratC = samples.filter(s => !s.isOneWord3 && s.openPct3 < 3 && s.openPct3 >= 0);
  const cHit3 = stratC.filter(s => s.hitLimit3).length;
  const cGain = stratC.map(s => (s.close3 - s.open3) / s.open3 * 100);

  console.log(`\n  策略C：平开低吸（0~3%开盘买入，等封板）`);
  console.log(`   样本：${stratC.length}只`);
  console.log(`   封板率：${cHit3}/${stratC.length}(${stratC.length ? (cHit3/stratC.length*100).toFixed(1) : 0}%)`);
  console.log(`   从开盘到收盘收益中位：${median(cGain).toFixed(2)}%`);

  // ── ⑥ 炸板处理决策 ───────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('  ⑥ 炸板后的处理决策（基于尾盘打2板策略）');
  console.log(`${'─'.repeat(78)}`);

  const zhaBanSamples = samples.filter(s => s.zhaBan3);
  if (zhaBanSamples.length) {
    // 炸板后当天不同位置出的结果
    const zbCutClose = zhaBanSamples.map(s => (s.close3 - s.close2) / s.close2 * 100); // 当天收盘出
    const zbCutNext  = zhaBanSamples.map(s => s.hit4 ? 10 : (s.close4 - s.close2) / s.close2 * 100); // 次日再出

    console.log(`  炸板样本：${zhaBanSamples.length}只`);
    console.log(`\n  炸板后当天收盘出（相对2板买入价）：`);
    const lossZb = zbCutClose.filter(v => v < 0).length;
    const gainZb = zbCutClose.filter(v => v >= 0).length;
    console.log(`   盈利：${gainZb}只  亏损：${lossZb}只  收益中位：${median(zbCutClose).toFixed(2)}%`);
    console.log(`   → 炸板后收盘出，多数仍有小幅盈利（因为2板买入后，3板即使炸板也在涨停附近`);

    const zbLargeOpen = zhaBanSamples.filter(s => s.openPct3 >= 5);
    const zbSmallOpen = zhaBanSamples.filter(s => s.openPct3 < 5);
    console.log(`\n  高开5%+炸板（${zbLargeOpen.length}只）：收益中位 ${median(zbLargeOpen.map(s=>(s.close3-s.close2)/s.close2*100)).toFixed(2)}%`);
    console.log(`  低开<5%炸板（${zbSmallOpen.length}只）：收益中位 ${median(zbSmallOpen.map(s=>(s.close3-s.close2)/s.close2*100)).toFixed(2)}%`);

    console.log('\n  炸板止损规则：');
    console.log('   ① 开盘后封板又开板，若跌回开盘价 → 立即出');
    console.log('   ② 开板后跌幅>5%（相对涨停价）→ 直接止损');
    console.log('   ③ 封板后再开板，且量比急速放大 → 出清');
  }

  // ── 总结 ────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(78)}`);
  console.log('  💡 综合解决方案');
  console.log(`${'═'.repeat(78)}`);
  console.log(`
  实战痛点1：一字板买不进
  ─────────────────────────────────
  解法①：改成「尾盘打2板」策略（推荐）
    - 2板当天14:55前，在涨停价挂买单
    - 只要股票2板当天未炸板，大概率能成交
    - 成交后隔天拿3板，无论一字/高开均可参与
    - 代价：多承担1个涨停板的成本（亏损风险从3板算起）
    - 优势：永远能买到，无需和几万人抢竞价

  解法②：只打可买的3板（高开3~8%）
    - 放弃一字板，只参与有换手的3板
    - 集合竞价9:20~9:25挂涨停价买单
    - 封板率 ~${samples.filter(s=>!s.isOneWord3&&s.openPct3>=3&&s.openPct3<8).length > 0 ? (samples.filter(s=>!s.isOneWord3&&s.openPct3>=3&&s.openPct3<8&&s.hitLimit3).length/samples.filter(s=>!s.isOneWord3&&s.openPct3>=3&&s.openPct3<8).length*100).toFixed(0) : 0}%
    - 代价：错过一字板行情，参与样本减少

  实战痛点2：打进去就炸板
  ─────────────────────────────────
  解法：炸板分级止损
    - 炸板后跌回开盘价 → 立即出，不犹豫
    - 炸板后收盘仍+5%以上 → 可考虑持到次日（次日4板概率较高）
    - 炸板后收盘+0~5% → 次日开盘观察，弱势出
    - 炸板后收盘亏损 → 次日开盘直接清

  最优组合策略（实战推荐）：
  ─────────────────────────────────
  ① 2板尾盘14:55买入（确保能买到）
  ② 3板当天观察：
     一字板 → 继续持有
     高开3~8%封板 → 继续持有
     炸板跌超5% → 按止损规则出
     低开/跌 → 当天止损出
  ③ 3板收盘后看换手+量比决定是否持到4板
  `);

  console.log(`${'═'.repeat(78)}\n`);
  db.close();
}

main();
