import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 天气查询工具
 * 获取指定城市的天气信息
 */
export const weatherTool = new DynamicStructuredTool({
  name: 'getWeather',
  description: '获取指定城市的天气信息。当用户询问某个城市的天气时使用此工具。',
  schema: z.object({
    city: z.string().describe('城市名称，例如：Shanghai, Beijing, Guangzhou'),
  }),
  func: async ({ city }) => {
    console.log(`🌤️  调用 getWeather 工具，查询城市: ${city}`);
    
    // 模拟天气数据（实际应用中可以接入真实的天气 API）
    const weatherDatabase: Record<string, any> = {
      'Shanghai': { temp: 15, condition: '多云', humidity: 65, wind: '东北风 3-4级' },
      '上海': { temp: 15, condition: '多云', humidity: 65, wind: '东北风 3-4级' },
      'Beijing': { temp: 8, condition: '晴朗', humidity: 45, wind: '北风 2-3级' },
      '北京': { temp: 8, condition: '晴朗', humidity: 45, wind: '北风 2-3级' },
      'Guangzhou': { temp: 22, condition: '小雨', humidity: 80, wind: '南风 1-2级' },
      '广州': { temp: 22, condition: '小雨', humidity: 80, wind: '南风 1-2级' },
      'Shenzhen': { temp: 23, condition: '阴天', humidity: 75, wind: '东南风 2-3级' },
      '深圳': { temp: 23, condition: '阴天', humidity: 75, wind: '东南风 2-3级' },
      'Hangzhou': { temp: 14, condition: '多云转晴', humidity: 60, wind: '西北风 2级' },
      '杭州': { temp: 14, condition: '多云转晴', humidity: 60, wind: '西北风 2级' },
    };
    
    // 查找天气数据（不区分大小写）
    const cityKey = Object.keys(weatherDatabase).find(
      key => key.toLowerCase() === city.toLowerCase()
    );
    
    const weather = cityKey 
      ? weatherDatabase[cityKey]
      : { temp: 20, condition: '数据暂无', humidity: 50, wind: '微风' };
    
    const result = {
      city: city,
      temperature: `${weather.temp}°C`,
      condition: weather.condition,
      humidity: `${weather.humidity}%`,
      wind: weather.wind,
      timestamp: new Date().toLocaleString('zh-CN'),
    };
    
    console.log(`✅ 天气查询结果:`, result);
    return JSON.stringify(result, null, 2);
  },
});
