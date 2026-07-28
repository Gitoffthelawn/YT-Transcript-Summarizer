// Waits for the merge sequence to finish: watches the Gemini conversation grow
// turn by turn, then the pasteWatch entry being consumed by handlePasteReport,
// and finally prints the real status string the extension produced.
import { connect, sleep } from './cdp.mjs';

const EXT = process.env.EXT_ID;
const deadline = Date.now() + (Number(process.argv[2] || 900)) * 1000;

const readTurns = function () {
  const parts = [...document.querySelectorAll('user-query')].map(q => {
    const m = /parte (\d+) di (\d+)/i.exec(q.innerText || '');
    if (m) return `${m[1]}/${m[2]}`;
    return /riassunto complessivo|UN UNICO|unendo i/i.test(q.innerText || '') ? 'MERGE' : '?';
  });
  const busy = !!document.querySelector('button[aria-label*="Stop" i], button[aria-label*="Interrompi" i]');
  return { turns: parts, models: document.querySelectorAll('model-response').length, busy };
};

let lastSig = '';
while (Date.now() < deadline) {
  const c = await connect(9333);
  try {
    const ts = await c.targets();
    // The merge run's tab is the one with a conversation in it.
    let best = null;
    for (const t of ts.filter(x => x.type === 'page' && x.url.includes('gemini.google.com'))) {
      const s = await c.attach(t.targetId);
      await c.send('Runtime.enable', {}, s);
      const r = await c.send('Runtime.evaluate', { expression: `(${readTurns.toString()})()`, returnByValue: true }, s);
      const v = r.result.value;
      if (v && v.turns.length && (!best || v.turns.length > best.turns.length)) best = v;
    }

    const pop = ts.find(x => x.type === 'page' && x.url.includes('popup.html'));
    let state = null;
    if (pop) {
      const s = await c.attach(pop.targetId);
      await c.send('Runtime.enable', {}, s);
      const r = await c.send('Runtime.evaluate', {
        returnByValue: true, awaitPromise: true,
        expression: `(async()=>{const g=await chrome.storage.local.get(['jobs','pasteWatch']);return JSON.stringify({rows:(g.jobs||[]).map(j=>j.status+' :: '+j.statusText),watch:Object.keys(g.pasteWatch||{})})})()`
      }, s);
      state = JSON.parse(r.result.value);
    }

    const sig = JSON.stringify({ best, state });
    if (sig !== lastSig) {
      lastSig = sig;
      console.log(new Date().toISOString().slice(11, 19),
        'turni:', best ? best.turns.join(',') : '-',
        '| busy:', best ? best.busy : '-',
        '| watch:', state ? state.watch.join(',') || 'VUOTA' : '?');
      if (state) for (const r of state.rows) console.log('    ', r);
    }
    if (state && state.watch.length === 0 && state.rows.length) {
      console.log('\n=== REPORT ARRIVATO ===');
      for (const r of state.rows) console.log(r);
      c.close();
      process.exit(0);
    }
  } catch (e) {
    console.log('(retry:', e.message.slice(0, 80) + ')');
  }
  c.close();
  await sleep(15000);
}
console.log('TIMEOUT: la sequenza non si e conclusa entro il limite');
