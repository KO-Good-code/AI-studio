/**
 * 会话持久化 — JSON 文件存储（零依赖，开发友好）
 * 每个会话一个 JSON 文件，保存在 data/conversations/ 下
 */
import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data', 'conversations');

async function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  isTeamMode: boolean;
  teamId?: string | null;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
}

export type ConversationSummary = Omit<Conversation, 'messages'> & {
  messageCount: number;
};

function safeName(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitized) throw new Error('invalid conversation id');
  return sanitized;
}

function filePath(id: string): string {
  return path.join(DATA_DIR, `${safeName(id)}.json`);
}

export function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromMessages(messages: ConversationMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '新对话';
  const text = first.content.trim();
  return text.length > 40 ? text.slice(0, 40) + '…' : text || '新对话';
}

export async function createConversation(
  data: Pick<Conversation, 'model' | 'isTeamMode' | 'teamId' | 'messages'>
): Promise<Conversation> {
  await ensureDir();
  const now = Date.now();
  const conv: Conversation = {
    id: generateId(),
    title: titleFromMessages(data.messages),
    model: data.model,
    isTeamMode: data.isTeamMode,
    teamId: data.teamId ?? null,
    messages: data.messages,
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(filePath(conv.id), JSON.stringify(conv, null, 2), 'utf-8');
  return conv;
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, 'title' | 'messages' | 'model' | 'isTeamMode' | 'teamId'>>
): Promise<Conversation | null> {
  const conv = await getConversation(id);
  if (!conv) return null;
  if (patch.title !== undefined) conv.title = patch.title;
  if (patch.messages !== undefined) {
    conv.messages = patch.messages;
    if (!patch.title) conv.title = titleFromMessages(conv.messages);
  }
  if (patch.model !== undefined) conv.model = patch.model;
  if (patch.isTeamMode !== undefined) conv.isTeamMode = patch.isTeamMode;
  if (patch.teamId !== undefined) conv.teamId = patch.teamId;
  conv.updatedAt = Date.now();
  await writeFile(filePath(id), JSON.stringify(conv, null, 2), 'utf-8');
  return conv;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  await ensureDir();
  const fp = filePath(id);
  if (!existsSync(fp)) return null;
  try {
    const raw = await readFile(fp, 'utf-8');
    return JSON.parse(raw) as Conversation;
  } catch {
    return null;
  }
}

export async function listConversations(): Promise<ConversationSummary[]> {
  await ensureDir();
  const files = await readdir(DATA_DIR);
  const items: ConversationSummary[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await readFile(path.join(DATA_DIR, f), 'utf-8');
      const conv = JSON.parse(raw) as Conversation;
      const { messages, ...rest } = conv;
      items.push({ ...rest, messageCount: messages.length });
    } catch {
      /* skip corrupt */
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export async function deleteConversation(id: string): Promise<boolean> {
  await ensureDir();
  const fp = filePath(id);
  if (!existsSync(fp)) return false;
  await unlink(fp);
  return true;
}
