import Database from 'better-sqlite3';
import path from 'path';
import { existsSync } from 'fs';
import type { DayBar } from './types';

const DB_PATH = path.join(process.cwd(), 'data', 'prices.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `数据库不存在: ${DB_PATH}\n请先运行: npx tsx scripts/import-prices.ts`
    );
  }
  _db = new Database(DB_PATH, { readonly: true });
  _db.pragma('cache_size = -128000');
  return _db;
}

export function queryByCode(
  code: string,
  startDate: string,
  endDate: string
): DayBar[] {
  return getDb()
    .prepare(
      'SELECT * FROM prices WHERE code = ? AND date >= ? AND date <= ? ORDER BY date'
    )
    .all(code, startDate, endDate) as DayBar[];
}

export function queryByDate(date: string): DayBar[] {
  return getDb()
    .prepare('SELECT * FROM prices WHERE date = ?')
    .all(date) as DayBar[];
}

export function queryLimitUpStocks(date: string): DayBar[] {
  return getDb()
    .prepare(
      `SELECT * FROM prices
       WHERE date = ? AND high_limit IS NOT NULL AND close >= high_limit AND high_limit > 0
       ORDER BY turnover_rate DESC`
    )
    .all(date) as DayBar[];
}

export function getNextTradingDay(date: string, offset = 1): string | null {
  const row = getDb()
    .prepare(
      `SELECT DISTINCT date FROM prices WHERE date > ? ORDER BY date LIMIT 1 OFFSET ?`
    )
    .get(date, offset - 1) as { date: string } | undefined;
  return row?.date ?? null;
}

export function getTradingDates(startDate: string, endDate: string): string[] {
  return (
    getDb()
      .prepare(
        'SELECT DISTINCT date FROM prices WHERE date >= ? AND date <= ? ORDER BY date'
      )
      .all(startDate, endDate) as { date: string }[]
  ).map((r) => r.date);
}

export function queryByDateRange(
  startDate: string,
  endDate: string,
  filters?: { industry?: string; minMV?: number; market?: string }
): DayBar[] {
  let sql = 'SELECT * FROM prices WHERE date >= ? AND date <= ?';
  const params: unknown[] = [startDate, endDate];

  if (filters?.industry) {
    sql += ' AND industry = ?';
    params.push(filters.industry);
  }
  if (filters?.market) {
    sql += ' AND market = ?';
    params.push(filters.market);
  }
  if (filters?.minMV) {
    sql += ' AND circ_mv >= ?';
    params.push(filters.minMV);
  }

  sql += ' ORDER BY date, code';
  return getDb().prepare(sql).all(...params) as DayBar[];
}

export function getStockDayOnDate(
  code: string,
  date: string
): DayBar | null {
  return (
    (getDb()
      .prepare('SELECT * FROM prices WHERE code = ? AND date = ?')
      .get(code, date) as DayBar) ?? null
  );
}

export function getStockNextDays(
  code: string,
  afterDate: string,
  limit: number
): DayBar[] {
  return getDb()
    .prepare(
      'SELECT * FROM prices WHERE code = ? AND date > ? ORDER BY date LIMIT ?'
    )
    .all(code, afterDate, limit) as DayBar[];
}

export function isDbReady(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}
