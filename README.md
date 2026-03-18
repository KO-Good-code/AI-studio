# 🦙 AI Studio

基于 **Next.js 14** + **LangChain** 的本地/云端对话助手：支持 **Ollama**、**智谱 GLM**，单聊与 **Multi-Agent Team**，内置搜索/天气工具，可选 **MCP** 扩展能力。

## ✨ 功能特性

- ✅ 流式对话（单 Agent / Team 模式）
- ✅ Ollama 本地模型 + 智谱云端模型切换
- ✅ 工具调用（联网搜索 Tavily、天气示例等）
- ✅ MCP：`mcp.config.json` 或环境变量，自检 `GET /api/mcp/status`
- ✅ Team：多角色 Agent 协作、自定义 Team（`/teams`）
- ✅ 暗色模式、模型动态列表

## 🛠️ 技术栈

- **Next.js 14** · **LangChain** · **Ollama** / **智谱 OpenAI 兼容 API**
- **Tailwind CSS** · **TypeScript**

## 📚 文档索引

| 文档 | 说明 |
|------|------|
| [TEAM_GUIDE.md](./TEAM_GUIDE.md) | Team 模式使用与测试思路 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构说明 |
| [GLM_INTEGRATION.md](./GLM_INTEGRATION.md) | 智谱 AI 配置 |
| [OLLAMA_DYNAMIC_MODELS.md](./OLLAMA_DYNAMIC_MODELS.md) | Ollama 动态模型列表 |
| [docs/MCP.md](./docs/MCP.md) | MCP 配置、多服务、自检 |
| [lib/agents/README.md](./lib/agents/README.md) | Agent 扩展开发 |
| [CHANGELOG.md](./CHANGELOG.md) | 变更记录 |

## 🚀 快速开始

### 1. 安装 Ollama

```bash
# macOS
brew install ollama

# 启动 Ollama 服务
ollama serve
```

### 2. 下载模型

```bash
# 下载 Llama 3.2 (3B，约 2GB)
ollama pull llama3.2

# 下载 Qwen2.5 7B (约 4.7GB，中文优秀)
ollama pull qwen2.5:7b

# 验证模型已安装
ollama list
```

### 3. 安装项目依赖

```bash
pnpm install
```

### 4. 配置环境变量

复制 `.env.local.example` 为 `.env.local`，按需填写：

- **Ollama**：`OLLAMA_BASE_URL`、`DEFAULT_MODEL`
- **智谱**：`ZHIPU_API_KEY`（见 `GLM_INTEGRATION.md`）
- **联网搜索**：`TAVILY_API_KEY`
- **MCP**：见 `docs/MCP.md`（或根目录 `mcp.config.json`）

### 5. 运行开发服务器

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看应用。

## 📁 主要目录

```
app/api/chat/     # 单聊 + 工具 + MCP
app/api/team/     # Team 协作
app/api/mcp/status/  # MCP 连接自检（JSON）
lib/agents/       # Agent 配置与 Team 协调器
lib/tools/        # webSearch、weather 等
lib/mcp/          # MCP 客户端
mcp.config.example.json  # 复制为 mcp.config.json 使用 MCP
```

## 💡 使用说明

1. **选择模型**：在顶部导航栏选择 Llama 3.2（快速）或 Qwen2.5（中文优秀）
2. **输入问题**：在输入框中输入你的编程问题
3. **发送消息**：点击"发送"按钮或按 Enter 键
4. **实时响应**：AI 助手会实时流式输出回答
5. **自动滚动**：消息会自动滚动到底部

## 🎯 支持的模型

| 模型           | 大小 | 特点               | 推荐场景           |
| -------------- | ---- | ------------------ | ------------------ |
| **llama3.2**   | 3B   | Meta 出品，速度快  | 通用对话、代码生成 |
| **qwen2.5:7b** | 7B   | 阿里出品，中文优秀 | 中文任务、复杂推理 |

### 添加更多模型

```bash
# DeepSeek R1 (推理能力强)
ollama pull deepseek-r1:7b

# Mistral (平衡性好)
ollama pull mistral

# CodeLlama (专注代码)
ollama pull codellama:7b
```

然后在 `app/page.tsx` 的模型选择器中添加新选项。

## 💻 硬件要求

| 模型大小 | 最低内存 | 推荐内存 | GPU  |
| -------- | -------- | -------- | ---- |
| 3B       | 8GB      | 16GB     | 可选 |
| 7B       | 16GB     | 32GB     | 推荐 |

**Mac 用户**：M 系列芯片（M1/M2/M3）性能优秀，统一内存架构对 LLM 推理非常友好！

## 🔧 开发命令

- `pnpm dev` - 启动开发服务器
- `pnpm build` - 构建生产版本
- `pnpm start` - 启动生产服务器
- `pnpm lint` - 代码检查

## 🐛 常见问题

### 1. 无法连接到 Ollama 服务

**错误**：`ECONNREFUSED`

**解决方案**：

```bash
# 确保 Ollama 服务正在运行
ollama serve

# 或使用 Homebrew 服务
brew services start ollama
```

### 2. 模型未找到

**错误**：`model not found`

**解决方案**：

```bash
# 下载所需模型
ollama pull llama3.2
ollama pull qwen2.5:7b

# 查看已安装模型
ollama list
```

### 3. 响应速度慢

**优化建议**：

- 使用较小的模型（如 llama3.2 3B）
- 确保有足够的内存
- 关闭其他占用资源的应用

## 🌟 特性对比

| 特性     | Ollama 本地方案 | Gemini API        |
| -------- | --------------- | ----------------- |
| 成本     | ✅ 免费         | ❌ 按使用付费     |
| 数据隐私 | ✅ 完全本地     | ❌ 发送到云端     |
| 离线使用 | ✅ 支持         | ❌ 需要网络       |
| 响应速度 | ✅ 快（本地）   | ⚠️ 取决于网络     |
| 模型选择 | ✅ 多种开源模型 | ⚠️ 仅 Gemini 系列 |
| 硬件要求 | ⚠️ 需要本地资源 | ✅ 无要求         |

## 📚 相关资源

- 🔗 [Ollama 官方文档](https://ollama.ai/docs)
- 🔗 [Vercel AI SDK 文档](https://sdk.vercel.ai/docs)
- 🔗 [Llama 3.2 模型介绍](https://ollama.ai/library/llama3.2)
- 🔗 [Qwen2.5 模型介绍](https://ollama.ai/library/qwen2.5)

## 🎨 自定义

### 添加新模型到选择器

编辑 `app/page.tsx`：

```tsx
<select
  value={selectedModel}
  onChange={(e) => setSelectedModel(e.target.value)}
>
  <option value="llama3.2">🚀 Llama 3.2 (快速)</option>
  <option value="qwen2.5:7b">🇨🇳 Qwen2.5 7B (中文)</option>
  <option value="deepseek-r1:7b">🧠 DeepSeek R1 (推理)</option>
  <option value="codellama:7b">💻 CodeLlama (代码)</option>
</select>
```

### 修改系统提示词

编辑 `app/api/chat/route.ts`：

```typescript
system: "你是一个专业的编程助手。请直接、准确地回答问题，代码请放在 Markdown 代码块中。",
```

## 📄 许可证

MIT

---

**享受本地 AI 的强大与隐私！** 🚀🔒
