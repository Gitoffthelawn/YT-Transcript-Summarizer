// Exercises the API-mode chunk+merge path (TESTING-TODO §4.1 / §7.4), which had
// never been run: `mergeApiPrompt` is a separate code path from the web merge,
// and the open question was whether the merge call receives ALL the partial
// summaries or only the last one.
//
// It drives the REAL background.js — real processJob, real summarizeTranscript,
// real callLLM — so every assertion below is about a body the extension would
// actually have put on the wire. See harness.mjs for what is stubbed and why.
import { install, boot, runJob, reset, saved, check, finish, makeTranscript } from './harness.mjs';

const TRANSCRIPT_LEN = 30000;
const LINES = TRANSCRIPT_LEN / 60;
const TRANSCRIPT = makeTranscript(TRANSCRIPT_LEN);

install({ transcript: TRANSCRIPT });

// ── fetch stub: records what the extension sends, replies as Anthropic would ──
let calls = [];
let failMerge = false;
const MERGE_MARK = 'riassunti parziali di parti consecutive';   // chunkNotes.it.mergeApi
const MERGE_MARK_EN = 'partial summaries of consecutive parts'; // chunkNotes.en.mergeApi

globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const isGemini = String(url).includes('generativelanguage.googleapis.com');
  const content = isGemini ? body.contents[0].parts[0].text : body.messages[0].content;
  const isMerge = content.includes(MERGE_MARK) || content.includes(MERGE_MARK_EN);
  calls.push({ url: String(url), content, isMerge });

  if (isMerge && failMerge) {
    return { ok: false, status: 400, text: async () => 'invalid_request_error: merge exploded' };
  }
  // Each reply is uniquely identifiable, so we can prove which of them reach the
  // merge call — the whole point of the exercise.
  const text = isMerge ? 'RIASSUNTO-UNIFICATO-FINALE' : `SOMMARIO-PARZIALE-${calls.length}`;
  const data = isGemini
    ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
    : { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
  return { ok: true, status: 200, json: async () => data };
};

await boot();

const BASE = {
  mode: 'api', provider: 'anthropic', model: 'claude-sonnet-5',
  apiKeys: { anthropic: 'sk-test' },
  prompt: 'Riassumi questo video.',
  transcriptLang: 'it', chunkParts: 3, chunkMerge: true,
};

async function run(extra) {
  calls = [];
  reset();
  const row = await runJob({ ...BASE, ...extra });
  return { row, md: saved.join('\n\n') };
}

// ── Run 1: 3 parts + merge, everything succeeds (IT) ─────────────────────────
let { row, md } = await run({});
const chunkCalls = calls.filter(c => !c.isMerge);
const mergeCalls = calls.filter(c => c.isMerge);

console.log(`\n  ${calls.length} API calls: ${chunkCalls.length} chunk + ${mergeCalls.length} merge`);

check('3 chunk calls', chunkCalls.length, 3);
check('exactly one merge call', mergeCalls.length, 1);
check('every call went to the Anthropic endpoint',
  calls.every(c => c.url === 'https://api.anthropic.com/v1/messages'), true);

// Each chunk call must carry its own "parte i di n" note and its own slice.
check('chunk 1 announces part 1 of 3', chunkCalls[0]?.content.includes('parte 1 di 3'), true);
check('chunk 3 announces part 3 of 3', chunkCalls[2]?.content.includes('parte 3 di 3'), true);
check('chunk 1 carries the start of the transcript', chunkCalls[0]?.content.includes('[0000]'), true);
check('chunk 3 carries the end of the transcript',
  chunkCalls[2]?.content.includes(`[${String(LINES - 1).padStart(4, '0')}]`), true);
check('the chunks together cover the whole transcript',
  chunkCalls.reduce((n, c) => n + (c.content.match(/^\[\d{4}\]/gm) || []).length, 0), LINES);

// ── The question §7.4 actually asks ──────────────────────────────────────────
const mergeBody = mergeCalls[0]?.content ?? '';
check('merge receives partial 1', mergeBody.includes('SOMMARIO-PARZIALE-1'), true);
check('merge receives partial 2', mergeBody.includes('SOMMARIO-PARZIALE-2'), true);
check('merge receives partial 3 (not ONLY this one)', mergeBody.includes('SOMMARIO-PARZIALE-3'), true);
check('merge carries the part headings', (mergeBody.match(/## Parte \d\/3/g) || []).length, 3);
check('merge does NOT re-send the raw transcript', mergeBody.includes('[0000] parlato'), false);
check('merge does NOT carry the per-chunk instruction', mergeBody.includes('parte 1 di 3'), false);
check('merge keeps the user prompt above the merge note',
  mergeBody.indexOf('Riassumi questo video.') < mergeBody.indexOf(MERGE_MARK), true);

// ── What the user ends up with ───────────────────────────────────────────────
check('job completed', row?.statusText, '✅ Completed: Video di prova');
check('the saved file holds the merged summary', md.includes('RIASSUNTO-UNIFICATO-FINALE'), true);
check('the saved file drops the partials the merge replaced', md.includes('SOMMARIO-PARZIALE-1'), false);
check('the banner says the parts were merged',
  md.includes('split into 3 parts and the partial summaries were merged in a final API call'), true);

// ── Run 2: the merge call fails — the 3 good calls must not be thrown away ───
failMerge = true;
({ row, md } = await run({ transcriptLang: 'en' }));
failMerge = false;

console.log(`\n  merge failure run: ${calls.length} API calls`);
check('still one merge attempt', calls.filter(c => c.isMerge).length, 1);
check('merge failure is not retried (400 is not retriable)', calls.length, 4);
check('job still completes', row?.status, 'done');
check('the partial summaries are kept', md.includes('SOMMARIO-PARZIALE-1') && md.includes('SOMMARIO-PARZIALE-3'), true);
check('the failure is disclosed in the file', md.includes('The final merge call failed'), true);
check('the banner does not claim a merge happened',
  md.includes('the partial summaries were merged in a final API call'), false);

// ── Run 3: merge off — no extra call at all ──────────────────────────────────
({ row, md } = await run({ chunkMerge: false }));
check('merge off → 3 calls, no merge', calls.length, 3);
check('merge off → all partials kept',
  md.includes('SOMMARIO-PARZIALE-1') && md.includes('SOMMARIO-PARZIALE-3'), true);
check('merge off → banner says separate calls',
  md.includes('each summarized in a separate API call'), true);

// ── The API path must be untouched by the web composer cap (fix A) ───────────
// Gemini's 32 000-char composer limit has no business shrinking an API call.
({ row, md } = await run({ provider: 'gemini', model: 'gemini-2.0-flash', apiKeys: { gemini: 'k' }, chunkParts: 1, chunkMerge: false }));
check('API mode ignores the composer cap → one call', calls.length, 1);
check('API mode sent the whole 30k transcript in it',
  (calls[0].content.match(/^\[\d{4}\]/gm) || []).length, LINES);

finish();
