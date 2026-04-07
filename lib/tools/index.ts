import { weatherTool } from './weather';
import { webSearchTool } from './web-search';
import { aShareTool } from './a-share';
import { aShareLimitListTool } from './a-share-limit-list';
import { aShareStockInfoTool } from './a-share-stock-info';
import { backtestTool } from './backtest';

/**
 * 所有可用的 Agent 工具
 * 在这里统一导出所有工具，方便管理和使用
 */
export const allTools = [
  webSearchTool,
  aShareLimitListTool,
  aShareTool,
  aShareStockInfoTool,
  backtestTool,
  weatherTool,
];

// 单独导出各个工具，方便按需引用
export { weatherTool } from './weather';
export { webSearchTool } from './web-search';
export { aShareTool } from './a-share';
export { aShareLimitListTool } from './a-share-limit-list';
export { aShareStockInfoTool } from './a-share-stock-info';
export { backtestTool } from './backtest';

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
