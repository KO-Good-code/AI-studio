import { weatherTool } from './weather';
import { webSearchTool } from './web-search';
import { aShareTool } from './a-share';
import { aShareLimitListTool } from './a-share-limit-list';
import { aShareStockInfoTool } from './a-share-stock-info';

/**
 * 所有可用的 Agent 工具
 * 在这里统一导出所有工具，方便管理和使用
 */
export const allTools = [
  webSearchTool,  // 🌐 联网搜索工具 - 获取实时信息
  aShareLimitListTool, // 📋 A 股涨跌停/炸板全市场列表（Tushare + 东财兜底）
  aShareTool,     // 📈 A 股实时/历史行情（Tushare + 东财兜底）
  aShareStockInfoTool, // 📊 A 股个股详情（公司简况/财报/股东/分红）
  weatherTool,    // ☁️ 天气工具 - 查询天气（示例）
  // 未来可以在这里添加更多工具
  // calendarTool,
  // calculatorTool,
];

// 单独导出各个工具，方便按需引用
export { weatherTool } from './weather';
export { webSearchTool } from './web-search';
export { aShareTool } from './a-share';
export { aShareLimitListTool } from './a-share-limit-list';
export { aShareStockInfoTool } from './a-share-stock-info';

/**
 * 根据场景获取特定工具
 */
export const getToolsForScenario = (
  scenario: 'search' | 'weather' | 'stocks' | 'all'
) => {
  switch (scenario) {
    case 'search':
      return [webSearchTool];
    case 'stocks':
      return [aShareLimitListTool, aShareTool, aShareStockInfoTool];
    case 'weather':
      return [weatherTool];
    case 'all':
    default:
      return allTools;
  }
};
