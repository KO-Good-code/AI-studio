import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents, getBuiltInAgents, isBuiltInAgent } from '@/lib/agents/manager';
import { loadCustomAgents, upsertAgent, deleteAgent } from '@/lib/agents/storage';
import { AgentConfig } from '@/lib/agents/types';

export const runtime = 'nodejs';

/**
 * GET /api/agents - 获取所有 Agent
 */
export async function GET() {
  try {
    const allAgents = await getAllAgents();
    const builtInAgents = getBuiltInAgents();
    const customAgents = await loadCustomAgents();

    return Response.json({
      success: true,
      agents: allAgents,
      builtIn: Object.keys(builtInAgents),
      custom: Object.keys(customAgents),
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents - 创建或更新 Agent
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '无效的 JSON 请求体' },
      { status: 400 }
    );
  }

  try {
    const { id, agent } = body as { id: string; agent: AgentConfig };

    if (!id || !agent) {
      return Response.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证必填字段
    if (!agent.name || !agent.role || !agent.systemPrompt) {
      return Response.json(
        { success: false, error: 'Agent 缺少必要字段 (name, role, systemPrompt)' },
        { status: 400 }
      );
    }

    // 检查是否为内置 Agent（不允许覆盖）
    if (isBuiltInAgent(id)) {
      return Response.json(
        { success: false, error: '不能修改内置 Agent' },
        { status: 403 }
      );
    }

    // 设置默认值
    const agentConfig: AgentConfig = {
      name: agent.name,
      role: agent.role,
      emoji: agent.emoji || '🤖',
      description: agent.description || '',
      specialties: agent.specialties || [],
      temperature: agent.temperature ?? 0.5,
      systemPrompt: agent.systemPrompt,
    };

    await upsertAgent(id, agentConfig);

    return Response.json({
      success: true,
      message: 'Agent 已保存',
      id,
      agent: agentConfig,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents?id=xxx - 删除 Agent
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return Response.json(
        { success: false, error: '缺少 Agent ID' },
        { status: 400 }
      );
    }

    // 检查是否为内置 Agent（不允许删除）
    if (isBuiltInAgent(id)) {
      return Response.json(
        { success: false, error: '不能删除内置 Agent' },
        { status: 403 }
      );
    }

    await deleteAgent(id);

    return Response.json({
      success: true,
      message: 'Agent 已删除',
      id,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
