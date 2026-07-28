// The `pasteWatch` lifecycle in web mode (TESTING-TODO §4.5 / §7.9).
//
// pasteWatch is what lets a `pasteReport` arriving minutes later be interpreted
// at all, and it lives in chrome.storage precisely because MV3 recycles the
// service worker mid-sequence (observed live, §4.5). Its 6-hour pruning had
// never been seen to run — which is the half that matters in *both* directions:
// too lax and abandoned tabs make the map grow forever, too eager and a long
// run's verdict is silently discarded.
//
// Time is not faked: the entries are seeded with the timestamps they would have
// after N hours, which is what the pruning actually reads.
import { install, boot, runJob, reset, store, openedTabs, check, finish, makeTranscript } from './harness.mjs';

install({ transcript: makeTranscript(12000) });
// Web mode never calls an LLM API. Anything reaching the network here is a bug.
globalThis.fetch = async (url) => { throw new Error(`web mode must not call the network: ${url}`); };

await boot();

const HOUR = 60 * 60 * 1000;
const WEB = {
  mode: 'web', provider: 'gemini',
  prompt: 'Riassumi questo video.', transcriptLang: 'it',
  chunkParts: 1, autoPaste: true, autoSubmit: true,
};

/** Seed pasteWatch with entries of a given age (in hours), then run a web job. */
async function runWithWatch(ages) {
  const pasteWatch = {};
  for (const [id, hours] of Object.entries(ages)) {
    pasteWatch[id] = { providerLabel: 'Gemini', title: `old ${id}`, chunks: 1, ts: Date.now() - hours * HOUR };
  }
  reset({ pasteWatch });
  await runJob(WEB);
  return store.pasteWatch ?? {};
}

// ── The pruning, in both directions ──────────────────────────────────────────
let watch = await runWithWatch({ ancient: 7, borderline: 5.9, fresh: 0.5 });
const ids = Object.keys(watch).sort().join(',');
console.log(`\n  pasteWatch after the run: ${ids}`);

check('the 7 h entry is pruned', 'ancient' in watch, false);
check('a 5.9 h entry survives — a long run must not lose its verdict', 'borderline' in watch, true);
check('a fresh entry survives', 'fresh' in watch, true);
check('the new job registered its own entry', 'j1' in watch, true);
check('nothing else was invented', Object.keys(watch).length, 3);

// The surviving entries must be intact, not just present: the pruning loop
// mutates the object it writes back.
check('a survivor keeps its payload', watch.fresh?.title, 'old fresh');

// ── The entry the run itself wrote must be usable by handlePasteReport ───────
check('provider label recorded', watch.j1?.providerLabel, 'Gemini');
check('title recorded', watch.j1?.title, 'Video di prova');
check('part count recorded', watch.j1?.chunks, 1);
check('autoSubmit recorded', watch.j1?.autoSubmit, true);
check('timestamp is fresh', watch.j1?.ts > Date.now() - HOUR, true);

// ── And the run really was a web run ─────────────────────────────────────────
check('the Gemini tab was opened', openedTabs[0], 'https://gemini.google.com/app');
check('the transcript was staged for the content script',
  store.pendingLLMContent?.parts?.[0]?.includes('[0000]'), true);
check('the payload carries the job id', store.pendingLLMContent?.jobId, 'j1');
check('the status is provisional, not "✅ Sent"',
  store.jobs?.[0]?.statusText?.startsWith('📤 Sending to Gemini'), true);

// ── Exactly 6 h is the boundary, and it is exclusive (`< cutoff` is pruned) ──
watch = await runWithWatch({ justUnder: 5.999, justOver: 6.001 });
check('6 h − a few seconds survives', 'justUnder' in watch, true);
check('6 h + a few seconds is pruned', 'justOver' in watch, false);

// ── Pruning must not run when nothing is stale ───────────────────────────────
watch = await runWithWatch({ a: 1, b: 2, c: 3 });
check('no stale entries → nothing removed', Object.keys(watch).sort().join(','), 'a,b,c,j1');

finish();
