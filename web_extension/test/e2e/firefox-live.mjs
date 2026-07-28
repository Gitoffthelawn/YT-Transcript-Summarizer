// A real run of the real extension inside Firefox — the replacement for
// firefox-run.mjs, whose recipe stopped working on Firefox 153.
//
// WHAT BROKE. drive-gecko.mjs drives the run through popup.html, because that is
// the only context with extension-API access that can talk to the background.
// Reaching it needed Firefox to open the popup itself, via
// `--start-url moz-extension://<uuid>/popup.html`. On Firefox 153 that URL is no
// longer opened from the command line, and WebDriver BiDi still refuses to
// navigate to it ("Navigation to moz-extension://… is not allowed"). Verified
// both, 2026-07-28: BiDi then reports a single `chrome://browser/content/
// blanktab.html` and there is no way in.
//
// WHAT WORKS INSTEAD. Skip the popup: graft a few lines into a THROWAWAY COPY of
// the extension that start the run from inside the background — where the
// extension APIs already are — and have them report back over plain HTTP to a
// local collector. Nothing is driven from outside, so nothing privileged has to
// be reached. The repo is never touched: the copy lives in a temp dir and is
// deleted at the end.
//
// COST. `SUBMIT=0` (the default) leaves auto-submit off: part 1 is pasted into
// the real composer and nothing is ever sent. `SUBMIT=1` exercises the forced
// split with auto-submit on — on a signed-out profile that still posts nothing,
// because Gemini cannot send while logged out, but the whole staging chain runs.
//
//   node test/e2e/firefox-live.mjs [gemini|anthropic|openai]
//   SUBMIT=1 VIDEO=<id> node test/e2e/firefox-live.mjs gemini
//
// Requires web-ext (npx fetches it) and Firefox on the default Windows path.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, appendFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const PROVIDER = (process.argv[2] || 'gemini').toLowerCase();
const VIDEO = process.env.VIDEO || 'gQ2BnKMzlUQ';
const SUBMIT = process.env.SUBMIT === '1';
const PORT = 8765;

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Short, space-free paths: web-ext and Firefox both mishandle the repo's own.
const work = mkdtempSync(join(tmpdir(), 'ytslive-'));
const extDir = join(work, 'ext');
const profile = join(work, 'profile');
mkdirSync(profile, { recursive: true });

cpSync(repo, extDir, {
  recursive: true,
  filter: (src) => !/[\\/](test|tools|dist|_metadata|node_modules|\.git)$/.test(src)
                && !/NOTES\.md$|ROADMAP\.md$/.test(src),
});

const rig = `
// ── live rig (throwaway copy only) ───────────────────────────────────────────
const RIG = 'http://127.0.0.1:${PORT}/report';
const say = (tag, data) => fetch(RIG, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag, data }) }).catch(() => {});
(async () => {
  await new Promise(r => setTimeout(r, 2500));
  const { __rigStarted } = await chrome.storage.local.get('__rigStarted');
  if (__rigStarted) return;
  await chrome.storage.local.set({ __rigStarted: true });
  say('boot', { ua: navigator.userAgent, version: chrome.runtime.getManifest().version });

  const jobs = [{ id: 1, url: 'https://www.youtube.com/watch?v=${VIDEO}', status: 'queued', title: '' }];
  const settings = {
    mode: 'web', provider: ${JSON.stringify(PROVIDER)},
    prompt: 'Genera un riassunto completo e dettagliato del seguente video.',
    transcriptLang: 'it', chunkParts: 1, chunkMerge: false,
    autoPaste: true, autoSubmit: ${SUBMIT}, saveTranscriptFile: false, webDelay: 30,
  };
  await chrome.storage.local.set({ jobs, settings, running: true, nextJobId: null, nextJobAt: null });
  startRun(null);

  let seenPayload = false, last = '';
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const { jobs: j = [], pendingLLMContent: p } =
      await chrome.storage.local.get(['jobs', 'pendingLLMContent']);
    const sig = JSON.stringify(j.map(x => [x.status, x.statusText]));
    if (sig !== last) { last = sig; say('status', j.map(x => \`[\${x.status}] \${x.statusText}\`)); }

    // The staged payload is the only place the [m:ss] anchors can be checked
    // against REAL captions rather than a synthetic transcript.
    if (p?.parts && !seenPayload) {
      seenPayload = true;
      const whole = p.parts.join('\\n');
      const anchors = whole.match(/^\\[\\d{1,2}:\\d{2}(?::\\d{2})?\\] /gm) || [];
      say('payload', {
        messages: p.parts.length,
        totalChars: whole.length,
        anchors: anchors.length,
        firstAnchor: anchors[0]?.trim() ?? null,
        lastAnchor: anchors[anchors.length - 1]?.trim() ?? null,
        promptAsksForTimestamps: /\\[m:ss\\]/.test(p.parts[0]),
        mergeAppended: !!p.merge,
      });
    }
    if (j.length && j.every(x => ['done', 'error', 'unavailable'].includes(x.status))) {
      await new Promise(r => setTimeout(r, 25000));   // give the paste time
      const { jobs: fin = [] } = await chrome.storage.local.get('jobs');
      say('final', fin.map(x => \`[\${x.status}] \${x.statusText}\`));
      return say('done', 'ok');
    }
  }
  say('timeout', 'the run never settled');
})();
`;
appendFileSync(join(extDir, 'background.js'), rig);

let finished;
const wait = new Promise(r => { finished = r; });
const server = createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    try {
      const { tag, data } = JSON.parse(body || '{}');
      console.log(`\n── ${tag} ──`);
      console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      if (tag === 'done' || tag === 'timeout') finished(tag);
    } catch { /* ignore junk */ }
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    res.end('ok');
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

console.log(`launching Firefox — provider ${PROVIDER}, video ${VIDEO}, auto-submit ${SUBMIT ? 'ON' : 'OFF'}`);
const web = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', 'web-ext', 'run', '--source-dir', extDir, '--firefox-profile', profile,
   '--keep-profile-changes', '--no-reload'],
  { stdio: 'ignore', shell: process.platform === 'win32' });

const verdict = await Promise.race([wait, new Promise(r => setTimeout(() => r('expired'), 300000))]);

web.kill();
if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/IM', 'firefox.exe'], { stdio: 'ignore' });
server.close();
try { rmSync(work, { recursive: true, force: true }); } catch { /* Windows may still hold it */ }

console.log(`\nverdict: ${verdict === 'done' ? '✅ the run completed' : `⚠️ ${verdict}`}`);
process.exit(verdict === 'done' ? 0 : 1);
