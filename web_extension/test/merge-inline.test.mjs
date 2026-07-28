// The web-mode merge fix: the content script reads the partial answers off the
// page and pastes them INTO the merge request, instead of asking the model to
// re-read its own earlier turns (observed 2026-07-27: Gemini fused only parts
// 3 and 4 of 4). This suite runs the REAL paste_common.js — the file is loaded
// into a vm context with a stub DOM, since it is a plain content script with no
// exports and no top-level side effects.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildChunkMessages } from '../modules/llm-api.js';

let failures = 0;
function check(name, actual, expect) {
  const ok = actual === expect;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${JSON.stringify(expect)}\n      actual:   ${JSON.stringify(actual)}`);
}

// ── load the real content script ─────────────────────────────────────────────
const src = readFileSync(new URL('../paste_common.js', import.meta.url), 'utf8');
let dom = { };   // selector → array of node-likes, swapped per test
const ctx = vm.createContext({
  console,
  document: {
    querySelectorAll: (sel) => dom[sel] || [],
    querySelector: (sel) => (dom[sel] || [])[0] || null,
  },
  chrome: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } },
  setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} },
});
vm.runInContext(src, ctx);
const { ytsBuildMergeMessage, ytsReadLastReply, ytsTrimTo,
        ytsCountAttachments, ytsWaitForLanded, ytsWaitForSubmitted } = ctx;

// ── the plan really comes out of the real message builder ────────────────────
const transcript = Array.from({ length: 400 }, (_, i) => `line ${i} ${'lorem ipsum dolor sit amet '.repeat(8)}`).join('\n');
const web = buildChunkMessages(transcript, {
  prompt: 'Riassumi il video.', transcriptLang: 'it', chunkParts: 4,
  chunkMerge: true, maxMessageChars: 32000, splitToFit: true,
});
check('merge run produces chunks + 1 messages', web.parts.length, web.chunks + 1);
check('mergePlan points at the last message', web.mergePlan.at, web.parts.length - 1);
check('mergePlan counts the chunks', web.mergePlan.count, web.chunks);
check('mergePlan carries the composer cap', web.mergePlan.cap, 32000);
check('mergePlan is null without merge',
  buildChunkMessages(transcript, { prompt: 'p', chunkParts: 4, chunkMerge: false }).mergePlan, null);

const plan = { ...web.mergePlan, count: 4, at: 4 };
const reply = i => `Sintesi parziale ${i}. ` + `contenuto distintivo ${i} `.repeat(60);
const replies = [1, 2, 3, 4].map(reply);

// ── the whole point: every partial answer is in the message ──────────────────
const msg = ytsBuildMergeMessage(plan, replies);
check('inlined merge keeps ALL four partials',
  replies.every(r => msg.includes(r)), true);
check('inlined merge labels each part in the transcript language',
  [1, 2, 3, 4].every(i => msg.includes(`## Parte ${i}/4`)), true);
check('inlined merge opens with the merge instruction', msg.startsWith(plan.head), true);
check('inlined merge no longer says "qui sopra"', msg.includes('qui sopra'), false);

// ── refusing to inline is a real outcome, not an accident ────────────────────
check('a missing answer → fall back to the message already in the queue',
  ytsBuildMergeMessage(plan, replies.slice(0, 3)), null);
check('an extra answer (mis-alignment) → fall back',
  ytsBuildMergeMessage(plan, [...replies, reply(5)]), null);
check('a composer too small to hold real summaries → fall back',
  ytsBuildMergeMessage({ ...plan, cap: 1200 }, replies), null);
check('no plan → fall back', ytsBuildMergeMessage(null, replies), null);

// ── the cap is respected, and what it costs is visible ───────────────────────
const tight = ytsBuildMergeMessage({ ...plan, cap: 4000 }, replies);
check('capped merge stays inside the composer', tight.length <= 4000, true);
check('capped merge still carries all four parts',
  [1, 2, 3, 4].every(i => tight.includes(`Sintesi parziale ${i}.`)), true);
check('capped merge marks the cuts', tight.includes('[…]'), true);
check('uncapped merge is left whole', ytsBuildMergeMessage({ ...plan, cap: 0 }, replies).includes('[…]'), false);

check('trim keeps short text untouched', ytsTrimTo('abc', 100), 'abc');
check('trim never exceeds the budget', ytsTrimTo('x'.repeat(500), 100).length <= 100, true);

// ── reading the answer off the page ──────────────────────────────────────────
const long = 'a'.repeat(500);
dom = { '.model-response-text': [{ innerText: long + '1' }, { innerText: long + '2' }] };
check('reads the NEWEST answer', ytsReadLastReply({ replySelectors: ['.model-response-text'] }), long + '2');
check('unknown selectors → empty, not a wrong answer',
  ytsReadLastReply({ replySelectors: ['.nope'] }), '');
check('no replySelectors at all → empty', ytsReadLastReply({}), '');

// A spinner or a "thinking…" stub must never be mistaken for a summary: it would
// be inlined as if it were one, which is worse than falling back.
dom = { '.model-response-text': [{ innerText: long }, { innerText: 'Sto pensando…' }] };
check('skips a too-short node and takes the real answer',
  ytsReadLastReply({ replySelectors: ['.model-response-text'] }), long);

// ── fix L: Claude answers a big paste with an attachment, not with text ──────
// Reading only the composer made every long web run on Claude fail outright.
const CLAUDE = {
  inputSelectors: ['.ProseMirror'],
  attachmentSelectors: ['[data-testid="file-thumbnail"]'],
};
const empty = { innerText: '' };
const payload = 'Riassumi il seguente video.' + ' x'.repeat(500);

dom = { '.ProseMirror': [empty], '[data-testid="file-thumbnail"]': [] };
check('no attachment yet → count is 0', ytsCountAttachments(CLAUDE), 0);

// The paste produced a chip and left the composer empty: that IS the text arriving.
dom['[data-testid="file-thumbnail"]'] = [{}];
let landed = await ytsWaitForLanded(CLAUDE, empty, payload, 0, 1000);
check('attachment counts as landed', !!landed && landed.attached, true);

// A chip that was already there before we pasted proves nothing.
landed = await ytsWaitForLanded(CLAUDE, empty, payload, 1, 800);
check('pre-existing attachment is not our paste', landed, null);

// Text in the composer still wins, and is not reported as an attachment.
dom = { '.ProseMirror': [{ innerText: payload }], '[data-testid="file-thumbnail"]': [] };
landed = await ytsWaitForLanded(CLAUDE, dom['.ProseMirror'][0], payload, 0, 1000);
check('text in the composer → landed, not attached', !!landed && landed.attached, false);

// Submitting: with an attachment the composer is empty from the start, so the
// "composer emptied" rule would declare success before anything was sent — the
// fix H bug rebuilt. The chip going away is the real signal.
dom = { '.ProseMirror': [empty], '[data-testid="file-thumbnail"]': [{}] };
check('attachment still there → not submitted',
  await ytsWaitForSubmitted(CLAUDE, payload, 800, 0), false);
dom['[data-testid="file-thumbnail"]'] = [];
check('attachment gone → submitted',
  await ytsWaitForSubmitted(CLAUDE, payload, 800, 0), true);

// A provider that declares no attachment selectors is untouched by all of this.
check('no attachmentSelectors → count is 0', ytsCountAttachments({ inputSelectors: [] }), 0);

// ── fix N: the same answer must never be counted twice ──────────────────────
// A merge carrying partial 1 twice looks perfect — status ✅, partials inlined —
// while half the video is missing. That is exactly the bug this all started from.
const { ytsReadNewReply } = ctx;
const answer1 = ('Sintesi della parte 1. ' + 'contenuto uno '.repeat(60)).trim();
const answer2 = ('Sintesi della parte 2. ' + 'contenuto due '.repeat(60)).trim();
const CFG = { replySelectors: ['.reply'] };

dom = { '.reply': [{ innerText: answer1 }] };
check('first answer is taken as is', await ytsReadNewReply(CFG, '', 1000), answer1);

dom = { '.reply': [{ innerText: answer1 }, { innerText: answer2 }] };
check('a genuinely new answer is taken', await ytsReadNewReply(CFG, answer1, 1000), answer2);

// The page still shows the previous part's answer: waiting is right, reusing is not.
dom = { '.reply': [{ innerText: answer1 }] };
check('unchanged answer → nothing, rather than a duplicate',
  await ytsReadNewReply(CFG, answer1, 1200), '');

// When the message became an attachment the instruction went in with it, and the
// model saw a file and no request. This is the text put back in the composer.
const { ytsInstructionHead } = ctx;
const chunkMsg = 'Riassumi il video.\n\n---\n\nQuesta è la parte 1 di 4…\n\n---\n\nTRASCRIZIONE…';
check('instruction head stops at the first separator', ytsInstructionHead(chunkMsg), 'Riassumi il video.');
check('no separator → nothing to re-type (never guess)', ytsInstructionHead('solo testo'), '');
check('head too long to be safe → skip rather than make a second attachment',
  ytsInstructionHead('x'.repeat(5000) + '\n\n---\n\ncoda'), '');

// ── ytsPasteText must survive Gecko's ClipboardEvent ─────────────────────────
// Firefox ignores `clipboardData` passed to the ClipboardEvent constructor. A
// rich-text editor then receives an EMPTY clipboard, calls preventDefault() anyway,
// and ytsPasteText read that as "the framework handled it" — returning true having
// inserted nothing. Measured live on Firefox 153 (test/e2e/gecko-paste.mjs):
// 0 of 2019 characters landed on a ProseMirror-like editor, with a true return.
// This reproduces the Gecko semantics so the regression cannot come back quietly.
class GeckoDataTransfer {
  constructor() { this._d = new Map(); }
  setData(type, val) { this._d.set(type, val); }
  getData(type) { return this._d.get(type) || ''; }
}
class GeckoClipboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.defaultPrevented = false;
    this.clipboardData = null;   // ← Gecko drops init.clipboardData on the floor
  }
  preventDefault() { this.defaultPrevented = true; }
}
ctx.DataTransfer = GeckoDataTransfer;
ctx.ClipboardEvent = GeckoClipboardEvent;
// If Method 2 were reached here it would mask the bug, so make it a no-op: this test
// is about Method 1 delivering the text, which is the only path a rich editor takes.
ctx.document.execCommand = () => false;

const { ytsPasteText } = ctx;
const PASTE = 'Parte 1 di 2\n\n---\n\n' + 'y'.repeat(500);

// A ProseMirror-like editor: takes over the paste and inserts the text itself.
const editor = {
  innerText: '',
  dispatchEvent(ev) {
    const t = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
    this.innerText += t;
    ev.preventDefault();
    return !ev.defaultPrevented;
  },
};
const pasted = ytsPasteText(editor, PASTE);
check('Gecko: intercepting editor receives the whole text', editor.innerText, PASTE);
check('Gecko: ytsPasteText reports success', pasted, true);

// The pair matters: a `true` return with an empty editor is the exact shape of the bug.
check('Gecko: success is not claimed over an empty editor',
  pasted === true && editor.innerText.length === 0, false);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
