# MCP 配置说明

## 方式一：单独 JSON 文件（推荐）

1. 复制示例并重命名：

   ```bash
   cp mcp.config.example.json mcp.config.json
   ```

2. 编辑 **`mcp.config.json`**（已在 `.gitignore`，不会进 Git）。

3. 支持两种结构（二选一）：

   **A. 带 `servers` 键**

   ```json
   {
     "servers": [
       { "stdio": { "command": "npx", "args": ["-y", "@vendor/mcp", "参数"] } },
       { "http": { "url": "https://...", "headers": { "Authorization": "Bearer xxx" } } }
     ]
   }
   ```

   **B. 根节点直接为数组**

   ```json
   [
     { "stdio": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] } }
   ]
   ```

4. 默认会读取项目根目录的 **`mcp.config.json`**。若要指定路径：

   ```bash
   # .env.local
   MCP_CONFIG_FILE=./config/my-mcp.json
   ```

---

## 配置优先级

1. **`mcp.config.json`**（或 `MCP_CONFIG_FILE` 指向的文件）— 只要解析出非空列表，**只用文件**，不再读下面环境变量里的「多服务」配置。  
2. 若没有有效文件配置，再依次尝试：**`MCP_SERVERS`** → **`MCP_SERVER`** + **`MCP_HTTP_URL`**。

---

## 方式二：环境变量（无文件时）

见仓库根目录 **`.env.local.example`**。

---

## 怎么测试是否生效

1. **接口自检（推荐）**  
   启动 `pnpm dev` 后浏览器或终端访问：

   ```bash
   curl -s http://localhost:3000/api/mcp/status | jq
   ```

   - `ok: true` 且 `tools` 非空 → 配置已生效。  
   - `configured: true` 但 `ok: false` → 看终端 `[MCP]` 报错（命令错误、路径不存在、网络等）。

2. **对话实测**  
   用已支持工具调用的模型，在单聊里说例如：「用 MCP 工具列出项目根目录下的文件」或「读取 package.json」（需已接 filesystem 类 MCP）。

---

## 安全

`mcp.config.json` 里常有 API Key / Bearer，务必保留在本地，勿提交。

---

## 故障排查

- **`MCP error -32000: Connection closed`（stdio 子进程秒退）**  
  常见原因是命令启动失败或进程立刻退出。  
  - **`yahoo-finance-mcp-server`（npm）**：当前包把 Python 源码当作可执行入口，在 Node 侧用 stdio 拉起时容易直接崩掉。  
  - 可改用 Node 包 `@szemeng76/yfinance-mcp-server`（示例：`npx -y @szemeng76/yfinance-mcp-server`），或自行用 `uvx` / `python` 运行维护良好的 PyPI/GitHub MCP，并按其 README 填写 `command` / `args`。

- **`MCP error -32603: d._parse is not a function`（调用 Yahoo 类工具时）**  
  这是 **MCP 子进程内部** 抛出的错误，不是本仓库 `app/api/chat` 的逻辑问题。  
  **常见原因**：`@szemeng76/yfinance-mcp-server` 用 esbuild **打成单文件** 时，`zod` 主入口与 `zod/v4-mini` 可能被各打一份进包，**两套 Zod 运行时混用**；MCP SDK 用 mini 侧去解析用 classic `z` 建出来的 schema 时，内部会走到不存在的 `_parse`，就出现该报错。  
  **可行做法**：  
  1. 暂时从 `mcp.config.json` 里 **去掉** Yahoo 那一段，只保留 filesystem 等稳定服务；  
  2. 换 **非单文件打包** 的 Yahoo MCP（例如克隆 [SzeMeng76/yfinance-mcp-server](https://github.com/SzeMeng76/yfinance-mcp-server) 本地 `pnpm i && node src/index.ts`，或等上游修复 bundle）；  
  3. 使用 **Python / 其他语言** 实现且 README 可用的 Yahoo Finance MCP，用 `uvx` / `python` 启动。

---

## Yahoo / 股票类 MCP 平替（推荐）

`@szemeng76/yfinance-mcp-server`（npm 单文件包）易出现 Zod 混用报错，可改用下面 **Python 生态**（数据源多为 Yahoo，经 **yfinance**）：

| 方案 | 说明 | `mcp.config.json` 示例 |
|------|------|-------------------------|
| **PyPI `yahoo-finance-mcp-server`**（默认推荐） | FastMCP + yfinance，工具多（行情、财报、期权、新闻等）。需 **Python ≥3.10** 且本机有 **`uv`**。 | `"command": "uvx", "args": ["yahoo-finance-mcp-server"]` |
| **`uvx` + Git**（Alex2Yang 系 README） | 不经过 PyPI，直接从仓库拉取运行（注意 README 里可能指向 fork，以仓库为准）。 | `"command": "uvx", "args": ["--from", "git+https://github.com/richin13/yahoo-finance-mcp", "yahoo-finance-mcp"]` |
| **`python -m`** | 已 `pip install yahoo-finance-mcp-server` 时可用。 | `"command": "python3", "args": ["-m", "yahoo_finance_mcp_server.server"]` |

**安装 `uv`（macOS）**：`brew install uv`；或见 [astral.sh/uv](https://docs.astral.sh/uv/getting-started/installation/)。  
若终端报 **`spawn uvx ENOENT`**，说明 PATH 里找不到 `uvx`，可把 `command` 写成 `uv` 的绝对路径，或先确保 shell 能执行 `uvx`。

- **`MCP error -32001: Request timed out`（默认约 60s）**  
  多发生在 **`uvx` 第一次**拉取 PyPI、或子进程冷启动较慢时：初始化 / `tools/list` 超过 SDK 默认超时。  
  本项目已将默认 MCP 请求超时提高到 **180s**，并可在 `.env.local` 设置 **`MCP_REQUEST_TIMEOUT_MS`**（例如 `300000`）继续加大；同时可在终端先执行一次 `uvx yahoo-finance-mcp-server` 完成缓存后再启动 Next。

**其他**：TypeScript 有 [yfnhanced-mcp](https://github.com/kanishka-namdeo/yfnhanced-mcp) 等，需自行按其 README 配置 `command` / `args` 并验证是否仍单文件打包引发依赖问题。
