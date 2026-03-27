import { NextRequest, NextResponse } from 'next/server';
import {
  listConversations,
  createConversation,
  type ConversationMessage,
} from '@/lib/storage/conversations';

export async function GET() {
  try {
    const list = await listConversations();
    return NextResponse.json({ success: true, conversations: list });
  } catch (err) {
    console.error('[conversations] list error:', err);
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
    const b = body as {
      model?: string;
      isTeamMode?: boolean;
      teamId?: string | null;
      messages?: unknown;
    };
    const conv = await createConversation({
      model: b.model ?? 'unknown',
      isTeamMode: !!b.isTeamMode,
      teamId: b.teamId ?? null,
      messages: Array.isArray(b.messages)
        ? (b.messages as ConversationMessage[])
        : [],
    });
    return NextResponse.json({ success: true, conversation: conv });
  } catch (err) {
    console.error('[conversations] create error:', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
