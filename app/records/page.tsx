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

function formatDate(d: string): string {
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  return d
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
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

  const grouped = records.reduce<Record<string, TradeRecord[]>>((acc, r) => {
    const key = r.tradeDate
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="min-h-screen bg-[#0f1117] text-gray-100">
      {/* Header */}
      <header className="bg-[#1a1b23] border-b border-gray-800 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-gray-400 hover:text-white transition-colors text-sm">
              &larr; 返回对话
            </a>
            <h1 className="text-base font-semibold text-white">操作记录</h1>
          </div>
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg transition-all font-medium"
          >
            + 新增记录
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <p className="text-gray-500 text-center mt-12">加载中…</p>
        ) : records.length === 0 ? (
          <div className="text-center mt-20 space-y-3">
            <p className="text-4xl">📋</p>
            <p className="text-gray-400">暂无操作记录</p>
            <p className="text-gray-600 text-sm">点击右上角"新增记录"手动添加，或在 AI 对话中自动生成</p>
          </div>
        ) : (
          sortedDates.map((date) => (
            <div key={date} className="mb-8">
              <h2 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {formatDate(date)}
              </h2>
              <div className="space-y-3">
                {grouped[date].map((r) => (
                  <div
                    key={r.id}
                    className="group bg-[#1a1b23] border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
                  >
                    {/* Row 1: Stock name + tags + change */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-white">{r.stockName}</span>
                          {r.isDragon && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-red-600 text-white rounded font-medium">
                              是否龙一
                            </span>
                          )}
                          {r.position && (
                            <span className="text-xs text-gray-400">
                              仓位:{r.position}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-500 font-mono">{r.stockCode}</span>
                          {r.concept && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-amber-700/40 text-amber-300 rounded">
                              {r.concept}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className={`text-lg font-bold ${
                          parseFloat(r.changePercent) > 0 ? 'text-red-400' :
                          parseFloat(r.changePercent) < 0 ? 'text-green-400' : 'text-gray-300'
                        }`}>
                          {r.changePercent || '--'}
                        </p>
                        {r.boardInfo && (
                          <p className={`text-xs mt-0.5 ${
                            parseFloat(r.changePercent) > 0 ? 'text-red-400/70' : 'text-gray-400'
                          }`}>
                            {r.boardInfo}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Market cap + price */}
                    {(r.marketCap || r.price) && (
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        {r.marketCap && <span>{r.marketCap}亿</span>}
                        {r.price && <span>{r.price}元</span>}
                      </div>
                    )}

                    {/* Row 3: Strategy */}
                    {r.strategy && (
                      <p className={`mt-2 text-xs leading-relaxed ${
                        parseFloat(r.changePercent) > 0 ? 'text-red-400/80' : 'text-gray-400'
                      }`}>
                        {r.strategy}
                      </p>
                    )}

                    {/* Row 4: Notes */}
                    {r.notes && (
                      <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{r.notes}</p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-800/50">
                      <span className="text-[10px] text-gray-600">
                        {r.source === 'ai' ? '🤖 AI生成' : '✍️ 手动'}
                      </span>
                      <div className="opacity-0 group-hover:opacity-100 flex gap-2 transition-all">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-[11px] text-gray-500 hover:text-indigo-400 transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => remove(r.id)}
                          className="text-[11px] text-gray-500 hover:text-red-400 transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1b23] border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-800">
              <h3 className="text-base font-semibold text-white">
                {editingId ? '编辑记录' : '新增操作记录'}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {/* Stock name + code */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">股票名称 *</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
                    value={form.stockName}
                    onChange={(e) => updateField('stockName', e.target.value)}
                    placeholder="如：华电辽能"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">股票代码 *</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
                    value={form.stockCode}
                    onChange={(e) => updateField('stockCode', e.target.value)}
                    placeholder="如：600396"
                  />
                </div>
              </div>

              {/* Concept + Dragon */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">主线概念</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
                    value={form.concept}
                    onChange={(e) => updateField('concept', e.target.value)}
                    placeholder="如：电力+氢能"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">仓位</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
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
                <label htmlFor="isDragon" className="text-sm text-gray-300">龙一标识</label>
              </div>

              {/* Date + Change */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">日期 (YYYYMMDD)</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
                    value={form.tradeDate}
                    onChange={(e) => updateField('tradeDate', e.target.value)}
                    placeholder="20260325"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">涨幅</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
                    value={form.changePercent}
                    onChange={(e) => updateField('changePercent', e.target.value)}
                    placeholder="如：10.00%"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">连板</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
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
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
                    value={form.marketCap}
                    onChange={(e) => updateField('marketCap', e.target.value)}
                    placeholder="如：127"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">股价(元)</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500"
                    value={form.price}
                    onChange={(e) => updateField('price', e.target.value)}
                    placeholder="如：5.28"
                  />
                </div>
              </div>

              {/* Strategy */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">策略</label>
                <textarea
                  className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500 resize-none"
                  rows={2}
                  value={form.strategy}
                  onChange={(e) => updateField('strategy', e.target.value)}
                  placeholder="如：涨停,不能直接排板,只打回封"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">补充说明</label>
                <textarea
                  className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-red-500 resize-none"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                  placeholder="如：大妖股,必须满仓梭哈,能吃3个板"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-gray-800 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={save}
                disabled={!form.stockName.trim() || !form.stockCode.trim()}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-30 transition-all font-medium"
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
