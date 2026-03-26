import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { tavily } from '@tavily/core';

export const webSearchTool = new DynamicStructuredTool({
  name: 'webSearch',
  description: `搜索互联网获取最新的实时信息。
  
适用场景：
- 需要获取最新新闻、政策与媒体报道
- 天气、体育等非结构化实时信息
- 查找最新的技术文档、产品信息
- 泛财经舆情摘要（非交易所官方全量结构化榜单）

不适用场景：
- A 股「全市场涨停/跌停/炸板名单」：应使用 aShareLimitList（Tushare），勿用本搜索代替
- 单只 A 股 OHLC/K 线：应使用 aShareQuote
- 编程问题、算法实现（基于知识库即可）
- 理论概念解释
- 代码调试和错误修复`,

  schema: z.object({
    query: z.string().describe('搜索关键词，应该简洁明确'),
    count: z.number().optional().describe('返回结果数量，默认5条，范围1-20'),
  }),

  func: async ({ query, count = 5 }) => {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      throw new Error('Tavily API Key 未配置，请在 .env.local 中设置 TAVILY_API_KEY');
    }

    console.log(`🔍 Tavily 搜索: "${query}"`);

    try {
      const tvly = tavily({ apiKey });

      const response = await tvly.search(query, {
        maxResults: Math.min(count, 20),
        searchDepth: 'basic',
      });

      const results = response.results || [];

      if (results.length === 0) {
        return `未找到关于 "${query}" 的相关信息。请尝试使用不同的关键词。`;
      }

      console.log(`✅ 找到 ${results.length} 条搜索结果`);

      const formattedResults = results.map((item: any, index: number) => {
        const title = item.title || '无标题';
        const content = item.content || '无摘要';
        const url = item.url || '';

        return `【结果 ${index + 1}】
标题: ${title}
摘要: ${content}
链接: ${url}`;
      }).join('\n\n' + '─'.repeat(50) + '\n\n');

      return `🌐 搜索关键词: "${query}"\n📊 找到 ${results.length} 条相关结果\n\n${formattedResults}`;

    } catch (error: any) {
      console.error('❌ Tavily 搜索出错:', error);

      if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        return '❌ 搜索失败：Tavily API Key 无效，请检查 .env.local 配置。';
      }

      if (error.message?.includes('429')) {
        return '❌ 搜索失败：Tavily API 请求次数超限，请稍后再试。';
      }

      return `❌ 搜索失败: ${error.message}`;
    }
  },
});
