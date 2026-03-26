import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { allTools } from '@/lib/tools';
import {
  findMcpBinding,
  formatMcpToolResult,
  mcpRpcOptions,
  type McpConnected,
} from '@/lib/mcp/session';

export type ToolCallLike = {
  name: string;
  id?: string;
  args?: Record<string, unknown>;
};

export type ExecuteToolCallLogContext = {
  /** 例如 chat 或 agent 名 */
  label?: string;
};

/**
 * 执行单条工具调用：优先 MCP 绑定，否则内置 DynamicStructuredTool。
 */
export async function executeToolCall(
  toolCall: ToolCallLike,
  mcp: McpConnected | null,
  log?: ExecuteToolCallLogContext
): Promise<string> {
  const prefix = log?.label ? `${log.label}: ` : '';
  const binding = mcp ? findMcpBinding(mcp.bindings, toolCall.name) : undefined;

  if (binding && mcp) {
    try {
      const raw = await binding.client.callTool(
        {
          name: binding.mcpName,
          arguments: (toolCall.args ?? {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        mcpRpcOptions()
      );
      const resultString = formatMcpToolResult(raw as never);
      console.log(`✅ ${prefix}MCP 工具 ${binding.mcpName} 执行成功`);
      return resultString;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${prefix}MCP ${binding.mcpName}:`, msg);
      return `MCP 工具失败: ${msg}`;
    }
  }

  const tool = allTools.find((t) => t.name === toolCall.name);
  if (!tool) {
    return `未知工具: ${toolCall.name}`;
  }

  try {
    const toolResult = await tool.func((toolCall.args ?? {}) as never);
    const resultString =
      typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
    console.log(`✅ ${prefix}工具 ${tool.name} 执行成功`);
    return resultString;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${prefix}工具 ${tool.name}:`, msg);
    return `工具执行失败: ${msg}`;
  }
}
