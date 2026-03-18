'use client'

import { useState, useEffect } from 'react'
import { Team } from '@/lib/agents/storage'
import { AgentConfig } from '@/lib/agents/types'

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)

  // 表单状态
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    selectedAgents: [] as string[],
  })

  // 加载数据
  const loadData = async () => {
    try {
      const [teamsRes, agentsRes] = await Promise.all([
        fetch('/api/teams'),
        fetch('/api/agents'),
      ])

      const teamsData = await teamsRes.json()
      const agentsData = await agentsRes.json()

      if (teamsData.success) setTeams(teamsData.teams)
      if (agentsData.success) setAgents(agentsData.agents)
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // 新增 Team
  const handleCreate = () => {
    setEditingTeam(null)
    setFormData({
      id: '',
      name: '',
      description: '',
      selectedAgents: [],
    })
    setShowForm(true)
  }

  // 编辑 Team
  const handleEdit = (team: Team) => {
    setEditingTeam(team)
    setFormData({
      id: team.id,
      name: team.name,
      description: team.description,
      selectedAgents: [...team.agentIds],
    })
    setShowForm(true)
  }

  // 保存 Team
  const handleSave = async () => {
    try {
      const id = editingTeam?.id || formData.id
      if (!id) {
        alert('请输入 Team ID')
        return
      }

      if (!formData.name) {
        alert('请输入 Team 名称')
        return
      }

      if (formData.selectedAgents.length === 0) {
        alert('请至少选择一个 Agent')
        return
      }

      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: formData.name,
          description: formData.description,
          agentIds: formData.selectedAgents,
        }),
      })

      const data = await res.json()
      if (data.success) {
        alert('保存成功！')
        setShowForm(false)
        loadData()
      } else {
        alert(`保存失败: ${data.error}`)
      }
    } catch (error) {
      alert('保存失败，请重试')
      console.error(error)
    }
  }

  // 删除 Team
  const handleDelete = async (id: string) => {
    const team = teams.find((t) => t.id === id)
    if (!confirm(`确定要删除 Team "${team?.name}" 吗？`)) return

    try {
      const res = await fetch(`/api/teams?id=${id}`, { method: 'DELETE' })
      const data = await res.json()

      if (data.success) {
        alert('删除成功！')
        loadData()
      } else {
        alert(`删除失败: ${data.error}`)
      }
    } catch (error) {
      alert('删除失败，请重试')
      console.error(error)
    }
  }

  // 切换 Agent 选择
  const toggleAgent = (agentId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedAgents: prev.selectedAgents.includes(agentId)
        ? prev.selectedAgents.filter((id) => id !== agentId)
        : [...prev.selectedAgents, agentId],
    }))
  }

  // Agent 上移
  const moveUp = (index: number) => {
    if (index === 0) return
    const newList = [...formData.selectedAgents]
    ;[newList[index - 1], newList[index]] = [newList[index], newList[index - 1]]
    setFormData({ ...formData, selectedAgents: newList })
  }

  // Agent 下移
  const moveDown = (index: number) => {
    if (index === formData.selectedAgents.length - 1) return
    const newList = [...formData.selectedAgents]
    ;[newList[index], newList[index + 1]] = [newList[index + 1], newList[index]]
    setFormData({ ...formData, selectedAgents: newList })
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">🤝 Team 管理</h1>
            <p className="text-gray-500 mt-2">创建自定义 Agent 团队，组建专业协作组</p>
          </div>
          <button
            onClick={handleCreate}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            ➕ 新增 Team
          </button>
        </div>

        {/* Team 列表 */}
        {teams.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg">
            <p className="text-gray-500">还没有自定义 Team，点击上方按钮创建</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {teams.map((team) => (
              <div key={team.id} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold">{team.name}</h3>
                    <p className="text-sm text-gray-500">{team.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(team)}
                      className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(team.id)}
                      className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    成员 ({team.agentIds.length}):
                  </p>
                  {team.agentIds.map((agentId, index) => {
                    const agent = agents[agentId]
                    return agent ? (
                      <div key={agentId} className="flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded">
                        <span className="text-sm text-gray-500">{index + 1}.</span>
                        <span className="text-xl">{agent.emoji}</span>
                        <div className="flex-1">
                          <div className="font-medium">{agent.name}</div>
                          <div className="text-xs text-gray-500">{agent.role}</div>
                        </div>
                      </div>
                    ) : (
                      <div key={agentId} className="p-2 bg-red-100 dark:bg-red-900 rounded text-sm">
                        ⚠️ Agent "{agentId}" 不存在
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 text-xs text-gray-400">
                  创建时间: {new Date(team.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 创建/编辑表单 Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">
              {editingTeam ? '编辑 Team' : '新增 Team'}
            </h2>

            <div className="grid grid-cols-2 gap-6">
              {/* 左侧：基本信息 */}
              <div className="space-y-4">
                <h3 className="font-bold text-lg">基本信息</h3>

                {!editingTeam && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Team ID *</label>
                    <input
                      type="text"
                      value={formData.id}
                      onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                      placeholder="例如: security-team"
                      className="w-full p-2 border rounded dark:bg-gray-700"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-1">Team 名称 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="例如: 安全审查团队"
                    className="w-full p-2 border rounded dark:bg-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="描述这个 Team 的用途"
                    rows={3}
                    className="w-full p-2 border rounded dark:bg-gray-700"
                  />
                </div>

                <div>
                  <h4 className="font-medium mb-2">已选择 ({formData.selectedAgents.length})</h4>
                  {formData.selectedAgents.length === 0 ? (
                    <p className="text-sm text-gray-500">从右侧选择 Agent</p>
                  ) : (
                    <div className="space-y-2">
                      {formData.selectedAgents.map((agentId, index) => {
                        const agent = agents[agentId]
                        return agent ? (
                          <div key={agentId} className="flex items-center gap-2 p-2 bg-blue-100 dark:bg-blue-900 rounded">
                            <span className="text-xl">{agent.emoji}</span>
                            <div className="flex-1 text-sm font-medium">{agent.name}</div>
                            <button
                              onClick={() => moveUp(index)}
                              disabled={index === 0}
                              className="p-1 hover:bg-blue-200 rounded disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveDown(index)}
                              disabled={index === formData.selectedAgents.length - 1}
                              className="p-1 hover:bg-blue-200 rounded disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => toggleAgent(agentId)}
                              className="p-1 hover:bg-red-200 rounded text-red-600"
                            >
                              ✕
                            </button>
                          </div>
                        ) : null
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧：可用 Agent */}
              <div>
                <h3 className="font-bold text-lg mb-4">可用 Agent</h3>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {Object.entries(agents).map(([id, agent]) => {
                    const isSelected = formData.selectedAgents.includes(id)
                    return (
                      <div
                        key={id}
                        onClick={() => toggleAgent(id)}
                        className={`p-3 border rounded cursor-pointer transition ${
                          isSelected
                            ? 'bg-blue-100 border-blue-500 dark:bg-blue-900'
                            : 'bg-white border-gray-300 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{agent.emoji}</span>
                          <div className="flex-1">
                            <div className="font-medium">{agent.name}</div>
                            <div className="text-xs text-gray-500">{agent.role}</div>
                          </div>
                          {isSelected && <span className="text-blue-600">✓</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
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
