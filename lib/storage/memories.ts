/**
 * 用户记忆持久化 — 类似 ChatGPT Memory / Open WebUI
 * 每条记忆是一个事实/偏好/习惯，跨会话持久保留
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(() => {}, () => {});
  return next;
}

export interface MemoryItem {
  id: string;
  content: string;
  category: 'preference' | 'fact' | 'habit' | 'instruction' | 'other';
  source: 'auto' | 'manual';
  createdAt: number;
  updatedAt: number;
}

async function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function loadAll(): Promise<MemoryItem[]> {
  await ensureDir();
  if (!existsSync(MEMORIES_FILE)) return [];
  try {
    const raw = await readFile(MEMORIES_FILE, 'utf-8');
    return JSON.parse(raw) as MemoryItem[];
  } catch {
    return [];
  }
}

async function saveAll(items: MemoryItem[]): Promise<void> {
  await ensureDir();
  await writeFile(MEMORIES_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function generateId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listMemories(): Promise<MemoryItem[]> {
  const items = await loadAll();
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export function addMemory(
  content: string,
  category: MemoryItem['category'] = 'other',
  source: MemoryItem['source'] = 'manual'
): Promise<MemoryItem> {
  return withLock(async () => {
    const items = await loadAll();
    const existing = items.find(
      (m) => m.content.trim().toLowerCase() === content.trim().toLowerCase()
    );
    if (existing) {
      existing.updatedAt = Date.now();
      await saveAll(items);
      return existing;
    }
    const now = Date.now();
    const item: MemoryItem = {
      id: generateId(),
      content: content.trim(),
      category,
      source,
      createdAt: now,
      updatedAt: now,
    };
    items.push(item);
    await saveAll(items);
    return item;
  });
}

export function addMemories(
  entries: Array<{ content: string; category?: MemoryItem['category'] }>
): Promise<MemoryItem[]> {
  return withLock(async () => {
    const items = await loadAll();
    const added: MemoryItem[] = [];
    for (const entry of entries) {
      const lc = entry.content.trim().toLowerCase();
      const existing = items.find((m) => m.content.trim().toLowerCase() === lc);
      if (existing) {
        existing.updatedAt = Date.now();
        added.push(existing);
        continue;
      }
      const now = Date.now();
      const item: MemoryItem = {
        id: generateId(),
        content: entry.content.trim(),
        category: entry.category ?? 'other',
        source: 'auto',
        createdAt: now,
        updatedAt: now,
      };
      items.push(item);
      added.push(item);
    }
    await saveAll(items);
    return added;
  });
}

export function updateMemory(
  id: string,
  patch: Partial<Pick<MemoryItem, 'content' | 'category'>>
): Promise<MemoryItem | null> {
  return withLock(async () => {
    const items = await loadAll();
    const item = items.find((m) => m.id === id);
    if (!item) return null;
    if (patch.content !== undefined) item.content = patch.content.trim();
    if (patch.category !== undefined) item.category = patch.category;
    item.updatedAt = Date.now();
    await saveAll(items);
    return item;
  });
}

export function deleteMemory(id: string): Promise<boolean> {
  return withLock(async () => {
    const items = await loadAll();
    const idx = items.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await saveAll(items);
    return true;
  });
}

export function clearAllMemories(): Promise<void> {
  return withLock(async () => {
    await saveAll([]);
  });
}

export async function getMemoryPrompt(): Promise<string> {
  const items = await listMemories();
  if (items.length === 0) return '';
  const lines = items.map((m) => `- ${m.content}`);
  return [
    '## 用户记忆',
    '以下是你已了解到的关于用户的信息，请在回答中自然地运用这些知识，无需重复提及：',
    ...lines,
  ].join('\n');
}
