import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { allTools } from '@/lib/tools';
import { createLLM, isZhipuModel, validateModel } from '@/lib/models/factory';
import { streamZhipuChatCompletion } from '@/lib/models/zhipu-chat-stream';
import { formatChatStreamError, mapLlmErrorToResponse } from '@/lib/api/llmErrors';
import {
  chatPostBodySchema,
  normalizeClientMessageContent,
} from '@/lib/chat/schemas';
import { executeToolCall } from '@/lib/chat/executeToolCall';
import { toolsToOpenAiFunctions } from '@/lib/chat/openaiToolDefs';
import { messageContentToText, streamChunkToText } from '@/lib/langchain/messageText';
import {
  getLastUserQuery,
  heuristicLimitListToolCall,
} from '@/lib/chat/heuristicStockTools';
import {
  connectMcpStdio,
  disconnectMcp,
  isMcpConfigured,
  type McpConnected,
} from '@/lib/mcp/session';
import { getMemoryPrompt } from '@/lib/storage/memories';
import { extractAll } from '@/lib/memory/combined-extractor';

export const runtime = 'nodejs';

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

    const parsed = chatPostBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: '请求参数无效',
          issues: parsed.error.flatten(),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { model, messages, temperature: bodyTemp } = parsed.data;
    const temperature =
      bodyTemp !== undefined ? bodyTemp : 0.7;

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

    const llm = createLLM(model, temperature);

    const zhipuTools = toolsToOpenAiFunctions(allTools);

    const langchainMessages = messages.map((msg) => {
      const content = normalizeClientMessageContent(msg);
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

    const memoryPrompt = await getMemoryPrompt();

    const hasSystemMsg = messages.some((msg) => msg.role === 'system');
    const systemMsg = new SystemMessage(
      `当前日期: ${today}。如果用户提到"今天"、"最近"等时间词，请基于此日期理解。` +
        ` A股工具：全市场涨停/跌停/炸板名单用 aShareLimitList；单只股票 OHLC 行情或K线用 aShareQuote；个股基本面/PE/PB/ROE/财报/股东/分红用 aShareStockInfo。` +
        (isMcpConfigured()
          ? ' 带 mcp_ 前缀的工具来自 MCP 生态；其中 Yahoo/Finance 类多为单票、偏海外标的，一般不用于沪深全市场涨跌停榜单。'
          : '') +
        (memoryPrompt ? `\n\n${memoryPrompt}` : '')
    );
    const allMessages = hasSystemMsg
      ? langchainMessages
      : [systemMsg, ...langchainMessages];

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        let mcp: McpConnected | null = null;
        let collectedReply = '';
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

          const hasBindTools = typeof (llm as { bindTools?: unknown }).bindTools === 'function';
          const llmWithTools = hasBindTools
            ? (llm as any).bindTools(mergedTools, { tool_choice: 'auto' })
            : llm;

          const response = await llmWithTools.invoke(allMessages);

          const hiddenToolCalls = !response.tool_calls?.length
            ? ((response as Record<string, unknown>).additional_kwargs as
                | { tool_calls?: unknown[] }
                | undefined
              )?.tool_calls
            : undefined;
          if (hiddenToolCalls?.length) {
            console.log(
              '[chat] tool_calls 在 additional_kwargs 中，数量:',
              hiddenToolCalls.length
            );
            response.tool_calls = hiddenToolCalls as typeof response.tool_calls;
          }

          if (response.tool_calls && response.tool_calls.length > 0) {
            const cleanContent = typeof response.content === 'string'
              ? response.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/<\/?tool_call>/g, '')
              : response.content;
            const aiMessageWithToolCalls = new AIMessage({
              content: cleanContent,
              tool_calls: response.tool_calls,
            });
            const messagesWithAI = [...allMessages, aiMessageWithToolCalls];
            const toolMessages: ToolMessage[] = [];

            for (const toolCall of response.tool_calls) {
              const resultString = await executeToolCall(
                {
                  name: toolCall.name,
                  id: toolCall.id,
                  args: (toolCall.args ?? {}) as Record<string, unknown>,
                },
                mcp,
                { label: 'chat' }
              );

              toolMessages.push(
                new ToolMessage({
                  content: resultString,
                  tool_call_id: toolCall.id || '',
                })
              );
            }

            const messagesWithTools = [...messagesWithAI, ...toolMessages];
            let streamed = '';

            if (isZhipuModel(model)) {
              try {
                for await (const text of streamZhipuChatCompletion(
                  model,
                  temperature,
                  messagesWithTools
                )) {
                  if (text) {
                    streamed += text;
                    controller.enqueue(encoder.encode(text));
                  }
                }
              } catch (e) {
                console.warn(
                  '[chat] 智谱直连流式失败，将尝试 LangChain stream / invoke:',
                  e
                );
              }
            }

            if (!streamed.trim()) {
              const finalStream = await llmWithTools.stream(messagesWithTools);
              for await (const chunk of finalStream) {
                const text = streamChunkToText(chunk);
                if (text) {
                  streamed += text;
                  controller.enqueue(encoder.encode(text));
                }
              }
            }

            if (!streamed.trim()) {
              console.warn(
                '[chat] 工具后轮 stream 无正文，改用 invoke 拉取完整回复'
              );
              const finalMsg = await llmWithTools.invoke(messagesWithTools);
              const fallback = messageContentToText(finalMsg.content);
              if (fallback.trim()) {
                controller.enqueue(encoder.encode(fallback));
              } else if (toolMessages.length > 0) {
                controller.enqueue(
                  encoder.encode(
                    `（模型未生成说明，以下为工具原始结果）\n\n${toolMessages.map((m) => m.content).join('\n\n---\n\n')}`
                  )
                );
              } else {
                controller.enqueue(
                  encoder.encode(
                    '（工具已调度但无返回内容，请查看服务端日志或更换模型。）'
                  )
                );
              }
            }
            collectedReply = streamed;
          } else {
            console.log('[chat] 模型首轮无 tool_calls，尝试流式拿正文');
            let streamedPlain = '';

            if (isZhipuModel(model)) {
              try {
                for await (const text of streamZhipuChatCompletion(
                  model,
                  temperature,
                  allMessages
                )) {
                  if (text) {
                    streamedPlain += text;
                    controller.enqueue(encoder.encode(text));
                  }
                }
              } catch (e) {
                console.warn('[chat] 无工具路径 智谱直连流式失败:', e);
              }
            }

            if (!streamedPlain.trim()) {
              try {
                const noToolStream = await llm.stream(allMessages);
                for await (const chunk of noToolStream) {
                  const text = streamChunkToText(chunk);
                  if (text) {
                    streamedPlain += text;
                    controller.enqueue(encoder.encode(text));
                  }
                }
              } catch (e) {
                console.warn('[chat] 无工具路径 llm.stream 失败:', e);
              }
            }

            if (!streamedPlain.trim()) {
              console.warn(
                '[chat] 无工具路径 stream 均无正文，尝试 llm.invoke（无工具绑定）'
              );
              try {
                const finalMsg = await llm.invoke(allMessages);
                const fb = messageContentToText(finalMsg.content);
                if (fb.trim()) {
                  controller.enqueue(encoder.encode(fb));
                  streamedPlain = fb;
                }
              } catch (e) {
                console.warn('[chat] 无工具路径 llm.invoke 兜底失败:', e);
              }
            }

            if (!streamedPlain.trim()) {
              const q = getLastUserQuery(messages);
              const hint = heuristicLimitListToolCall(q);
              if (hint) {
                console.log(
                  `[chat] 模型无输出，启发式代调工具 ${hint.name}`,
                  hint.args
                );
                try {
                  const toolOut = await executeToolCall(
                    hint,
                    mcp,
                    { label: 'chat-heuristic' }
                  );
                  controller.enqueue(
                    encoder.encode(
                      `（模型未触发工具调用，已根据问题自动执行 ${hint.name}）\n\n${toolOut}`
                    )
                  );
                } catch (e) {
                  console.error('[chat] 启发式工具调用失败:', e);
                  controller.enqueue(
                    encoder.encode(
                      `（启发式工具调用失败：${e instanceof Error ? e.message : String(e)}）`
                    )
                  );
                }
              } else {
                controller.enqueue(
                  encoder.encode(
                    [
                      '（模型未输出任何文字。常见原因：）',
                      '1）工具数量过多（当前 ' +
                        mergedTools.length +
                        '）可能干扰模型，可在 mcp.config.json 中关掉不需要的 MCP 服务；',
                      '2）智谱 flash 模型 + LangChain 工具绑定偶发空回复，可换 glm-4.7 或更大参数模型；',
                      '3）请查看终端日志。',
                    ].join('\n')
                  )
                );
              }
            }
            collectedReply = streamedPlain;
          }

          controller.close();

          const normalizedMsgs = messages.map((m) => ({ role: m.role, content: m.content ?? '' }));
          if (collectedReply.trim()) {
            normalizedMsgs.push({ role: 'assistant', content: collectedReply });
          }
          (async () => {
            try {
              await new Promise((r) => setTimeout(r, 30000));
              await extractAll(model, normalizedMsgs);
            } catch (err) { console.error('[chat] 后台合并提取失败:', err); }
          })();
        } catch (error) {
          console.error('❌ 流式响应错误:', error);
          try {
            const text = formatChatStreamError(error);
            controller.enqueue(encoder.encode(text));
            controller.close();
          } catch {
            controller.error(error);
          }
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
  } catch (error: unknown) {
    console.error('>>> API Error:', error);
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
