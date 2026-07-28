// The zero-cost pass on Firefox: auto-submit OFF, so the content script pastes part 1
// and stops. Nothing is ever sent, no quota is spent — but claim, split, the paste
// itself and the final verdict are all exercised for real. §1.2 calls this the run to
// do before spending anything.
//
//   EXT_UUID=<uuid> PROVIDER=gemini|anthropic|openai node test/e2e/firefox-run.mjs
import { openPopup, startBatch, pollJobs, clearState, settled, baseSettings, sleep } from './drive-gecko.mjs';

const PROVIDER = process.env.PROVIDER || 'gemini';
const VIDEO = process.env.VIDEO || 'gQ2BnKMzlUQ';
const HOST = { gemini: 'gemini.google.com', anthropic: 'claude.ai', openai: 'chatgpt.com' }[PROVIDER];
if (!HOST) throw new Error(`unknown PROVIDER: ${PROVIDER}`);

const { bidi, evalIn } = await openPopup();
await clearState(evalIn);

console.log(`\n=== ${PROVIDER} — auto-paste ON, auto-submit OFF (nothing is sent) ===`);
await startBatch(evalIn,
  [{ id: 1, url: `https://www.youtube.com/watch?v=${VIDEO}`, status: 'queued', title: '' }],
  { ...baseSettings, provider: PROVIDER, autoPaste: true, autoSubmit: false, chunkParts: 2 });

await pollJobs(evalIn, { seconds: 120, until: settled });

// Give the content script time to claim and paste into the tab the background opened.
await sleep(25000);

const { contexts } = await bidi.send('browsingContext.getTree', {});
const flat = [];
(function walk(list) { for (const c of list) { flat.push(c); if (c.children) walk(c.children); } })(contexts);
const tabs = flat.filter(c => (c.url || '').includes(HOST));
console.log(`\n${HOST} tabs: ${tabs.length}`);

let landed = 0;
for (const t of tabs) {
  const dom = await bidi.eval(t.context, `(() => {
    const els = [...document.querySelectorAll('.ql-editor, [contenteditable="true"], textarea, #prompt-textarea')];
    const read = e => ('value' in e && typeof e.value === 'string') ? e.value : (e.innerText || e.textContent || '');
    const filled = els.map(read).filter(t => t.trim().length > 20);
    // An attachment is the other legitimate landing place (fix L) — count chips too.
    const chips = document.querySelectorAll(
      '[data-testid="file-thumbnail"], [data-testid*="attachment"], .group\\\\/thumbnail, [aria-label*="allegat" i]').length;
    return {
      inputs: els.length,
      filled: filled.map(t => ({ len: t.length, head: t.slice(0, 70), tail: t.slice(-40) })),
      chips,
    };
  })()`);
  console.log(`  candidate inputs: ${dom.inputs}, filled: ${dom.filled.length}, attachment chips: ${dom.chips}`);
  for (const f of dom.filled) {
    landed += f.len;
    console.log(`    ${f.len} chars | head: ${JSON.stringify(f.head)}`);
    console.log(`    ${' '.repeat(String(f.len).length)}       tail: ${JSON.stringify(f.tail)}`);
  }
  if (dom.chips) landed += 1;   // an attachment counts as landed, per fix L
}

const jobs = await evalIn(`(async () => (await (globalThis.browser||globalThis.chrome).storage.local.get('jobs')).jobs || [])()`);
console.log('\nfinal status line:');
for (const j of jobs) console.log(`  [${j.status}] ${j.statusText}`);

await bidi.close();
console.log(landed ? `\n✅ ${PROVIDER}: the paste landed` : `\n❌ ${PROVIDER}: nothing landed`);
process.exit(landed ? 0 : 1);
