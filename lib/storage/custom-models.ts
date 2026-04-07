/**
 * 自定义模型持久化
 * 支持用户添加 OpenAI 兼容的第三方模型（DeepSeek、Moonshot、Groq、本地 Ollama 等）
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const MODELS_FILE = path.join(DATA_DIR, 'custom-models.json');

export interface CustomModelConfig {
  id: string;
  /** 实际传给 API 的模型名称（如 deepseek-chat, gpt-4o） */
  name: string;
  /** 用户可见的展示名称 */
  displayName: string;
  /** 提供商分类标签 */
  providerLabel: string;
  /** API Base URL（如 https://api.deepseek.com/v1） */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 最大输出 tokens */
  maxTokens?: number;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

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

async function loadAll(): Promise<CustomModelConfig[]> {
  await ensureDir();
  if (!existsSync(MODELS_FILE)) return [];
  try {
    const raw = await readFile(MODELS_FILE, 'utf-8');
    return JSON.parse(raw) as CustomModelConfig[];
  } catch {
    return [];
  }
}

async function saveAll(items: CustomModelConfig[]): Promise<void> {
  await ensureDir();
  await writeFile(MODELS_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listCustomModels(): Promise<CustomModelConfig[]> {
  const items = await loadAll();
  items.sort((a, b) => a.createdAt - b.createdAt);
  return items;
}

export function getCustomModelById(id: string): Promise<CustomModelConfig | null> {
  return loadAll().then((items) => items.find((m) => m.id === id) ?? null);
}

export function addCustomModel(
  data: Omit<CustomModelConfig, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CustomModelConfig> {
  return withLock(async () => {
    const items = await loadAll();
    const now = Date.now();
    const model: CustomModelConfig = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    items.push(model);
    await saveAll(items);
    return model;
  });
}

export function updateCustomModel(
  id: string,
  patch: Partial<Omit<CustomModelConfig, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<CustomModelConfig | null> {
  return withLock(async () => {
    const items = await loadAll();
    const item = items.find((m) => m.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    item.updatedAt = Date.now();
    await saveAll(items);
    return item;
  });
}

export function deleteCustomModel(id: string): Promise<boolean> {
  return withLock(async () => {
    const items = await loadAll();
    const idx = items.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await saveAll(items);
    return true;
  });
}
