// Runs test/e2e/gecko-paste.html in Firefox and prints the verdict.
// Sends nothing, needs no account, touches no provider. See the HTML for what it proves.
//
//   node test/e2e/gecko-paste.mjs
//
// Expects Firefox already running with --remote-debugging-port=9222 (see README).
import { connect, serve, sleep } from './bidi.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const http = await serve(repo, 8931);
const bidi = await connect(9222);

const ctx = await bidi.open(`http://127.0.0.1:${http.port}/test/e2e/gecko-paste.html`);
await sleep(1500);

const payload = await bidi.eval(ctx, 'window.__ytsResults');
if (!payload) {
  console.log('no results — the page did not run');
  process.exit(1);
}

console.log('UA:', payload.extra.userAgent, '\n');

console.log('execCommand("insertText") probe:');
console.log('  returned:', JSON.stringify(payload.extra.execCommandSupported.returned));
console.log('  inserted:', JSON.stringify(payload.extra.execCommandSupported.inserted), '\n');

let bad = 0;
for (const r of payload.results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  if (!r.ok) bad++;
  console.log(`${mark}  ${r.case.padEnd(6)} ${r.landed}/${r.expected} chars` +
    `  ytsPasteText returned ${JSON.stringify(r.returned)}` +
    `${r.doubled ? '  ⚠️ DOUBLE PASTE' : ''}${r.error ? '  error: ' + r.error : ''}`);
  console.log(`      ${r.note}`);
}

console.log('\nProseMirror-like editor:');
console.log('  paste events seen:', payload.extra.pmPasteEventsSeen);
console.log('  clipboardData chars it received:', payload.extra.pmClipboardDataChars);
console.log('\ninstruction head (fix M):', JSON.stringify(payload.extra.instructionHead));

await bidi.close_(ctx);
await bidi.close();
await http.close();

console.log(bad ? `\n${bad} case(s) FAILED on Gecko` : '\nall three editors accepted the paste');
process.exit(bad ? 1 : 0);
