// 4-bis option B, on Gemini: build the File in the page and simulate a drop.
// This is exactly the mechanism the extension would use, so a failure here is a
// finding about the proposal itself, not just about my automation.
import { connect, sleep } from './cdp.mjs';

const QUESTION = 'Nel file allegato rispondi secco a due domande, senza riassumere: 1) qual e il testo ESATTO dell ULTIMA riga? 2) quante righe ci sono in totale?';

const c = await connect(9333);
const { targetId } = await c.send('Target.createTarget', { url: 'https://gemini.google.com/app' });
const s = await c.attach(targetId);
await c.send('Page.enable', {}, s);
await c.send('Runtime.enable', {}, s);
await c.send('Page.bringToFront', {}, s);
await sleep(8000);

const ev = async (fn, arg) => {
  const r = await c.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`,
    returnByValue: true, awaitPromise: true
  }, s);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 250));
  return r.result.value;
};

console.log('drop:', await ev(async function () {
  let str = '';
  for (let i = 1; str.length < 300000; i++)
    str += `L${String(i).padStart(6, '0')} riga di prova per misurare il limite del composer.\n`;

  const file = new File([str], 'probe-lines.txt', { type: 'text/plain' });
  const dt = new DataTransfer();
  dt.items.add(file);

  const target = document.querySelector('div.ql-editor[contenteditable="true"]')
    || document.querySelector('div[contenteditable="true"]');
  const zone = target.closest('div[class*="input" i], form') || target;

  for (const type of ['dragenter', 'dragover', 'drop']) {
    zone.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }
  return { chars: str.length, righe: str.length / 59, zona: zone.tagName + '.' + String(zone.className).slice(0, 30) };
}));

let seen = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  if (await ev(function () { return /probe-lines/i.test(document.body.innerText); })) {
    console.log('chip allegato comparsa dopo', i, 's'); seen = true; break;
  }
}
if (!seen) {
  console.log('NESSUNA chip: il drop simulato non e stato accettato');
  console.log('composer:', await ev(function () {
    const el = document.querySelector('div.ql-editor[contenteditable="true"]');
    return el ? (el.innerText || '').length : -1;
  }));
  c.close(); process.exit(1);
}

await sleep(5000);
await ev(function (q) {
  const el = document.querySelector('div.ql-editor[contenteditable="true"]') || document.querySelector('div[contenteditable="true"]');
  el.focus(); document.execCommand('insertText', false, q); return el.innerText.length;
}, QUESTION);
await sleep(1500);
console.log('invio:', await ev(function () {
  const b = [...document.querySelectorAll('button')].find(x => /send|invia/i.test(x.getAttribute('aria-label') || '') && !x.disabled && x.getAttribute('aria-disabled') !== 'true');
  if (b) { b.click(); return 'ok'; } return 'invio non disponibile';
}));

let prev = '', stable = 0;
for (let i = 0; i < 70; i++) {
  await sleep(2500);
  const txt = await ev(function () {
    const r = document.querySelectorAll('model-response');
    return r.length ? (r[r.length - 1].innerText || '').slice(0, 1000) : '';
  });
  if (txt && txt === prev) { if (++stable >= 3) break; } else { stable = 0; prev = txt; }
}
console.log('\n===== RISPOSTA GEMINI =====\n' + (prev || '(vuota)'));
console.log('\nAtteso: "L005085 riga di prova per misurare il limite del composer." / 5085 righe');
c.close();
