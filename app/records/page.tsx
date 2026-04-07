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
  stockName: '', stockCode: '', concept: '', isDragon: false,
  position: '', tradeDate: '', marketCap: '', price: '',
  changePercent: '', boardInfo: '', strategy: '', notes: '',
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 从 notes 字段解析卖出日期、收益率、盈亏金额、出场原因 */
function parseNotes(notes: string) {
  const sellDate = notes.match(/卖出[：:]?([\d\-]+)/)?.[1] ?? ''
  const ret      = notes.match(/收益率[：:]?([+\-\d.]+%)/)?.[1]
               ?? notes.match(/收益[：:]?([+\-\d.]+%)/)?.[1] ?? ''
  const pnl      = notes.match(/盈亏[：:]?([+\-\d,]+元)/)?.[1] ?? ''
  const exit     = notes.match(/出场[：:]?(.+?)(?:\s量比|\s持仓|\|$|$)/)?.[1]?.trim() ?? ''
  const holdDays = notes.match(/持仓[：:]?(\d+天)/)?.[1] ?? ''
  return { sellDate, ret, pnl, exit, holdDays }
}

/** 收益数字 → 颜色 class */
function retColor(ret: string) {
  const v = parseFloat(ret)
  if (isNaN(v)) return 'text-gray-400'
  return v > 0 ? 'text-red-500 font-bold' : v < 0 ? 'text-green-600 font-bold' : 'text-gray-500'
}

/** 涨幅数字 → 颜色 class */
function pctColor(pct: string) {
  const v = parseFloat(pct)
  if (isNaN(v)) return 'text-gray-400'
  return v > 0 ? 'text-red-500' : v < 0 ? 'text-green-600' : 'text-gray-500'
}

/** YYYYMMDD → YYYY-MM-DD */
function fmtDate(d: string) {
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  return d
}

export default function RecordsPage() {
  const [records, setRecords] = useState<TradeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [search, setSearch] = useState('')

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
      stockName: r.stockName, stockCode: r.stockCode, concept: r.concept,
      isDragon: r.isDragon, position: r.position, tradeDate: r.tradeDate,
      marketCap: r.marketCap ?? '', price: r.price ?? '',
      changePercent: r.changePercent, boardInfo: r.boardInfo,
      strategy: r.strategy, notes: r.notes,
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.stockName.trim() || !form.stockCode.trim()) return
    const payload = { ...form, source: editingId ? undefined : 'manual' as const }
    try {
      if (editingId) {
        await fetch(`/api/trade-records/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/trade-records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
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

  const filtered = records.filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.stockName.toLowerCase().includes(q) ||
      r.stockCode.toLowerCase().includes(q) ||
      r.concept.toLowerCase().includes(q)
    )
  })

  // 统计摘要（仅 V14 回测记录）
  const v14Records = filtered.filter(r => r.strategy.includes('V14'))
  const v14Pnls = v14Records.map(r => {
    const raw = parseNotes(r.notes).pnl.replace(/[+元,]/g, '')
    return parseFloat(raw)
  }).filter(v => !isNaN(v))
  const v14Rets = v14Records.map(r => parseFloat(parseNotes(r.notes).ret)).filter(v => !isNaN(v))
  const v14TotalPnl = v14Pnls.reduce((a, b) => a + b, 0)
  const v14Total = v14Rets.reduce((a, b) => a + b, 0)
  const v14Wins = v14Pnls.filter(v => v > 0).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10 shadow-sm">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <a href="/" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">← 返回</a>
            <h1 className="text-base font-bold text-gray-800">交易记录</h1>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{filtered.length} 条</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="px-3 py-1.5 text-xs bg-gray-100 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-400 w-40"
              placeholder="搜索股票/概念…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button
              onClick={openNew}
              className="px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all font-medium whitespace-nowrap"
            >
              + 新增
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-4 py-4 space-y-4">

        {/* 统计摘要 */}
        {v14Records.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'V14 回测笔数', value: String(v14Records.length) + ' 笔', sub: '初始10万 每仓2万' },
              { label: '总盈亏（元）', value: (v14TotalPnl >= 0 ? '+' : '') + v14TotalPnl.toLocaleString('zh-CN') + ' 元', sub: `最终 ${(100000 + v14TotalPnl).toLocaleString('zh-CN')} 元`, color: v14TotalPnl >= 0 ? 'text-red-500' : 'text-green-600' },
              { label: '胜率', value: v14Pnls.length ? (v14Wins / v14Pnls.length * 100).toFixed(0) + '%' : '--', sub: `${v14Wins}盈 / ${v14Pnls.length - v14Wins}亏` },
              { label: '平均单笔盈亏', value: v14Pnls.length ? (v14TotalPnl / v14Pnls.length >= 0 ? '+' : '') + Math.round(v14TotalPnl / v14Pnls.length).toLocaleString('zh-CN') + ' 元' : '--', sub: '等权平均', color: v14TotalPnl / v14Pnls.length >= 0 ? 'text-red-500' : 'text-green-600' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className={`text-xl font-bold mt-0.5 ${s.color ?? 'text-gray-800'}`}>{s.value}</p>
                <p className="text-[11px] text-gray-300 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <p className="text-gray-400 text-center py-20 text-sm">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 space-y-2">
            <p className="text-4xl">📋</p>
            <p className="text-gray-400">暂无记录</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
                    <th className="px-4 py-3 text-left whitespace-nowrap">#</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">股票</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">行业概念</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">买入日</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">买入价</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">当日涨幅</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">市值</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">仓位</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">卖出日</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">收益</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">出场方式</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">来源</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((r, idx) => {
                    const { sellDate, ret, pnl, exit, holdDays } = parseNotes(r.notes)
                    const isV14 = r.strategy.includes('V14')
                    return (
                      <tr
                        key={r.id}
                        className="hover:bg-blue-50/40 transition-colors group"
                      >
                        {/* # */}
                        <td className="px-4 py-3 text-gray-300 text-xs">{idx + 1}</td>

                        {/* 股票 */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-gray-800">{r.stockName}</span>
                            {r.isDragon && (
                              <span className="px-1 py-px text-[9px] bg-red-500 text-white rounded font-bold">龙</span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{r.stockCode}</p>
                        </td>

                        {/* 行业概念 */}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[140px]">
                            {r.concept ? r.concept.split(/[,，、+]/).map((tag, i) => (
                              <span key={i} className="px-1.5 py-px text-[10px] bg-amber-100 text-amber-800 rounded font-medium">
                                {tag.trim()}
                              </span>
                            )) : <span className="text-gray-300 text-xs">—</span>}
                          </div>
                        </td>

                        {/* 买入日 */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-gray-700 text-xs font-mono">{fmtDate(r.tradeDate)}</span>
                        </td>

                        {/* 买入价 */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className="text-gray-700">{r.price ? `${r.price}元` : '—'}</span>
                        </td>

                        {/* 当日涨幅 */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className={pctColor(r.changePercent)}>
                            {r.changePercent || '—'}
                          </span>
                        </td>

                        {/* 市值 */}
                        <td className="px-4 py-3 text-right whitespace-nowrap text-xs text-gray-400">
                          {r.marketCap || '—'}
                        </td>

                        {/* 仓位 */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                            {r.position || '—'}
                          </span>
                        </td>

                        {/* 卖出日 */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {sellDate ? (
                            <span className="text-xs font-mono text-gray-500">{sellDate}</span>
                          ) : (
                            <span className="text-gray-300 text-xs">持仓中</span>
                          )}
                        </td>

                        {/* 收益 */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {pnl ? (
                            <div>
                              <p className={`text-sm font-bold ${retColor(pnl)}`}>{pnl}</p>
                              {ret && <p className={`text-xs ${retColor(ret)}`}>{ret}</p>}
                            </div>
                          ) : ret ? (
                            <span className={`text-sm ${retColor(ret)}`}>{ret}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>

                        {/* 出场方式 */}
                        <td className="px-4 py-3 max-w-[200px]">
                          {exit ? (
                            <div>
                              <span className="text-[11px] text-gray-500 leading-snug">{exit}</span>
                              {holdDays && <span className="ml-1 text-[10px] text-gray-300">({holdDays})</span>}
                            </div>
                          ) : r.boardInfo ? (
                            <span className="text-[11px] text-orange-500">{r.boardInfo}</span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>

                        {/* 来源 */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {r.source === 'ai' ? (
                            <span className="text-[11px] text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded">
                              {isV14 ? 'V14回测' : '🤖 AI'}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">手动</span>
                          )}
                        </td>

                        {/* 操作 */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEdit(r)}
                              className="text-[11px] text-blue-400 hover:text-blue-600 transition-colors"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => remove(r.id)}
                              className="text-[11px] text-gray-300 hover:text-red-400 transition-colors"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-800">
                {editingId ? '编辑记录' : '新增交易记录'}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '股票名称 *', key: 'stockName' as const, placeholder: '如：华电辽能' },
                  { label: '股票代码 *', key: 'stockCode' as const, placeholder: '如：600396' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                    <input
                      className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                      value={form[f.key] as string}
                      onChange={e => updateField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '行业概念', key: 'concept' as const, placeholder: '如：电力+氢能' },
                  { label: '仓位', key: 'position' as const, placeholder: '如：20%、1/2仓' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                    <input
                      className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                      value={form[f.key] as string}
                      onChange={e => updateField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="isDragon" checked={form.isDragon}
                  onChange={e => updateField('isDragon', e.target.checked)}
                  className="w-4 h-4 accent-red-500" />
                <label htmlFor="isDragon" className="text-sm text-gray-600">标记为龙头</label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '买入日期', key: 'tradeDate' as const, placeholder: '20260325' },
                  { label: '买入涨幅', key: 'changePercent' as const, placeholder: '+4.5%' },
                  { label: '出场/连板', key: 'boardInfo' as const, placeholder: '追踪止损/首板' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                    <input
                      className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                      value={form[f.key] as string}
                      onChange={e => updateField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '市值', key: 'marketCap' as const, placeholder: '~92亿' },
                  { label: '股价(元)', key: 'price' as const, placeholder: '12.78' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                    <input
                      className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                      value={form[f.key] as string}
                      onChange={e => updateField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">策略描述</label>
                <textarea className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-400 resize-none"
                  rows={2} value={form.strategy}
                  onChange={e => updateField('strategy', e.target.value)}
                  placeholder="如：V14策略 / 追板策略" />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">备注（卖出信息/补充说明）</label>
                <textarea className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-400 resize-none"
                  rows={3} value={form.notes}
                  onChange={e => updateField('notes', e.target.value)}
                  placeholder="买入:2026-01-05 卖出:2026-01-13 收益:+6.38% 出场:追踪止损" />
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                取消
              </button>
              <button onClick={save}
                disabled={!form.stockName.trim() || !form.stockCode.trim()}
                className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-30 transition-all font-medium">
                {editingId ? '保存修改' : '添加记录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
