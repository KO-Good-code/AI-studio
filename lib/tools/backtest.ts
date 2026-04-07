import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { runCustomBacktest } from '@/lib/backtest/custom-engine';
import { isDbReady } from '@/lib/backtest/db';
import type { CustomBacktestConfig } from '@/lib/backtest/custom-engine';
import type { ConditionRule } from '@/lib/backtest/condition';

const conditionSchema = z.object({
  field: z.string().describe(
    '左侧字段。支持: ' +
    '基础字段(open,high,low,close,prev_close,quote_rate,volume,turnover,' +
    'high_limit,low_limit,turnover_rate,turnover_rate_f,volume_ratio,' +
    'pe,pe_ttm,pb,ps,ps_ttm,total_mv,circ_mv) | ' +
    '均线(ma5,ma10,ma20,ma60) | ' +
    '前日均线(prev_ma5,prev_ma20) | ' +
    '偏离均线百分比(pct_above_ma20,pct_above_ma60等，值=(close-maX)/maX*100) | ' +
    '计算指标(consecutive_limit_up,is_limit_up,is_limit_down,is_st,amplitude,open_pct,' +
    'prev_quote_rate,prev_turnover_rate,prev_volume_ratio)'
  ),
  op: z.enum(['>', '<', '>=', '<=', '==', '=', '!=']).describe('比较运算符，= 等同于 =='),
  value: z.union([z.number(), z.string()]).describe(
    '右侧值：数字字面量(如 10) 或另一个字段名(如 "high_limit")'
  ),
});

export const backtestTool = new DynamicStructuredTool({
  name: 'backtest',
  description:
    'A股策略回测工具。你需要根据用户需求自行设计买入和卖出条件，然后调用此工具执行回测。' +
    '数据范围: 2025-04-01 ~ 2026-03-03。' +
    '支持全市场扫描(scanMode=market)或单股分析(scanMode=single,需指定code)。' +
    '买入条件(buyRules)全部满足时触发买入，卖出条件(sellRules)任一满足时触发卖出。' +
    '另外可设置最大持仓天数(sellAfterDays)、止盈%(takeProfitPct)、止损%(stopLossPct)。' +
    '示例策略: 涨停打板={buyRules:[{field:"is_limit_up",op:"==",value:1},{field:"turnover_rate",op:">",value:5}], sellAfterDays:1}; ' +
    '均线金叉={buyRules:[{field:"ma5",op:">",value:"ma20"}], sellRules:[{field:"ma5",op:"<",value:"ma20"}]}',
  schema: z.object({
    strategyName: z.string().describe('给这个策略起个名字'),
    startDate: z.string().describe('回测开始日期 YYYY-MM-DD'),
    endDate: z.string().describe('回测结束日期 YYYY-MM-DD'),
    scanMode: z.enum(['market', 'single']).describe('market=全市场扫描 single=单只股票'),
    code: z.string().optional().describe('股票代码(single模式必填)，如 "000001.SZ"'),
    buyRules: z.array(conditionSchema).describe('买入条件(全部满足触发)'),
    sellRules: z.array(conditionSchema).optional().describe('卖出条件(任一满足触发)'),
    sellAfterDays: z.number().optional().describe('最大持仓天数，到期自动卖出'),
    takeProfitPct: z.number().optional().describe('止盈百分比，如 10 表示盈利10%时卖出'),
    stopLossPct: z.number().optional().describe('止损百分比，如 5 表示亏损5%时卖出'),
    industry: z.string().optional().describe('按行业过滤(market模式)，如 "半导体"'),
    market: z.string().optional().describe('按市场过滤，如 "主板"、"创业板"'),
    marketBreadthMinPct: z.number().optional().describe(
      '大盘宽度过滤：5日滚动上涨股票占比须 >= 该值才允许新开仓，范围0~1（如0.5表示50%）。' +
      '建议值0.5；震荡市可调高到0.55；趋势市不填。'
    ),
    initialCapital: z.number().optional().describe(
      '初始资金（元），默认100000（10万）。用于模拟实际资金曲线和每笔盈亏金额。'
    ),
    maxPositions: z.number().optional().describe(
      '最大同时持仓数，默认10。资金将平均分配到每个仓位。'
    ),
    maxConsecutiveLosses: z.number().optional().describe(
      '连续亏损熔断笔数：连续亏损达到此值后暂停开新仓 lossCooldownDays 天。建议值2~3，不填则不启用。'
    ),
    lossCooldownDays: z.number().optional().describe(
      '熔断冷静期天数，默认3天。与 maxConsecutiveLosses 配合使用。'
    ),
    topSectorN: z.number().optional().describe(
      '板块动量过滤：按近期平均涨幅排名，只允许买入前 N 名板块的个股。' +
      '建议值5~15。不填则不启用板块过滤，所有板块均可入场。'
    ),
    sectorMomentumDays: z.number().optional().describe(
      '计算板块相对强度(RS)的回看天数，默认20天。与 topSectorN 配合使用。'
    ),
  }),
  func: async (input) => {
    try {
      if (!isDbReady()) {
        return '回测数据库未就绪，请先运行: npx tsx scripts/import-prices.ts';
      }

      const config: CustomBacktestConfig = {
        strategyName: input.strategyName,
        startDate: input.startDate,
        endDate: input.endDate,
        scanMode: input.scanMode,
        code: input.code,
        buyRules: input.buyRules as ConditionRule[],
        sellRules: (input.sellRules ?? []) as ConditionRule[],
        sellAfterDays: input.sellAfterDays,
        takeProfitPct: input.takeProfitPct,
        stopLossPct: input.stopLossPct,
        marketBreadthMinPct: input.marketBreadthMinPct,
        initialCapital: input.initialCapital,
        maxPositions: input.maxPositions,
        maxConsecutiveLosses: input.maxConsecutiveLosses,
        lossCooldownDays: input.lossCooldownDays,
        topSectorN: input.topSectorN,
        sectorMomentumDays: input.sectorMomentumDays,
        filters: {
          industry: input.industry,
          market: input.market,
        },
      };

      const result = runCustomBacktest(config);
      return result.summary;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `回测失败: ${msg}`;
    }
  },
});
