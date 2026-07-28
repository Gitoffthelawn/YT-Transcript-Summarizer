// Can the extension attach the transcript as a FILE instead of typing it in?
//
// §4.4 answered "no, on Gemini" and closed the question with a condition:
//
//     «Se un domani Gemini esporrà un input file vero, il test da rifare è
//      quello posizionale sul suo modello, e la questione si riapre.»
//
// This is that test, made repeatable — Gemini redesigns its composer without
// warning (§2), and the answer is a property of THEIR markup, not of ours. It
// re-runs the three probes and prints a verdict:
//
//   1. is there a real <input type=file> anywhere — light DOM *and* every open
//      shadow root — at rest, and after opening the upload menu?
//   2. does a synthetic drop produce an attachment chip?
//   3. if an input exists: does assigning `input.files` produce a chip?
//
// It clicks the menu but NEVER the "Upload files" item: that opens a native OS
// picker, which no automation can close. Nothing is ever submitted, no message
// is sent, no quota is spent.
//
//   node test/e2e/upload-probe.mjs [gemini|anthropic|openai]
//
// The profile is persistent (../yts-probe-profile), so you sign in ONCE and
// every later run reuses it. Signed out, the upload UI is gated behind
// "Sign in to try tools" and the result is inconclusive — the script says so
// rather than reporting a false negative.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { connect, sleep } from './cdp.mjs';

const PROVIDER = (process.argv[2] || 'gemini').toLowerCase();
const SITES = {
  gemini:    { url: 'https://gemini.google.com/app', composer: 'div.ql-editor[contenteditable="true"], div[contenteditable="true"]' },
  anthropic: { url: 'https://claude.ai/new',         composer: 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"]' },
  openai:    { url: 'https://chatgpt.com/',          composer: '#prompt-textarea, div[contenteditable="true"], textarea' },
};
const site = SITES[PROVIDER];
if (!site) throw new Error(`unknown provider: ${PROVIDER}`);

// A Chrome profile is ~50 MB and has to persist across runs (that is the point:
// you sign in once). It does not belong next to the source — LOCALAPPDATA is
// where a throwaway-but-persistent profile goes on Windows.
const profile = resolve(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'yts-probe-profile');
const PORT = 9336;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', site.url,
], { stdio: 'ignore' });

await sleep(6000);
const cdp = await connect(PORT);
const targets = await cdp.targets();
const page = targets.find(t => t.type === 'page' && t.url.includes(new URL(site.url).host));
if (!page) { console.log('the provider tab never opened'); chrome.kill(); process.exit(1); }
const s = await cdp.attach(page.targetId);
await cdp.send('Runtime.enable', {}, s);

const ev = async (fn, arg) => {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`,
    returnByValue: true, awaitPromise: true,
  }, s);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};

// Walks the light DOM and every OPEN shadow root. A closed shadow root cannot be
// reached from a content script either, so what this misses, the extension
// misses too — which is the question being asked.
const scanFileInputs = function () {
  const found = [];
  const seen = new Set();
  const walk = (root, path) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    let all;
    try { all = root.querySelectorAll('*'); } catch { return; }
    for (const el of all) {
      if (el.tagName === 'INPUT' && el.type === 'file') {
        found.push({ path, id: el.id || null, cls: String(el.className).slice(0, 50), accept: el.accept });
      }
      if (el.shadowRoot) walk(el.shadowRoot, path + ' > ' + el.tagName.toLowerCase() + '::shadow');
    }
  };
  walk(document, 'document');
  return found;
};

await sleep(4000);

// ── is this session usable at all? ───────────────────────────────────────────
let signedOut = await ev(function () {
  return /sign in to try|accedi per provare/i.test(document.body.innerText);
});
if (signedOut) {
  console.log(`\n⚠️  ${PROVIDER}: signed out — the upload menu is gated, so a "no" here would mean nothing.`);
  console.log('    Sign in in the window that just opened, then press Enter here (the profile is kept).');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('    ready> ');
  rl.close();
  await ev(function () { location.reload(); });
  await sleep(8000);
  signedOut = await ev(function () {
    return /sign in to try|accedi per provare/i.test(document.body.innerText);
  });
}

const out = { provider: PROVIDER, signedOut };

// ── probe 1: a real file input, at rest and with the menu open ───────────────
out.atRest = await ev(scanFileInputs);

out.menuOpened = await ev(async function () {
  const btn = [...document.querySelectorAll('button[aria-label], button')]
    .find(b => /upload|attach|allega|carica|tools|add files|plus/i.test(
      (b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')));
  if (!btn) return false;
  btn.click();                       // opens the MENU only — never the picker
  await new Promise(r => setTimeout(r, 2000));
  return true;
});
out.afterMenu = await ev(scanFileInputs);

// ── probe 2: does a synthetic drop land? ─────────────────────────────────────
out.drop = await ev(async function (composerSel) {
  const text = 'L000001 riga di prova per la sonda upload.\n'.repeat(300);
  const file = new File([text], 'yts-upload-probe.txt', { type: 'text/plain' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = document.querySelector(composerSel);
  if (!target) return { error: 'no composer' };
  const zone = target.closest('div[class*="input" i], form') || target;
  let prevented = null;
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
    const ok = zone.dispatchEvent(e);
    if (type === 'drop') prevented = !ok;
  }
  await new Promise(r => setTimeout(r, 6000));
  return { preventDefaulted: prevented, chip: /yts-upload-probe/i.test(document.body.innerText) };
}, site.composer);

// ── probe 3: assigning input.files, if there is anything to assign ───────────
out.assign = (out.atRest.length || out.afterMenu.length)
  ? await ev(async function () {
      const inputs = [];
      const seen = new Set();
      const walk = (root) => {
        if (!root || seen.has(root)) return;
        seen.add(root);
        let all; try { all = root.querySelectorAll('*'); } catch { return; }
        for (const el of all) {
          if (el.tagName === 'INPUT' && el.type === 'file') inputs.push(el);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      if (!inputs.length) return { error: 'no input' };
      const text = 'L000001 riga di prova per la sonda upload.\n'.repeat(300);
      const file = new File([text], 'yts-assign-probe.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      let assigned = false;
      try { inputs[0].files = dt.files; assigned = inputs[0].files.length === 1; } catch (e) { return { error: String(e) }; }
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 6000));
      return { assigned, chip: /yts-assign-probe/i.test(document.body.innerText) };
    })
  : { skipped: 'no file input to assign to' };

// ── verdict ──────────────────────────────────────────────────────────────────
const inputs = out.atRest.length + out.afterMenu.length;
const works = out.drop?.chip === true || out.assign?.chip === true;

console.log(`\n=== upload probe — ${PROVIDER} ===`);
console.log(`signed out ................ ${out.signedOut ? 'YES — result is INCONCLUSIVE' : 'no'}`);
console.log(`<input type=file> at rest .. ${out.atRest.length}`);
console.log(`  ...with the menu open .... ${out.afterMenu.length}${out.menuOpened ? '' : '  (no menu button found)'}`);
for (const i of [...out.atRest, ...out.afterMenu]) console.log(`      ${i.path}  accept=${i.accept}`);
console.log(`synthetic drop ............ preventDefaulted=${out.drop?.preventDefaulted}  chip=${out.drop?.chip}`);
console.log(`input.files assignment .... ${JSON.stringify(out.assign)}`);
console.log(`\nverdict: ${
  out.signedOut ? 'INCONCLUSIVE — sign in and re-run'
  : works ? '✅ ATTACHING WORKS — §4.4 reopens: run the positional test on the model next'
  : `❌ still unreachable (${inputs} file inputs, no chip) — §4.4 stands, the split stays necessary`}`);

cdp.close();
chrome.kill();
process.exit(works || out.signedOut ? 0 : 1);
