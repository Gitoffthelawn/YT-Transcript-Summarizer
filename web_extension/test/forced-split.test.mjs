// "1 part" is not always one message, and the user has to be told which of the
// two happened.
//
// Gemini truncates a composer message at exactly 32 000 characters, in silence,
// so a long transcript is split whether or not anyone asked for it. Everything
// downstream of that was wrong in one way or another:
//
//   · the merge was decided by a checkbox the UI HIDES at "1 part", so it
//     carried whatever an earlier setting had left in it — a user who picked
//     "1 part" could get 7 partial summaries and no whole one, or the reverse,
//     depending on a control they could not see;
//   · the status line said "✂️ 7 parts" under a selector reading "1 part",
//     with no hint that the provider's own limit had forced it.
//
// This drives the REAL background.js: the numbers and the strings below are the
// ones the extension produces.
import {
  install, boot, runJob, reset, sendMessage, store, openedTabs,
  check, finish, makeTranscript,
} from './harness.mjs';

// 120 000 chars ≈ a 2 h video: four Gemini messages' worth.
install({ transcript: makeTranscript(120000) });
globalThis.fetch = async (url) => { throw new Error(`web mode must not call the network: ${url}`); };

await boot();

const BASE = {
  mode: 'web', prompt: 'Riassumi questo video.', transcriptLang: 'it',
  autoPaste: true, autoSubmit: true,
  // The state the bug needs: one part asked for, and a merge flag left over from
  // an earlier setting — the chip is hidden at "1 part", so this is invisible.
  chunkParts: 1, chunkMerge: false,
};

// ── Gemini: the split is forced, and it says so ──────────────────────────────
reset();
let row = await runJob({ ...BASE, provider: 'gemini' });
const staged = store.pendingLLMContent;
const chunks = staged.parts.length - 1;   // + the merge message

console.log(`\n  asked 1 part → ${staged.parts.length} messages staged`);
check('the Gemini tab was opened', openedTabs[0], 'https://gemini.google.com/app');
check('"1 part" really became several messages', staged.parts.length > 1, true);
check('every message fits the composer',
  staged.parts.every(p => p.length <= 32000), true);
check('the whole transcript is staged, last line included',
  staged.parts.some(p => p.includes('[1999]')), true);

// One summary was asked for, so one summary must come back.
check('a forced split still ends in a merge request', staged.merge?.count, chunks);
check('the merge request is the last message', staged.merge?.at, staged.parts.length - 1);

// The provisional status has to carry the reason, not just the number.
check('the status says how many parts AND why', row.statusText,
  `📤 Sending to Gemini (✂️ ${chunks} parts — over Gemini's message limit + merge): Video di prova`);

// ── ...and the reason survives into the final verdict ────────────────────────
sendMessage({ type: 'pasteReport', jobId: 'j1', ok: true, sent: staged.parts.length, total: staged.parts.length, mergeInline: true });
for (let i = 0; i < 80; i++) await new Promise(r => setImmediate(r));
check('the final verdict keeps the reason', store.jobs[0].statusText,
  `✅ Sent to Gemini (✂️ ${chunks} parts — over Gemini's message limit + merge): Video di prova`);
check('the verdict is a success', store.jobs[0].status, 'done');

// ── Claude has no composer cap: "1 part" means one message, and no merge ─────
reset();
row = await runJob({ ...BASE, provider: 'anthropic' });
check('no cap → the request is honoured exactly',
  store.pendingLLMContent.parts.length, 1);
check('no cap → no merge message was invented', store.pendingLLMContent.merge, null);
check('no cap → the status mentions no split', row.statusText,
  '📤 Sending to Claude.ai: Video di prova');

// ── auto-submit off: we may not press Send, so splitting would LOSE text ─────
// Only part 1 would ever be pasted, so the honest thing is to keep it whole and
// warn about the overflow instead.
reset();
row = await runJob({ ...BASE, provider: 'gemini', autoSubmit: false });
check('auto-submit off → still a single message', store.pendingLLMContent.parts.length, 1);
check('auto-submit off → the overflow is disclosed',
  row.statusText.includes("over Gemini's message limit — the tail of a part may be dropped"), true);

finish();
