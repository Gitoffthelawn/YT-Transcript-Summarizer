// The combined web branch when the paste FAILS (TESTING-TODO §4.7 / §7.7).
//
// The success path was verified live on 2026-07-27; the failure path was covered
// only by paste-report.test.mjs, which injects a hand-made pasteWatch entry. That
// leaves the interesting half untested: whether `runBatchCombined` really writes
// the `jobIds` list the verdict needs. If it wrote only its own id — the exact
// shape of the old §3.1 divergence — the injected-entry test would still pass
// while two of the three queue rows sat on a stale "📤 Sending" forever.
//
// So here the watch entry is the one the extension itself produced: a real
// combined run, then a real pasteReport on top of it.
import {
  install, boot, runJobs, reset, sendMessage, store, openedTabs, notifications,
  check, finish, makeTranscript,
} from './harness.mjs';

install({ transcript: makeTranscript(9000) });
globalThis.fetch = async (url) => { throw new Error(`web mode must not call the network: ${url}`); };

await boot();

const JOBS = [
  { id: 'a', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', status: 'queued' },
  { id: 'b', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', status: 'queued' },
  { id: 'c', url: 'https://www.youtube.com/watch?v=CCCCCCCCCCC', status: 'queued' },
];
const SETTINGS = {
  mode: 'web', provider: 'gemini', combinedPrompt: true,
  prompt: 'Riassumi questi video.', transcriptLang: 'it',
  chunkParts: 2, autoPaste: true, autoSubmit: true,
};

reset();
let rows = await runJobs(SETTINGS, structuredClone(JOBS));

// ── The combined run itself ──────────────────────────────────────────────────
check('one tab for the whole batch, not three', openedTabs.length, 1);
check('all three rows are provisional',
  rows.every(r => r.statusText?.startsWith('📤 Sending to Gemini (combined)')), true);

// The claim entry is registered under the FIRST job's id only...
const watch = store.pasteWatch ?? {};
check('exactly one watch entry for the batch', Object.keys(watch).length, 1);
check('registered under the first job', 'a' in watch, true);
// ...but it must carry every id, or the other two rows are unreachable.
check('the watch entry carries all three ids', watch.a?.jobIds?.join(','), 'a,b,c');
check('the entry is flagged combined', watch.a?.combined, true);
check('the payload is staged once', Array.isArray(store.pendingLLMContent?.parts), true);
check('the payload is addressed to the first job', store.pendingLLMContent?.jobId, 'a');

// ── Now the paste fails, and the verdict must reach every row ────────────────
notifications.length = 0;
sendMessage({ type: 'pasteReport', jobId: 'a', ok: false, sent: 0, total: watch.a.chunks });
for (let i = 0; i < 80; i++) await new Promise(r => setImmediate(r));
rows = store.jobs;

check('all three rows went to error', rows.every(r => r.status === 'error'), true);
check('all three carry the same verdict',
  rows.every(r => r.statusText?.startsWith('❌ Paste into Gemini (combined) failed')), true);
check('no row was left on the provisional label',
  rows.some(r => r.statusText?.startsWith('📤')), false);
// Three rows, one batch, one thing that went wrong: three toasts would be noise.
check('exactly ONE notification for the whole batch', notifications.length, 1);
check('the watch entry is consumed', Object.keys(store.pasteWatch ?? {}).length, 0);

// ── A second report for the same batch must be a no-op ───────────────────────
// (a reloaded tab re-claiming the payload would otherwise re-write the verdict)
notifications.length = 0;
sendMessage({ type: 'pasteReport', jobId: 'a', ok: true, sent: 9, total: 9 });
for (let i = 0; i < 80; i++) await new Promise(r => setImmediate(r));
check('a duplicate report cannot resurrect the batch as a success',
  store.jobs.every(r => r.status === 'error'), true);
check('and it notifies nobody', notifications.length, 0);

finish();
