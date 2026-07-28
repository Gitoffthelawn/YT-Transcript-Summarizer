// Runs test/e2e/clear-retry.html in BOTH engines and prints the verdict.
// Sends nothing, needs no account, touches no provider. See the HTML for what
// it proves; the short version is that the retry in ytsSendOne must not leave a
// second copy of the transcript in the composer.
//
//   node test/e2e/clear-retry.mjs            # Chrome (headless, launched here)
//   node test/e2e/clear-retry.mjs firefox    # Firefox (headless, launched here)
//
// Gecko is not a formality: ytsClearInput leans on document.execCommand and
// Selection, and this file already has one fix (H) that existed only because
// Firefox's clipboard semantics differ from Blink's.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { serve, sleep } from './bidi.mjs';

const engine = (process.argv[2] || 'chrome').toLowerCase();
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const http = await serve(repo, engine === 'firefox' ? 8933 : 8934);
const url = `http://127.0.0.1:${http.port}/test/e2e/clear-retry.html`;
const profile = mkdtempSync(resolve(tmpdir(), `ytsclear-${engine}-`));

let payload = null;
let browser = null;

try {
  if (engine === 'firefox') {
    const { connect } = await import('./bidi.mjs');
    browser = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', [
      '--remote-debugging-port=9223', '--headless', '--no-remote',
      '--profile', profile, 'about:blank',
    ], { stdio: 'ignore' });
    await sleep(6000);
    const bidi = await connect(9223);
    const ctx = await bidi.open(url);
    await sleep(2000);
    payload = await bidi.eval(ctx, 'window.__ytsResults');
  } else {
    const { connect } = await import('./cdp.mjs');
    browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      `--user-data-dir=${profile}`, '--remote-debugging-port=9335', '--headless=new',
      '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { stdio: 'ignore' });
    await sleep(4000);
    const cdp = await connect(9335);
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const s = await cdp.attach(targetId);
    await cdp.send('Runtime.enable', {}, s);
    await sleep(2000);
    const r = await cdp.send('Runtime.evaluate',
      { expression: 'window.__ytsResults', returnByValue: true }, s);
    payload = r.result.value;
  }
} finally {
  browser?.kill();
  http.close?.();
}

if (!payload) {
  console.log(`no results — the page did not run in ${engine}`);
  process.exit(1);
}

console.log('UA:', payload.userAgent, '\n');
let bad = 0;
for (const r of payload.results) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.case} — ${r.detail}`);
}
console.log(bad ? `\n${bad} FAILURE(S)` : '\nall green');
process.exit(bad ? 1 : 0);
