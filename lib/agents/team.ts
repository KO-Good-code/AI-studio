import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { selectAgentsForTask } from './configs';
import { AgentConfig, TeamContext } from './types';
import { createLLM, createLLMAsync, isZhipuModel } from '@/lib/models/factory';
import { streamZhipuChatCompletion } from '@/lib/models/zhipu-chat-stream';
import { messageContentToText } from '@/lib/langchain/messageText';
import { allTools } from '@/lib/tools';
import { toolsToOpenAiFunctions } from '@/lib/chat/openaiToolDefs';
import { executeToolCall } from '@/lib/chat/executeToolCall';
import { streamChunkToText } from '@/lib/langchain/messageText';
import {
  connectMcpStdio,
  disconnectMcp,
  type McpConnected,
} from '@/lib/mcp/session';
import { getMemoryPrompt } from '@/lib/storage/memories';

/** 调度结果：谁上场、是否链式传递本轮发言 */
interface TeamRoutePlan {
  agentIds: string[];
  chainPriorOutputs: boolean;
  reason: string;
}

/**
 * Multi-Agent Team 协调器
 */
export class AgentTeam {
  private llm: BaseChatModel;
  private context: TeamContext;

  private modelId: string;

  private constructor(model: string, llm: BaseChatModel) {
    this.modelId = model;
    this.llm = llm;
    this.context = {
      originalQuestion: '',
      currentAgent: '',
      agentResponses: [],
      status: 'planning',
    };
  }

  static async create(model: string): Promise<AgentTeam> {
    const llm = await createLLMAsync(model, 0.5);
    return new AgentTeam(model, llm);
  }

  /**
   * 从模型回复中解析 JSON（兼容 ```json 包裹）
   */
  private extractJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();
    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = codeBlock ? codeBlock[1].trim() : trimmed;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * 调度：决定本轮哪些 Agent 参与、是否把前一位的本轮输出传给后一位
   */
  private async runTeamRouter(
    candidateIds: string[],
    agentById: Record<string, AgentConfig>,
    currentQuestion: string,
    conversationHistory: string
  ): Promise<TeamRoutePlan> {
    const roster = candidateIds
      .filter((id) => agentById[id])
      .map((id) => {
        const a = agentById[id];
        return `- id: \`${id}\` | ${a.name}（${a.role}）\n  专长: ${a.specialties.join('、')}\n  简介: ${a.description}`;
      })
      .join('\n\n');

    const sys = `你是 Multi-Agent 团队的调度员。只输出一个 JSON 对象，不要其它文字或 markdown。

字段说明：
- agentIds: 字符串数组，必须从候选的 id 中选，按发言顺序；至少 1 个。
  · 若用户问题与候选成员专长明显不符、或属于闲聊/泛问，只选 1 个相对最合适的成员回应即可。
  · 若问题需要多人接力（如先定架构再写代码），按合理顺序列出多个 id，不要超过候选人数。
- chainPriorOutputs: 布尔。
  · true：后一位需要阅读前一位在本轮已生成的完整发言，并在此基础上补充或深化（典型：流水线协作）。
  · false：后一位只看「用户问题 + 此前对话记录」，不读本回合前面成员的长篇输出（避免无关专业把错误内容继续传递、或各角色独立作答）。
- reason: 一句中文，向用户解释为何这样调度。`;

    const user = `【候选成员】\n${roster}\n\n【此前对话】\n${conversationHistory || '（首轮，无）'}\n\n【本轮用户问题】\n${currentQuestion}\n\n输出 JSON 示例：{"agentIds":["coder"],"chainPriorOutputs":false,"reason":"..."}`;

    try {
      const res = await this.llm.invoke([
        new SystemMessage(sys),
        new HumanMessage(user),
      ]);
      const text =
        typeof res.content === 'string'
          ? res.content
          : (res.content as { text?: string }[]).map((c: any) => c.text || '').join('');
      const json = this.extractJsonObject(text);
      if (!json) throw new Error('parse');

      const rawIds = Array.isArray(json.agentIds) ? json.agentIds : [];
      const agentIds = rawIds
        .map((id) => String(id).trim())
        .filter((id) => candidateIds.includes(id));
      const seen = new Set<string>();
      const ordered = agentIds.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const finalIds =
        ordered.length > 0 ? ordered : [candidateIds[0]].filter(Boolean);

      return {
        agentIds: finalIds,
        chainPriorOutputs: json.chainPriorOutputs !== false,
        reason: typeof json.reason === 'string' ? json.reason : '',
      };
    } catch (e) {
      console.warn('Team 调度解析失败，使用默认候选全流程:', e);
      return {
        agentIds: candidateIds,
        chainPriorOutputs: true,
        reason: '采用默认：候选成员按序协作，并传递本轮上文',
      };
    }
  }

  async *processWithTeam(
    chatMessages: { role: string; content: string }[],
    customAgentIds: string[] | null = null
  ): AsyncGenerator<string, void, unknown> {
    const currentQuestion = chatMessages[chatMessages.length - 1].content;
    const conversationHistory = this.formatConversationHistory(chatMessages);
    this.context.originalQuestion = currentQuestion;
    this.context.status = 'planning';

    yield `\n🎯 **开始任务分析...**\n\n`;
    if (conversationHistory) {
      yield `📜 **已带上此前 ${chatMessages.length - 1} 条对话记录**\n\n`;
    }
    yield `📝 **本轮问题**: ${currentQuestion}\n\n`;

    const selectionText = [conversationHistory, currentQuestion]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2000);
    const keywordAgentIds =
      customAgentIds || selectAgentsForTask(selectionText);

    const { getAllAgents } = await import('./manager');
    const allAgentsMap = await getAllAgents();

    const candidateIds = keywordAgentIds.filter((id) => allAgentsMap[id]);
    if (candidateIds.length === 0) {
      yield `❌ **未找到可用 Agent**，请检查 Team 配置。\n`;
      this.context.status = 'error';
      return;
    }

    yield `📋 **关键词初筛候选**: ${candidateIds.length} 人\n\n`;

    let plan: TeamRoutePlan;
    if (candidateIds.length === 1) {
      plan = {
        agentIds: candidateIds,
        chainPriorOutputs: false,
        reason: '仅一位候选成员，直接执行（跳过调度）',
      };
      yield `⚡ **单 Agent 模式，跳过调度**\n\n`;
    } else {
      plan = await this.runTeamRouter(
        candidateIds,
        allAgentsMap,
        currentQuestion,
        conversationHistory
      );
    }

    const agents = plan.agentIds
      .map((id) => allAgentsMap[id])
      .filter(Boolean) as AgentConfig[];

    if (agents.length === 0) {
      yield `❌ **调度结果为空**，已中止。\n`;
      this.context.status = 'error';
      return;
    }

    yield `🧭 **调度**: ${plan.reason || '已根据问题选择参与成员'}\n\n`;
    if (agents.length > 1) {
      yield `🔗 **本轮链式传递前序发言**: ${plan.chainPriorOutputs ? '是（后一位可读前一位本轮输出）' : '否（后一位仅看用户与历史对话）'}\n\n`;
    }
    yield `✅ **本轮实际参与** (${agents.length} 人): ${agents.map((a) => `${a.emoji} ${a.name}`).join(' → ')}\n\n`;

    const baseOpenAiTools = toolsToOpenAiFunctions(allTools);

    let mcp: McpConnected | null = null;
    try {
      mcp = await connectMcpStdio();
      const mergedTools = mcp
        ? [...baseOpenAiTools, ...mcp.openAiToolDefs]
        : baseOpenAiTools;

      if (mcp) {
        yield `🔌 **MCP 已连接**（${mcp.bindings.length} 个外部工具，名称以 \`mcp_\` 开头）\n\n`;
      }

      yield `---\n\n`;

    this.context.status = 'executing';
    this.context.agentResponses = [];

    const today = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    const totalAgents = agents.length;

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const isLastAgent = i === agents.length - 1;

      yield `\n${agent.emoji} **${agent.name} 开始工作...**\n\n`;

      const previousContext =
        plan.chainPriorOutputs && i > 0
          ? this.context.agentResponses
              .map((msg) => `[${msg.agentName}]: ${msg.content}`)
              .join('\n\n')
          : '';

      const independentThisRound = !plan.chainPriorOutputs && i > 0;

      const fullPrompt = this.buildAgentPrompt(
        agent,
        currentQuestion,
        previousContext,
        isLastAgent,
        conversationHistory,
        totalAgents,
        independentThisRound
      );

      const agentTools = AgentTeam.filterToolsForAgent(agent, mergedTools);
      const hasBindTools = typeof (this.llm as any).bindTools === 'function';
      const llmWithTools = hasBindTools
        ? (this.llm as any).bindTools(agentTools, { tool_choice: 'auto' })
        : this.llm;

      console.log(`[${agent.name}] 绑定 ${agentTools.length}/${mergedTools.length} 个工具`);

      const memoryPrompt = await getMemoryPrompt();
      const systemPrompt =
        `当前日期: ${today}\n\n${agent.systemPrompt}\n\n你可以使用工具来获取实时信息。` +
        `A股工具：涨跌停/炸板名单用 aShareLimitList；OHLC行情/K线用 aShareQuote；个股基本面/PE/ROE/财报/股东/分红用 aShareStockInfo；新闻与泛搜索用 webSearch。` +
        `\n\n⚠️ 重要：当用户要求"获取最新信息"或"重新分析"时，你**必须**先调用工具获取实时数据，然后再给出分析。不要依赖历史对话中的旧数据。` +
        `\n\n🚫 禁止在回复文本中写 XML 格式的工具调用（如 <tool_call>、<invoke>、<minimax:tool_call> 等）。你只能通过系统提供的 function calling 机制调用工具。如果工具已返回数据，请直接基于数据进行分析总结，不要尝试调用更多工具。` +
        `\n\n若用户用「它」「这只」「上面」「刚才」「对应」等指代，请结合【此前对话记录】推断具体指什么（如股票代码、产品名），不要无故要求用户重复已说过的信息。` +
        (memoryPrompt ? `\n\n${memoryPrompt}` : '');

      let agentResponse = '';
      try {
        const response = await llmWithTools.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(fullPrompt),
        ]);

        const hiddenToolCalls = !response.tool_calls?.length
          ? ((response as Record<string, unknown>).additional_kwargs as
              | { tool_calls?: unknown[] }
              | undefined
            )?.tool_calls
          : undefined;
        if (hiddenToolCalls?.length) {
          console.log(`[${agent.name}] tool_calls 在 additional_kwargs 中，数量:`, hiddenToolCalls.length);
          response.tool_calls = hiddenToolCalls as typeof response.tool_calls;
        }

        if (response.tool_calls && response.tool_calls.length > 0) {
          console.log(`🔧 [${agent.name}] 触发 ${response.tool_calls.length} 个工具调用`);

          for (const tc of response.tool_calls) {
            yield `\n🔧 *正在调用工具: ${tc.name}...*\n\n`;
          }

          const cleanedContent = typeof response.content === 'string'
            ? AgentTeam.cleanToolCallTags(response.content)
            : response.content;
          const msgs: any[] = [
            new SystemMessage(systemPrompt),
            new HumanMessage(fullPrompt),
            new AIMessage({
              content: cleanedContent,
              tool_calls: response.tool_calls,
            }),
          ];

          for (const tc of response.tool_calls) {
            const result = await executeToolCall(
              {
                name: tc.name,
                id: tc.id,
                args: (tc.args ?? {}) as Record<string, unknown>,
              },
              mcp,
              { label: `[${agent.name}]` }
            );
            msgs.push(
              new ToolMessage({ content: result, tool_call_id: tc.id || '' })
            );
          }

          const toolMsgContents = msgs
            .filter((m: unknown) => m instanceof ToolMessage)
            .map((m: ToolMessage) => String(m.content));

          msgs.push(
            new HumanMessage(
              '请直接基于以上工具返回的数据，给出完整、详细的分析总结。' +
              '不要尝试调用更多工具，不要输出任何 XML 标签。'
            )
          );

          agentResponse += yield* this.streamWithFallback(
            this.llm,
            msgs,
            agent.name,
            toolMsgContents
          );
        } else {
          const directContent = typeof response.content === 'string'
            ? AgentTeam.cleanToolCallTags(response.content).trim()
            : messageContentToText(response.content).trim();

          if (directContent) {
            yield directContent;
            agentResponse += directContent;
          } else {
            console.warn(`[${agent.name}] invoke 无内容，走 streamWithFallback`);
            const plainMsgs = [
              new SystemMessage(systemPrompt),
              new HumanMessage(fullPrompt),
            ];
            agentResponse += yield* this.streamWithFallback(
              llmWithTools,
              plainMsgs,
              agent.name
            );
          }
        }

        this.context.agentResponses.push({
          agentName: agent.name,
          role: 'assistant',
          content: agentResponse,
          timestamp: Date.now(),
          emoji: agent.emoji,
        });

        yield `\n\n---\n\n`;
      } catch (error: any) {
        yield `\n\n❌ **${agent.name} 遇到错误**: ${error.message}\n\n`;
      }
    }

    this.context.status = 'completed';
    yield `\n✅ **团队协作完成！**\n`;
    } finally {
      await disconnectMcp(mcp);
    }
  }

  private formatConversationHistory(
    messages: { role: string; content: string }[]
  ): string {
    if (messages.length <= 1) return '';
    const parts: string[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i];
      const label =
        m.role === 'user' ? '用户' : '助手（上一轮 Team 完整回复）';
      parts.push(`**${label}**:\n${m.content}`);
    }
    return parts.join('\n\n────────\n\n');
  }

  private buildAgentPrompt(
    agent: AgentConfig,
    currentQuestion: string,
    previousContext: string,
    isLastAgent: boolean,
    conversationHistory: string,
    totalAgents: number,
    independentThisRound: boolean
  ): string {
    let prompt = '';

    if (conversationHistory) {
      prompt += `**此前对话记录**（本轮追问请结合下文；用户若未重复股票名/代码，请从上文推断）：\n\n${conversationHistory}\n\n==========\n\n`;
    }

    prompt += `**本轮用户问题**: ${currentQuestion}\n\n`;

    if (previousContext) {
      prompt += `**本回合团队中已有成员的发言**:\n${previousContext}\n\n`;
      prompt += `**你的任务**: 基于以上内容，从 **${agent.role}** 的角度提供你的专业见解和建议。`;
    } else if (independentThisRound) {
      prompt += `**你的任务**: 作为 **${agent.role}**，请**仅根据用户问题与「此前对话记录」**独立作答；调度策略要求你**不要**假设或依赖本团队其它成员在本轮已生成的内容（避免非本专业内容误导你）。`;
    } else {
      prompt += `**你的任务**: 作为 **${agent.role}**，请为这个问题提供你的专业解答。`;
    }

    if (isLastAgent && totalAgents > 1 && previousContext) {
      prompt += `\n\n💡 **注意**: 你是本轮最后一位发言的成员，请整合团队中已有发言，给出完整方案。`;
    } else if (isLastAgent && totalAgents > 1 && !previousContext) {
      prompt += `\n\n💡 **注意**: 你是本轮最后一位；若前面已有成员发言，用户可在界面查看；请从你的专业角度收束或补充结论。`;
    } else if (isLastAgent && totalAgents === 1) {
      prompt += `\n\n💡 **注意**: 请给出完整、可直接采纳的答复。`;
    }

    return prompt;
  }

  private static readonly STOCK_TOOL_NAMES = new Set([
    'aShareLimitList',
    'aShareQuote',
    'aShareStockInfo',
    'webSearch',
    'mcp_web_search',
    'mcp_get_stock_info',
    'mcp_get_historical_stock_prices',
    'mcp_get_stock_actions',
    'mcp_get_financial_statement',
    'mcp_get_holder_info',
    'mcp_get_recommendations',
    'mcp_get_yahoo_finance_news',
    'backtest',
  ]);

  private static isStockAgent(agent: AgentConfig): boolean {
    const text = `${agent.systemPrompt} ${agent.description} ${agent.specialties.join(' ')}`;
    return /A股|打板|龙头|涨停|股票|短线|连板/.test(text);
  }

  private static filterToolsForAgent(
    agent: AgentConfig,
    allTools: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    if (!AgentTeam.isStockAgent(agent)) return allTools;

    return allTools.filter((tool) => {
      const fn = (tool as { function?: { name?: string } }).function;
      const name = fn?.name ?? '';
      return AgentTeam.STOCK_TOOL_NAMES.has(name);
    });
  }

  private static cleanToolCallTags(s: string): string {
    return s
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<\/?think>/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<\/?tool_call>/g, '')
      .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '')
      .replace(/<\/?minimax:tool_call>/g, '')
      .replace(/<minimax:[^>]*>[\s\S]*?<\/minimax:[^>]*>/g, '')
      .replace(/<\/?minimax:[^>]*>/g, '')
      .replace(/<invoke[\s\S]*?<\/invoke>/g, '')
      .replace(/<\/?invoke[^>]*>/g, '');
  }

  private async *streamWithFallback(
    llmWithTools: BaseChatModel,
    msgs: unknown[],
    agentName: string,
    toolResultTexts?: string[]
  ): AsyncGenerator<string, string, unknown> {
    let text = '';

    let buf = '';
    const flushClean = function* (this: void, raw: string): Generator<string> {
      buf += raw;
      const cleaned = AgentTeam.cleanToolCallTags(buf);
      if (/<tool_call/i.test(buf) && !/<\/tool_call>/i.test(buf)) return;
      if (/<think/i.test(buf) && !/<\/think>/i.test(buf)) return;
      if (/<minimax:/i.test(buf) && !/<\/minimax:/i.test(buf)) return;
      if (/<invoke[\s>]/i.test(buf) && !/<\/invoke>/i.test(buf)) return;
      if (cleaned.trim()) yield cleaned;
      buf = '';
    };

    if (isZhipuModel(this.modelId)) {
      try {
        for await (const t of streamZhipuChatCompletion(
          this.modelId,
          0.5,
          msgs as import('@langchain/core/messages').BaseMessage[]
        )) {
          if (t) {
            for (const c of flushClean(t)) { text += c; yield c; }
          }
        }
      } catch (e) {
        console.warn(`[${agentName}] 智谱直连流式失败:`, e);
      }
    }
    if (buf) { const c = AgentTeam.cleanToolCallTags(buf); if (c.trim()) { text += c; yield c; } buf = ''; }

    if (!text.trim()) {
      try {
        const stream = await llmWithTools.stream(
          msgs as import('@langchain/core/messages').BaseMessage[]
        );
        for await (const chunk of stream) {
          const t = streamChunkToText(chunk);
          if (t) {
            for (const c of flushClean(t)) { text += c; yield c; }
          }
        }
      } catch (e) {
        console.warn(`[${agentName}] llmWithTools.stream 失败:`, e);
      }
    }
    if (buf) {
      console.log(`[${agentName}] 流式结束 buf 残留 ${buf.length} 字，前120: ${buf.slice(0, 120)}`);
      const c = AgentTeam.cleanToolCallTags(buf); if (c.trim()) { text += c; yield c; } buf = '';
    }

    console.log(`[${agentName}] streamWithFallback 文本长度: ${text.trim().length}，前200: ${text.trim().slice(0, 200)}`);

    if (!text.trim()) {
      try {
        const resp = await this.llm.invoke(
          msgs as import('@langchain/core/messages').BaseMessage[]
        );
        const t = AgentTeam.cleanToolCallTags(messageContentToText(resp.content));
        if (t.trim()) {
          text += t;
          yield t;
        }
      } catch (e) {
        console.warn(`[${agentName}] llm.invoke 兜底失败:`, e);
      }
    }

    const tooShort = text.trim().length > 0 && text.trim().length < 200;
    if ((!text.trim() || tooShort) && toolResultTexts?.length) {
      const label = tooShort
        ? `\n\n---\n\n（${agentName} 回复过短，以下附上工具原始数据供参考）\n\n`
        : `（${agentName} 模型未生成总结，以下为工具原始数据）\n\n`;
      const fallback = label + toolResultTexts.join('\n\n---\n\n');
      yield fallback;
      text += fallback;
    }

    if (!text.trim()) {
      const notice = `（${agentName} 未输出内容，请尝试换用更大参数模型）\n`;
      yield notice;
      text += notice;
    }

    return text;
  }

  getContext(): TeamContext {
    return this.context;
  }
}
