import { NextRequest } from 'next/server';
import { loadCustomTeams, upsertTeam, deleteTeam, getTeamById } from '@/lib/agents/storage';
import { Team } from '@/lib/agents/storage';

export const runtime = 'nodejs';

/**
 * GET /api/teams - 获取所有自定义 Team
 */
export async function GET() {
  try {
    const teams = await loadCustomTeams();

    return Response.json({
      success: true,
      teams,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/teams - 创建或更新 Team
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, description, agentIds } = body as Partial<Team>;

    if (!id || !name || !agentIds || agentIds.length === 0) {
      return Response.json(
        { success: false, error: '缺少必要参数 (id, name, agentIds)' },
        { status: 400 }
      );
    }

    const team: Team = {
      id,
      name,
      description: description || '',
      agentIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await upsertTeam(team);

    return Response.json({
      success: true,
      message: 'Team 已保存',
      team,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/teams?id=xxx - 删除 Team
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return Response.json(
        { success: false, error: '缺少 Team ID' },
        { status: 400 }
      );
    }

    await deleteTeam(id);

    return Response.json({
      success: true,
      message: 'Team 已删除',
      id,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
