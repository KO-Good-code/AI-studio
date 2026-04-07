import { NextResponse } from 'next/server';
import { updateCustomModel, deleteCustomModel, getCustomModelById } from '@/lib/storage/custom-models';

export const runtime = 'nodejs';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: '无效的 JSON 请求体' }, { status: 400 });
    }

    const { name, displayName, providerLabel, baseUrl, apiKey, maxTokens, description } =
      body as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim()) patch.name = name.trim();
    if (typeof displayName === 'string' && displayName.trim()) patch.displayName = displayName.trim();
    if (typeof providerLabel === 'string') patch.providerLabel = providerLabel.trim();
    if (typeof baseUrl === 'string' && baseUrl.trim()) patch.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (typeof apiKey === 'string' && apiKey.trim() && !apiKey.includes('****')) patch.apiKey = apiKey.trim();
    if (typeof maxTokens === 'number') patch.maxTokens = maxTokens;
    if (typeof description === 'string') patch.description = description.trim();

    const updated = await updateCustomModel(params.id, patch);
    if (!updated) {
      return NextResponse.json({ success: false, error: '模型不存在' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      model: { ...updated, apiKey: `${updated.apiKey.slice(0, 4)}****` },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ok = await deleteCustomModel(params.id);
    if (!ok) {
      return NextResponse.json({ success: false, error: '模型不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const model = await getCustomModelById(params.id);
    if (!model) {
      return NextResponse.json({ success: false, error: '模型不存在' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      model: { ...model, apiKey: `${model.apiKey.slice(0, 4)}****` },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
