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

const _NOT_FOUND = Symbol('not_found');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _findInObject(obj: any, targetKey: string, maxDepth: number): typeof _NOT_FOUND | any {
  if (!obj || typeof obj !== "object" || maxDepth === 0) return _NOT_FOUND;
  if (targetKey in obj) return obj[targetKey];
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      const result = _findInObject(val, targetKey, maxDepth - 1);
      if (result !== _NOT_FOUND) return result;
    }
  }
  return _NOT_FOUND;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findInObject(obj: any, targetKey: string, maxDepth: number = 12): any {
  const result = _findInObject(obj, targetKey, maxDepth);
  return result === _NOT_FOUND ? null : result;
}
