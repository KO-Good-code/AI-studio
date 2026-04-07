import { NextResponse } from 'next/server';
import { listCustomModels, addCustomModel } from '@/lib/storage/custom-models';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const models = await listCustomModels();
    const safe = models.map((m) => ({
      ...m,
      apiKey: m.apiKey ? `${m.apiKey.slice(0, 4)}****` : '',
    }));
    return NextResponse.json({ success: true, models: safe });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: '无效的 JSON 请求体' }, { status: 400 });
    }

    const { name, displayName, providerLabel, baseUrl, apiKey, maxTokens, description } =
      body as Record<string, unknown>;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, error: '模型名称不能为空' }, { status: 400 });
    }
    if (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.trim()) {
      return NextResponse.json({ success: false, error: 'API Base URL 不能为空' }, { status: 400 });
    }
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json({ success: false, error: 'API Key 不能为空' }, { status: 400 });
    }

    const model = await addCustomModel({
      name: (name as string).trim(),
      displayName: typeof displayName === 'string' && displayName.trim()
        ? displayName.trim()
        : `🔗 ${(name as string).trim()}`,
      providerLabel: typeof providerLabel === 'string' && providerLabel.trim()
        ? providerLabel.trim()
        : 'Custom',
      baseUrl: (baseUrl as string).trim().replace(/\/+$/, ''),
      apiKey: (apiKey as string).trim(),
      maxTokens: typeof maxTokens === 'number' ? maxTokens : undefined,
      description: typeof description === 'string' ? description.trim() : undefined,
    });

    return NextResponse.json({
      success: true,
      model: { ...model, apiKey: `${model.apiKey.slice(0, 4)}****` },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
