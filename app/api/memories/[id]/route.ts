import { NextRequest, NextResponse } from 'next/server';
import {
  updateMemory,
  deleteMemory,
  type MemoryItem,
} from '@/lib/storage/memories';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '无效的 JSON 请求体' },
      { status: 400 }
    );
  }
  const item = await updateMemory(
    id,
    body as Partial<Pick<MemoryItem, 'content' | 'category'>>
  );
  if (!item) {
    return NextResponse.json(
      { success: false, error: 'not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, memory: item });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteMemory(id);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true });
}
