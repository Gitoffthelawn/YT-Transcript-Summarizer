// The same harness as gecko-paste.mjs, on Blink. Its job is the regression question:
// the Gecko fix must be inert on Chrome, where the ClipboardEvent constructor does
// carry clipboardData and the extension is already verified (§4).
//
//   node test/e2e/chrome-paste.mjs
//
// Launches its own headless Chrome; sends nothing, needs no account.
import { connect, sleep } from './cdp.mjs';
import { serve } from './bidi.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const http = await serve(repo, 8932);

const profile = mkdtempSync(resolve(tmpdir(), 'ytschrome-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  `--user-data-dir=${profile}`, '--remote-debugging-port=9334', '--headless=new',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
await sleep(4000);

const cdp = await connect(9334);
const { targetId } = await cdp.send('Target.createTarget', {
  url: `http://127.0.0.1:${http.port}/test/e2e/gecko-paste.html`,
});
const s = await cdp.attach(targetId);
await cdp.send('Runtime.enable', {}, s);
await sleep(2500);

const r = await cdp.send('Runtime.evaluate',
  { expression: 'window.__ytsResults', returnByValue: true }, s);
const payload = r.result.value;

let bad = 0;
if (!payload) { console.log('no results — the page did not run'); bad = 1; }
else {
  console.log('UA:', payload.extra.userAgent, '\n');
  for (const c of payload.results) {
    if (!c.ok) bad++;
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.case.padEnd(6)} ${c.landed}/${c.expected} chars` +
      `  returned ${JSON.stringify(c.returned)}${c.doubled ? '  ⚠️ DOUBLE PASTE' : ''}`);
  }
  console.log('\nclipboardData chars the editor received:', payload.extra.pmClipboardDataChars);
  console.log('(on Blink this is non-zero without the Gecko branch ever firing)');
}

cdp.close();
chrome.kill();
await http.close();
console.log(bad ? `\n${bad} case(s) FAILED on Blink` : '\nno regression on Blink');
process.exit(bad ? 1 : 0);
