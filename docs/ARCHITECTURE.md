# 工程分层速览（AI Studio）

> Team 协作的详细架构图见仓库根目录 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 目录职责

| 路径 | 说明 |
|------|------|
| `app/api/chat` | 单聊：工具调用 + 流式输出（含智谱 SSE 直连兜底） |
| `app/api/team` | Multi-Agent Team 流式协作 |
| `app/api/models` | 模型列表与可用性探测 |
| `app/api/mcp/status` | MCP 连接自检 |
| `lib/chat/` | 聊天域：`schemas`（Zod 校验）、`executeToolCall`、`openaiToolDefs` |
| `lib/langchain/` | 与 LangChain 无关业务逻辑的纯工具，如 `messageText` |
| `lib/mcp/session.ts` | MCP 多实例连接、工具名映射、超时 |
| `lib/models/` | LLM 工厂、智谱流式、模型元数据 |
| `lib/tools/` | 内置 LangChain 工具（Tavily、天气等） |
| `lib/agents/` | Team 编排、路由、持久化 |
| `lib/api/llmErrors.ts` | 将底层错误映射为用户可读 JSON |

## 请求流（单聊）

1. `POST /api/chat` → Zod `chatPostBodySchema` 校验（含「最后一条须为用户」）。
2. `connectMcpStdio()` 按 `mcp.config.json` 拉起子进程，合并 OpenAI 形态工具定义。
3. `invoke` 首轮；若有 `tool_calls`，`executeToolCall` 统一执行 MCP 或内置工具。
4. 续写：智谱走 `streamZhipuChatCompletion`，否则 LangChain `stream`，再 `invoke` 兜底。
5. `finally` 中断开 MCP。

## 工程约定

- 环境变量示例见 `.env.local.example`；MCP 详见 `docs/MCP.md`。
- 新增 API 应对请求体做 **Zod 校验**，错误返回 **JSON**（`error` / `suggestion` / `issues`），便于前端展示。
