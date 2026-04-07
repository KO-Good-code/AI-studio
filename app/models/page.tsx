'use client'

import { useCallback, useEffect, useState } from 'react'

interface CustomModel {
  id: string
  name: string
  displayName: string
  providerLabel: string
  baseUrl: string
  apiKey: string
  maxTokens?: number
  description?: string
  createdAt: number
  updatedAt: number
}

const EMPTY_FORM = {
  name: '',
  displayName: '',
  providerLabel: '',
  baseUrl: '',
  apiKey: '',
  maxTokens: '',
  description: '',
}

const PRESETS: Record<string, { providerLabel: string; baseUrl: string; models: string[] }> = {
  DeepSeek: {
    providerLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  'OpenAI': {
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  'Moonshot': {
    providerLabel: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  'SiliconFlow': {
    providerLabel: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
  },
  Groq: {
    providerLabel: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  },
  Together: {
    providerLabel: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
  },
  MiniMax: {
    providerLabel: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    models: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1'],
  },
}

export default function ModelsPage() {
  const [models, setModels] = useState<CustomModel[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/custom-models')
      const data = await res.json()
      if (data.success) setModels(data.models ?? [])
    } catch (err) {
      console.error('Failed to fetch custom models:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const openNew = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setTestResult(null)
    setShowForm(true)
  }

  const openEdit = (m: CustomModel) => {
    setEditingId(m.id)
    setForm({
      name: m.name,
      displayName: m.displayName,
      providerLabel: m.providerLabel,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      maxTokens: m.maxTokens ? String(m.maxTokens) : '',
      description: m.description ?? '',
    })
    setTestResult(null)
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim()) return
    const payload = {
      ...form,
      maxTokens: form.maxTokens ? parseInt(form.maxTokens) : undefined,
    }
    try {
      if (editingId) {
        await fetch(`/api/custom-models/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/custom-models', {
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
    if (!confirm('确定删除该模型配置？')) return
    await fetch(`/api/custom-models/${id}`, { method: 'DELETE' })
    refresh()
  }

  const applyPreset = (presetName: string) => {
    const preset = PRESETS[presetName]
    if (!preset) return
    setForm((prev) => ({
      ...prev,
      providerLabel: preset.providerLabel,
      baseUrl: preset.baseUrl,
      name: preset.models[0] || prev.name,
      displayName: prev.displayName || `🔗 ${preset.models[0] || presetName}`,
    }))
  }

  const testConnection = async () => {
    if (!form.baseUrl.trim() || !form.apiKey.trim() || !form.name.trim()) {
      setTestResult('请先填写 Base URL、API Key 和模型名称')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/custom-models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
          model: form.name.trim(),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setTestResult(`✅ 连接成功！回复: "${data.reply}"`)
      } else {
        setTestResult(`❌ ${data.error}`)
      }
    } catch (err) {
      setTestResult(`❌ 请求失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTesting(false)
    }
  }

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-gray-100">
      <header className="bg-[#1a1b23] border-b border-gray-800 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-gray-400 hover:text-white transition-colors text-sm">&larr; 返回</a>
            <h1 className="text-base font-semibold text-white">模型管理</h1>
          </div>
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all font-medium"
          >
            + 添加模型
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* 预设快捷按钮 */}
        <div className="mb-6">
          <p className="text-xs text-gray-500 mb-2">快速添加（点击后填入 API Key 即可）</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(PRESETS).map((name) => (
              <button
                key={name}
                onClick={() => { openNew(); setTimeout(() => applyPreset(name), 0) }}
                className="px-3 py-1.5 text-xs bg-[#1a1b23] border border-gray-700 text-gray-300 hover:border-indigo-500 hover:text-indigo-300 rounded-lg transition-all"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500 text-center mt-12 text-sm">加载中…</p>
        ) : models.length === 0 ? (
          <div className="text-center mt-16 space-y-3">
            <p className="text-4xl">🔗</p>
            <p className="text-gray-400">暂无自定义模型</p>
            <p className="text-gray-600 text-sm">点击上方"添加模型"或选择一个预设快速开始</p>
          </div>
        ) : (
          <div className="space-y-3">
            {models.map((m) => (
              <div
                key={m.id}
                className="group bg-[#1a1b23] border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{m.displayName}</span>
                      <span className="px-1.5 py-0.5 text-[10px] bg-indigo-600/30 text-indigo-300 rounded font-medium">
                        {m.providerLabel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 font-mono">{m.name}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{m.baseUrl}</p>
                    {m.description && (
                      <p className="text-xs text-gray-500 mt-1">{m.description}</p>
                    )}
                    <p className="text-[10px] text-gray-700 mt-1">Key: {m.apiKey}</p>
                  </div>
                  <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(m)}
                      className="text-xs text-gray-500 hover:text-indigo-400 transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => remove(m.id)}
                      className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-[#1a1b23] border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-800">
              <h3 className="text-base font-semibold text-white">
                {editingId ? '编辑模型' : '添加自定义模型'}
              </h3>
              <p className="text-xs text-gray-500 mt-1">支持所有 OpenAI 兼容 API（DeepSeek、Moonshot、Groq 等）</p>
            </div>

            {/* Preset buttons inside form */}
            {!editingId && (
              <div className="px-5 pt-4 flex flex-wrap gap-1.5">
                {Object.keys(PRESETS).map((name) => (
                  <button
                    key={name}
                    onClick={() => applyPreset(name)}
                    className="px-2 py-1 text-[10px] bg-gray-800 text-gray-400 hover:text-indigo-300 hover:bg-gray-700 rounded transition-all"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            <div className="p-5 space-y-4">
              {/* Provider + Model name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">提供商名称</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-indigo-500"
                    value={form.providerLabel}
                    onChange={(e) => updateField('providerLabel', e.target.value)}
                    placeholder="如：DeepSeek"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">模型名称 *</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-indigo-500"
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="如：deepseek-chat"
                  />
                </div>
              </div>

              {/* Display name */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">显示名称</label>
                <input
                  className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-indigo-500"
                  value={form.displayName}
                  onChange={(e) => updateField('displayName', e.target.value)}
                  placeholder="如：🧠 DeepSeek V3"
                />
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">API Base URL *</label>
                <input
                  className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                  value={form.baseUrl}
                  onChange={(e) => updateField('baseUrl', e.target.value)}
                  placeholder="如：https://api.deepseek.com/v1"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">API Key *</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                  value={form.apiKey}
                  onChange={(e) => updateField('apiKey', e.target.value)}
                  placeholder="sk-..."
                />
              </div>

              {/* Max tokens + Description */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">最大输出 Tokens</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-indigo-500"
                    value={form.maxTokens}
                    onChange={(e) => updateField('maxTokens', e.target.value)}
                    placeholder="如：4096"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">备注</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-[#2a2b37] border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-indigo-500"
                    value={form.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    placeholder="可选"
                  />
                </div>
              </div>

              {/* Test connection */}
              <div>
                <button
                  onClick={testConnection}
                  disabled={testing || !form.baseUrl.trim() || !form.apiKey.trim() || !form.name.trim()}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-all disabled:opacity-30 font-medium"
                >
                  {testing ? '测试中...' : '🔌 测试连接'}
                </button>
                {testResult && (
                  <p className={`mt-2 text-xs ${testResult.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                    {testResult}
                  </p>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-gray-800 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={save}
                disabled={!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim()}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-30 transition-all font-medium"
              >
                {editingId ? '保存修改' : '添加模型'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
