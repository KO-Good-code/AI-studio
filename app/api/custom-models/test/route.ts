import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: '无效的 JSON 请求体' }, { status: 400 });
    }

    const { baseUrl, apiKey, model } = body as Record<string, string>;

    if (!baseUrl?.trim() || !apiKey?.trim() || !model?.trim()) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const url = `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: model.trim(),
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      }),
      signal: ac.signal,
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content ?? '';
      return NextResponse.json({ success: true, reply: reply.slice(0, 100) });
    }

    const text = await res.text();
    return NextResponse.json({
      success: false,
      error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      return NextResponse.json({ success: false, error: '连接超时（15秒）' });
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
