# 🤝 Multi-Agent Team 系统

这是一个基于 LangChain 的多 Agent 协作系统，能够让多个专业 Agent 共同解决复杂问题。

## 🎯 系统架构

```
用户问题
    ↓
智能路由器（分析问题类型）
    ↓
选择合适的 Agent 组合
    ↓
Agent 1 → Agent 2 → Agent 3 → ... → 最终答案
    ↓
流式返回给用户
```

## 👥 可用的 Agent

### 🧑‍💻 CodeMaster - 代码实现专家
- **职责**: 编写高质量、可维护的代码
- **擅长**: 算法设计、性能优化、TypeScript/JavaScript/Python
- **温度**: 0.3 (较低，保证代码准确性)

### 📚 DocExpert - 技术文档专家
- **职责**: 编写清晰、全面的技术文档
- **擅长**: API 文档、用户指南、README 编写
- **温度**: 0.5 (中等，平衡准确性和创造性)

### 🐛 BugHunter - 调试专家
- **职责**: 问题诊断、错误排查
- **擅长**: 错误诊断、性能分析、日志分析
- **温度**: 0.4 (较低，保证分析准确性)

### 🏗️ SysArchitect - 系统架构师
- **职责**: 系统设计、技术选型
- **擅长**: 架构设计、可扩展性、安全性设计
- **温度**: 0.6 (较高，需要创造性思维)

### 🔍 CodeReviewer - 代码审查专家
- **职责**: 代码质量审查、安全审计
- **擅长**: 代码审查、最佳实践、重构建议
- **温度**: 0.3 (较低，保证审查严谨性)

## 🔍 智能路由机制

系统会根据用户问题的关键词自动选择最合适的 Agent 组合：

| 关键词 | 选择的 Agent |
|--------|--------------|
| 实现、写代码、开发 | CodeMaster |
| 文档、说明、README | DocExpert |
| 错误、bug、调试 | BugHunter |
| 架构、设计、方案 | SysArchitect |
| 审查、优化、改进 | CodeReviewer |

## 📝 使用示例

### 示例 1: 代码实现问题
**问题**: "用 TypeScript 实现一个 LRU 缓存"

**系统行为**:
1. 选择 `CodeMaster` (代码实现)
2. 可能附加 `CodeReviewer` (确保代码质量)

### 示例 2: 架构设计问题
**问题**: "设计一个高并发的电商系统架构"

**系统行为**:
1. 选择 `SysArchitect` (架构设计)
2. 可能附加 `CodeMaster` (示例代码)
3. 可能附加 `DocExpert` (设计文档)

### 示例 3: Bug 排查问题
**问题**: "为什么我的 Next.js 应用内存泄漏？"

**系统行为**:
1. 选择 `BugHunter` (问题诊断)
2. 可能附加 `CodeReviewer` (代码审查)

## 🔧 自定义 Agent

要添加新的 Agent，只需在 `lib/agents/configs.ts` 中添加配置：

```typescript
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  // ... 现有 Agent
  
  // 新增的 Agent
  security: {
    name: 'SecurityGuard',
    role: '安全专家',
    emoji: '🔐',
    description: '专注于安全审计和漏洞检测',
    specialties: ['安全审计', 'XSS/CSRF 防护', '认证授权'],
    temperature: 0.3,
    systemPrompt: `你是 SecurityGuard，一位安全专家...`,
  },
};
```

## 🌟 特性

- ✅ **智能路由**: 自动选择最合适的 Agent 组合
- ✅ **上下文共享**: 后续 Agent 可以看到前面 Agent 的工作成果
- ✅ **流式输出**: 实时显示每个 Agent 的工作进展
- ✅ **可扩展**: 轻松添加新的 Agent
- ✅ **类型安全**: 完整的 TypeScript 支持

## 🚀 API 使用

### 发送请求

```typescript
const response = await fetch('/api/team', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: '你的问题',
    model: 'llama3.2', // 可选
  }),
});

// 流式读取响应
const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  console.log(chunk); // 实时输出 Agent 的工作进展
}
```

## 🎨 响应格式示例

```
🎯 **开始任务分析...**

📝 **问题**: 实现一个 React 组件

✅ **已选择 2 个专业 Agent 参与协作**:

🧑‍💻 **CodeMaster** (代码实现专家)
🔍 **CodeReviewer** (代码审查专家)

---

🧑‍💻 **CodeMaster 开始工作...**

[CodeMaster 的代码实现...]

---

🔍 **CodeReviewer 开始工作...**

[CodeReviewer 的审查意见...]

---

✅ **团队协作完成！所有 Agent 已完成任务。**
```

## 💡 最佳实践

1. **问题描述要清晰**: 越详细的问题描述，Agent 的回答越准确
2. **善用 Team 模式**: 对于复杂问题，Team 模式能提供更全面的解决方案
3. **单一职责**: 每个问题最好聚焦在一个主题上
4. **迭代优化**: 根据 Agent 的回答继续提问，深入探讨

## 🔮 未来计划

- [ ] 添加更多专业 Agent（测试专家、DevOps 专家等）
- [ ] 支持 Agent 之间的对话和辩论
- [ ] 实现 Agent 记忆和学习能力
- [ ] 支持自定义 Agent 配置（UI 界面）
- [ ] 添加工具调用能力（搜索、计算等）
