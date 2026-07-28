// Minimal WebDriver BiDi client for Firefox — the Gecko counterpart of cdp.mjs.
//
// Chrome's CDP recipe (§7) does not carry over: Firefox has no Extensions.loadUnpacked
// and no browser-level CDP socket. BiDi is the supported protocol, and Node 24's global
// WebSocket is enough for it, so this stays dependency-free like the rest of the rig.
export async function connect(port = 9222) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`no BiDi on :${port} — is Firefox running with --remote-debugging-port?`));
  });

  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id != null && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.type === 'error' ? rej(new Error(`${m.error}: ${m.message}`)) : res(m.result);
    } else if (m.method) {
      for (const fn of listeners) fn(m);
    }
  };

  const send = (method, params = {}) => new Promise((res, rej) => {
    const msg = { id: ++id, method, params };
    pending.set(msg.id, { res, rej });
    ws.send(JSON.stringify(msg));
    setTimeout(() => {
      if (pending.has(msg.id)) { pending.delete(msg.id); rej(new Error(`timeout: ${method}`)); }
    }, 60000);
  });

  await send('session.new', { capabilities: { alwaysMatch: {} } });

  const api = {
    send,
    on: (fn) => listeners.push(fn),
    // BiDi allows one session per browser: leaving it open makes the *next* run fail with
    // "Maximum number of active sessions". Always end it, even if the run threw.
    close: async () => {
      try { await send('session.end', {}); } catch (_) {}
      ws.close();
    },

    async context() {
      const { contexts } = await send('browsingContext.getTree', {});
      return contexts[0].context;
    },
    async open(url) {
      const { context } = await send('browsingContext.create', { type: 'tab' });
      await send('browsingContext.navigate', { context, url, wait: 'complete' });
      return context;
    },
    async navigate(context, url) {
      return send('browsingContext.navigate', { context, url, wait: 'complete' });
    },
    async close_(context) {
      return send('browsingContext.close', { context }).catch(() => {});
    },
    /** Evaluate and return a plain JS value (BiDi hands back a typed tree). */
    async eval(context, expression) {
      const r = await send('script.evaluate', {
        expression,
        target: { context },
        awaitPromise: true,
        resultOwnership: 'none',
      });
      if (r.type === 'exception') throw new Error(r.exceptionDetails?.text || 'exception');
      return deserialize(r.result);
    },
    async screenshot(context) {
      const r = await send('browsingContext.captureScreenshot', { context });
      return Buffer.from(r.data, 'base64');
    },
  };
  return api;
}

/** BiDi returns {type:'number',value:3} / {type:'object',value:[[k,v],…]} — flatten it. */
function deserialize(v) {
  if (v == null) return v;
  switch (v.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': case 'number': case 'boolean': case 'bigint': return v.value;
    case 'array': case 'set': return (v.value || []).map(deserialize);
    case 'object': case 'map':
      return Object.fromEntries((v.value || []).map(([k, val]) =>
        [typeof k === 'object' ? deserialize(k) : k, deserialize(val)]));
    default: return v.value !== undefined ? v.value : null;
  }
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Static file server rooted at the repo, so ../../paste_common.js resolves.
 *  file:// would not: Gecko blocks a file:// page from reaching a parent directory. */
export async function serve(root, port = 8931) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { join, extname, normalize } = await import('node:path');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    try {
      const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, '');
      const body = await readFile(join(root, rel));
      res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { port, close: () => new Promise(r => server.close(r)) };
}
