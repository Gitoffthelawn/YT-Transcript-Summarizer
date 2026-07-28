// §4.1 live: auto-submit ON + merge ON on the 108k video.
// Expected: split raised to 4 parts (Gemini cap) + 1 merge message = 5 messages.
// The status line must end "✅ Sent to Gemini (✂️ 4 parts + merge)" and NOT
// "⚠️ Only part 4 of 5" — the count that was wrong before fix E.
// Also exercises §4.5: the sequence lasts minutes, so MV3 will recycle the
// service worker while pasteWatch has to survive in storage.
import { openPopup, startBatch, pollJobs, baseSettings, sleep } from './drive.mjs';

const { c, evalIn } = await openPopup();
const jobs = [{ id: 1, url: 'https://www.youtube.com/watch?v=gQ2BnKMzlUQ', title: null, status: 'queued', statusText: 'Queued', prompt: null, format: null, length: null, split: null }];

await startBatch(evalIn, jobs, {
  ...baseSettings, mode: 'web', autoPaste: true, autoSubmit: true,
  chunkParts: 2, chunkMerge: true,
});

const started = Date.now();
await pollJobs(evalIn, { seconds: Number(process.argv[2] || 900) });
console.log('durata:', Math.round((Date.now() - started) / 1000), 's');

const w = await evalIn(`(async()=>JSON.stringify((await chrome.storage.local.get('pasteWatch')).pasteWatch||{}))()`);
console.log('pasteWatch residuo:', w);
const p = await evalIn(`(async()=>JSON.stringify((await chrome.storage.local.get('pendingLLMContent')).pendingLLMContent||null))()`);
console.log('pendingLLMContent residuo:', (p || '').slice(0, 120));
c.close();
