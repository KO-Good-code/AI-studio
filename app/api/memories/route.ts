import { NextRequest, NextResponse } from 'next/server';
import {
  listMemories,
  addMemory,
  clearAllMemories,
  type MemoryItem,
} from '@/lib/storage/memories';

export async function GET() {
  try {
    const items = await listMemories();
    return NextResponse.json({ success: true, memories: items });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '无效的 JSON 请求体' },
      { status: 400 }
    );
  }

  try {
    const { content, category } = body as {
      content?: string;
      category?: MemoryItem['category'];
    };
    if (!content?.trim()) {
      return NextResponse.json(
        { success: false, error: 'content is required' },
        { status: 400 }
      );
    }
    const item = await addMemory(content, category ?? 'other', 'manual');
    return NextResponse.json({ success: true, memory: item });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await clearAllMemories();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
