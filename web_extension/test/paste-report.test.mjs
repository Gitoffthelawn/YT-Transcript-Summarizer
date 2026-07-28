// Drives the REAL handlePasteReport in background.js through the real message
// listener, against a stubbed chrome.* — so the status strings under test are
// the ones the extension actually produces.
import { fileURLToPath } from 'node:url';
const EXT = fileURLToPath(new URL('..', import.meta.url));

const store = {};
const notifications = [];
let onMessage = null;

globalThis.chrome = {
  alarms: { onAlarm: { addListener() {} }, create() {}, clear() {} },
  runtime: {
    onMessage: { addListener(fn) { onMessage = onMessage || fn; if (fn.length === 3) onMessage = fn; } },
    onConnect: { addListener() {} },
    getURL: p => p,
    lastError: null,
  },
  storage: {
    local: {
      async get(keys) {
        const k = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
        const out = {};
        for (const key of k) if (key in store) out[key] = structuredClone(store[key]);
        return out;
      },
      async set(obj) { Object.assign(store, structuredClone(obj)); },
      async remove(key) { for (const k of [].concat(key)) delete store[k]; },
    },
  },
  tabs: { create: async () => ({ id: 1 }), query: async () => [], sendMessage: async () => {} },
  notifications: { create: (o) => notifications.push(o) },
  downloads: { download: async () => 1, onChanged: { addListener() {} } },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  scripting: { executeScript: async () => [] },
};

await import(new URL('../background.js', import.meta.url).href);
if (!onMessage) throw new Error('pasteReport listener was never registered');

const JOBS = [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }];

async function run({ watch, report, jobs = JOBS }) {
  store.jobs = structuredClone(jobs);
  store.pasteWatch = { [watch.id]: { ...watch.info, ts: Date.now() } };
  notifications.length = 0;
  onMessage({ type: 'pasteReport', ...report }, {}, () => {});
  // handlePasteReport is async behind a sync listener; let its promise chain drain.
  for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r));
  return {
    rows: store.jobs.map(j => ({ id: j.id, status: j.status, text: j.statusText })),
    notified: notifications.length,
  };
}

const base = { providerLabel: 'Gemini', title: 'Habitat — post-AI', warn: '', overflowNote: '' };
let failures = 0;
function check(name, actual, expect) {
  const ok = actual === expect;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${expect}\n      actual:   ${actual}`);
}

// ── §4.1  merge active: 5 messages, 4 parts, all sent ────────────────────────
let r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: true, autoSubmit: true } },
  report: { jobId: 'j1', ok: true, sent: 5, total: 5 },
});
check('merge OK → parts, not messages', r.rows[0].text,
  '✅ Sent to Gemini (✂️ 4 parts + merge): Habitat — post-AI');
check('merge OK → status done', r.rows[0].status, 'done');

// The merge message normally carries the partial summaries back as text. When
// the content script could not read them off the page, the merge leans on the
// model's memory of its own earlier turns — which is exactly how a "summary of
// the whole video" ended up covering only its second half. Must be visible.
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: true, autoSubmit: true } },
  report: { jobId: 'j1', ok: true, sent: 5, total: 5, mergeInline: false },
});
check('merge fell back to chat memory → says so', r.rows[0].text,
  '✅ Sent to Gemini (✂️ 4 parts + merge) (⚠️ merge relied on the chat’s memory — it may cover only the last parts): Habitat — post-AI');

// ...and when the partials WERE inlined, no warning: it is the normal path.
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: true, autoSubmit: true } },
  report: { jobId: 'j1', ok: true, sent: 5, total: 5, mergeInline: true },
});
check('merge with the partials inlined → no warning', r.rows[0].text,
  '✅ Sent to Gemini (✂️ 4 parts + merge): Habitat — post-AI');

// A run without a merge cannot produce that warning, whatever the flag says.
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: false, autoSubmit: true } },
  report: { jobId: 'j1', ok: true, sent: 4, total: 4, mergeInline: false },
});
check('no merge → no merge warning', r.rows[0].text,
  '✅ Sent to Gemini (✂️ 4 parts): Habitat — post-AI');

// ── §4.1  merge active, every part landed but the merge message did not ──────
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: true, autoSubmit: true } },
  report: { jobId: 'j1', ok: false, sent: 4, total: 5 },
});
check('merge lost → not "Only part 4 of 5"', r.rows[0].text,
  '⚠️ All 4 parts reached Gemini, but the merge request did not: Habitat — post-AI');

// ── partial: stopped after part 2 of 4 ───────────────────────────────────────
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: false, autoSubmit: true } },
  report: { jobId: 'j1', ok: false, sent: 2, total: 4 },
});
check('partial → counts parts', r.rows[0].text,
  '⚠️ Only part 2 of 4 reached Gemini: Habitat — post-AI');
check('partial → notifies', r.notified, 1);

// ── total failure ────────────────────────────────────────────────────────────
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: false, autoSubmit: true } },
  report: { jobId: 'j1', ok: false, sent: 0, total: 4 },
});
check('nothing landed', r.rows[0].text,
  '❌ Paste into Gemini failed — reload the tab to retry: Habitat — post-AI');

// ── §4.2  auto-submit OFF: 1 message pasted, 2 parts planned ─────────────────
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 2, merged: false, autoSubmit: false } },
  report: { jobId: 'j1', ok: true, sent: 1, total: 1 },
});
check('auto-submit off → does not claim "Sent (2 parts)"', r.rows[0].text,
  '✅ Pasted into Gemini (✂️ part 1 of 2 — auto-submit off): Habitat — post-AI');

// ── overflow warning must survive into the final status ──────────────────────
const ovf = " (⚠️ 22k chars over Gemini's message limit — the tail of a part may be dropped)";
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 2, merged: false, autoSubmit: false, overflowNote: ovf } },
  report: { jobId: 'j1', ok: true, sent: 1, total: 1 },
});
check('overflow note preserved', r.rows[0].text,
  `✅ Pasted into Gemini (✂️ part 1 of 2 — auto-submit off)${ovf}: Habitat — post-AI`);

// ── §3.1  combined: one report must update every queue row ───────────────────
r = await run({
  watch: { id: 'j1', info: { ...base, title: 'A + B + C', chunks: 3, merged: false, autoSubmit: true, jobIds: ['j1', 'j2', 'j3'], combined: true } },
  report: { jobId: 'j1', ok: true, sent: 3, total: 3 },
});
check('combined → all 3 rows updated', r.rows.map(x => x.text).join(' | '),
  Array(3).fill('✅ Sent to Gemini (combined) (✂️ 3 parts): A + B + C').join(' | '));

r = await run({
  watch: { id: 'j1', info: { ...base, title: 'A + B + C', chunks: 3, merged: false, autoSubmit: true, jobIds: ['j1', 'j2', 'j3'], combined: true } },
  report: { jobId: 'j1', ok: false, sent: 0, total: 3 },
});
check('combined failure → all 3 rows error', r.rows.every(x => x.status === 'error'), true);

// ── success whose queue row is already gone must still reach the user ────────
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: false, autoSubmit: true } },
  report: { jobId: 'j1', ok: true, sent: 4, total: 4 },
  jobs: [],   // popup pruned the finished row while the sequence was running
});
check('success with no row left → notifies', r.notified, 1);

// ...but a success whose row is still visible must NOT add a notification.
r = await run({
  watch: { id: 'j1', info: { ...base, chunks: 4, merged: false, autoSubmit: true } },
  report: { jobId: 'j1', ok: true, sent: 4, total: 4 },
});
check('success with a visible row → stays quiet', r.notified, 0);

// ── unknown job (report after the watch entry was pruned) must be a no-op ────
store.jobs = structuredClone(JOBS);
store.pasteWatch = {};
onMessage({ type: 'pasteReport', jobId: 'j1', ok: true, sent: 1, total: 1 }, {}, () => {});
for (let i = 0; i < 50; i++) await new Promise(r2 => setImmediate(r2));
check('stale report is ignored', store.jobs[0].statusText, undefined);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
