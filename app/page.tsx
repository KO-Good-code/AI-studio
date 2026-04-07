'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/* ───────── types ───────── */

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

interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  isTeamMode: boolean;
  teamId?: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

interface MemoryItem {
  id: string;
  content: string;
  category: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

/* ───────── helpers ───────── */

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

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/* ───────── Markdown ───────── */

const mdComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-xl font-bold mt-4 mb-2 pb-1 border-b border-gray-600 text-white">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-lg font-bold mt-3 mb-1.5 text-white">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-semibold mt-2 mb-1 text-white">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 leading-relaxed text-gray-100">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed text-gray-100">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-gray-200">{children}</em>,
  code: ({ className, children, ...rest }: { className?: string; children?: React.ReactNode }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 bg-gray-700/70 text-amber-300 rounded text-sm font-mono">
          {children}
        </code>
      );
    }
    return (
      <code
        className={`block overflow-x-auto p-3 my-2 bg-black/50 text-green-400 rounded-lg text-sm font-mono leading-relaxed ${className ?? ''}`}
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="my-2">{children}</pre>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-blue-500 pl-3 my-2 text-gray-300 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-sm border border-gray-600 rounded-lg overflow-hidden">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-gray-700/50">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-semibold text-gray-100 border-b border-gray-600">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-1.5 border-b border-gray-700 text-gray-200">{children}</td>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-500 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300"
    >
      {children}
    </a>
  ),
};

const remarkPlugins = [remarkGfm];

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
}

/* ───────── Main Component ───────── */

export default function Home() {
  /* ── state ── */
  const [selectedModel, setSelectedModel] = useState('llama3.2')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const [isTeamMode, setIsTeamMode] = useState(false)
  const [customTeams, setCustomTeams] = useState<Array<{ id: string; name: string }>>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [currentConvId, setCurrentConvId] = useState<string | null>(null)
  const [convLoading, setConvLoading] = useState(false)

  const [sidebarTab, setSidebarTab] = useState<'chats' | 'memory'>('chats')
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [newMemoryText, setNewMemoryText] = useState('')
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingMemoryText, setEditingMemoryText] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const memoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── cleanup on unmount ── */
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (memoryTimerRef.current) clearTimeout(memoryTimerRef.current)
    }
  }, [])

  /* ── scroll ── */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  /* ── fetch models ── */
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/api/models')
        const data = await response.json()
        if (data.success && data.models) {
          setAvailableModels(data.models)
          const currentModel = data.models.find((m: ModelInfo) => m.id === selectedModel)
          if (!currentModel || !currentModel.available) {
            const firstAvailable = data.models.find((m: ModelInfo) => m.available)
            if (firstAvailable) setSelectedModel(firstAvailable.id)
          }
        }
      } catch (err) {
        console.error('Failed to fetch models:', err)
      } finally {
        setModelsLoading(false)
      }
    }
    fetchModels()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── fetch teams ── */
  useEffect(() => {
    if (!isTeamMode) return
    const fetchTeams = async () => {
      try {
        const response = await fetch('/api/teams')
        const data = await response.json()
        if (data.success && data.teams) {
          setCustomTeams(data.teams.map((t: Record<string, string>) => ({ id: t.id, name: t.name })))
        }
      } catch (err) {
        console.error('Failed to fetch teams:', err)
      }
    }
    fetchTeams()
  }, [isTeamMode])

  /* ── fetch conversation list ── */
  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations')
      const data = await res.json()
      if (data.success) setConversations(data.conversations ?? [])
    } catch (err) {
      console.error('Failed to fetch conversations:', err)
    }
  }, [])

  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  /* ── fetch memories ── */
  const refreshMemories = useCallback(async () => {
    try {
      const res = await fetch('/api/memories')
      const data = await res.json()
      if (data.success) setMemories(data.memories ?? [])
    } catch (err) {
      console.error('Failed to fetch memories:', err)
    }
  }, [])

  useEffect(() => {
    refreshMemories()
  }, [refreshMemories])

  const addNewMemory = async () => {
    if (!newMemoryText.trim()) return
    try {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMemoryText.trim(), category: 'other' }),
      })
      setNewMemoryText('')
      refreshMemories()
    } catch (err) {
      console.error('Failed to add memory:', err)
    }
  }

  const deleteMemoryItem = async (id: string) => {
    try {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' })
      refreshMemories()
    } catch (err) {
      console.error('Failed to delete memory:', err)
    }
  }

  const startEditMemory = (item: MemoryItem) => {
    setEditingMemoryId(item.id)
    setEditingMemoryText(item.content)
  }

  const saveEditMemory = async () => {
    if (!editingMemoryId || !editingMemoryText.trim()) return
    try {
      await fetch(`/api/memories/${editingMemoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editingMemoryText.trim() }),
      })
      setEditingMemoryId(null)
      setEditingMemoryText('')
      refreshMemories()
    } catch (err) {
      console.error('Failed to update memory:', err)
    }
  }

  const clearAllMemoriesAction = async () => {
    if (!confirm('确定清除所有记忆？此操作不可撤销。')) return
    try {
      await fetch('/api/memories', { method: 'DELETE' })
      refreshMemories()
    } catch (err) {
      console.error('Failed to clear memories:', err)
    }
  }

  useEffect(() => { scrollToBottom() }, [messages])

  /* ── save helper ── */
  const saveConversation = useCallback(async (msgs: ChatMessage[]) => {
    if (msgs.length === 0) return null;
    const payload = {
      messages: msgs.map(({ id, role, content }) => ({ id, role, content })),
      model: selectedModel,
      isTeamMode,
      teamId: selectedTeamId,
    };
    try {
      if (currentConvId) {
        await fetch(`/api/conversations/${currentConvId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        refreshConversations();
        return currentConvId;
      } else {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.success && data.conversation) {
          setCurrentConvId(data.conversation.id);
          refreshConversations();
          return data.conversation.id as string;
        }
      }
    } catch (err) {
      console.error('Failed to save conversation:', err);
    }
    return null;
  }, [currentConvId, selectedModel, isTeamMode, selectedTeamId, refreshConversations]);

  /* ── load conversation ── */
  const loadConversation = async (id: string) => {
    if (id === currentConvId) return;
    setConvLoading(true);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (data.success && data.conversation) {
        const conv = data.conversation;
        setMessages(conv.messages);
        setCurrentConvId(conv.id);
        setSelectedModel(conv.model);
        setIsTeamMode(conv.isTeamMode);
        setSelectedTeamId(conv.teamId ?? null);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    } finally {
      setConvLoading(false);
    }
  };

  /* ── delete conversation ── */
  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (currentConvId === id) {
        setCurrentConvId(null);
        setMessages([]);
        setError(null);
      }
      refreshConversations();
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  /* ── new conversation ── */
  const startNewConversation = () => {
    setCurrentConvId(null);
    setMessages([]);
    setError(null);
  };

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')

    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: userMessage,
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setIsLoading(true)
    setError(null)

    const apiPayload = isTeamMode
      ? { messages: newMessages.map(({ role, content }) => ({ role, content })), model: selectedModel, teamId: selectedTeamId }
      : { messages: newMessages.map(({ role, content }) => ({ role, content })), model: selectedModel }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const apiEndpoint = isTeamMode ? '/api/team' : '/api/chat'
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errText = await errorMessageFromResponse(response)
        throw new Error(errText)
      }

      const assistantId = newMessageId()
      const msgsWithAssistant = [...newMessages, { id: assistantId, role: 'assistant', content: '' }]
      setMessages(msgsWithAssistant)

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantMessage = ''

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            assistantMessage += chunk
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: assistantMessage } : m)
            )
          }
        } finally {
          reader.releaseLock()
        }
      }

      const finalMessages = newMessages.concat({ id: assistantId, role: 'assistant', content: assistantMessage })
      setIsLoading(false)

      await saveConversation(finalMessages)
      if (memoryTimerRef.current) clearTimeout(memoryTimerRef.current)
      memoryTimerRef.current = setTimeout(() => refreshMemories(), 5000)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error(String(err)))
      setIsLoading(false)
      console.error('Error:', err)
    }
  }

  /* ── clear = new conversation ── */
  const clearChat = () => {
    startNewConversation();
  }

  /* ───────── render ───────── */
  return (
    <div className="flex h-screen bg-[#0f1117] text-gray-100">
      {/* ─── Sidebar ─── */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } shrink-0 bg-[#14151e] border-r border-gray-800 flex flex-col transition-all duration-200 overflow-hidden`}
      >
        {/* Sidebar tabs */}
        <div className="border-b border-gray-800 flex">
          <button
            onClick={() => setSidebarTab('chats')}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === 'chats'
                ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            对话
          </button>
          <button
            onClick={() => setSidebarTab('memory')}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === 'memory'
                ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            记忆 {memories.length > 0 && <span className="ml-1 text-[10px] opacity-60">({memories.length})</span>}
          </button>
        </div>

        {/* ── Chats tab ── */}
        {sidebarTab === 'chats' && (
          <>
            <div className="p-3 border-b border-gray-800 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-300">历史对话</span>
              <button
                onClick={startNewConversation}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors"
                title="新建对话"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {conversations.length === 0 ? (
                <p className="text-xs text-gray-600 text-center mt-8">暂无历史对话</p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={`group mx-2 my-0.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      currentConvId === conv.id
                        ? 'bg-indigo-600/20 border border-indigo-500/30'
                        : 'hover:bg-gray-800/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm text-gray-200 truncate flex-1 leading-snug">
                        {conv.title}
                      </p>
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-500 hover:text-red-400 transition-all shrink-0"
                        title="删除"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-500">{conv.messageCount} 条</span>
                      <span className="text-[10px] text-gray-600">·</span>
                      <span className="text-[10px] text-gray-500">{relativeTime(conv.updatedAt)}</span>
                      {conv.isTeamMode && (
                        <span className="text-[10px] text-indigo-400/70 ml-auto">Team</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── Memory tab ── */}
        {sidebarTab === 'memory' && (
          <>
            <div className="p-3 border-b border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-300">AI 记忆</span>
                {memories.length > 0 && (
                  <button
                    onClick={clearAllMemoriesAction}
                    className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                  >
                    清除全部
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                AI 会自动记住你的偏好和习惯，也可手动添加。这些信息在所有对话中生效。
              </p>
            </div>

            {/* Add memory */}
            <div className="p-2 border-b border-gray-800/50">
              <div className="flex gap-1.5">
                <input
                  className="flex-1 px-2.5 py-1.5 text-xs bg-[#2a2b37] border border-gray-700 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none text-gray-200 placeholder-gray-500"
                  placeholder="手动添加记忆…"
                  value={newMemoryText}
                  onChange={(e) => setNewMemoryText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addNewMemory() }}
                />
                <button
                  onClick={addNewMemory}
                  disabled={!newMemoryText.trim()}
                  className="px-2 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-30 transition-all shrink-0"
                >
                  添加
                </button>
              </div>
            </div>

            {/* Memory list */}
            <div className="flex-1 overflow-y-auto py-1">
              {memories.length === 0 ? (
                <div className="text-center mt-8 px-4">
                  <p className="text-xs text-gray-600">暂无记忆</p>
                  <p className="text-[10px] text-gray-700 mt-1">对话几次后 AI 会自动记录</p>
                </div>
              ) : (
                memories.map((mem) => (
                  <div
                    key={mem.id}
                    className="group mx-2 my-0.5 px-3 py-2 rounded-lg hover:bg-gray-800/40 transition-colors"
                  >
                    {editingMemoryId === mem.id ? (
                      <div className="flex flex-col gap-1.5">
                        <input
                          className="w-full px-2 py-1 text-xs bg-[#2a2b37] border border-indigo-500 rounded text-gray-200 outline-none"
                          value={editingMemoryText}
                          onChange={(e) => setEditingMemoryText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEditMemory(); if (e.key === 'Escape') setEditingMemoryId(null) }}
                          autoFocus
                        />
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditingMemoryId(null)} className="px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-200">取消</button>
                          <button onClick={saveEditMemory} className="px-1.5 py-0.5 text-[10px] text-indigo-400 hover:text-indigo-300">保存</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-gray-300 leading-relaxed">{mem.content}</p>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              mem.source === 'auto'
                                ? 'bg-teal-900/30 text-teal-400'
                                : 'bg-indigo-900/30 text-indigo-400'
                            }`}>
                              {mem.source === 'auto' ? '自动' : '手动'}
                            </span>
                            <span className="text-[10px] text-gray-600">
                              {({ preference: '偏好', fact: '事实', habit: '习惯', instruction: '指示', other: '其他' } as Record<string, string>)[mem.category] ?? mem.category}
                            </span>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-all">
                            <button
                              onClick={() => startEditMemory(mem)}
                              className="p-0.5 text-gray-500 hover:text-indigo-400"
                              title="编辑"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => deleteMemoryItem(mem.id)}
                              className="p-0.5 text-gray-500 hover:text-red-400"
                              title="删除"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </aside>

      {/* ─── Main area ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-[#1a1b23] border-b border-gray-800 px-4 py-3 sticky top-0 z-10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 shrink-0">
              {/* Sidebar toggle */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors"
                title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <span className="text-xl">{isTeamMode ? '🤝' : '🤖'}</span>
              <h1 className="text-base font-semibold text-gray-100 hidden sm:block">
                AI Studio
              </h1>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button
                onClick={() => setIsTeamMode(!isTeamMode)}
                disabled={isLoading}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all disabled:opacity-40 ${
                  isTeamMode
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                }`}
              >
                {isTeamMode ? '🤝 Team' : '👤 Chat'}
              </button>

              {isTeamMode && customTeams.length > 0 && (
                <select
                  value={selectedTeamId || ''}
                  onChange={(e) => setSelectedTeamId(e.target.value || null)}
                  disabled={isLoading}
                  className="px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-40 text-gray-300"
                >
                  <option value="">自动</option>
                  {customTeams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              )}

              <a href="/records" target="_blank" className="px-2 py-1 text-xs bg-red-900/40 text-red-400 hover:text-red-300 hover:bg-red-900/60 rounded-md transition-all">操作记录</a>

              {isTeamMode && (
                <>
                  <a href="/agents" target="_blank" className="px-2 py-1 text-xs bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-md transition-all">Agent</a>
                  <a href="/teams" target="_blank" className="px-2 py-1 text-xs bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-md transition-all">Team</a>
                </>
              )}

              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isLoading || modelsLoading}
                className="px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-40 text-gray-300 max-w-[160px]"
              >
                {modelsLoading ? (
                  <option>加载中...</option>
                ) : availableModels.length > 0 ? (
                  availableModels.map((model) => (
                    <option key={model.id} value={model.id} disabled={!model.available}>
                      {model.displayName}{!model.available ? ` (${model.reason})` : ''}
                    </option>
                  ))
                ) : (
                  <option>无模型</option>
                )}
              </select>

              <a
                href="/models"
                target="_blank"
                className="px-2 py-1 text-xs bg-gray-800 text-gray-400 hover:text-indigo-300 hover:bg-gray-700 rounded-md transition-all"
                title="模型管理"
              >
                +
              </a>

              <button
                onClick={clearChat}
                disabled={isLoading || messages.length === 0}
                className="px-2 py-1 text-xs bg-gray-800 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded-md transition-all disabled:opacity-30"
                title="新建对话"
              >
                新建
              </button>

              <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
            </div>
          </div>
        </header>

        {/* Error bar */}
        {error && (
          <div className="bg-red-900/50 text-red-300 px-4 py-2 text-center text-sm border-b border-red-800">
            {error.message}
          </div>
        )}

        {/* Loading overlay when switching conversations */}
        {convLoading && (
          <div className="bg-indigo-900/20 text-indigo-300 px-4 py-1.5 text-center text-xs border-b border-indigo-800/30">
            加载对话中…
          </div>
        )}

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.length === 0 && (
              <div className="text-center mt-24 space-y-3">
                <div className="text-4xl">{isTeamMode ? '🤝' : '🤖'}</div>
                <h2 className="text-lg font-medium text-gray-300">
                  {isTeamMode ? 'Multi-Agent Team 协作' : 'AI Studio'}
                </h2>
                <p className="text-sm text-gray-500">
                  {isTeamMode ? '多个 Agent 协同回答' : '输入问题开始对话'}
                </p>
              </div>
            )}

            {messages.map((m, index) => (
              <div key={m.id} className={`mb-5 flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gradient-to-br from-teal-600 to-cyan-700 text-white'
                }`}>
                  {m.role === 'user' ? '👤' : '🤖'}
                </div>

                <div className={`min-w-0 max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}>
                  <div className={`inline-block text-left px-4 py-3 rounded-2xl ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-sm'
                      : 'bg-[#252736] text-gray-100 border border-gray-700/60 rounded-tl-sm'
                  }`}>
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap leading-relaxed text-sm">{m.content}</p>
                    ) : (
                      <div className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <MarkdownContent content={m.content} />
                        {isLoading && index === messages.length - 1 && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 bg-indigo-500 animate-pulse rounded-sm" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <footer className="bg-[#1a1b23] border-t border-gray-800 p-3">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSubmit} className="relative flex items-center">
              <input
                className="w-full py-3 px-4 pr-12 bg-[#2a2b37] border border-gray-700 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm text-gray-100 placeholder-gray-500 transition-all"
                value={input}
                placeholder={isTeamMode ? 'Team 模式，输入你的问题…' : '输入你的问题…'}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="absolute right-1.5 p-2 rounded-lg bg-indigo-600 text-white disabled:opacity-30 disabled:bg-gray-600 transition-all hover:bg-indigo-500 active:scale-95"
              >
                {isLoading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </form>
          </div>
        </footer>
      </div>
    </div>
  )
}
