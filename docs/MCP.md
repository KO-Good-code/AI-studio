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
