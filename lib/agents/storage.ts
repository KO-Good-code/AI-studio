import { AgentConfig } from './types';
import fs from 'fs/promises';
import path from 'path';

/**
 * Agent 和 Team 配置的持久化存储
 */

const DATA_DIR = path.join(process.cwd(), '.agent-data');
const AGENTS_FILE = path.join(DATA_DIR, 'custom-agents.json');
const TEAMS_FILE = path.join(DATA_DIR, 'custom-teams.json');

export interface Team {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

/**
 * 读取自定义 Agent 列表
 */
export async function loadCustomAgents(): Promise<Record<string, AgentConfig>> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(AGENTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * 保存自定义 Agent 列表
 */
export async function saveCustomAgents(agents: Record<string, AgentConfig>): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
}

/**
 * 添加或更新一个自定义 Agent
 */
export async function upsertAgent(id: string, agent: AgentConfig): Promise<void> {
  const agents = await loadCustomAgents();
  agents[id] = agent;
  await saveCustomAgents(agents);
}

/**
 * 删除一个自定义 Agent
 */
export async function deleteAgent(id: string): Promise<void> {
  const agents = await loadCustomAgents();
  delete agents[id];
  await saveCustomAgents(agents);
}

/**
 * 读取自定义 Team 列表
 */
export async function loadCustomTeams(): Promise<Team[]> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(TEAMS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * 保存自定义 Team 列表
 */
export async function saveCustomTeams(teams: Team[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(TEAMS_FILE, JSON.stringify(teams, null, 2), 'utf-8');
}

/**
 * 添加或更新一个 Team
 */
export async function upsertTeam(team: Team): Promise<void> {
  const teams = await loadCustomTeams();
  const index = teams.findIndex((t) => t.id === team.id);
  
  if (index >= 0) {
    teams[index] = { ...team, updatedAt: Date.now() };
  } else {
    teams.push({ ...team, createdAt: Date.now(), updatedAt: Date.now() });
  }
  
  await saveCustomTeams(teams);
}

/**
 * 删除一个 Team
 */
export async function deleteTeam(id: string): Promise<void> {
  const teams = await loadCustomTeams();
  const filtered = teams.filter((t) => t.id !== id);
  await saveCustomTeams(filtered);
}

/**
 * 根据 ID 获取 Team
 */
export async function getTeamById(id: string): Promise<Team | null> {
  const teams = await loadCustomTeams();
  return teams.find((t) => t.id === id) || null;
}
