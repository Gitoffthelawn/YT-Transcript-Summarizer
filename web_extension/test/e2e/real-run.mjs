// The supported flow, end to end, at ZERO provider cost: a real job with
// auto-paste ON and auto-submit OFF. The transcript is fetched for real, split
// for real, and pasted into the real Gemini composer — but nothing is ever
// submitted, so no message reaches the model.
//
// This is the §4.2 check re-run against Gemini's CURRENT UI (redesigned since
// the 2026-07-27 session: the composer is now a compact pill on a landing page).
// Ends with a screenshot, because "is the transcript visibly in the box" is a
// question about pixels.
import { openPopup, startBatch, pollJobs, settled, baseSettings } from './drive.mjs';
import { sleep } from './cdp.mjs';
import fs from 'node:fs';

const VIDEO = process.env.VIDEO || 'gQ2BnKMzlUQ';
const OUT = process.env.OUTDIR || '.';
const { c, evalIn } = await openPopup();

await evalIn(`(async () => { await chrome.storage.local.remove(['pendingLLMContent','jobs','pasteWatch']); return 1; })()`);

console.log(`starting a real web job on ${VIDEO} (auto-paste ON, auto-submit OFF)`);
await startBatch(evalIn,
  [{ id: 1, url: `https://www.youtube.com/watch?v=${VIDEO}`, status: 'queued', title: '' }],
  { ...baseSettings, autoPaste: true, autoSubmit: false, chunkParts: 2 });

await pollJobs(evalIn, { seconds: 90, until: settled });

// Find the Gemini tab the background opened and look at what is actually in it.
await sleep(20000);
const targets = (await c.targets()).filter(t => t.type === 'page' && t.url.includes('gemini.google.com'));
console.log(`\ngemini tabs: ${targets.length}`);

for (const t of targets) {
  const s = await c.attach(t.targetId);
  await c.send('Runtime.enable', {}, s);
  const r = await c.send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const els = [...document.querySelectorAll('.ql-editor, [contenteditable="true"], textarea')];
      const read = e => ('value' in e && typeof e.value === 'string') ? e.value : (e.innerText || e.textContent || '');
      return { n: els.length, filled: els.map(read).filter(t => t.trim().length > 20)
        .map(t => ({ len: t.length, head: t.slice(0, 60), tail: t.slice(-40) })) };
    })())`, returnByValue: true,
  }, s);
  const dom = JSON.parse(r.result.value);
  console.log(`  ${t.url}`);
  console.log(`    candidate inputs: ${dom.n}, filled: ${dom.filled.length}`);
  for (const f of dom.filled) {
    console.log(`      len=${f.len.toLocaleString()}  head="${f.head.replace(/\n/g, ' ')}"`);
    console.log(`                     tail="${f.tail.replace(/\n/g, ' ')}"`);
  }
  const shot = await c.send('Page.captureScreenshot', { format: 'png' }, s).catch(() => null);
  if (shot) {
    fs.writeFileSync(`${OUT}/real-run.png`, Buffer.from(shot.data, 'base64'));
    console.log(`    screenshot: ${OUT}/real-run.png`);
  }
}

const st = await evalIn(`(async () => {
  const g = await chrome.storage.local.get(['jobs','pasteWatch','pendingLLMContent']);
  return JSON.stringify({
    jobs: (g.jobs||[]).map(j => [j.status, j.statusText]),
    pasteWatch: Object.keys(g.pasteWatch||{}),
    pending: !!g.pendingLLMContent,
  });
})()`);
console.log(`\nfinal state: ${st}`);

c.close();
process.exit(0);
