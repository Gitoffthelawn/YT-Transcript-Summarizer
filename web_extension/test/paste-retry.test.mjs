// The three ways the paste path could send the same transcript twice.
//
// Every one of them is a retry that was safe in theory and not in practice:
//
//   §A  ytsSendOne retries a paste it "did not see land" in 15 s. Not seeing it
//       is not the same as it not being there — a slow editor gets a SECOND copy
//       stacked under the first, and one message goes out carrying the prompt
//       and the whole transcript twice.
//   §B  a failed run hands the payload back to storage so a reload can retry.
//       When the text is already sitting in the composer, "not submitted" often
//       just means we could not tell — and the replay posts it all again.
//   §C  the payload is one global key, so the next video in a web batch
//       overwrites it. A chat tab still booting would claim the WRONG video's
//       transcript and report it under the wrong job.
//
// This runs the REAL paste_common.js. Time is virtual: the file's own sleeps
// drive a fake clock, so a 15 s window costs nothing to test.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0;
function check(name, actual, expect) {
  const ok = actual === expect;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${JSON.stringify(expect)}\n      actual:   ${JSON.stringify(actual)}`);
}

// ── a virtual clock ──────────────────────────────────────────────────────────
// Every ytsSleep(ms) advances it by ms and resumes immediately. Deadlines built
// from Date.now() therefore behave exactly as they would in a browser, at no
// wall-clock cost.
let clock = 1_700_000_000_000;
function makeContext({ storage = {}, timeOrigin = clock - 1000 } = {}) {
  const store = { ...storage };
  const dom = { nodes: {} };

  class FakeDataTransfer {
    constructor() { this._d = new Map(); }
    setData(t, v) { this._d.set(t, v); }
    getData(t) { return this._d.get(t) || ''; }
  }
  class FakeClipboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.clipboardData = init.clipboardData || null;
      this.defaultPrevented = false;
    }
    preventDefault() { this.defaultPrevented = true; }
  }

  const ctx = vm.createContext({
    console,
    store,
    dom,
    Date: new Proxy(Date, { get: (t, p) => (p === 'now' ? () => clock : Reflect.get(t, p)) }),
    performance: { timeOrigin },
    setTimeout: (fn, ms) => { clock += ms || 0; return setImmediate(fn); },
    clearTimeout: (id) => clearImmediate(id),
    MutationObserver: class { observe() {} disconnect() {} },
    Event: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    DataTransfer: FakeDataTransfer,
    ClipboardEvent: FakeClipboardEvent,
    document: {
      querySelector: (sel) => (dom.nodes[sel] || [])[0] || null,
      querySelectorAll: (sel) => dom.nodes[sel] || [],
      documentElement: {},
      execCommand: () => false,
      createRange: () => ({ selectNodeContents() {} }),
    },
    window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    chrome: {
      storage: {
        local: {
          async get(keys) {
            const k = keys == null ? Object.keys(store) : [].concat(keys);
            const out = {};
            for (const key of k) if (key in store) out[key] = structuredClone(store[key]);
            return out;
          },
          async set(obj) { Object.assign(store, structuredClone(obj)); },
          async remove(key) { for (const k of [].concat(key)) delete store[k]; },
        },
      },
      runtime: { sendMessage() {} },
    },
  });
  vm.runInContext(readFileSync(new URL('../paste_common.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

/**
 * A composer that takes the paste but does not SHOW it for `delays[i]` ms — the
 * shape of a chat page still mounting under a 100 kB paste.
 */
function makeEditor(delays) {
  let revealAt = Infinity;
  let n = 0;
  return {
    text: '',                       // what is really in there, visible or not
    offsetParent: {},
    focus() {},
    closest: () => null,            // no <form> around it, like every chat page
    get innerText() { return clock >= revealAt ? this.text : ''; },
    dispatchEvent(ev) {
      if (ev.type !== 'paste') return true;
      this.text += ev.clipboardData.getData('text/plain');
      revealAt = clock + (delays[n] ?? 0);
      n++;
      ev.preventDefault();
      return false;                 // the framework handled it (ProseMirror-like)
    },
    clear() { this.text = ''; revealAt = Infinity; },
  };
}

const PAYLOAD = 'Riassumi il video.\n\n---\n\n' + 'trascrizione '.repeat(400);
const occurrences = (hay, needle) => hay.split(needle).length - 1;

// ── §A  a slow first paste must not be doubled ───────────────────────────────
{
  const ctx = makeContext();
  // 25 s to appear: past the 15 s the first attempt waits, so the retry fires.
  const editor = makeEditor([25000, 0]);
  ctx.dom.nodes['.composer'] = [editor];
  // ytsClearInput reaches the editor through the DOM contract, not our helper.
  ctx.document.execCommand = (cmd) => { if (cmd === 'delete') { editor.clear(); return true; } return false; };

  const cfg = { inputSelectors: ['.composer'], sendSelectors: ['.send'], stopSelectors: [] };
  const res = await ctx.ytsSendOne(cfg, PAYLOAD, false);

  check('§A the text does reach the editor', res.landed, true);
  check('§A it is there exactly once, not twice',
    occurrences(editor.text, 'Riassumi il video.'), 1);
  check('§A and it is the whole message, not a fragment', editor.text, PAYLOAD);
}

// ── §A′ the normal case is untouched: no clear, no second paste ──────────────
{
  const ctx = makeContext();
  const editor = makeEditor([0]);
  ctx.dom.nodes['.composer'] = [editor];
  const res = await ctx.ytsSendOne({ inputSelectors: ['.composer'], sendSelectors: ['.send'] }, PAYLOAD, false);
  check('§A′ a prompt editor still gets exactly one copy',
    res.landed && editor.text === PAYLOAD, true);
}

// ── §B  a payload whose text is already in the composer is not left to replay ─
{
  const ctx = makeContext();
  const editor = makeEditor([0]);
  ctx.dom.nodes['.composer'] = [editor];
  ctx.store.pendingLLMContent = {
    parts: [PAYLOAD], text: PAYLOAD, autoSubmit: true, jobId: 'j1', ts: clock - 5000,
  };
  // No send button and no way to tell the message left: `submitted` stays false
  // while the text sits in the composer — the exact ambiguous case.
  await ctx.ytsRunPaste({ inputSelectors: ['.composer'], sendSelectors: ['.nope'], stopSelectors: [] });

  check('§B the text landed', occurrences(editor.text, 'Riassumi il video.') > 0, true);
  check('§B the payload is NOT left behind for a second tab to replay',
    'pendingLLMContent' in ctx.store, false);
}

// ── §B′ nothing landed at all → the payload IS kept, for one retry ───────────
{
  const ctx = makeContext();
  ctx.dom.nodes['.composer'] = [];        // the editor never appears
  ctx.store.pendingLLMContent = {
    parts: [PAYLOAD], text: PAYLOAD, autoSubmit: true, jobId: 'j1', ts: clock - 5000,
  };
  await ctx.ytsRunPaste({ inputSelectors: ['.composer'], sendSelectors: ['.send'] });
  check('§B′ a payload that reached nothing survives for a reload',
    ctx.store.pendingLLMContent?.parts?.length, 1);
  check('§B′ the failed attempt is counted', ctx.store.pendingLLMContent?.attempts, 1);
  check('§B′ the claim is released so the retry can take it',
    ctx.store.pendingLLMContent?.claimedBy, undefined);

  // ...but only once. A transcript nobody wants any more must not keep pasting
  // itself into whatever the user opens next.
  await ctx.ytsRunPaste({ inputSelectors: ['.composer'], sendSelectors: ['.send'] });
  check('§B′ the second failure retires the payload',
    'pendingLLMContent' in ctx.store, false);
}

// ── §C  a payload staged after this tab opened belongs to another tab ────────
{
  // The background writes the payload and only THEN calls tabs.create, so a
  // payload newer than this document was meant for a tab that is still opening.
  const ctx = makeContext({ timeOrigin: clock - 60000 });
  ctx.store.pendingLLMContent = {
    parts: ['video 2'], text: 'video 2', autoSubmit: true, jobId: 'j2', ts: clock - 1000,
  };
  check('§C a tab does not steal the next video\'s transcript',
    await ctx.ytsClaimPending(), null);
  check('§C ...and leaves it in storage for the tab it belongs to',
    ctx.store.pendingLLMContent?.jobId, 'j2');

  // The tab it WAS meant for opened after it was staged, and claims it normally.
  const mine = makeContext({ timeOrigin: clock - 500 });
  mine.store.pendingLLMContent = {
    parts: ['video 2'], text: 'video 2', autoSubmit: true, jobId: 'j2', ts: clock - 1000,
  };
  const claimed = await mine.ytsClaimPending();
  check('§C the tab it was staged for claims it', claimed?.parts?.[0], 'video 2');
  check('§C and the claim carries the job id', claimed?.jobId, 'j2');
}

// ── the TTL still governs everything ─────────────────────────────────────────
{
  const ctx = makeContext({ timeOrigin: clock });
  ctx.store.pendingLLMContent = {
    parts: ['vecchio'], text: 'vecchio', autoSubmit: true, jobId: 'j9', ts: clock - 6 * 60 * 1000,
  };
  check('an expired payload is refused', await ctx.ytsClaimPending(), null);
  check('...and dropped, not left to rot', 'pendingLLMContent' in ctx.store, false);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
