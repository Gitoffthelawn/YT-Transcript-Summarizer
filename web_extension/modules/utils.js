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

// Depth-limited search for the first value stored under `targetKey`.
// `undefined` is the only "not found" marker: a legitimately stored `null`,
// `false` or `0` used to be discarded by the recursive caller because it
// compared the result against `null`.
export function findInObject(obj, targetKey, maxDepth = 12) {
  if (!obj || typeof obj !== 'object' || maxDepth === 0) return null;
  if (obj[targetKey] !== undefined) return obj[targetKey];
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      const result = findInObject(val, targetKey, maxDepth - 1);
      if (result !== undefined && result !== null) return result;
    }
  }
  return null;
}
