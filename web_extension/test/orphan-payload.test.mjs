// One global payload key, one video per tab: what happens to video 1 when
// video 2's turn comes before its chat tab has picked anything up.
//
// `pendingLLMContent` is a single storage key, and the web batch overwrites it
// every `webDelay` seconds (30 by default). A cold provider tab can take longer
// than that to mount its composer, and then video 1's transcript is simply gone
// — nothing is ever pasted for it, and its queue row sits at the provisional
// "📤 Sending to …" forever, which reads as success.
//
// The transcript cannot be rescued at that point (the next video's turn has
// come). The silence can, and must be: a job that will never be pasted has to
// say so. A payload already CLAIMED by a tab is a different story — that tab
// works from its own copy and its verdict is still coming, so it must be left
// alone.
import {
  install, boot, runJobs, reset, store, openedTabs, check, finish, makeTranscript,
} from './harness.mjs';

install({ transcript: makeTranscript(6000) });
globalThis.fetch = async (url) => { throw new Error(`web mode must not call the network: ${url}`); };

await boot();

const WEB = {
  mode: 'web', provider: 'gemini', prompt: 'Riassumi questo video.', transcriptLang: 'it',
  chunkParts: 1, autoPaste: true, autoSubmit: true,
  webDelay: 1,   // the real gap is 30 s; the race is the same, the test is faster
};
const job = (id, v) => ({ id, url: `https://www.youtube.com/watch?v=${v}`, status: 'queued' });

// ── Two videos, and the first tab never claims anything ──────────────────────
reset();
let rows = await runJobs(WEB, [job('a', 'AAAAAAAAAAA'), job('b', 'BBBBBBBBBBB')]);
const byId = Object.fromEntries(rows.map(r => [r.id, r]));

console.log(`\n  a: ${byId.a.status} — ${byId.a.statusText}\n  b: ${byId.b.status} — ${byId.b.statusText}`);
check('both videos opened a tab', openedTabs.length, 2);
check('the payload now belongs to the second video', store.pendingLLMContent?.jobId, 'b');
check('the second video is still provisional, as it should be',
  byId.b.statusText.startsWith('📤 Sending to Gemini'), true);

// The first video is the whole point: it must not be left claiming success.
check('the abandoned video does not sit on "📤 Sending"',
  byId.a.statusText.startsWith('📤'), false);
check('the abandoned video is marked failed', byId.a.status, 'error');
check('...and says what actually happened', byId.a.statusText,
  '❌ Gemini never received this transcript — the next video\'s turn came first: Video di prova');
check('its watch entry is gone, so a stray report cannot revive it',
  'a' in (store.pasteWatch ?? {}), false);
check('the second video keeps its watch entry', 'b' in (store.pasteWatch ?? {}), true);

// ── A CLAIMED payload belongs to a tab that is still working ─────────────────
// Overwriting the key costs that tab nothing (it holds its own copy of the
// parts), and its report is still on its way — declaring it failed here would be
// a lie that a later success could no longer correct.
reset();
rows = await runJobs(WEB, [job('c', 'CCCCCCCCCCC')]);
const provisional = rows[0].statusText;
check('the third video is staged', store.pendingLLMContent?.jobId, 'c');

// The chat tab claims it — exactly what ytsClaimPending writes.
store.pendingLLMContent = { ...store.pendingLLMContent, claimedBy: 'tok-1', claimedAt: Date.now() };

rows = await runJobs(WEB, [{ ...rows[0] }, job('d', 'DDDDDDDDDDD')]);
const after = Object.fromEntries(rows.map(r => [r.id, r]));
check('a claimed payload does not fail its job', after.c.statusText, provisional);
check('...and its watch entry survives to receive the verdict',
  'c' in (store.pasteWatch ?? {}), true);
check('the new video still got staged', store.pendingLLMContent?.jobId, 'd');

finish();
