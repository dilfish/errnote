/** 本地持久化：记住上次的筛选条件等 */

export function loadStored<T extends Record<string, unknown>>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const result: Record<string, unknown> = { ...fallback };
    for (const name of Object.keys(fallback)) {
      const value = parsed[name];
      // 只接受类型一致的值，避免脏数据把界面搞坏
      if (typeof value === typeof fallback[name]) result[name] = value;
    }
    return result as T;
  } catch {
    return fallback;
  }
}

export function saveStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略即可
  }
}
