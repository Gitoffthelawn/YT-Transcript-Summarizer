import { buildChunkMessages } from '../modules/llm-api.js';
import { CONFIG, getPreset } from '../modules/config.js';

const GEMINI = CONFIG.maxWebMessageChars.gemini; // 32000
const PROMPT = getPreset('it', 'chat', 'normal');

// A transcript shaped like a caption track: many short lines, so splitTranscript
// always finds a clean boundary.
function transcript(chars) {
  let s = '';
  for (let i = 1; s.length < chars; i++) s += `[${String(i).padStart(6, '0')}] parola parola parola parola parola.\n`;
  return s.slice(0, chars);
}

let failures = 0;
const check = (name, actual, expect) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expect);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expect)}, got ${JSON.stringify(actual)}`}`);
};

function build(chars, { asked, cap, autoSubmit, merge = false }) {
  const web = buildChunkMessages(transcript(chars), {
    prompt: PROMPT, transcriptLang: 'it', chunkParts: asked, chunkMerge: merge,
    maxMessageChars: cap, splitToFit: !!autoSubmit,
  });
  return { ...web, longest: Math.max(...web.parts.map(p => p.length)) };
}

const T = 107000;
console.log(`transcript: ${T} chars · Gemini cap: ${GEMINI} · prompt: ${PROMPT.length}\n`);

// ── §4.2 row 1: auto-submit ON, asked 2 → raised until everything fits ───────
let w = build(T, { asked: 2, cap: GEMINI, autoSubmit: true });
console.log(`  ON,  asked 2 → ${w.chunks} parts, longest ${w.longest}, overflow ${w.overflow}`);
check('ON: raised above the asked 2', w.chunks > 2, true);
check('ON: overflow eliminated', w.overflow, 0);
check('ON: every message inside the composer cap', w.parts.every(p => p.length <= GEMINI), true);

// ── §4.2 row 2: auto-submit OFF, asked 2 → stays 2, warns instead ───────────
w = build(T, { asked: 2, cap: GEMINI, autoSubmit: false });
console.log(`  OFF, asked 2 → ${w.chunks} parts, longest ${w.longest}, overflow ${w.overflow}`);
check('OFF: honours the asked 2', w.chunks, 2);
check('OFF: reports the overflow', w.overflow > 0, true);
check('OFF: overflow == longest - cap', w.overflow, w.longest - GEMINI);

// ── §4.2 row 3: auto-submit OFF, asked 1 ────────────────────────────────────
w = build(T, { asked: 1, cap: GEMINI, autoSubmit: false });
console.log(`  OFF, asked 1 → ${w.chunks} parts, longest ${w.longest}, overflow ${w.overflow}`);
check('OFF/1: single part', w.chunks, 1);
check('OFF/1: reports the overflow', w.overflow, w.longest - GEMINI);

// ── §4.2 row 4: API mode (no cap passed at all) ─────────────────────────────
w = build(T, { asked: 2, cap: null, autoSubmit: true });
console.log(`  API, asked 2 → ${w.chunks} parts, longest ${w.longest}, overflow ${w.overflow}`);
check('API: honours the asked 2', w.chunks, 2);
check('API: no overflow concept', w.overflow, 0);

// ── claude.ai / chatgpt.com today: cap is null → untouched behaviour ────────
w = build(T, { asked: 2, cap: CONFIG.maxWebMessageChars.default, autoSubmit: true });
check('null cap: behaves like before the fix', w.chunks, 2);

// ── §4.1 merge: messages = parts + 1 ───────────────────────────────────────
w = build(T, { asked: 2, cap: GEMINI, autoSubmit: true, merge: true });
console.log(`\n  merge ON → ${w.chunks} parts, ${w.parts.length} messages`);
check('merge: one extra message', w.parts.length, w.chunks + 1);
check('merge: flag set', w.merged, true);
check('merge: still no overflow', w.overflow, 0);

// ── §4.4 past the 10-part ceiling ──────────────────────────────────────────
// A ~6 h video used to lose its tail at the old 10-part ceiling; it must now fit.
const SIX_HOURS = 340000;
w = build(SIX_HOURS, { asked: 1, cap: GEMINI, autoSubmit: true });
console.log(`\n  ${SIX_HOURS} chars → ${w.chunks} parts, overflow ${w.overflow}`);
check('6h video: fits without overflow now', w.overflow, 0);
check('6h video: needed more than the user-facing maxParts', w.chunks > CONFIG.chunking.maxParts, true);
check('6h video: within the automatic ceiling', w.chunks <= CONFIG.chunking.maxAutoParts, true);

const HUGE = 900000; // beyond even maxAutoParts × 32k
w = build(HUGE, { asked: 1, cap: GEMINI, autoSubmit: true });
console.log(`  ${HUGE} chars → ${w.chunks} parts (auto max ${CONFIG.chunking.maxAutoParts}), overflow ${w.overflow}`);
check('huge: clamped at maxAutoParts', w.chunks, CONFIG.chunking.maxAutoParts);
check('huge: overflow is reported, not silent', w.overflow > 0, true);
check('huge: overflow is a sane number', w.overflow, w.longest - GEMINI);

// The user-facing cap must still bind what the user can ASK for.
w = build(T, { asked: 99, cap: null, autoSubmit: false });
check('asked 99 is clamped to maxParts', w.chunks, CONFIG.chunking.maxParts);

// ── the split nobody asked for ─────────────────────────────────────────────
// Picking "1 part" on a long video does NOT produce one message on Gemini: the
// composer would truncate it, so the split is forced. Two things follow, and
// both used to be wrong.
w = build(T, { asked: 1, cap: GEMINI, autoSubmit: true });
console.log(`\n  asked 1 → ${w.chunks} parts, ${w.parts.length} messages, auto ${w.autoSplit}`);
check('a forced split is flagged as automatic', w.autoSplit, true);
check('what the user asked for is preserved', w.asked, 1);
// "1 part" means "one summary". Leaving N partial summaries and no whole one
// answers a question nobody asked.
check('asked 1 ⇒ the merge is not optional', w.merged, true);
check('forced split appends exactly one merge message', w.parts.length, w.chunks + 1);
check('forced split builds the plan the content script needs', w.mergePlan?.count, w.chunks);

// The merge chip is HIDDEN at "1 part", so whatever it holds is left over from
// an earlier setting. It must not get a vote — that stale `false` used to strip
// the merge off a run the user could not even see the checkbox for.
w = build(T, { asked: 1, cap: GEMINI, autoSubmit: true, merge: false });
check('a stale merge=false cannot strip the merge off a forced split', w.merged, true);

// A deliberate split is the user's call, in both directions.
w = build(T, { asked: 4, cap: GEMINI, autoSubmit: true, merge: false });
check('asked 4 + merge off → no merge', w.merged, false);
check('asked 4 + merge off → no extra message', w.parts.length, w.chunks);
check('asked 4 + merge off → no plan', w.mergePlan, null);
w = build(T, { asked: 4, cap: GEMINI, autoSubmit: true, merge: true });
check('asked 4 + merge on → merge', w.merged, true);

// Raised beyond the request is still automatic; landing exactly on it is not.
w = build(SIX_HOURS, { asked: 4, cap: GEMINI, autoSubmit: true, merge: true });
check('raised above the asked count is flagged automatic', w.autoSplit, true);
w = build(T, { asked: 4, cap: null, autoSubmit: true, merge: true });
check('a split that came out as asked is not automatic', w.autoSplit, false);

// A transcript that fits is untouched by all of this — no phantom merge message.
w = build(6000, { asked: 1, cap: GEMINI, autoSubmit: true, merge: true });
check('short transcript → one message', w.parts.length, 1);
check('short transcript → nothing automatic', w.autoSplit, false);
check('short transcript → no merge, whatever the checkbox says', w.merged, false);

// ── no text may ever be lost when the cap is honoured ───────────────────────
const src = transcript(T);
w = build(T, { asked: 2, cap: GEMINI, autoSubmit: true });
const original = src.replace(/\s+/g, '');
// Each message is `prompt \n\n---\n\n note \n\n---\n\n slice`: take everything
// after the SECOND separator to get the transcript slice back.
const sliceOf = (p) => {
  const first = p.indexOf('\n\n---\n\n');
  return p.slice(p.indexOf('\n\n---\n\n', first + 1) + 7);
};
check('slices reconstruct the whole transcript, in order',
  w.parts.map(sliceOf).join('').replace(/\s+/g, ''), original);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
