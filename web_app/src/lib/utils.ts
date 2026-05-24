export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs: number = 12000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findInObject(obj: any, targetKey: string, maxDepth: number = 12): any {
  if (!obj || typeof obj !== "object" || maxDepth === 0) return null;
  if (obj[targetKey] !== undefined) return obj[targetKey];
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      const result = findInObject(val, targetKey, maxDepth - 1);
      if (result !== null) return result;
    }
  }
  return null;
}
