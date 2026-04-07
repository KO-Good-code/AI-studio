import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'data/prices.db'), { readonly: true });
const date = '2026-04-02';

const total   = (db.prepare('SELECT COUNT(*) as c FROM prices WHERE date=?').get(date) as any).c;
const up      = (db.prepare('SELECT COUNT(*) as c FROM prices WHERE date=? AND quote_rate>0').get(date) as any).c;
const down    = (db.prepare('SELECT COUNT(*) as c FROM prices WHERE date=? AND quote_rate<0').get(date) as any).c;
const limitUp = (db.prepare('SELECT COUNT(*) as c FROM prices WHERE date=? AND high_limit>0 AND close>=high_limit').get(date) as any).c;
const limitDn = (db.prepare('SELECT COUNT(*) as c FROM prices WHERE date=? AND low_limit>0 AND close<=low_limit').get(date) as any).c;

console.log('\n📊 2026-04-02 A股收盘概况');
console.log('─'.repeat(42));
console.log(`总股数: ${total}`);
console.log(`上涨:   ${up}  (${(up/total*100).toFixed(1)}%)`);
console.log(`下跌:   ${down}  (${(down/total*100).toFixed(1)}%)`);
console.log(`平盘:   ${total - up - down}`);
console.log(`涨停:   ${limitUp}  (${(limitUp/total*100).toFixed(2)}%)`);
console.log(`跌停:   ${limitDn}`);

console.log('\n🔥 今日涨幅 Top 10');
const top10 = db.prepare(
  "SELECT code, name, quote_rate, close FROM prices WHERE date=? AND name NOT LIKE '%ST%' ORDER BY quote_rate DESC LIMIT 10"
).all(date) as any[];
top10.forEach((r, i) =>
  console.log(`  ${i+1}. ${r.code} ${(r.name||'').padEnd(8)} ${r.quote_rate?.toFixed(2)}%  ¥${r.close}`)
);

console.log('\n❄️  今日跌幅 Top 10');
const bot10 = db.prepare(
  "SELECT code, name, quote_rate, close FROM prices WHERE date=? AND name NOT LIKE '%ST%' ORDER BY quote_rate ASC LIMIT 10"
).all(date) as any[];
bot10.forEach((r, i) =>
  console.log(`  ${i+1}. ${r.code} ${(r.name||'').padEnd(8)} ${r.quote_rate?.toFixed(2)}%  ¥${r.close}`)
);

console.log('\n📈 近5日涨停比趋势（判断大盘状态）');
const last5 = db.prepare(`
  SELECT date,
    COUNT(*) as total,
    SUM(CASE WHEN high_limit>0 AND close>=high_limit THEN 1 ELSE 0 END) as lu,
    SUM(CASE WHEN low_limit>0  AND close<=low_limit  THEN 1 ELSE 0 END) as ld
  FROM prices
  WHERE date >= date('2026-04-02','-10 days') AND date <= '2026-04-02'
  GROUP BY date ORDER BY date DESC LIMIT 5
`).all() as any[];

last5.forEach(r => {
  const pct = (r.lu / r.total * 100).toFixed(2);
  const bar = '█'.repeat(Math.min(20, Math.round(r.lu / r.total * 500)));
  console.log(`  ${r.date}  涨停:${String(r.lu).padStart(3)}只  跌停:${String(r.ld).padStart(3)}只  占比:${pct}%  ${bar}`);
});

const avg5 = last5.reduce((s, r) => s + r.lu / r.total, 0) / last5.length * 100;
console.log(`\n  5日均涨停比: ${avg5.toFixed(3)}%`);
if (avg5 >= 2.0)       console.log('  📗 大盘状态: 牛市（双策略 → 牛市模式，满5仓ORIG）');
else if (avg5 >= 0.8)  console.log('  📒 大盘状态: 震荡市（双策略 → 震荡模式，3仓RT10）');
else                   console.log('  📕 大盘状态: 熊市（双策略 → 空仓等待）');

db.close();
