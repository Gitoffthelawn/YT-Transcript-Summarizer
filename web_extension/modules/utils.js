export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function findInObject(obj, targetKey, maxDepth = 12) {
  if (!obj || typeof obj !== 'object' || maxDepth === 0) return null;
  if (obj[targetKey] !== undefined) return obj[targetKey];
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      const result = findInObject(val, targetKey, maxDepth - 1);
      if (result !== null) return result;
    }
  }
  return null;
}
