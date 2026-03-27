/**
 * 打板操作记录持久化
 * 参考格式：股票名/代码、主线概念、龙头标识、仓位、市值/股价、日期、涨幅、连板数、策略备注
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'trade-records.json');

export interface TradeRecord {
  id: string;
  stockName: string;
  stockCode: string;
  /** 主线概念（如"电力+氢能"、"算力协同"） */
  concept: string;
  /** 是否龙一 */
  isDragon: boolean;
  /** 仓位描述（如"必须满仓"、"1/2仓"、"1/3仓"、"1w"） */
  position: string;
  /** 操作日期 YYYYMMDD */
  tradeDate: string;
  /** 市值（亿） */
  marketCap?: string;
  /** 股价（元） */
  price?: string;
  /** 涨幅（如"10.00%"） */
  changePercent: string;
  /** 连板信息（如"首板"、"2连板"、"3连板"、"断板反包"） */
  boardInfo: string;
  /** 策略备注（如"涨停,不能直接排板,只打回封"） */
  strategy: string;
  /** 补充说明 */
  notes: string;
  /** 来源：manual=手动录入 ai=AI对话中提取 */
  source: 'manual' | 'ai';
  createdAt: number;
  updatedAt: number;
}

export type TradeRecordSummary = TradeRecord;

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(() => {}, () => {});
  return next;
}

async function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function loadAll(): Promise<TradeRecord[]> {
  await ensureDir();
  if (!existsSync(RECORDS_FILE)) return [];
  try {
    const raw = await readFile(RECORDS_FILE, 'utf-8');
    return JSON.parse(raw) as TradeRecord[];
  } catch {
    return [];
  }
}

async function saveAll(items: TradeRecord[]): Promise<void> {
  await ensureDir();
  await writeFile(RECORDS_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function generateId(): string {
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listTradeRecords(): Promise<TradeRecord[]> {
  const items = await loadAll();
  items.sort((a, b) => {
    const dateCompare = b.tradeDate.localeCompare(a.tradeDate);
    if (dateCompare !== 0) return dateCompare;
    return b.createdAt - a.createdAt;
  });
  return items;
}

export function addTradeRecord(
  data: Omit<TradeRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<TradeRecord> {
  return withLock(async () => {
    const items = await loadAll();
    const now = Date.now();
    const record: TradeRecord = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    items.push(record);
    await saveAll(items);
    return record;
  });
}

export function addTradeRecords(
  records: Array<Omit<TradeRecord, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<TradeRecord[]> {
  return withLock(async () => {
    const items = await loadAll();
    const now = Date.now();
    const added: TradeRecord[] = [];
    for (const data of records) {
      const record: TradeRecord = {
        ...data,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      items.push(record);
      added.push(record);
    }
    await saveAll(items);
    return added;
  });
}

export function updateTradeRecord(
  id: string,
  patch: Partial<Omit<TradeRecord, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<TradeRecord | null> {
  return withLock(async () => {
    const items = await loadAll();
    const item = items.find((r) => r.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    item.updatedAt = Date.now();
    await saveAll(items);
    return item;
  });
}

export function deleteTradeRecord(id: string): Promise<boolean> {
  return withLock(async () => {
    const items = await loadAll();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await saveAll(items);
    return true;
  });
}
