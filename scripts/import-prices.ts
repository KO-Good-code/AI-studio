/**
 * CSV → SQLite 导入脚本
 * 用法: npx tsx scripts/import-prices.ts
 */
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import Database from 'better-sqlite3';

const CSV_PATH = path.join(process.cwd(), 'data', 'all-prices.csv');
const DB_PATH = path.join(process.cwd(), 'data', 'prices.db');

const BATCH_SIZE = 10_000;

const KEEP_COLS = [
  'code', 'date', 'open', 'high', 'low', 'close',
  'prev_close', 'quote_rate', 'volume', 'turnover',
  'high_limit', 'low_limit', 'turnover_rate', 'turnover_rate_f',
  'volume_ratio', 'pe', 'pe_ttm', 'pb', 'ps', 'ps_ttm',
  'total_mv', 'circ_mv', 'name', 'industry', 'market',
] as const;

const TEXT_COLS = new Set(['code', 'date', 'name', 'industry', 'market']);

function createTable(db: Database.Database) {
  const cols = KEEP_COLS.map(
    (c) => `${c} ${TEXT_COLS.has(c) ? 'TEXT' : 'REAL'}`
  ).join(', ');

  db.exec(`DROP TABLE IF EXISTS prices`);
  db.exec(`CREATE TABLE prices (${cols})`);
}

function createIndexes(db: Database.Database) {
  console.log('🔨 创建索引...');
  db.exec('CREATE INDEX idx_code_date ON prices(code, date)');
  db.exec('CREATE INDEX idx_date ON prices(date)');
  db.exec('CREATE INDEX idx_industry_date ON prices(industry, date)');
  console.log('✅ 索引创建完成');
}

async function main() {
  console.log(`📂 CSV: ${CSV_PATH}`);
  console.log(`💾 DB:  ${DB_PATH}`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -512000'); // 512MB cache

  createTable(db);

  const placeholders = KEEP_COLS.map(() => '?').join(', ');
  const insertStmt = db.prepare(
    `INSERT INTO prices (${KEEP_COLS.join(', ')}) VALUES (${placeholders})`
  );
  const insertMany = db.transaction((rows: unknown[][]) => {
    for (const row of rows) insertStmt.run(...row);
  });

  const rl = createInterface({
    input: createReadStream(CSV_PATH, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let headerMap: Map<string, number> | null = null;
  let batch: unknown[][] = [];
  let total = 0;
  const t0 = Date.now();

  for await (const line of rl) {
    if (!headerMap) {
      const headers = line.split(',');
      headerMap = new Map(headers.map((h, i) => [h.trim(), i]));
      continue;
    }

    const fields = line.split(',');
    const row = KEEP_COLS.map((col) => {
      const idx = headerMap!.get(col);
      if (idx === undefined) return null;
      const val = fields[idx]?.trim() ?? '';
      if (!val) return null;
      return TEXT_COLS.has(col) ? val : Number(val);
    });

    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      total += batch.length;
      batch = [];
      if (total % 500_000 === 0) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  ⏳ ${(total / 1e6).toFixed(1)}M 行 (${elapsed}s)`);
      }
    }
  }

  if (batch.length > 0) {
    insertMany(batch);
    total += batch.length;
  }

  console.log(`✅ 导入完成: ${total.toLocaleString()} 行 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  createIndexes(db);

  const count = db.prepare('SELECT COUNT(*) as cnt FROM prices').get() as { cnt: number };
  const sample = db.prepare('SELECT * FROM prices LIMIT 3').all();
  console.log(`📊 验证: ${count.cnt.toLocaleString()} 行`);
  console.log('📄 示例:', JSON.stringify(sample[0]).slice(0, 200));

  db.close();
  console.log('🎉 全部完成！');
}

main().catch((err) => {
  console.error('❌ 导入失败:', err);
  process.exit(1);
});
