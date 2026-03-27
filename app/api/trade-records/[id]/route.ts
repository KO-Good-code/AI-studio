import { NextRequest, NextResponse } from 'next/server';
import { updateTradeRecord, deleteTradeRecord } from '@/lib/storage/trade-records';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '无效的 JSON 请求体' },
      { status: 400 }
    );
  }
  const record = await updateTradeRecord(id, body);
  if (!record) {
    return NextResponse.json(
      { success: false, error: 'not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, record });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteTradeRecord(id);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true });
}
