'use client'

import { useCallback, useEffect, useState } from 'react'

interface TradeRecord {
  id: string
  stockName: string
  stockCode: string
  concept: string
  isDragon: boolean
  position: string
  tradeDate: string
  marketCap?: string
  price?: string
  changePercent: string
  boardInfo: string
  strategy: string
  notes: string
  source: 'manual' | 'ai'
  createdAt: number
  updatedAt: number
}

const EMPTY_FORM: Omit<TradeRecord, 'id' | 'createdAt' | 'updatedAt' | 'source'> = {
  stockName: '',
  stockCode: '',
  concept: '',
  isDragon: false,
  position: '',
  tradeDate: '',
  marketCap: '',
  price: '',
  changePercent: '',
  boardInfo: '',
  strategy: '',
  notes: '',
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function formatDateDisplay(d: string): string {
  if (d.length === 8) return d
  return d
}

export default function RecordsPage() {
  const [records, setRecords] = useState<TradeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/trade-records')
      const data = await res.json()
      if (data.success) setRecords(data.records ?? [])
    } catch (err) {
      console.error('Failed to fetch records:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const openNew = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, tradeDate: todayStr() })
    setShowForm(true)
  }

  const openEdit = (r: TradeRecord) => {
    setEditingId(r.id)
    setForm({
      stockName: r.stockName,
      stockCode: r.stockCode,
      concept: r.concept,
      isDragon: r.isDragon,
      position: r.position,
      tradeDate: r.tradeDate,
      marketCap: r.marketCap ?? '',
      price: r.price ?? '',
      changePercent: r.changePercent,
      boardInfo: r.boardInfo,
      strategy: r.strategy,
      notes: r.notes,
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.stockName.trim() || !form.stockCode.trim()) return
    const payload = { ...form, source: 'manual' as const }
    try {
      if (editingId) {
        await fetch(`/api/trade-records/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/trade-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      setShowForm(false)
      refresh()
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('确定删除该记录？')) return
    await fetch(`/api/trade-records/${id}`, { method: 'DELETE' })
    refresh()
  }

  const updateField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">
              &larr; 返回
            </a>
            <h1 className="text-base font-bold text-gray-800">操作记录</h1>
          </div>
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-all font-medium"
          >
            + 新增
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-4">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 text-xs text-gray-400 font-medium border-b border-gray-100">
          <span>股票(选主线概念)</span>
          <span className="w-24 text-center">日期</span>
          <span className="w-28 text-right">涨幅</span>
        </div>

        {loading ? (
          <p className="text-gray-400 text-center mt-12 text-sm">加载中…</p>
        ) : records.length === 0 ? (
          <div className="text-center mt-20 space-y-3">
            <p className="text-4xl">📋</p>
            <p className="text-gray-400">暂无操作记录</p>
            <p className="text-gray-300 text-sm">点击右上角"新增"手动添加，或在 AI 对话中自动生成</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {records.map((r) => (
              <div
                key={r.id}
                className="group grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-3 hover:bg-gray-50/80 transition-colors cursor-pointer"
                onClick={() => openEdit(r)}
              >
                {/* === Left Column: Stock Info === */}
                <div className="min-w-0 space-y-0.5">
                  {/* Row 1: Name + Dragon + Position */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-bold text-red-600">{r.stockName}</span>
                    {r.isDragon && (
                      <span className="px-1 py-px text-[10px] bg-red-500 text-white rounded-sm font-bold leading-tight">
                        是否龙一
                      </span>
                    )}
                    {r.position && (
                      <span className="text-xs text-gray-500">仓位:{r.position}</span>
                    )}
                  </div>
                  {/* Row 2: Code + Concept tags + board position desc */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-gray-400 font-mono">{r.stockCode}</span>
                    {r.concept && r.concept.split(/[,，、+]/).map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-1.5 py-px text-[10px] bg-yellow-400 text-yellow-900 rounded-sm font-medium leading-tight"
                      >
                        {tag.trim()}
                      </span>
                    ))}
                    {r.boardInfo && !/^\d/.test(r.boardInfo) && !r.boardInfo.includes('连板') && !r.boardInfo.includes('首板') && !r.boardInfo.includes('断板') && (
                      <span className="text-[11px] text-gray-400">{r.boardInfo}</span>
                    )}
                  </div>
                  {/* Row 3: Notes (red callout text) */}
                  {r.notes && (
                    <p className="text-xs text-red-500 leading-snug">{r.notes}</p>
                  )}

                  {/* Delete button */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); remove(r.id) }}
                      className="text-[10px] text-gray-300 hover:text-red-400 transition-colors"
                    >
                      删除
                    </button>
                    {r.source === 'ai' && (
                      <span className="text-[10px] text-gray-300 ml-2">🤖 AI</span>
                    )}
                  </div>
                </div>

                {/* === Middle Column: Date + MarketCap + Price === */}
                <div className="w-24 text-center space-y-0.5 shrink-0">
                  <p className="text-sm font-bold text-gray-800">{formatDateDisplay(r.tradeDate)}</p>
                  {r.marketCap && (
                    <p className="text-xs text-gray-400">{r.marketCap}亿</p>
                  )}
                  {r.price && (
                    <p className="text-xs text-gray-400">{r.price}元</p>
                  )}
                </div>

                {/* === Right Column: Change% + Strategy + BoardInfo === */}
                <div className="w-28 text-right space-y-0.5 shrink-0">
                  <p className={`text-sm font-bold ${
                    parseFloat(r.changePercent) > 0 ? 'text-red-500' :
                    parseFloat(r.changePercent) < 0 ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {r.changePercent || '--'}
                  </p>
                  {r.strategy && (
                    <p className="text-[11px] text-green-600 leading-snug">{r.strategy}</p>
                  )}
                  {r.boardInfo && (
                    <p className={`text-xs font-medium ${
                      r.boardInfo.includes('断板') ? 'text-orange-500' : 'text-red-400'
                    }`}>
                      {r.boardInfo}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white border border-gray-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-800">
                {editingId ? '编辑记录' : '新增操作记录'}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {/* Stock name + code */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">股票名称 *</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.stockName}
                    onChange={(e) => updateField('stockName', e.target.value)}
                    placeholder="如：华电辽能"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">股票代码 *</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.stockCode}
                    onChange={(e) => updateField('stockCode', e.target.value)}
                    placeholder="如：600396"
                  />
                </div>
              </div>

              {/* Concept + Position */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">主线概念</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.concept}
                    onChange={(e) => updateField('concept', e.target.value)}
                    placeholder="如：电力+氢能"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">仓位</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.position}
                    onChange={(e) => updateField('position', e.target.value)}
                    placeholder="如：必须满仓、1/2仓、1w"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDragon"
                  checked={form.isDragon}
                  onChange={(e) => updateField('isDragon', e.target.checked)}
                  className="w-4 h-4 accent-red-500"
                />
                <label htmlFor="isDragon" className="text-sm text-gray-600">龙一标识</label>
              </div>

              {/* Date + Change + Board */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">日期</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.tradeDate}
                    onChange={(e) => updateField('tradeDate', e.target.value)}
                    placeholder="20260325"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">涨幅</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.changePercent}
                    onChange={(e) => updateField('changePercent', e.target.value)}
                    placeholder="如：10.00%"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">连板</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.boardInfo}
                    onChange={(e) => updateField('boardInfo', e.target.value)}
                    placeholder="如：首板、2连板"
                  />
                </div>
              </div>

              {/* Market cap + Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">市值(亿)</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.marketCap}
                    onChange={(e) => updateField('marketCap', e.target.value)}
                    placeholder="如：127"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">股价(元)</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                    value={form.price}
                    onChange={(e) => updateField('price', e.target.value)}
                    placeholder="如：5.28"
                  />
                </div>
              </div>

              {/* Strategy */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">策略（右侧绿字）</label>
                <textarea
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400 resize-none"
                  rows={2}
                  value={form.strategy}
                  onChange={(e) => updateField('strategy', e.target.value)}
                  placeholder="如：涨停,不能直接排板,只打回封"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">补充说明（左侧红字）</label>
                <textarea
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400 resize-none"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                  placeholder="如：大妖股,必须满仓梭哈,能吃3个板"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={save}
                disabled={!form.stockName.trim() || !form.stockCode.trim()}
                className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-30 transition-all font-medium"
              >
                {editingId ? '保存修改' : '添加记录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
