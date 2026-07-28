// §4.7 — the combined branch, live, at ZERO provider cost (auto-submit OFF, so
// part 1 lands in the composer and nothing is ever submitted).
//
// What this adds over the offline test: the `pasteReport` is produced by the
// real content script rather than injected, so it proves the two halves fit
// together — that the `jobIds` list written by runBatchCombined is what
// handlePasteReport later reads, and that ONE report really does move EVERY row.
//
// NOTE — inducing a live FAILURE here did not work and the attempt is left in
// place, disabled by reality rather than removed: pausing new targets and
// blocking their scripts (below) does not stop the tab the extension opens with
// chrome.tabs.create, which is already running by the time the handler fires.
// Gemini booted normally and the paste succeeded. The failure VERDICT is covered
// offline by test/combined-failure.test.mjs; what stays unproven live is only
// the verdict string, not the jobIds plumbing this test does exercise.
import { openPopup, startBatch, pollJobs, baseSettings } from './drive.mjs';
import { sleep } from './cdp.mjs';

const { c, evalIn } = await openPopup();

let failures = 0;
const check = (name, actual, expect) => {
  const ok = actual === expect;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${expect}\n      actual:   ${actual}`);
};

// Pause every new tab before it runs anything, block its scripts, let it go.
await c.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
c.on(async (m) => {
  if (m.method !== 'Target.attachedToTarget') return;
  const s = m.params.sessionId;
  if (!m.params.targetInfo.url.includes('gemini.google.com')) {
    return void c.send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
  }
  try {
    await c.send('Network.enable', {}, s);
    await c.send('Network.setBlockedURLs', { urls: ['*.js', '*/_/BardChatUi/*'] }, s);
  } catch (_) {}
  await c.send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
});

await evalIn(`(async () => { await chrome.storage.local.remove(['pendingLLMContent','jobs','pasteWatch']); return 1; })()`);

console.log('starting a COMBINED web batch (2 videos), auto-paste ON, auto-submit OFF');
await startBatch(evalIn, [
  { id: 1, url: 'https://www.youtube.com/watch?v=gQ2BnKMzlUQ', status: 'queued', title: '' },
  { id: 2, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', status: 'queued', title: '' },
], { ...baseSettings, combinedPrompt: true, autoPaste: true, autoSubmit: false, chunkParts: 2 });

// Both rows go provisional as soon as the tab opens; the verdict lands only when
// the content script gives up (ytsWaitForInput 15 s + the paste retries).
await pollJobs(evalIn, { seconds: 60 });
console.log('\n...waiting for the content script to give up...');
await sleep(45000);

const st = JSON.parse(await evalIn(`(async () => {
  const g = await chrome.storage.local.get(['jobs','pasteWatch','pendingLLMContent']);
  return JSON.stringify({
    rows: (g.jobs||[]).map(j => [j.id, j.status, j.statusText]),
    watch: Object.keys(g.pasteWatch||{}),
    pending: !!g.pendingLLMContent,
  });
})()`));

console.log('\nfinal rows:');
for (const [id, status, text] of st.rows) console.log(`   [${id}] ${String(status).padEnd(6)} ${text}`);
console.log(`   pasteWatch: [${st.watch.join(',')}]  pendingLLMContent: ${st.pending}`);

// Whether Gemini boots before the script blocking bites is a race, so BOTH
// outcomes are legitimate and both have been observed. The invariants that must
// hold either way are asserted first; the outcome-specific ones then branch.
const failed = st.rows.every(r => r[1] === 'error');
console.log(`\n   outcome: ${failed ? 'paste FAILED (composer never rendered)' : 'paste SUCCEEDED'}`);

check('both rows got a verdict', st.rows.length, 2);
// The point of the whole combined fix (D): ONE report, EVERY row.
check('one report moved both rows off the provisional label',
  st.rows.some(r => /^📤/.test(r[2])), false);
check('both rows carry the same combined verdict',
  new Set(st.rows.map(r => r[2].replace(/: .*$/, ''))).size, 1);
check('the verdict is scoped "(combined)"',
  st.rows.every(r => /\(combined\)/.test(r[2])), true);
check('the overflow warning survived the report on both rows (fix G)',
  st.rows.every(r => /chars over Gemini's message limit/.test(r[2])), true);
check('the watch entry was consumed', st.watch.length, 0);

if (failed) {
  check('every row is in error', st.rows.every(r => r[1] === 'error'), true);
  check('the verdict tells the user what to do',
    st.rows.every(r => /❌ Paste into Gemini \(combined\) failed — reload the tab to retry/.test(r[2])), true);
  // Deliberate: nothing landed, so the transcript is handed back rather than
  // destroyed — "reload the tab to retry" would be a lie otherwise.
  check('the payload is KEPT so the suggested retry can work', st.pending, true);
} else {
  check('every row is done', st.rows.every(r => r[1] === 'done'), true);
  check('auto-submit off is reported as Pasted, not Sent (fix F)',
    st.rows.every(r => /✅ Pasted into Gemini \(combined\) \(✂️ part 1 of 2 — auto-submit off\)/.test(r[2])), true);
  check('the payload was consumed', st.pending, false);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
c.close();
process.exit(failures ? 1 : 0);
