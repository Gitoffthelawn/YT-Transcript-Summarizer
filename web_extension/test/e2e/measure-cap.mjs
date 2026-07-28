// Same measurement as measure-cap.mjs, but the clipboard is filled from OUTSIDE
// the browser (PowerShell Set-Clipboard). navigator.clipboard.writeText refuses
// with NotAllowedError whenever the OS window is not focused, which it never is
// in an automated run — the OS clipboard has no such requirement.
import { connect, sleep } from './cdp.mjs';

const match = process.argv[2];
const LINE = 59;

const c = await connect(9333);
const t = (await c.targets()).find(x => x.type === 'page' && x.url.includes(match));
if (!t) { console.log('nessuna tab per', match); process.exit(1); }
const s = await c.attach(t.targetId);
await c.send('Runtime.enable', {}, s);
await c.send('Page.enable', {}, s);
await c.send('Page.bringToFront', {}, s);
await sleep(800);

const ev = async (fn) => {
  const r = await c.send('Runtime.evaluate', {
    expression: `(${fn.toString()})()`, returnByValue: true, awaitPromise: true
  }, s);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};

console.log('tab:', t.url.slice(0, 55));
console.log('composer:', await ev(function () {
  const el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
  if (!el) return 'ASSENTE';
  el.focus();
  return el.tagName + '.' + String(el.className).slice(0, 40);
}));

// Trusted paste: the OS clipboard was filled by the caller.
await c.send('Input.dispatchKeyEvent', {
  type: 'keyDown', modifiers: 2, key: 'v', code: 'KeyV',
  windowsVirtualKeyCode: 86, commands: ['paste']
}, s);
await c.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 }, s);

let prev = -1, stable = 0;
for (let i = 0; i < 70; i++) {
  await sleep(1000);
  const n = await ev(function () {
    const el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
    return el ? ((el.value ?? el.innerText) || '').length : 0;
  });
  if (n === prev) { if (++stable >= 4) break; } else { stable = 0; prev = n; }
}

console.log('RISULTATO:', JSON.stringify(await ev(function () {
  const el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
  const raw = (el.value ?? el.innerText) || '';
  const lines = raw.replace(/\s+$/, '').split('\n').filter(l => l.trim().length);
  const last = (lines[lines.length - 1] || '').replace(/\r$/, '');
  const m = /^L(\d{6})/.exec(last.trim());
  const body = document.body.innerText;
  return {
    righeSopravvissute: lines.length,
    ultimaRiga: last.slice(0, 55),
    ultimaRigaCompleta: /composer\.$/.test(last),
    offsetReale: m ? (parseInt(m[1], 10) - 1) * 59 + last.length : null,
    diventatoAllegato: /pasted[- ]?(content|text)|\.txt\b|Incollato/i.test(body.slice(0, 4000))
  };
}), null, 1));
c.close();
