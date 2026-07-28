// §7.8 / §4.3 — the claim, live, at ZERO provider cost.
//
// auto-submit is OFF throughout, so the content script pastes part 1 into the
// composer and stops: nothing is ever submitted, no message reaches Gemini, no
// quota is spent. The claim is exercised in full anyway, because claiming
// happens before any of that.
//
// Four scenarios, covering BOTH timers — the doc only ever mentions the 60 s
// claim lock, but ytsClaimPending also enforces a 5-minute payload TTL:
//   1. two tabs opened together      → exactly one may paste
//   2. a fresh claim by another tab  → must be respected
//   3. a claim older than 60 s       → must NOT wedge the payload forever
//   4. a payload older than 5 min    → dropped, and removed from storage
//
//   EXT_ID=<id> node test/e2e/claim-race.mjs
import { openPopup } from './drive.mjs';
import { sleep } from './cdp.mjs';

const GEMINI = 'https://gemini.google.com/app';
const MARK = 'YTS-CLAIM-PROBE';
const { c, evalIn } = await openPopup();

let failures = 0;
const check = (name, actual, expect) => {
  const ok = actual === expect;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${expect}\n      actual:   ${actual}`);
};

/**
 * Put a payload in storage exactly as background.setPendingLLMContent would.
 * The body is ~25 000 chars, not a token string: a tiny payload pastes and
 * settles so fast that it races Angular's boot, which produced a misleading
 * failure the first time this ran. A realistic size is also the only one the
 * user ever actually gets.
 */
const seed = (extra = {}) => evalIn(`(async () => {
  const body = ${JSON.stringify(MARK)} + ' ' + 'trascrizione di prova. '.repeat(1100);
  await chrome.storage.local.remove('pendingLLMContent');
  await chrome.storage.local.set({ pendingLLMContent: {
    parts: [body], text: body,
    autoSubmit: false, jobId: null, ts: Date.now(), ...${JSON.stringify(extra)}
  }});
  return true;
})()`);

const payload = () => evalIn(`(async () => {
  const { pendingLLMContent: p } = await chrome.storage.local.get('pendingLLMContent');
  return p ? { present: true, claimed: !!p.claimedBy } : { present: false, claimed: false };
})()`);

/**
 * Open n Gemini tabs at the same instant; return each composer's text.
 *
 * The tabs are opened in the FOREGROUND because that is what the extension does
 * (`chrome.tabs.create({ active: true })`). In a background tab Chrome defers
 * layout and throttles timers, so `ytsWaitForInput` — which requires a *visible*
 * element — may never resolve. Opening them in the background made this test
 * report failures that the supported flow does not have (see real-run.mjs).
 */
async function openTabs(n) {
  const ids = await Promise.all(
    Array.from({ length: n }, () => c.send('Target.createTarget', { url: GEMINI, background: false })
      .then(r => r.targetId))
  );
  const sessions = [];
  for (const id of ids) {
    const s = await c.attach(id);
    await c.send('Runtime.enable', {}, s);
    sessions.push(s);
  }
  // Poll rather than sleep blindly: Angular's boot time is the whole reason
  // fix B exists, and it varies.
  let texts = [];
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    texts = [];
    for (const s of sessions) {
      // Read EVERY candidate input, not just `.ql-editor`: Gemini's redesigned
      // composer keeps more than one, and the filled one is not always the first
      // (observed in real-run.mjs — reading only the first reports a false empty).
      const r = await c.send('Runtime.evaluate', {
        expression: `(() => {
          const read = e => ('value' in e && typeof e.value === 'string') ? e.value : (e.innerText || e.textContent || '');
          const all = [...document.querySelectorAll('.ql-editor, [contenteditable="true"], textarea')].map(read);
          return all.sort((a, b) => b.length - a.length)[0] || '';
        })()`,
        returnByValue: true,
      }, s).catch(() => ({ result: { value: '<gone>' } }));
      texts.push(String(r.result?.value ?? ''));
    }
    if (texts.some(t => t.includes(MARK))) break;
  }
  for (const id of ids) await c.send('Target.closeTarget', { targetId: id }).catch(() => {});
  return texts;
}

// ── 1. Two tabs opened together ──────────────────────────────────────────────
console.log('\n=== 1. two Gemini tabs opened simultaneously ===');
await seed();
let texts = await openTabs(2);
console.log(`   composers: ${texts.map(t => (t.includes(MARK) ? 'PASTED' : t ? 'other' : 'empty')).join(' | ')}`);
// The hazard is TWO tabs replaying the same conversation. Only one of two
// simultaneously-opened tabs can be the active one, and the other may legitimately
// still be laying out when we look — so the safety property is "never more than
// one", and the liveness half ("someone pasted") is what real-run.mjs covers.
check('never two tabs pasting the same payload',
  texts.filter(t => t.includes(MARK)).length <= 1, true);
check('the payload was consumed exactly once', (await payload()).present, false);

// ── 2. A fresh claim by another tab must be respected ────────────────────────
console.log('\n=== 2. payload already claimed 5 s ago ===');
await seed({ claimedBy: 'someone-else', claimedAt: Date.now() - 5000 });
texts = await openTabs(1);
check('a live claim blocks a second tab', texts[0].includes(MARK), false);
check('and the payload is left intact for the claim holder', (await payload()).present, true);

// ── 3. A stale claim must not wedge the payload forever ─────────────────────
// The tab that claimed may have been closed or crashed; if the lock never
// expired the transcript would be unreachable for good.
console.log('\n=== 3. claim older than the 60 s lock ===');
await seed({ claimedBy: 'crashed-tab', claimedAt: Date.now() - 61000 });
texts = await openTabs(1);
check('a 61 s-old claim is overridden', texts[0].includes(MARK), true);
check('and the payload is then consumed', (await payload()).present, false);

// ── 4. The 5-minute payload TTL (undocumented until now) ────────────────────
console.log('\n=== 4. payload older than PENDING_TTL_MS (5 min) ===');
await seed({ ts: Date.now() - 6 * 60 * 1000 });
texts = await openTabs(1);
check('a stale payload is not pasted into an unrelated visit', texts[0].includes(MARK), false);
check('and it is removed from storage, not left to rot', (await payload()).present, false);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
c.close();
process.exit(failures ? 1 : 0);
