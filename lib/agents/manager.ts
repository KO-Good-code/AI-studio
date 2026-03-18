import { AgentConfig } from './types';
import { AGENT_CONFIGS } from './configs';
import { loadCustomAgents } from './storage';

/**
 * Agent 管理器 - 合并内置和自定义 Agent
 */

/**
 * 获取所有可用的 Agent（内置 + 自定义）
 */
export async function getAllAgents(): Promise<Record<string, AgentConfig>> {
  const customAgents = await loadCustomAgents();
  
  // 合并内置和自定义 Agent
  return {
    ...AGENT_CONFIGS,
    ...customAgents,
  };
}

/**
 * 根据 ID 获取单个 Agent
 */
export async function getAgentById(id: string): Promise<AgentConfig | null> {
  const allAgents = await getAllAgents();
  return allAgents[id] || null;
}

/**
 * 检查 Agent ID 是否已存在
 */
export async function agentExists(id: string): Promise<boolean> {
  const allAgents = await getAllAgents();
  return id in allAgents;
}

/**
 * 获取内置 Agent 列表
 */
export function getBuiltInAgents(): Record<string, AgentConfig> {
  return { ...AGENT_CONFIGS };
}

/**
 * 检查是否为内置 Agent
 */
export function isBuiltInAgent(id: string): boolean {
  return id in AGENT_CONFIGS;
}
