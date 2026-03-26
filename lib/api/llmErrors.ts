/**
 * 从 LangChain / OpenAI SDK 抛出的异常中拼出可读说明
 */
export function extractLlmErrorDetails(error: unknown): string {
  if (error == null) return '';
  if (typeof error !== 'object') return String(error);
  const e = error as Error & {
    error?: { message?: string; code?: string };
    code?: string;
    status?: number;
  };
  const parts: string[] = [];
  if (typeof e.message === 'string' && e.message) parts.push(e.message);
  if (e.error && typeof e.error.message === 'string') parts.push(e.error.message);
  if (e.error && e.error.code != null) parts.push(`code=${e.error.code}`);
  if (
    e.code != null &&
    String(e.code) !== String((e.error as { code?: string } | undefined)?.code)
  ) {
    parts.push(`code=${e.code}`);
  }
  if (typeof e.status === 'number') parts.push(`HTTP ${e.status}`);
  return parts.filter(Boolean).join(' | ') || String(error);
}

/** 智谱等：余额不足时常返回 HTTP 429，SDK 标成 RateLimitError */
function isZhipuBalanceError(details: string): boolean {
  return (
    /Insufficient balance|no resource package|Please recharge/i.test(details) ||
    /\b1113\b/.test(details)
  );
}

/**
 * 流式响应内写入纯文本错误（避免 controller.error 导致 Next failed to pipe response）
 */
export function formatChatStreamError(error: unknown): string {
  const details = extractLlmErrorDetails(error);
  if (isZhipuBalanceError(details)) {
    return (
      `【错误】智谱账号余额不足或未购买资源包，请到控制台充值或开通套餐后再试。\n` +
      `（接口提示：${details.slice(0, 400)}）`
    );
  }
  if (/429|rate limit|RateLimit/i.test(details) && !isZhipuBalanceError(details)) {
    return `【错误】请求过于频繁或触发限流，请稍后再试。\n${details.slice(0, 400)}`;
  }
  return `【错误】模型服务异常，请稍后重试。\n${details.slice(0, 400)}`;
}

/**
 * 将底层 Error 映射为对用户友好的文案（API JSON 响应）
 */
export function mapLlmErrorToResponse(error: unknown): {
  error: string;
  suggestion: string;
  details: string;
} {
  const details = extractLlmErrorDetails(error);
  let errorMessage = details;
  let suggestion = '请检查服务配置';

  if (details.includes('ECONNREFUSED')) {
    errorMessage = '无法连接到 Ollama 服务';
    suggestion = '请运行: ollama serve';
  } else if (details.includes('model') || details.includes('not found')) {
    errorMessage = '模型未找到';
    suggestion = '请运行: ollama pull llama3.2 或 ollama pull qwen2.5:7b';
  } else if (isZhipuBalanceError(details)) {
    errorMessage = '智谱账号余额不足或未开通资源包';
    suggestion = '请登录智谱开放平台充值或购买资源包后再试';
  } else if (/429|rate limit|RateLimit/i.test(details)) {
    errorMessage = '请求过于频繁或触发限流（含部分服务商以 429 表示欠费）';
    suggestion = '稍后再试；若为智谱，请检查账户余额与资源包';
  }

  return { error: errorMessage, suggestion, details };
}
