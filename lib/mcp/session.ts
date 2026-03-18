/**
 * MCP 客户端：stdio / HTTP / 多实例
 * 配置优先级：① MCP_CONFIG_FILE 或项目根目录 mcp.config.json ② 环境变量
 */
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type McpStdioConfig = {
  command: string;
  args?: string[];
  cwd?: string;
};

export type McpHttpConfig = {
  url: string;
  headers?: Record<string, string>;
};

export type McpToolBinding = {
  exposedName: string;
  mcpName: string;
  client: Client;
};

export type McpConnected = {
  bindings: McpToolBinding[];
  openAiToolDefs: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  close: () => Promise<void>;
};

function sanitizeParameters(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: 'object', properties: {} };
}

function nextExposedName(mcpName: string, reserved: Set<string>): string {
  let base =
    'mcp_' +
    mcpName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
  if (!/^[a-zA-Z_]/.test(base))
    base = 'mcp_tool_' + base.replace(/^mcp_/, '');
  let name = base;
  let i = 0;
  while (reserved.has(name)) {
    name = `${base}_${++i}`;
  }
  reserved.add(name);
  return name;
}

async function appendToolsFromClient(
  client: Client,
  reserved: Set<string>,
  bindings: McpToolBinding[],
  openAiToolDefs: McpConnected['openAiToolDefs']
): Promise<void> {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const exposedName = nextExposedName(tool.name, reserved);
    bindings.push({
      exposedName,
      mcpName: tool.name,
      client,
    });
    openAiToolDefs.push({
      type: 'function',
      function: {
        name: exposedName,
        description:
          (tool.description ?? `MCP: ${tool.name}`).slice(0, 8000) ||
          `MCP tool: ${tool.name}`,
        parameters: sanitizeParameters(tool.inputSchema),
      },
    });
  }
}

async function addServersFromArray(
  items: unknown[],
  reserved: Set<string>,
  bindings: McpToolBinding[],
  openAiToolDefs: McpConnected['openAiToolDefs'],
  pushCloser: (fn: () => Promise<void>) => void,
  sourceLabel: string
): Promise<void> {
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] as Record<string, unknown>;
    if (!item || typeof item !== 'object') continue;

    if (item.stdio && typeof item.stdio === 'object') {
      const s = item.stdio as McpStdioConfig;
      if (!s.command) continue;
      const transport = new StdioClientTransport({
        command: s.command,
        args: s.args ?? [],
        cwd: s.cwd,
        stderr: 'pipe',
      });
      const client = new Client({
        name: `ai-studio-stdio-${sourceLabel}-${idx}`,
        version: '0.1.0',
      });
      try {
        await client.connect(transport);
        await appendToolsFromClient(
          client,
          reserved,
          bindings,
          openAiToolDefs
        );
        pushCloser(() => transport.close());
        console.log(
          `[MCP] ${sourceLabel} stdio #${idx} 已连接，累计工具 ${bindings.length}`
        );
      } catch (e) {
        console.error(`[MCP] ${sourceLabel} stdio #${idx} 失败:`, e);
        try {
          await transport.close();
        } catch {
          /* ignore */
        }
      }
    }

    if (item.http && typeof item.http === 'object') {
      const h = item.http as McpHttpConfig;
      if (!h.url) continue;
      const transport = new StreamableHTTPClientTransport(new URL(h.url), {
        requestInit:
          h.headers && Object.keys(h.headers).length
            ? { headers: h.headers }
            : undefined,
      });
      const client = new Client({
        name: `ai-studio-http-${sourceLabel}-${idx}`,
        version: '0.1.0',
      });
      try {
        await client.connect(transport);
        await appendToolsFromClient(
          client,
          reserved,
          bindings,
          openAiToolDefs
        );
        pushCloser(() => transport.close());
        console.log(
          `[MCP] ${sourceLabel} HTTP #${idx} ${h.url} 已连接，累计工具 ${bindings.length}`
        );
      } catch (e) {
        console.error(`[MCP] ${sourceLabel} HTTP #${idx} 失败:`, e);
        try {
          await transport.close();
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function buildConnected(
  bindings: McpToolBinding[],
  openAiToolDefs: McpConnected['openAiToolDefs'],
  closers: Array<() => Promise<void>>
): McpConnected | null {
  if (bindings.length === 0) return null;
  console.log(
    '[MCP] 已连接，工具:',
    bindings.map((b) => b.exposedName).join(', ')
  );
  return {
    bindings,
    openAiToolDefs,
    close: async () => {
      for (const fn of closers) {
        try {
          await fn();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** 从 JSON 文件读取 servers 列表（显式路径或默认项目根 mcp.config.json） */
async function loadServersFromConfigFile(): Promise<unknown[] | null> {
  const explicit =
    process.env.MCP_CONFIG_FILE?.trim() ||
    process.env.MCP_CONFIG_PATH?.trim();

  const paths: string[] = [];
  if (explicit) {
    paths.push(
      path.isAbsolute(explicit) ? explicit : path.join(process.cwd(), explicit)
    );
  } else {
    paths.push(path.join(process.cwd(), 'mcp.config.json'));
  }

  for (const p of paths) {
    if (!existsSync(p)) {
      if (explicit) {
        console.warn(`[MCP] 配置文件不存在: ${p}`);
      }
      continue;
    }
    try {
      const raw = await readFile(p, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[MCP] 已从文件加载: ${p}`);
        return parsed;
      }
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { servers: unknown }).servers)
      ) {
        const servers = (parsed as { servers: unknown[] }).servers;
        if (servers.length > 0) {
          console.log(`[MCP] 已从文件加载: ${p}`);
          return servers;
        }
      }
      if (explicit) {
        console.warn(
          '[MCP] 配置文件需为非空数组，或 { "servers": [ { "stdio"|"http": ... } ] }'
        );
      }
    } catch (e) {
      console.error('[MCP] 读取/解析配置失败:', p, e);
    }
  }
  return null;
}

/** 是否可能启用了 MCP（用于系统提示等） */
export function isMcpConfigured(): boolean {
  return !!(
    process.env.MCP_SERVER ||
    process.env.MCP_SERVERS ||
    process.env.MCP_HTTP_URL ||
    process.env.MCP_CONFIG_FILE ||
    process.env.MCP_CONFIG_PATH ||
    existsSync(path.join(process.cwd(), 'mcp.config.json'))
  );
}

/**
 * 连接所有已配置的 MCP。
 * 优先：mcp.config.json 或 MCP_CONFIG_FILE；否则 MCP_SERVERS → MCP_SERVER + MCP_HTTP_URL。
 */
export async function connectMcpStdio(): Promise<McpConnected | null> {
  const reserved = new Set<string>(['webSearch', 'weather']);
  const bindings: McpToolBinding[] = [];
  const openAiToolDefs: McpConnected['openAiToolDefs'] = [];
  const closers: Array<() => Promise<void>> = [];
  const pushCloser = (fn: () => Promise<void>) => closers.push(fn);

  const fromFile = await loadServersFromConfigFile();
  if (fromFile) {
    await addServersFromArray(
      fromFile,
      reserved,
      bindings,
      openAiToolDefs,
      pushCloser,
      'file'
    );
    const conn = buildConnected(bindings, openAiToolDefs, closers);
    if (conn) return conn;
  }

  const multiRaw = process.env.MCP_SERVERS?.trim();
  if (multiRaw) {
    try {
      const items = JSON.parse(multiRaw) as unknown;
      if (Array.isArray(items) && items.length > 0) {
        await addServersFromArray(
          items,
          reserved,
          bindings,
          openAiToolDefs,
          pushCloser,
          'env'
        );
        const conn = buildConnected(bindings, openAiToolDefs, closers);
        if (conn) return conn;
      }
    } catch (e) {
      console.error('[MCP] MCP_SERVERS JSON 无效:', e);
    }
  }

  const legacy = process.env.MCP_SERVER?.trim();
  if (legacy) {
    try {
      const cfg = JSON.parse(legacy) as McpStdioConfig;
      if (cfg.command) {
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          cwd: cfg.cwd,
          stderr: 'pipe',
        });
        const client = new Client({ name: 'ai-studio', version: '0.1.0' });
        await client.connect(transport);
        await appendToolsFromClient(
          client,
          reserved,
          bindings,
          openAiToolDefs
        );
        pushCloser(() => transport.close());
      }
    } catch (e) {
      console.error('[MCP] MCP_SERVER 解析/连接失败:', e);
    }
  }

  const httpUrl = process.env.MCP_HTTP_URL?.trim();
  if (httpUrl) {
    let headers: Record<string, string> = {};
    const hdrRaw = process.env.MCP_HTTP_HEADERS?.trim();
    if (hdrRaw) {
      try {
        headers = { ...headers, ...JSON.parse(hdrRaw) };
      } catch {
        console.error('[MCP] MCP_HTTP_HEADERS 须为 JSON 对象');
      }
    }
    const transport = new StreamableHTTPClientTransport(new URL(httpUrl), {
      requestInit:
        Object.keys(headers).length > 0 ? { headers } : undefined,
    });
    const client = new Client({ name: 'ai-studio-remote', version: '0.1.0' });
    try {
      await client.connect(transport);
      await appendToolsFromClient(
        client,
        reserved,
        bindings,
        openAiToolDefs
      );
      pushCloser(() => transport.close());
      console.log(`[MCP] 远程 ${httpUrl} 已连接`);
    } catch (e) {
      console.error('[MCP] MCP_HTTP_URL 连接失败:', e);
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
  }

  return buildConnected(bindings, openAiToolDefs, closers);
}

export async function disconnectMcp(conn: McpConnected | null): Promise<void> {
  if (!conn) return;
  try {
    await conn.close();
  } catch {
    /* ignore */
  }
}

export function findMcpBinding(
  bindings: McpToolBinding[],
  exposedName: string
): McpToolBinding | undefined {
  return bindings.find((b) => b.exposedName === exposedName);
}

export function formatMcpToolResult(result: {
  isError?: boolean;
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
}): string {
  if (result.isError) {
    return JSON.stringify(result, null, 2);
  }
  const parts =
    result.content?.map((c) => {
      if (c.type === 'text' && typeof c.text === 'string') return c.text;
      return JSON.stringify(c);
    }) ?? [];
  return parts.join('\n') || '(无输出)';
}
