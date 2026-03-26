import { AgentTeam } from '@/lib/agents/team';
import { getTeamById } from '@/lib/agents/storage';
import { validateModel } from '@/lib/models/factory';
import { mapLlmErrorToResponse } from '@/lib/api/llmErrors';
import { teamPostBodySchema } from '@/lib/chat/schemas';

export const runtime = 'nodejs';

/**
 * Multi-Agent Team 协作 API
 */
export async function POST(req: Request) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: '无效的 JSON 请求体' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const parsed = teamPostBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: '请求参数无效',
          issues: parsed.error.flatten(),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { model, teamId, messages: rawMessages, question } = parsed.data;

    let chatMessages: { role: string; content: string }[] = [];
    if (rawMessages && rawMessages.length > 0) {
      chatMessages = rawMessages.map((m) => ({
        role: m.role,
        content: m.content ?? '',
      }));
    } else if (question?.trim()) {
      chatMessages = [{ role: 'user', content: question.trim() }];
    }

    const last = chatMessages[chatMessages.length - 1];
    if (!last || last.role !== 'user' || !last.content.trim()) {
      return new Response(
        JSON.stringify({ error: '最后一条消息须为用户问题且内容非空' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('🤝 启动 Agent Team 模式');
    console.log(
      '📝 对话轮数:',
      chatMessages.length,
      '当前问题:',
      last.content.slice(0, 80)
    );
    console.log('🤖 使用模型:', model);

    const validation = await validateModel(model);
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: `模型不可用: ${validation.error}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const team = new AgentTeam(model);

    let customAgentIds: string[] | null = null;
    if (teamId) {
      const customTeam = await getTeamById(teamId);
      if (customTeam) {
        customAgentIds = customTeam.agentIds;
        console.log(`🎯 使用自定义 Team: ${customTeam.name}`);
      }
    }

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of team.processWithTeam(
            chatMessages,
            customAgentIds
          )) {
            controller.enqueue(encoder.encode(chunk));
          }

          controller.close();
          console.log('✅ Team 协作完成');
        } catch (error: unknown) {
          console.error('❌ Team 协作错误:', error);
          const msg = error instanceof Error ? error.message : String(error);
          const errorMsg = `\n\n❌ **系统错误**: ${msg}\n`;
          controller.enqueue(encoder.encode(errorMsg));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error: unknown) {
    console.error('>>> Team API Error:', error);
    const { error: errorMessage, suggestion, details } =
      mapLlmErrorToResponse(error);

    return new Response(
      JSON.stringify({
        error: errorMessage,
        suggestion,
        details,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
