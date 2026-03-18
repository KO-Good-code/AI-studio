import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { selectAgentsForTask } from './configs';
import { AgentConfig, TeamContext } from './types';
import { createLLM } from '@/lib/models/factory';
import { allTools } from '@/lib/tools';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  connectMcpStdio,
  disconnectMcp,
  findMcpBinding,
  formatMcpToolResult,
  type McpConnected,
} from '@/lib/mcp/session';

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

  constructor(model: string) {
    this.llm = createLLM(model, 0.5);

    this.context = {
      originalQuestion: '',
      currentAgent: '',
      agentResponses: [],
      status: 'planning',
    };
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

    const plan = await this.runTeamRouter(
      candidateIds,
      allAgentsMap,
      currentQuestion,
      conversationHistory
    );

    const agents = plan.agentIds
      .map((id) => allAgentsMap[id])
      .filter(Boolean) as AgentConfig[];

    if (agents.length === 0) {
      yield `❌ **调度结果为空**，已中止。\n`;
      this.context.status = 'error';
      return;
    }

    yield `🧭 **调度**: ${plan.reason || '已根据问题选择参与成员'}\n\n`;
    yield `🔗 **本轮链式传递前序发言**: ${plan.chainPriorOutputs ? '是（后一位可读前一位本轮输出）' : '否（后一位仅看用户与历史对话）'}\n\n`;
    yield `✅ **本轮实际参与** (${agents.length} 人): ${agents.map((a) => `${a.emoji} ${a.name}`).join(' → ')}\n\n`;

    const baseOpenAiTools = allTools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema, { target: 'openApi3' }),
      },
    }));

    let mcp: McpConnected | null = null;
    try {
      mcp = await connectMcpStdio();
      const mergedTools = mcp
        ? [...baseOpenAiTools, ...mcp.openAiToolDefs]
        : baseOpenAiTools;

      if (mcp) {
        yield `🔌 **MCP 已连接**（${mcp.bindings.length} 个外部工具，名称以 \`mcp_\` 开头）\n\n`;
      }

      const hasBindTools = typeof (this.llm as any).bindTools === 'function';
      const llmWithTools = hasBindTools
        ? (this.llm as any).bindTools(mergedTools, { tool_choice: 'auto' })
        : this.llm;

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

      const systemPrompt =
        `当前日期: ${today}\n\n${agent.systemPrompt}\n\n你可以使用工具来获取实时信息。如果用户的问题需要最新数据（新闻、股票、天气等），请调用相应工具。` +
        (mcp
          ? `\n\n带 \`mcp_\` 前缀的工具来自 MCP 生态（如读文件、目录列表等），按需调用。`
          : '') +
        `\n\n若用户用「它」「这只」「上面」「刚才」「对应」等指代，请结合【此前对话记录】推断具体指什么（如股票代码、产品名），不要无故要求用户重复已说过的信息。`;

      let agentResponse = '';
      try {
        const response = await llmWithTools.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(fullPrompt),
        ]);

        if (response.tool_calls && response.tool_calls.length > 0) {
          console.log(`🔧 [${agent.name}] 触发 ${response.tool_calls.length} 个工具调用`);

          for (const tc of response.tool_calls) {
            yield `\n🔧 *正在调用工具: ${tc.name}...*\n\n`;
          }

          const msgs: any[] = [
            new SystemMessage(systemPrompt),
            new HumanMessage(fullPrompt),
            new AIMessage({
              content: response.content,
              tool_calls: response.tool_calls,
            }),
          ];

          for (const tc of response.tool_calls) {
            const binding = mcp ? findMcpBinding(mcp.bindings, tc.name) : undefined;
            let result: string;
            if (binding && mcp) {
              try {
                const raw = await binding.client.callTool({
                  name: binding.mcpName,
                  arguments: (tc.args || {}) as Record<string, unknown>,
                });
                result = formatMcpToolResult(raw as any);
                console.log(`✅ [${agent.name}] MCP ${binding.mcpName} 成功`);
              } catch (err: any) {
                result = `MCP 工具失败: ${err.message}`;
                console.error(`❌ [${agent.name}] MCP ${binding.mcpName}:`, err.message);
              }
            } else {
              const tool = allTools.find((t) => t.name === tc.name);
              if (!tool) {
                result = `工具 ${tc.name} 不存在`;
              } else {
                try {
                  const raw = await tool.func(tc.args);
                  result = typeof raw === 'string' ? raw : JSON.stringify(raw);
                  console.log(`✅ [${agent.name}] 工具 ${tc.name} 执行成功`);
                } catch (err: any) {
                  result = `工具执行失败: ${err.message}`;
                  console.error(`❌ [${agent.name}] 工具 ${tc.name} 失败:`, err.message);
                }
              }
            }
            msgs.push(
              new ToolMessage({ content: result, tool_call_id: tc.id || '' })
            );
          }

          const finalStream = await llmWithTools.stream(msgs);
          for await (const chunk of finalStream) {
            const text =
              typeof chunk.content === 'string'
                ? chunk.content
                : chunk.content.map((c: any) => c.text || '').join('');
            if (text) {
              agentResponse += text;
              yield text;
            }
          }
        } else {
          const stream = await llmWithTools.stream([
            new SystemMessage(systemPrompt),
            new HumanMessage(fullPrompt),
          ]);

          for await (const chunk of stream) {
            const text =
              typeof chunk.content === 'string'
                ? chunk.content
                : chunk.content.map((c: any) => c.text || '').join('');
            if (text) {
              agentResponse += text;
              yield text;
            }
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

  getContext(): TeamContext {
    return this.context;
  }
}
