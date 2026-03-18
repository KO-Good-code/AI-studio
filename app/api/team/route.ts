import { AgentTeam } from '@/lib/agents/team';
import { getTeamById } from '@/lib/agents/storage';
import { validateModel } from '@/lib/models/factory';

export const runtime = 'nodejs';

/**
 * Multi-Agent Team 协作 API
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { model = 'llama3.2', teamId } = body;

    let chatMessages: { role: string; content: string }[] = [];
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      chatMessages = body.messages.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      }));
    } else if (typeof body.question === 'string' && body.question.trim()) {
      chatMessages = [{ role: 'user', content: body.question.trim() }];
    } else {
      return new Response(
        JSON.stringify({ error: '请提供 messages 或 question' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const last = chatMessages[chatMessages.length - 1];
    if (last.role !== 'user') {
      return new Response(
        JSON.stringify({ error: '最后一条消息须为用户问题' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('🤝 启动 Agent Team 模式');
    console.log('📝 对话轮数:', chatMessages.length, '当前问题:', last.content.slice(0, 80));
    console.log('🤖 使用模型:', model);

    // 验证模型是否可用
    const validation = await validateModel(model);
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: `模型不可用: ${validation.error}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 创建 Agent Team
    const team = new AgentTeam(model);
    
    // 如果指定了 teamId，使用自定义 Team
    let customAgentIds: string[] | null = null;
    if (teamId) {
      const customTeam = await getTeamById(teamId);
      if (customTeam) {
        customAgentIds = customTeam.agentIds;
        console.log(`🎯 使用自定义 Team: ${customTeam.name}`);
      }
    }

    // 创建流式响应
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // 开始团队协作（传入自定义 Agent IDs）
          for await (const chunk of team.processWithTeam(chatMessages, customAgentIds)) {
            controller.enqueue(encoder.encode(chunk));
          }

          controller.close();
          console.log('✅ Team 协作完成');
        } catch (error: any) {
          console.error('❌ Team 协作错误:', error);
          const errorMsg = `\n\n❌ **系统错误**: ${error.message}\n`;
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
  } catch (error: any) {
    console.error('>>> Team API Error:', error.message);

    let errorMessage = error.message;
    let suggestion = '请检查 Ollama 服务是否运行';

    if (error.message.includes('ECONNREFUSED')) {
      errorMessage = '无法连接到 Ollama 服务';
      suggestion = '请运行: ollama serve';
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        suggestion: suggestion,
        details: error.message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
