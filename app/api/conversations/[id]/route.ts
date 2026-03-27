import { NextRequest, NextResponse } from 'next/server';
import {
  getConversation,
  updateConversation,
  deleteConversation,
  type Conversation,
} from '@/lib/storage/conversations';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv) {
    return NextResponse.json(
      { success: false, error: 'not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, conversation: conv });
}

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
  const conv = await updateConversation(
    id,
    body as Partial<
      Pick<
        Conversation,
        'title' | 'messages' | 'model' | 'isTeamMode' | 'teamId'
      >
    >
  );
  if (!conv) {
    return NextResponse.json(
      { success: false, error: 'not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, conversation: conv });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteConversation(id);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'not found' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true });
}
