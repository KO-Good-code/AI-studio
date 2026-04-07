/**
 * 近1年所有回封入场案例 — 最高连板数 & 最大涨幅统计
 */
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data/prices.db');
const db = new Database(DB_PATH, { readonly: true });

const allCases = [
  // ── 封板成功 ──
  { entryDate:'2025-05-12', code:'002190.SZ', name:'成飞集成',  result:'seal', maxBoards:8  },
  { entryDate:'2026-03-19', code:'600396.SH', name:'华电辽能',  result:'seal', maxBoards:7  },
  { entryDate:'2024-10-30', code:'600481.SH', name:'双良节能',  result:'seal', maxBoards:5  },
  { entryDate:'2024-11-11', code:'002510.SZ', name:'天汽模',    result:'seal', maxBoards:4  },
  { entryDate:'2025-08-06', code:'603767.SH', name:'中马传动',  result:'seal', maxBoards:4  },
  { entryDate:'2026-03-27', code:'603538.SH', name:'美诺华',    result:'seal', maxBoards:4  },
  { entryDate:'2024-10-30', code:'002243.SZ', name:'力合科创',  result:'seal', maxBoards:3  },
  { entryDate:'2024-11-11', code:'600210.SH', name:'紫江企业',  result:'seal', maxBoards:3  },
  { entryDate:'2024-11-13', code:'603918.SH', name:'金桥信息',  result:'seal', maxBoards:3  },
  { entryDate:'2024-11-29', code:'600327.SH', name:'大东方',    result:'seal', maxBoards:3  },
  { entryDate:'2024-12-11', code:'002403.SZ', name:'爱仕达',    result:'seal', maxBoards:3  },
  { entryDate:'2024-12-13', code:'002115.SZ', name:'三维通信',  result:'seal', maxBoards:3  },
  { entryDate:'2025-03-26', code:'002300.SZ', name:'太阳电缆',  result:'seal', maxBoards:3  },
  { entryDate:'2025-04-24', code:'002537.SZ', name:'海联金汇',  result:'seal', maxBoards:3  },
  { entryDate:'2025-07-24', code:'002097.SZ', name:'山河智能',  result:'seal', maxBoards:3  },
  { entryDate:'2025-08-13', code:'002941.SZ', name:'新疆交建',  result:'seal', maxBoards:3  },
  { entryDate:'2025-09-22', code:'002059.SZ', name:'云南旅游',  result:'seal', maxBoards:3  },
  { entryDate:'2025-10-13', code:'603011.SH', name:'合锻智能',  result:'seal', maxBoards:3  },
  { entryDate:'2025-12-02', code:'603933.SH', name:'睿能科技',  result:'seal', maxBoards:3  },
  { entryDate:'2025-12-24', code:'002163.SZ', name:'海南发展',  result:'seal', maxBoards:3  },
  { entryDate:'2025-12-25', code:'000551.SZ', name:'创元科技',  result:'seal', maxBoards:3  },
  { entryDate:'2026-01-08', code:'600775.SH', name:'南京熊猫',  result:'seal', maxBoards:3  },
  { entryDate:'2026-01-13', code:'002342.SZ', name:'巨力索具',  result:'seal', maxBoards:3  },
  { entryDate:'2026-02-11', code:'002455.SZ', name:'百川股份',  result:'seal', maxBoards:3  },
  { entryDate:'2026-03-09', code:'000533.SZ', name:'顺钠股份',  result:'seal', maxBoards:3  },
  { entryDate:'2026-03-11', code:'601789.SH', name:'宁波建工',  result:'seal', maxBoards:3  },
  { entryDate:'2026-03-25', code:'002309.SZ', name:'中利集团',  result:'seal', maxBoards:3  },
  { entryDate:'2026-03-27', code:'000720.SZ', name:'新能泰山',  result:'seal', maxBoards:3  },
  // ── 炸板 ──
  { entryDate:'2024-10-23', code:'000016.SZ', name:'深康佳A',   result:'zhaban', maxBoards:2 },
  { entryDate:'2024-12-03', code:'600589.SH', name:'大位科技',  result:'zhaban', maxBoards:2 },
  { entryDate:'2024-12-10', code:'603466.SH', name:'风语筑',    result:'zhaban', maxBoards:2 },
  { entryDate:'2024-12-17', code:'600829.SH', name:'人民同泰',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-03-27', code:'603011.SH', name:'合锻智能',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-05-16', code:'600530.SH', name:'交大昂立',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-05-30', code:'603390.SH', name:'通达电气',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-06-03', code:'002907.SZ', name:'华森制药',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-06-04', code:'603123.SH', name:'翠微股份',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-07-10', code:'002951.SZ', name:'金时科技',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-07-23', code:'600629.SH', name:'华建集团',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-09-03', code:'603032.SH', name:'德新科技',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-10-17', code:'002370.SZ', name:'亚太药业',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-10-29', code:'000599.SZ', name:'青岛双星',  result:'zhaban', maxBoards:2 },
  { entryDate:'2025-12-16', code:'002471.SZ', name:'中超控股',  result:'zhaban', maxBoards:2 },
  { entryDate:'2026-03-02', code:'000899.SZ', name:'赣能股份',  result:'zhaban', maxBoards:2 },
  { entryDate:'2026-03-05', code:'600759.SH', name:'洲际油气',  result:'zhaban', maxBoards:2 },
  { entryDate:'2026-03-16', code:'600722.SH', name:'金牛化工',  result:'zhaban', maxBoards:2 },
] as const;

function getMaxGain(code: string, entryDate: string) {
  const bars = db.prepare(
    "SELECT close FROM prices WHERE code=? AND date>? ORDER BY date ASC LIMIT 20"
  ).all(code, entryDate) as any[];
  const d = db.prepare('SELECT close FROM prices WHERE code=? AND date=?').get(code, entryDate) as any;
  if (!d || bars.length === 0) return { entryPrice: 0, maxClose: 0, maxGainPct: 0, peakDay: 0 };
  const entryPrice = d.close;
  let maxClose = entryPrice, peakDay = 0;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].close > maxClose) { maxClose = bars[i].close; peakDay = i + 1; }
  }
  return { entryPrice, maxClose, maxGainPct: (maxClose - entryPrice) / entryPrice * 100, peakDay };
}

// 排序：板数降序 → 日期升序
const sorted = [...allCases].sort((a, b) =>
  b.maxBoards !== a.maxBoards ? b.maxBoards - a.maxBoards : a.entryDate.localeCompare(b.entryDate)
);

console.log(`\n${'═'.repeat(92)}`);
console.log('  📊 近1年 回封入场案例 — 最高连板数 & 后续最大涨幅');
console.log(`  共 ${allCases.length} 笔（28封板 + 18炸板）`);
console.log(`${'═'.repeat(92)}`);
console.log(
  `  ${'No'.padEnd(4)} ${'入场日'.padEnd(12)} ${'代码'.padEnd(12)} ${'名称'.padEnd(10)}` +
  ` ${'结果'.padEnd(5)} ${'最高板数'.padEnd(14)} ${'入场价'.padStart(7)} ${'后续最高'.padStart(8)} ${'最大涨幅'.padStart(8)} ${'峰值天'}`
);
console.log(`  ${'─'.repeat(88)}`);

const byBoards: Record<number, { cnt: number; gainSum: number; cases: string[] }> = {};

sorted.forEach((c, idx) => {
  const { entryPrice, maxClose, maxGainPct, peakDay } = getMaxGain(c.code, c.entryDate);
  const icon  = c.result === 'seal' ? '✅封' : '💥炸';
  const stars = c.result === 'seal'
    ? (c.maxBoards >= 6 ? '★★★' : c.maxBoards >= 4 ? '★★ ' : '★  ')
    : '   ';
  const boardBar = '▌'.repeat(c.maxBoards);

  if (!byBoards[c.maxBoards]) byBoards[c.maxBoards] = { cnt: 0, gainSum: 0, cases: [] };
  byBoards[c.maxBoards].cnt++;
  byBoards[c.maxBoards].gainSum += maxGainPct;
  byBoards[c.maxBoards].cases.push(c.name);

  console.log(
    `  ${String(idx + 1).padStart(3)}. ${c.entryDate}  ${c.code}  ${c.name.padEnd(10)}` +
    `  ${icon}  ${stars} ${c.maxBoards}板 ${boardBar.padEnd(8)}` +
    `  ¥${entryPrice > 0 ? entryPrice.toFixed(2).padStart(6) : ' N/A  '}` +
    `  ¥${maxClose  > 0 ? maxClose.toFixed(2).padStart(6)  : ' N/A  '}` +
    `  ${maxGainPct >= 0 ? '+' : ''}${maxGainPct.toFixed(1).padStart(5)}%` +
    `  第${peakDay}天`
  );
});

// ── 汇总统计 ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(92)}`);
console.log('  📈 按最高连板数分组汇总');
console.log(`  ${'板数'.padEnd(14)} ${'次数'.padStart(4)} ${'占比'.padStart(6)} ${'平均最大涨幅'.padStart(10)}  分布`);
console.log(`  ${'─'.repeat(70)}`);

const boardKeys = Object.keys(byBoards).map(Number).sort((a, b) => b - a);
for (const b of boardKeys) {
  const { cnt, gainSum } = byBoards[b];
  const avgG = gainSum / cnt;
  const pct  = cnt / allCases.length * 100;
  const bar  = '█'.repeat(cnt);
  const label = b === 2 ? '2板（炸板止）  ' : `${b}板           `;
  console.log(
    `  ${label.slice(0, 14)}${String(cnt).padStart(4)}次` +
    `  ${pct.toFixed(1).padStart(5)}%` +
    `  ${(avgG >= 0 ? '+' : '')}${avgG.toFixed(1).padStart(7)}%` +
    `  ${bar}`
  );
}

const sealCases  = sorted.filter(c => c.result === 'seal');
const zhabanCases = sorted.filter(c => c.result === 'zhaban');
const sealGains   = sealCases.map(c => getMaxGain(c.code, c.entryDate).maxGainPct);
const zhabanGains = zhabanCases.map(c => getMaxGain(c.code, c.entryDate).maxGainPct);
const avgSeal   = sealGains.reduce((s, v) => s + v, 0) / sealGains.length;
const avgZhaban = zhabanGains.reduce((s, v) => s + v, 0) / zhabanGains.length;
const allGains  = sorted.map(c => getMaxGain(c.code, c.entryDate).maxGainPct);
const avgAll    = allGains.reduce((s, v) => s + v, 0) / allGains.length;

console.log(`\n${'─'.repeat(92)}`);
console.log('  💰 收益空间汇总');
console.log(`  封板成功（28笔）平均后续最大涨幅：+${avgSeal.toFixed(1)}%`);
console.log(`  炸板（18笔）    平均后续最大涨幅：+${avgZhaban.toFixed(1)}%`);
console.log(`  全部（46笔）    平均后续最大涨幅：+${avgAll.toFixed(1)}%`);
console.log(`\n  连板数分布简图：`);
for (const b of boardKeys) {
  const { cnt } = byBoards[b];
  const bar = '█'.repeat(cnt * 2);
  console.log(`    ${b}板 ${'█'.repeat(cnt)}（${cnt}次）`);
}
console.log(`${'═'.repeat(92)}\n`);

db.close();
