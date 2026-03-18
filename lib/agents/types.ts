/**
 * Agent 系统类型定义
 */

export interface AgentConfig {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  emoji: string;
  specialties: string[];
  temperature?: number;
}

export interface AgentMessage {
  agentName: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  emoji?: string;
}

export interface TeamContext {
  originalQuestion: string;
  currentAgent: string;
  agentResponses: AgentMessage[];
  toolResults?: Record<string, any>;
  status: 'planning' | 'executing' | 'completed' | 'error';
}

export type AgentType = 'coder' | 'documenter' | 'debugger' | 'architect' | 'reviewer';
