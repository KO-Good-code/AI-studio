'use client'

import { useEffect, useRef, useState } from 'react'

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  displayName: string;
  description?: string;
  available: boolean;
  reason?: string;
  size?: number;
}

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
};

function newMessageId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function errorMessageFromResponse(response: Response): Promise<string> {
  const raw = await response.text();
  let msg = `请求失败 (${response.status})`;
  try {
    const j = JSON.parse(raw) as {
      error?: string;
      suggestion?: string;
      issues?: unknown;
    };
    if (typeof j.error === 'string') msg = j.error;
    if (j.suggestion) msg += ` — ${j.suggestion}`;
    if (j.issues != null) msg += ` ${JSON.stringify(j.issues)}`;
  } catch {
    if (raw.trim()) msg = raw.slice(0, 500);
  }
  return msg;
}

export default function Home() {
  // 模型选择状态
  const [selectedModel, setSelectedModel] = useState('llama3.2')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  
  // 🆕 Team 模式状态
  const [isTeamMode, setIsTeamMode] = useState(false)
  const [customTeams, setCustomTeams] = useState<Array<{id: string, name: string}>>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // 获取可用模型列表
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/api/models')
        const data = await response.json()
        
        if (data.success && data.models) {
          setAvailableModels(data.models)
          
          // 如果当前选择的模型不可用，选择第一个可用模型
          const currentModel = data.models.find((m: ModelInfo) => m.id === selectedModel)
          if (!currentModel || !currentModel.available) {
            const firstAvailable = data.models.find((m: ModelInfo) => m.available)
            if (firstAvailable) {
              setSelectedModel(firstAvailable.id)
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch models:', err)
      } finally {
        setModelsLoading(false)
      }
    }
    
    fetchModels()
  }, [])
  
  // 🆕 获取自定义 Team 列表
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const response = await fetch('/api/teams')
        const data = await response.json()
        if (data.success && data.teams) {
          setCustomTeams(data.teams.map((t: any) => ({ id: t.id, name: t.name })))
        }
      } catch (err) {
        console.error('Failed to fetch teams:', err)
      }
    }
    
    if (isTeamMode) {
      fetchTeams()
    }
  }, [isTeamMode])

  useEffect(() => {
    scrollToBottom()
  }, [messages])
  
  // 处理表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    const userMessage = input.trim()
    setInput('') // 立即清空输入框

    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: userMessage,
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setIsLoading(true)
    setError(null)

    const apiPayload =
      isTeamMode
        ? {
            messages: newMessages.map(({ role, content }) => ({ role, content })),
            model: selectedModel,
            teamId: selectedTeamId,
          }
        : {
            messages: newMessages.map(({ role, content }) => ({ role, content })),
            model: selectedModel,
          }

    try {
      const apiEndpoint = isTeamMode ? '/api/team' : '/api/chat'
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload),
      })

      if (!response.ok) {
        const errText = await errorMessageFromResponse(response)
        throw new Error(errText)
      }

      const assistantId = newMessageId()
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ])

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantMessage = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          assistantMessage += chunk

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: assistantMessage } : m
            )
          )
        }
      }

      setIsLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setIsLoading(false)
      console.error('Error:', err)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* 顶部导航栏 */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            🦙 Ollama 本地智能助手 {isTeamMode && '🤝'}
          </h1>
          <div className="flex items-center gap-4">
            {/* 🆕 Team 模式切换 */}
            <button
              onClick={() => setIsTeamMode(!isTeamMode)}
              disabled={isLoading}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-50 ${
                isTeamMode
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {isTeamMode ? '🤝 Team 模式' : '👤 单 Agent'}
            </button>
            
            {/* 🆕 自定义 Team 选择器 */}
            {isTeamMode && customTeams.length > 0 && (
              <select
                value={selectedTeamId || ''}
                onChange={(e) => setSelectedTeamId(e.target.value || null)}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none transition-all disabled:opacity-50 dark:text-white"
              >
                <option value="">智能选择</option>
                {customTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            )}
            
            {/* 🆕 管理按钮 */}
            {isTeamMode && (
              <a
                href="/agents"
                target="_blank"
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-all"
              >
                🤖 Agent
              </a>
            )}
            {isTeamMode && (
              <a
                href="/teams"
                target="_blank"
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-all"
              >
                🤝 Team
              </a>
            )}
            {/* 模型选择器 */}
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isLoading || modelsLoading}
              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none transition-all disabled:opacity-50 dark:text-white"
            >
              {modelsLoading ? (
                <option>加载模型中...</option>
              ) : availableModels.length > 0 ? (
                availableModels.map((model) => (
                  <option 
                    key={model.id} 
                    value={model.id}
                    disabled={!model.available}
                  >
                    {model.displayName}
                    {!model.available && ` (${model.reason})`}
                    {model.size && ` - ${(model.size / 1024 / 1024 / 1024).toFixed(1)} GB`}
                  </option>
                ))
              ) : (
                <option>未找到模型</option>
              )}
            </select>
            
            {/* 状态指示器 */}
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
              <span className="text-xs text-gray-500">
                {isLoading ? '生成中...' : '就绪'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 text-red-600 p-3 text-center text-sm border-b border-red-100">
          ⚠️ 运行错误: {error.message}
        </div>
      )}

      {/* 聊天内容区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="max-w-4xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center mt-20 space-y-4">
              <div className="text-5xl animate-bounce">{isTeamMode ? '🤝' : '🦙'}</div>
              <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200">
                {isTeamMode ? '你好！我是 Multi-Agent Team' : '你好！我是本地 AI 助手'}
              </h2>
              <p className="text-gray-500 italic">
                {isTeamMode 
                  ? '多个专业 Agent 协同工作，为你提供全方位的解决方案'
                  : '基于 LangChain + Ollama 本地大模型'
                }
              </p>
              <p className="text-xs text-gray-400 mt-2">
                ✨ 支持实时流式输出 | 🔒 数据完全本地化
                {isTeamMode && ' | 🤝 Multi-Agent 协作'}
              </p>
              {isTeamMode && (
                <div className="mt-6 max-w-xl mx-auto text-left bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-6 rounded-2xl border border-purple-200 dark:border-purple-700">
                  <h3 className="text-sm font-bold text-purple-700 dark:text-purple-300 mb-3">🎯 Team 包含的专业 Agent：</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2">
                      <span>🧑‍💻</span>
                      <span>代码实现专家</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>📚</span>
                      <span>技术文档专家</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>🐛</span>
                      <span>调试专家</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>🏗️</span>
                      <span>系统架构师</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>🔍</span>
                      <span>代码审查专家</span>
                    </div>
                  </div>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-3 italic">
                    💡 系统会根据你的问题自动选择最合适的 Agent 组合
                  </p>
                </div>
              )}
            </div>
          )}

          {messages.map((m, index) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} mb-6`}>
              <div className={`max-w-[85%] p-4 rounded-2xl shadow-md ${
                m.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-br-none' 
                  : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-gray-700 rounded-bl-none'
              }`}>
                <div className="text-[10px] opacity-50 mb-1 font-bold tracking-widest uppercase">
                  {m.role === 'user' ? 'You' : 'Ollama AI'}
                </div>
                <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap leading-relaxed">
                  {/* 🆕 解析 Markdown 格式（简单实现） */}
                  {m.content.split('\n').map((line, i) => {
                    // 处理分隔线
                    if (line.trim() === '---') {
                      return <hr key={i} className="my-4 border-gray-300 dark:border-gray-600" />
                    }
                    // 处理标题
                    if (line.startsWith('**') && line.endsWith('**')) {
                      return <div key={i} className="font-bold mt-2">{line.replace(/\*\*/g, '')}</div>
                    }
                    // 处理 emoji 开头的行
                    if (/^[🧑‍💻📚🐛🏗️🔍🎯✅❌💡📝]/.test(line)) {
                      return <div key={i} className="my-1">{line}</div>
                    }
                    // 普通文本
                    return line ? <div key={i}>{line}</div> : <br key={i} />
                  })}
                  {/* 流式输出时显示闪烁光标 */}
                  {m.role === 'assistant' && isLoading && index === messages.length - 1 && (
                    <span className="inline-block w-2 h-4 ml-1 bg-blue-500 animate-pulse"></span>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 底部输入框 */}
      <footer className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-2xl">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input
              className="w-full p-4 pr-16 bg-gray-100 dark:bg-gray-700 border-none rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-white placeholder-gray-400"
              value={input}
              placeholder="发送消息..."
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="absolute right-2 p-2 bg-blue-600 text-white rounded-xl disabled:opacity-50 disabled:bg-gray-400 transition-all hover:scale-105 active:scale-95"
            >
              {isLoading ? (
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
              ) : (
                <svg className="h-5 w-5 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9-2-9-18-9 18 9-2zm0 0v-8"></path>
                </svg>
              )}
            </button>
          </form>
          <p className="text-[10px] text-center text-gray-400 mt-2">
            {isTeamMode 
              ? '🤝 Multi-Agent Team 协作模式 | 多个专业 Agent 共同解决问题'
              : '使用 Ollama 本地大模型 + LangChain 实现流式输出'
            }
          </p>
        </div>
      </footer>
    </div>
  )
}
