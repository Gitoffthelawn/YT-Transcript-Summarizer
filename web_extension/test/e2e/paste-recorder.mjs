// Decisive experiment for the "landed but the composer is empty" case.
//
// A recorder is installed via Page.addScriptToEvaluateOnNewDocument, i.e. BEFORE
// the content script runs, and logs every value the composer ever holds with a
// timestamp. If the text appears and is then wiped, the recording shows it —
// polling once a second cannot, because the wipe happens during Angular's boot.
//
// Also saves a screenshot, to rule out the boring explanations (login wall,
// consent interstitial, a composer that is not the one we think).
import { openPopup } from './drive.mjs';
import { sleep } from './cdp.mjs';
import fs from 'node:fs';

const MARK = 'YTS-CLAIM-PROBE';
const TEXT = `${MARK} part one of two, long enough to pass the twenty character probe`;
const OUT = process.env.OUTDIR || '.';
const { c, evalIn } = await openPopup();

await evalIn(`(async () => {
  await chrome.storage.local.remove('pendingLLMContent');
  await chrome.storage.local.set({ pendingLLMContent: {
    parts: [${JSON.stringify(TEXT)}], autoSubmit: false, jobId: null, ts: Date.now()
  }});
  return true;
})()`);

const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', background: true });
const s = await c.attach(targetId);
await c.send('Page.enable', {}, s);
await c.send('Runtime.enable', {}, s);

// Runs in the MAIN world before any page script — records, never interferes.
await c.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__rec = [];
    const t0 = Date.now();
    const read = e => ('value' in e && typeof e.value === 'string') ? e.value : (e.innerText || e.textContent || '');
    const snap = () => {
      for (const el of document.querySelectorAll('.ql-editor, [contenteditable="true"], textarea')) {
        const t = read(el);
        el.__prev = el.__prev ?? null;
        if (t !== el.__prev) {
          window.__rec.push({ ms: Date.now() - t0, tag: el.tagName,
            cls: (el.className || '').toString().slice(0, 30),
            len: t.length, head: t.slice(0, 45) });
          el.__prev = t;
        }
      }
    };
    new MutationObserver(snap).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(snap, 50);
  `,
}, s);

await c.send('Page.navigate', { url: 'https://gemini.google.com/app' }, s);
await sleep(25000);

const rec = await c.send('Runtime.evaluate', {
  expression: 'JSON.stringify(window.__rec || [])', returnByValue: true,
}, s);
const events = JSON.parse(rec.result.value);

console.log(`\n=== composer value changes (${events.length} recorded) ===`);
for (const e of events) {
  const flag = e.head.includes(MARK) ? '  ← THE PASTE' : '';
  console.log(`  t=${String(e.ms).padStart(6)}ms ${e.tag}.${e.cls.padEnd(20)} len=${String(e.len).padStart(4)} "${e.head.replace(/\n/g, '\\n')}"${flag}`);
}

const everHad = events.some(e => e.head.includes(MARK));
const lastNonEmpty = [...events].reverse().find(e => e.len > 1);
console.log(`\n  text ever present in the composer: ${everHad ? 'YES' : 'NO'}`);
console.log(`  final composer state: len=${lastNonEmpty?.len ?? 0}`);
console.log(`  payload in storage: ${await evalIn(`(async () => (await chrome.storage.local.get('pendingLLMContent')).pendingLLMContent ? 'present' : 'ABSENT')()`)}`);

const shot = await c.send('Page.captureScreenshot', { format: 'png' }, s);
fs.writeFileSync(`${OUT}/gemini-after-paste.png`, Buffer.from(shot.data, 'base64'));
console.log(`  screenshot: ${OUT}/gemini-after-paste.png`);

await c.send('Target.closeTarget', { targetId }).catch(() => {});
c.close();
process.exit(0);
