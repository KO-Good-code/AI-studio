import { weatherTool } from './weather';
import { webSearchTool } from './web-search';

/**
 * 所有可用的 Agent 工具
 * 在这里统一导出所有工具，方便管理和使用
 */
export const allTools = [
  webSearchTool,  // 🌐 联网搜索工具 - 获取实时信息
  weatherTool,    // ☁️ 天气工具 - 查询天气（示例）
  // 未来可以在这里添加更多工具
  // calendarTool,
  // calculatorTool,
];

// 单独导出各个工具，方便按需引用
export { weatherTool } from './weather';
export { webSearchTool } from './web-search';

/**
 * 根据场景获取特定工具
 */
export const getToolsForScenario = (scenario: 'search' | 'weather' | 'all') => {
  switch (scenario) {
    case 'search':
      return [webSearchTool];
    case 'weather':
      return [weatherTool];
    case 'all':
    default:
      return allTools;
  }
};
