import { AVAILABLE_MODELS, isOllamaModel } from '@/lib/models/types';
import { validateModel } from '@/lib/models/factory';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    
    // 获取 Ollama 本地模型列表
    let ollamaModels: any[] = [];
    try {
      const response = await fetch(`${ollamaBaseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        ollamaModels = data.models || [];
      }
    } catch (error) {
      console.warn('无法连接到 Ollama 服务');
    }

    // 1. 处理预定义的模型（包括 Ollama 和云端模型）
    const predefinedModelsWithStatus = await Promise.all(
      AVAILABLE_MODELS.map(async (model) => {
        let available = false;
        let reason = '';

        if (isOllamaModel(model.id)) {
          // Ollama 模型：检查是否已安装
          available = ollamaModels.some((m) => m.name === model.name);
          if (!available) {
            reason = `未安装，运行: ollama pull ${model.name}`;
          }
        } else {
          // API 模型：检查 API Key
          const validation = await validateModel(model.id);
          available = validation.success;
          reason = validation.error || '';
        }

        return {
          ...model,
          available,
          reason,
          size: isOllamaModel(model.id)
            ? ollamaModels.find((m) => m.name === model.name)?.size
            : undefined,
        };
      })
    );

    // 2. 添加本地安装的其他 Ollama 模型（不在预定义列表中的）
    const predefinedOllamaNames = AVAILABLE_MODELS
      .filter(m => isOllamaModel(m.id))
      .map(m => m.name);

    const additionalOllamaModels = ollamaModels
      .filter(m => !predefinedOllamaNames.includes(m.name))
      .map(m => ({
        id: m.name,
        name: m.name,
        provider: 'ollama' as const,
        displayName: `🦙 ${m.name} (本地)`,
        description: `本地 Ollama 模型 - ${(m.size / 1024 / 1024 / 1024).toFixed(1)} GB`,
        available: true,
        reason: '',
        size: m.size,
      }));

    // 3. 合并所有模型：预定义 + 动态发现的
    const allModels = [...predefinedModelsWithStatus, ...additionalOllamaModels];

    // 返回模型列表
    return Response.json({
      success: true,
      models: allModels,
      ollama: {
        connected: ollamaModels.length > 0,
        models: ollamaModels,
        total: ollamaModels.length,
        additional: additionalOllamaModels.length,
      },
    });
  } catch (error: any) {
    console.error('Error fetching models:', error);
    
    return Response.json({
      error: '无法获取模型列表',
      details: error.message,
      success: false,
    }, { status: 500 });
  }
}
