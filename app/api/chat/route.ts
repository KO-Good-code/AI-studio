import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { allTools } from '@/lib/tools';
import { createLLM, validateModel } from '@/lib/models/factory';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  connectMcpStdio,
  disconnectMcp,
  findMcpBinding,
  formatMcpToolResult,
  isMcpConfigured,
  type McpConnected,
} from '@/lib/mcp/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { messages, model = 'llama3.2' } = await req.json();

    console.log('📥 收到请求，使用模型:', model);
    console.log('📝 消息数量:', messages.length);

    const validation = await validateModel(model);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: `模型不可用: ${validation.error}`,
          suggestion: '请检查模型配置或 API Key',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const llm = createLLM(model, 0.7);

    const zhipuTools = allTools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema, { target: 'openApi3' }),
      },
    }));

    const langchainMessages = messages.map((msg: any) => {
      const content =
        msg.content ||
        (msg.parts ? msg.parts.map((p: any) => p.text).join('') : '');
      if (msg.role === 'user') return new HumanMessage(content);
      if (msg.role === 'assistant') return new AIMessage(content);
      if (msg.role === 'system') return new SystemMessage(content);
      return new HumanMessage(content);
    });

    const today = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    const hasSystemMsg = messages.some((msg: any) => msg.role === 'system');
    const systemMsg = new SystemMessage(
      `当前日期: ${today}。如果用户提到"今天"、"最近"等时间词，请基于此日期理解。` +
        (isMcpConfigured()
          ? ' 带 mcp_ 前缀的工具来自 MCP 生态（如读文件、执行外部能力），按需调用。'
          : '')
    );
    const allMessages = hasSystemMsg
      ? langchainMessages
      : [systemMsg, ...langchainMessages];

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        let mcp: McpConnected | null = null;
        try {
          mcp = await connectMcpStdio();
          const mergedTools = mcp
            ? [...zhipuTools, ...mcp.openAiToolDefs]
            : zhipuTools;

          console.log(
            '🔧 工具数量:',
            mergedTools.length,
            mcp ? `(含 MCP ${mcp.bindings.length})` : ''
          );

          const hasBindTools = typeof (llm as any).bindTools === 'function';
          const llmWithTools = hasBindTools
            ? (llm as any).bindTools(mergedTools, { tool_choice: 'auto' })
            : llm;

          const response = await llmWithTools.invoke(allMessages);

          if (response.tool_calls && response.tool_calls.length > 0) {
            const aiMessageWithToolCalls = new AIMessage({
              content: response.content,
              tool_calls: response.tool_calls,
            });
            const messagesWithAI = [...allMessages, aiMessageWithToolCalls];
            const toolMessages: ToolMessage[] = [];

            for (const toolCall of response.tool_calls) {
              const binding = mcp
                ? findMcpBinding(mcp.bindings, toolCall.name)
                : undefined;
              let resultString: string;

              if (binding && mcp) {
                try {
                  const raw = await binding.client.callTool({
                    name: binding.mcpName,
                    arguments: (toolCall.args || {}) as Record<
                      string,
                      unknown
                    >,
                  });
                  resultString = formatMcpToolResult(raw as any);
                  console.log(`✅ MCP 工具 ${binding.mcpName} 执行成功`);
                } catch (err: any) {
                  resultString = `MCP 工具失败: ${err.message}`;
                  console.error(`❌ MCP ${binding.mcpName}:`, err.message);
                }
              } else {
                const tool = allTools.find((t) => t.name === toolCall.name);
                if (!tool) {
                  resultString = `未知工具: ${toolCall.name}`;
                } else {
                  try {
                    const toolResult = await tool.func(toolCall.args);
                    resultString =
                      typeof toolResult === 'string'
                        ? toolResult
                        : JSON.stringify(toolResult);
                  } catch (error: any) {
                    resultString = `工具执行失败: ${error.message}`;
                  }
                }
              }

              toolMessages.push(
                new ToolMessage({
                  content: resultString,
                  tool_call_id: toolCall.id || '',
                })
              );
            }

            const messagesWithTools = [...messagesWithAI, ...toolMessages];
            const finalStream = await llmWithTools.stream(messagesWithTools);
            for await (const chunk of finalStream) {
              const text =
                typeof chunk.content === 'string'
                  ? chunk.content
                  : chunk.content.map((c: any) => c.text || '').join('');
              if (text) controller.enqueue(encoder.encode(text));
            }
          } else {
            const text =
              typeof response.content === 'string'
                ? response.content
                : response.content.map((c: any) => c.text || '').join('');
            if (text) controller.enqueue(encoder.encode(text));
          }

          controller.close();
        } catch (error) {
          console.error('❌ 流式响应错误:', error);
          controller.error(error);
        } finally {
          await disconnectMcp(mcp);
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
    console.error('>>> API Error:', error.message);

    let errorMessage = error.message;
    let suggestion = '请检查服务配置';

    if (error.message.includes('ECONNREFUSED')) {
      errorMessage = '无法连接到 Ollama 服务';
      suggestion = '请运行: ollama serve';
    } else if (
      error.message.includes('model') ||
      error.message.includes('not found')
    ) {
      errorMessage = '模型未找到';
      suggestion = '请运行: ollama pull llama3.2 或 ollama pull qwen2.5:7b';
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        suggestion,
        details: error.message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
