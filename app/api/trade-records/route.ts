import { NextRequest, NextResponse } from 'next/server';
import {
  listTradeRecords,
  addTradeRecord,
  type TradeRecord,
} from '@/lib/storage/trade-records';

export async function GET() {
  try {
    const list = await listTradeRecords();
    return NextResponse.json({ success: true, records: list });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Partial<TradeRecord>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '无效的 JSON 请求体' },
      { status: 400 }
    );
  }
  try {
    if (!body.stockName?.trim() || !body.stockCode?.trim()) {
      return NextResponse.json(
        { success: false, error: '股票名称和代码不能为空' },
        { status: 400 }
      );
    }
    const record = await addTradeRecord({
      stockName: body.stockName.trim(),
      stockCode: body.stockCode.trim(),
      concept: body.concept?.trim() ?? '',
      isDragon: !!body.isDragon,
      position: body.position?.trim() ?? '',
      tradeDate: body.tradeDate?.trim() ?? new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      marketCap: body.marketCap?.trim(),
      price: body.price?.trim(),
      changePercent: body.changePercent?.trim() ?? '',
      boardInfo: body.boardInfo?.trim() ?? '',
      strategy: body.strategy?.trim() ?? '',
      notes: body.notes?.trim() ?? '',
      source: body.source === 'ai' ? 'ai' : 'manual',
    });
    return NextResponse.json({ success: true, record });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
