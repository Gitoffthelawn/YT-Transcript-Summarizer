// The Gecko twin of drive.mjs: opens popup.html (the only context with extension API
// access that can talk to the background) and drives a real run over BiDi.
//
// EXT_UUID is Firefox's per-profile internal id, not the manifest id. Find it in the
// profile's prefs.js under extensions.webextensions.uuids.
import { connect, sleep } from './bidi.mjs';

const UUID = process.env.EXT_UUID;

/**
 * BiDi refuses to *navigate* a tab to moz-extension:// ("Navigation to … is not allowed
 * in this context") — privileged URLs are off limits to WebDriver. It will happily
 * evaluate in such a tab if it is already open, so the popup has to be opened by
 * Firefox itself: pass it as a --start-url when launching (see TESTING-TODO §8.3).
 */
export async function openPopup(port = 9222) {
  if (!UUID) throw new Error('set EXT_UUID (see extensions.webextensions.uuids in prefs.js)');
  const bidi = await connect(port);
  const wanted = `moz-extension://${UUID}/popup.html`;

  const { contexts } = await bidi.send('browsingContext.getTree', {});
  const flat = [];
  (function walk(l) { for (const c of l) { flat.push(c); if (c.children) walk(c.children); } })(contexts);
  const found = flat.find(c => (c.url || '').startsWith(wanted));
  if (!found) {
    throw new Error(`popup.html is not open. Launch Firefox with --start-url "${wanted}"`);
  }

  await sleep(1500);
  const evalIn = (expr) => bidi.eval(found.context, expr);
  return { bidi, ctx: found.context, evalIn };
}

// Firefox exposes browser.*; the extension is written against chrome.*, which Firefox
// also provides. Take whichever is there so the harness does not care.
const API = `(globalThis.browser || globalThis.chrome)`;

export async function startBatch(evalIn, jobs, settings) {
  return evalIn(`(async () => {
    const p = ${API}.runtime.connect({ name: 'popup' });
    p.postMessage({ type: 'startBatch', jobs: ${JSON.stringify(jobs)}, settings: ${JSON.stringify(settings)} });
    globalThis.__port = p;
    return 'sent';
  })()`);
}

export async function pollJobs(evalIn, { seconds = 180, until } = {}) {
  let last = '';
  let jobs = [];
  for (let i = 0; i < seconds; i++) {
    jobs = await evalIn(`(async () => (await ${API}.storage.local.get('jobs')).jobs || [])()`);
    const sig = JSON.stringify(jobs.map(j => [j.id, j.status, j.statusText]));
    if (sig !== last) {
      last = sig;
      for (const j of jobs) console.log(`   [${String(j.status).padEnd(11)}] ${j.statusText}`);
      console.log('   ---');
    }
    if (until && until(jobs)) return jobs;
    await sleep(1000);
  }
  return jobs;
}

export async function clearState(evalIn) {
  return evalIn(`(async () => {
    await ${API}.storage.local.remove(['pendingLLMContent', 'jobs', 'pasteWatch']);
    return 1;
  })()`);
}

export const settled = (jobs) => jobs.length > 0 && jobs.every(j => ['done', 'error', 'unavailable'].includes(j.status));

export const baseSettings = {
  provider: 'gemini', apiKey: '', apiKeys: {}, model: 'gemini-2.0-flash',
  customEndpointUrl: '', mode: 'web', transcriptLang: 'it', useThinking: false,
  autoPaste: true, autoSubmit: false, combinedPrompt: false,
  saveTranscriptFile: false, webDelay: 5, chunkParts: 2, chunkMerge: false,
  prompt: 'Riassumi il seguente video.',
};

export { sleep };
