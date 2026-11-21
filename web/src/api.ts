export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly hint: string;

  constructor(status: number, code: string, message: string, detail = '', hint = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.hint = hint;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, raw, signal, timeoutMs = 90000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const payload = text ? safeParse(text) : null;
    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string; detail?: string; hint?: string } } | null)
        ?.error;
      throw new ApiError(
        response.status,
        error?.code ?? 'HTTP_ERROR',
        error?.message ?? `请求失败（${response.status}）`,
        error?.detail ?? '',
        error?.hint ?? '',
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', '请求超时，请检查 AI 配置或网络');
    }
    throw new ApiError(0, 'NETWORK', error instanceof Error ? error.message : '网络错误');
  } finally {
    clearTimeout(timer);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: 'BAD_RESPONSE', message: text.slice(0, 200) } };
  }
}
