// Drives the real extension over CDP: opens popup.html (the only context with
// chrome.* access that can talk to the background), sends startBatch, polls the
// job rows. See TESTING-TODO §6 for why the provider tab cannot be used instead.
import { connect, sleep } from './cdp.mjs';

const EXT = process.env.EXT_ID;

export async function openPopup(port = 9333) {
  const c = await connect(port);
  const { targetId } = await c.send('Target.createTarget', { url: `chrome-extension://${EXT}/popup.html` });
  const session = await c.attach(targetId);
  await c.send('Runtime.enable', {}, session);
  await sleep(2500);
  const evalIn = async (expr, awaitPromise = true) => {
    const r = await c.send('Runtime.evaluate', {
      expression: expr, awaitPromise, returnByValue: true
    }, session);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };
  return { c, session, evalIn, targetId };
}

export async function startBatch(evalIn, jobs, settings) {
  return evalIn(`(async () => {
    const p = chrome.runtime.connect({ name: 'popup' });
    p.postMessage({ type: 'startBatch', jobs: ${JSON.stringify(jobs)}, settings: ${JSON.stringify(settings)} });
    globalThis.__port = p;
    return 'sent';
  })()`);
}

export async function pollJobs(evalIn, { seconds = 180, until } = {}) {
  let last = '';
  for (let i = 0; i < seconds; i++) {
    const jobs = await evalIn(`(async () => (await chrome.storage.local.get('jobs')).jobs)()`);
    const sig = JSON.stringify(jobs.map(j => [j.id, j.status, j.statusText]));
    if (sig !== last) {
      last = sig;
      for (const j of jobs) console.log(`   [${String(j.status).padEnd(11)}] ${j.statusText}`);
      console.log('   ---');
    }
    if (until && until(jobs)) return jobs;
    await sleep(1000);
  }
  return evalIn(`(async () => (await chrome.storage.local.get('jobs')).jobs)()`);
}

export const settled = (jobs) => jobs.every(j => ['done', 'error', 'unavailable'].includes(j.status));

export const baseSettings = {
  provider: 'gemini', apiKey: '', apiKeys: {}, model: 'gemini-2.0-flash',
  customEndpointUrl: '', mode: 'web', transcriptLang: 'it', useThinking: false,
  autoPaste: true, autoSubmit: false, combinedPrompt: false,
  saveTranscriptFile: false, webDelay: 5, chunkParts: 2, chunkMerge: false,
  prompt: 'Riassumi il seguente video.',
};

export { connect, sleep };
