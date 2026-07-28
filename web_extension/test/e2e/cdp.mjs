// Minimal CDP client over the browser-level WebSocket (Node 24 has global WebSocket).
export async function connect(port = 9333) {
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(`${m.error.message} (${m.error.code})`)) : res(m.result);
    } else if (m.method) {
      for (const fn of listeners) fn(m);
    }
  };

  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, { res, rej });
    ws.send(JSON.stringify(msg));
    setTimeout(() => { if (pending.has(msg.id)) { pending.delete(msg.id); rej(new Error(`timeout: ${method}`)); } }, 60000);
  });

  return {
    send,
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
    async attach(targetId) {
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      return sessionId;
    },
    async targets() {
      const { targetInfos } = await send('Target.getTargets');
      return targetInfos;
    },
  };
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
