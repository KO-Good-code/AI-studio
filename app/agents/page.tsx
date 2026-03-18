'use client'

import { useState, useEffect } from 'react'
import { AgentConfig } from '@/lib/agents/types'

export default function AgentsPage() {
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({})
  const [builtInIds, setBuiltInIds] = useState<string[]>([])
  const [customIds, setCustomIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // 表单状态
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    role: '',
    emoji: '🤖',
    description: '',
    specialties: '',
    temperature: 0.5,
    systemPrompt: '',
  })

  // 加载 Agent 列表
  const loadAgents = async () => {
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      if (data.success) {
        setAgents(data.agents)
        setBuiltInIds(data.builtIn)
        setCustomIds(data.custom)
      }
    } catch (error) {
      console.error('加载 Agent 失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAgents()
  }, [])

  // 新增 Agent
  const handleCreate = () => {
    setEditingId(null)
    setFormData({
      id: '',
      name: '',
      role: '',
      emoji: '🤖',
      description: '',
      specialties: '',
      temperature: 0.5,
      systemPrompt: '',
    })
    setShowForm(true)
  }

  // 编辑 Agent
  const handleEdit = (id: string) => {
    const agent = agents[id]
    if (!agent) return

    setEditingId(id)
    setFormData({
      id,
      name: agent.name,
      role: agent.role,
      emoji: agent.emoji || '🤖',
      description: agent.description || '',
      specialties: agent.specialties?.join(', ') || '',
      temperature: agent.temperature ?? 0.5,
      systemPrompt: agent.systemPrompt,
    })
    setShowForm(true)
  }

  // 保存 Agent
  const handleSave = async () => {
    try {
      const id = editingId || formData.id
      if (!id) {
        alert('请输入 Agent ID')
        return
      }

      const agent: AgentConfig = {
        name: formData.name,
        role: formData.role,
        emoji: formData.emoji,
        description: formData.description,
        specialties: formData.specialties.split(',').map((s) => s.trim()).filter(Boolean),
        temperature: formData.temperature,
        systemPrompt: formData.systemPrompt,
      }

      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, agent }),
      })

      const data = await res.json()
      if (data.success) {
        alert('保存成功！')
        setShowForm(false)
        loadAgents()
      } else {
        alert(`保存失败: ${data.error}`)
      }
    } catch (error) {
      alert('保存失败，请重试')
      console.error(error)
    }
  }

  // 删除 Agent
  const handleDelete = async (id: string) => {
    if (!confirm(`确定要删除 Agent "${agents[id]?.name}" 吗？`)) return

    try {
      const res = await fetch(`/api/agents?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      
      if (data.success) {
        alert('删除成功！')
        loadAgents()
      } else {
        alert(`删除失败: ${data.error}`)
      }
    } catch (error) {
      alert('删除失败，请重试')
      console.error(error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">🤖 Agent 管理</h1>
            <p className="text-gray-500 mt-2">管理你的 AI Agent，创建自定义专家</p>
          </div>
          <button
            onClick={handleCreate}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            ➕ 新增 Agent
          </button>
        </div>

        {/* 内置 Agent */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
            📦 内置 Agent ({builtInIds.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {builtInIds.map((id) => {
              const agent = agents[id]
              return (
                <div key={id} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-3xl">{agent.emoji}</span>
                      <div>
                        <h3 className="font-bold text-lg">{agent.name}</h3>
                        <p className="text-sm text-gray-500">{agent.role}</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    {agent.description}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {agent.specialties?.slice(0, 3).map((s, i) => (
                      <span key={i} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-gray-400">
                    温度: {agent.temperature} | 内置
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 自定义 Agent */}
        <div>
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
            ✨ 自定义 Agent ({customIds.length})
          </h2>
          {customIds.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg">
              <p className="text-gray-500">还没有自定义 Agent，点击上方按钮创建</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customIds.map((id) => {
                const agent = agents[id]
                return (
                  <div key={id} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-3xl">{agent.emoji}</span>
                        <div>
                          <h3 className="font-bold text-lg">{agent.name}</h3>
                          <p className="text-sm text-gray-500">{agent.role}</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      {agent.description}
                    </p>
                    <div className="flex gap-2 flex-wrap mb-3">
                      {agent.specialties?.slice(0, 3).map((s, i) => (
                        <span key={i} className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          {s}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(id)}
                        className="flex-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(id)}
                        className="flex-1 px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 创建/编辑表单 Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">
              {editingId ? '编辑 Agent' : '新增 Agent'}
            </h2>

            <div className="space-y-4">
              {/* ID */}
              {!editingId && (
                <div>
                  <label className="block text-sm font-medium mb-1">Agent ID *</label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    placeholder="例如: security"
                    className="w-full p-2 border rounded dark:bg-gray-700"
                  />
                </div>
              )}

              {/* 名称 */}
              <div>
                <label className="block text-sm font-medium mb-1">名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如: SecurityGuard"
                  className="w-full p-2 border rounded dark:bg-gray-700"
                />
              </div>

              {/* 角色 */}
              <div>
                <label className="block text-sm font-medium mb-1">角色 *</label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="例如: 安全专家"
                  className="w-full p-2 border rounded dark:bg-gray-700"
                />
              </div>

              {/* Emoji */}
              <div>
                <label className="block text-sm font-medium mb-1">Emoji</label>
                <input
                  type="text"
                  value={formData.emoji}
                  onChange={(e) => setFormData({ ...formData, emoji: e.target.value })}
                  placeholder="🔐"
                  className="w-full p-2 border rounded dark:bg-gray-700"
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="简短描述这个 Agent 的功能"
                  rows={2}
                  className="w-full p-2 border rounded dark:bg-gray-700"
                />
              </div>

              {/* 专长 */}
              <div>
                <label className="block text-sm font-medium mb-1">专长（逗号分隔）</label>
                <input
                  type="text"
                  value={formData.specialties}
                  onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
                  placeholder="例如: 安全审计, XSS防护, SQL注入"
                  className="w-full p-2 border rounded dark:bg-gray-700"
                />
              </div>

              {/* 温度 */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  温度: {formData.temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={formData.temperature}
                  onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  0 = 精确严谨 | 0.5 = 平衡 | 1 = 创造性
                </p>
              </div>

              {/* System Prompt */}
              <div>
                <label className="block text-sm font-medium mb-1">System Prompt *</label>
                <textarea
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                  placeholder="你是 SecurityGuard，一位专业的安全专家..."
                  rows={8}
                  className="w-full p-2 border rounded dark:bg-gray-700 font-mono text-sm"
                />
              </div>
            </div>

            {/* 按钮 */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSave}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                保存
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
