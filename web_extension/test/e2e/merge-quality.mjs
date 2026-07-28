// §7.4 / §4.1 — the ONE test that really sends: does the model answer the merge
// message sensibly after N turns?
//
// test-merge.mjs already covers the mechanics (the status line, pasteWatch, the
// service-worker recycle). What was never observed is the CONTENT of the final
// answer, so this captures the whole conversation and prints the merge reply in
// full for a human (or me) to judge.
//
// This one costs real quota: on Gemini the composer cap raises the split to 4, so
// it is 4 parts + 1 merge = 5 messages on the user's account. Claude and ChatGPT
// have no cap, so there it is 2 + 1 = 3. Run it deliberately, not as part of a suite.
//
//   EXT_ID=<id> node test/e2e/merge-quality.mjs                    # Gemini (default)
//   EXT_ID=<id> PROVIDER=anthropic node test/e2e/merge-quality.mjs # Claude
//   EXT_ID=<id> PROVIDER=openai    node test/e2e/merge-quality.mjs # ChatGPT
import { openPopup, startBatch, pollJobs, baseSettings } from './drive.mjs';
import { connect, sleep } from './cdp.mjs';
import fs from 'node:fs';

// Only reading the conversation is provider-specific: everything the fix itself
// does lives in paste_common.js and is identical for all three. These selectors
// were checked against each real DOM (an existing conversation in the test
// profile) before any message was ever sent.
const PROVIDERS = {
  gemini: {
    host: 'gemini.google.com',
    user: 'user-query',
    model: 'model-response',
    userFallback: '[class*="query"],[class*="user"],[data-test-id*="query"]',
    modelFallback: '[class*="response"],[class*="model"],message-content',
  },
  anthropic: {
    host: 'claude.ai',
    user: '[data-testid="user-message"]',
    model: '.font-claude-response',
    userFallback: '[data-testid="user-message"]',
    modelFallback: '[data-is-streaming="false"]',
  },
  openai: {
    host: 'chatgpt.com',
    user: '[data-message-author-role="user"]',
    model: '[data-message-author-role="assistant"]',
    userFallback: '[data-message-author-role="user"]',
    modelFallback: '.markdown.prose',
  },
};

const OUT = process.env.OUTDIR || '.';
const VIDEO = process.env.VIDEO || 'gQ2BnKMzlUQ';
const PROVIDER = process.env.PROVIDER || 'gemini';
const P = PROVIDERS[PROVIDER];
if (!P) throw new Error(`unknown PROVIDER: ${PROVIDER} (gemini | anthropic | openai)`);
const { c, evalIn } = await openPopup();

await evalIn(`(async () => { await chrome.storage.local.remove(['pendingLLMContent','jobs','pasteWatch']); return 1; })()`);

console.log(`merge run on ${VIDEO} via ${PROVIDER} — auto-submit ON, merge ON (this DOES send)`);
await startBatch(evalIn,
  [{ id: 1, url: `https://www.youtube.com/watch?v=${VIDEO}`, status: 'queued', title: '' }],
  { ...baseSettings, provider: PROVIDER, autoPaste: true, autoSubmit: true, chunkParts: 2, chunkMerge: true });

// Reads the conversation without assuming one fixed DOM: tries the known
// elements first, then falls back to scanning for the chunk markers, so a
// redesign degrades the output instead of emptying it.
const extract = function (sel) {
  const txt = (n) => (n?.innerText || '').trim();
  let users = [...document.querySelectorAll(sel.user)].map(txt);
  let models = [...document.querySelectorAll(sel.model)].map(txt);
  if (!users.length) {
    const all = [...document.querySelectorAll(sel.userFallback)].map(txt);
    users = all.filter(t => /parte \d+ di \d+|riassunto complessivo|UN UNICO/i.test(t));
  }
  if (!models.length) {
    models = [...document.querySelectorAll(sel.modelFallback)].map(txt).filter(t => t.length > 80);
  }
  const labels = users.map(t => {
    const m = /parte (\d+) di (\d+)/i.exec(t);
    if (m) return `part ${m[1]}/${m[2]}`;
    return /riassunto complessivo|UN UNICO|unisci/i.test(t) ? 'MERGE' : '?';
  });
  const busy = !!document.querySelector('button[aria-label*="Stop" i], button[aria-label*="Interrompi" i]');
  const read = e => ('value' in e && typeof e.value === 'string') ? e.value : (e.innerText || e.textContent || '');
  const composer = [...document.querySelectorAll('.ql-editor, [contenteditable="true"], textarea')]
    .map(read).sort((a, b) => b.length - a.length)[0] || '';
  // Did the merge request carry the partial summaries as text, or did it just
  // point at the earlier turns? That is the whole subject of the fix, and it is
  // readable straight off the last user turn.
  const lastUser = users[users.length - 1] || '';
  const mergeInlined = /##\s*(Parte|Part|Teil|Partie)\s*1\s*\//.test(lastUser);
  return { turns: labels, nUser: users.length, nModel: models.length, busy,
           composerLen: composer.length, models, mergeInlined, mergeMsgLen: lastUser.length };
};

async function peek() {
  const c2 = await connect(9333);
  const t = (await c2.targets()).find(x => x.type === 'page' && x.url.includes(P.host));
  if (!t) { c2.close(); return null; }
  const s = await c2.attach(t.targetId);
  await c2.send('Runtime.enable', {}, s);
  const r = await c2.send('Runtime.evaluate',
    { expression: `(${extract.toString()})(${JSON.stringify(P)})`, returnByValue: true }, s).catch(() => null);
  let shot = null;
  try { shot = (await c2.send('Page.captureScreenshot', { format: 'png' }, s)).data; } catch (_) {}
  c2.close();
  return { data: r?.result?.value ?? null, shot };
}

// Poll the job row and the conversation together, so a stall is visible as it
// happens rather than after 20 minutes of silence.
const started = Date.now();
let last = null;
for (let i = 0; i < 80; i++) {
  const jobs = await evalIn(`(async () => (await chrome.storage.local.get('jobs')).jobs)()`);
  const p = await peek();
  if (p?.data) last = p;
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`[${mins}m] ${jobs?.[0]?.statusText?.slice(0, 80)}`);
  if (p?.data) console.log(`        turns=[${p.data.turns.join(', ')}] replies=${p.data.nModel} busy=${p.data.busy} composer=${p.data.composerLen}`);
  if (jobs?.[0] && ['done', 'error'].includes(jobs[0].status) && p?.data && !p.data.busy
      && (p.data.turns.includes('MERGE') || p.data.nUser >= 5)) break;
  await sleep(15000);
}

const jobs = await evalIn(`(async () => (await chrome.storage.local.get('jobs')).jobs)()`);
console.log(`\n=== final status ===\n${jobs?.[0]?.status}  ${jobs?.[0]?.statusText}`);
console.log(`duration: ${((Date.now() - started) / 60000).toFixed(1)} min`);

if (last?.shot) {
  fs.writeFileSync(`${OUT}/merge-run-${PROVIDER}.png`, Buffer.from(last.shot, 'base64'));
  console.log(`screenshot: ${OUT}/merge-run-${PROVIDER}.png`);
}
if (last?.data) {
  console.log(`turns submitted: [${last.data.turns.join(', ')}]`);
  console.log(`model replies:   ${last.data.nModel}`);
  const merged = last.data.models[last.data.models.length - 1] || '';
  fs.writeFileSync(`${OUT}/merge-reply-${PROVIDER}.txt`, last.data.models.join('\n\n===== NEXT REPLY =====\n\n'));
  console.log(`all replies saved: ${OUT}/merge-reply-${PROVIDER}.txt`);
  console.log(`merge message: ${last.data.mergeInlined ? 'partials INLINED' : '⚠️ pointed at earlier turns'} (${last.data.mergeMsgLen} chars)`);

  // The verdict, without eyeballing it. For every partial answer, take the words
  // that occur in THAT answer and in no other, and see how many survive into the
  // merge. The 2026-07-27 run scored 0/N on parts 1 and 2 and full marks on 3
  // and 4 — a summary "of the whole video" that covered its second half.
  const partials = last.data.models.slice(0, -1);
  if (partials.length >= 2) {
    const words = t => new Set((t.toLowerCase().match(/[a-zà-ÿ]{7,}/g) || []));
    const sets = partials.map(words);
    console.log(`\n=== coverage of each partial answer in the merge ===`);
    // Calibrated on the recorded 2026-07-27 run (merge-run-2026-07-27.txt),
    // where the metric scores 0%, 4%, 88%, 28% — the two parts the model
    // demonstrably dropped land an order of magnitude below the two it kept.
    const COVERED = 0.15;
    let worst = 1;
    sets.forEach((s, i) => {
      const own = [...s].filter(w => sets.every((o, j) => j === i || !o.has(w))).slice(0, 25);
      const hits = own.filter(w => merged.toLowerCase().includes(w));
      const ratio = own.length ? hits.length / own.length : 1;
      worst = Math.min(worst, ratio);
      console.log(`part ${i + 1}/${partials.length}: ${hits.length}/${own.length} distinctive words survive` +
                  `  ${ratio >= COVERED ? '✅' : '🔴'}  [${own.slice(0, 6).join(', ')}]`);
    });
    console.log(`\nVERDICT: ${worst >= COVERED ? '✅ every part is represented in the merge'
                                           : '🔴 at least one part was dropped by the model'}`);
  }

  console.log(`\n=== FINAL (merge) REPLY — ${merged.length} chars ===\n`);
  console.log(merged.slice(0, 4000));
}

c.close();
process.exit(0);
