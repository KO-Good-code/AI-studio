import {
  connectMcpStdio,
  disconnectMcp,
  isMcpConfigured,
} from '@/lib/mcp/session';

export const runtime = 'nodejs';

/**
 * GET /api/mcp/status
 * 测试 MCP 是否能连上、列出暴露给模型的工具名（不调用大模型）。
 */
export async function GET() {
  if (!isMcpConfigured()) {
    return Response.json(
      {
        ok: false,
        configured: false,
        message:
          '未检测到 MCP 配置。请添加 mcp.config.json 或环境变量 MCP_SERVER / MCP_SERVERS / MCP_HTTP_URL',
      },
      { status: 503 }
    );
  }

  let conn: Awaited<ReturnType<typeof connectMcpStdio>> = null;
  try {
    conn = await connectMcpStdio();
    if (!conn || conn.bindings.length === 0) {
      return Response.json({
        ok: false,
        configured: true,
        message:
          '配置已存在，但连接失败或未返回任何工具。请查看运行 next dev 的终端里的 [MCP] 日志',
        tools: [],
      });
    }

    return Response.json({
      ok: true,
      configured: true,
      toolCount: conn.bindings.length,
      tools: conn.bindings.map((b) => ({
        exposedName: b.exposedName,
        mcpName: b.mcpName,
      })),
      hint: '单聊里可让模型调用上述 exposedName（如：请用 mcp_xxx 列出当前目录）',
    });
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        configured: true,
        message: e instanceof Error ? e.message : String(e),
        tools: [],
      },
      { status: 502 }
    );
  } finally {
    await disconnectMcp(conn);
  }
}
