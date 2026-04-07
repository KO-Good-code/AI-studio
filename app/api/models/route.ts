import { AVAILABLE_MODELS, isOllamaModel, setCustomModelConfigs } from '@/lib/models/types';
import { validateModel } from '@/lib/models/factory';
import { listCustomModels } from '@/lib/storage/custom-models';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    
    let ollamaModels: Array<{ name: string; size: number; [k: string]: unknown }> = [];
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const response = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: ac.signal });
      clearTimeout(timer);
      if (response.ok) {
        const data = await response.json();
        ollamaModels = data.models || [];
      }
    } catch {
      console.warn('无法连接到 Ollama 服务（超时或不可达）');
    }

    // 1. 预定义模型
    const predefinedModelsWithStatus = await Promise.all(
      AVAILABLE_MODELS.map(async (model) => {
        let available = false;
        let reason = '';

        if (isOllamaModel(model.id)) {
          available = ollamaModels.some((m) => m.name === model.name);
          if (!available) {
            reason = `未安装，运行: ollama pull ${model.name}`;
          }
        } else {
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

    // 2. 动态发现的 Ollama 模型
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

    // 3. 自定义模型
    const customModels = await listCustomModels();
    const customModelItems = customModels.map((cm) => ({
      id: cm.id,
      name: cm.name,
      provider: 'custom' as const,
      displayName: cm.displayName,
      description: cm.description || `${cm.providerLabel} · ${cm.baseUrl}`,
      available: true,
      reason: '',
      isCustom: true,
      providerLabel: cm.providerLabel,
    }));

    setCustomModelConfigs(customModels.map((cm) => ({
      id: cm.id,
      name: cm.name,
      provider: 'custom' as const,
      displayName: cm.displayName,
      description: cm.description,
      maxTokens: cm.maxTokens,
    })));

    // 4. 合并
    const allModels = [
      ...predefinedModelsWithStatus,
      ...additionalOllamaModels,
      ...customModelItems,
    ];

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
