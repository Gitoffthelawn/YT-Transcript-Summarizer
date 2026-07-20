// ── background.js — Service Worker ───────────────────────────────────────────
import { callLLM } from './modules/llm-api.js';
import { fetchViaAndroidPlayer, fetchViaGetTranscript, tabFetchTranscript, tabBrowseContinuations } from './modules/youtube-api.js';
import { CONFIG } from './modules/config.js';
import { sleep, fetchWithTimeout } from './modules/utils.js';

let popupPort = null;
let isRunning = false;
// Set true when the user presses Stop/Reset. The batch loops poll this so an
// in-progress run can actually be interrupted (not just the *next* scheduled job).
let cancelRequested = false;

// True if a stop was requested (same-worker flag) or the persisted running flag
// was cleared (covers a service-worker restart mid-batch).
async function batchCancelled() {
  if (cancelRequested) return true;
  const { running } = await chrome.storage.local.get('running');
  return !running;
}

// A sleep that returns early with `true` as soon as a stop is requested.
async function cancellableSleep(ms) {
  const step = 250;
  for (let waited = 0; waited < ms; waited += step) {
    if (cancelRequested) return true;
    await sleep(Math.min(step, ms - waited));
  }
  return cancelRequested;
}

// Resume batch if service worker was restarted mid-batch
chrome.storage.local.get(['running', 'nextJobFromIndex', 'nextJobAt']).then(({ running, nextJobFromIndex, nextJobAt }) => {
  if (!running || isRunning) return;
  if (nextJobAt && Date.now() < nextJobAt) {
    // Still in the delay window — recreate alarm for the remaining time
    const ms = nextJobAt - Date.now();
    chrome.alarms.create('nextJob', { delayInMinutes: ms / 60000 });
    if (ms < 60000) {
      setTimeout(() => {
        chrome.storage.local.get(['running', 'nextJobFromIndex']).then(({ running, nextJobFromIndex }) => {
          if (running && !isRunning) {
            isRunning = true;
            runBatch(nextJobFromIndex ?? 0);
          }
        });
      }, ms);
    }
  } else {
    isRunning = true;
    runBatch(nextJobFromIndex ?? 0);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'nextJob') return;
  chrome.storage.local.get(['running', 'nextJobFromIndex']).then(({ running, nextJobFromIndex }) => {
    if (running && !isRunning) {
      isRunning = true;
      runBatch(nextJobFromIndex ?? 0);
    }
  });
});

// ── TTS Offscreen ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'tts-state' && sender.url === chrome.runtime.getURL('tts_offscreen.html')) {
    const { type, ...state } = msg;
    chrome.storage.local.set({ ttsState: state }).catch(() => {});
    safePost(msg);
  }
});

async function ensureTTSOffscreen() {
  if (!chrome.offscreen) return false;
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('tts_offscreen.html'),
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Text-to-Speech playback via Web Speech API'
      });
    }
    return true;
  } catch (e) { return false; }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return;
  popupPort = port;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'startBatch') {
      cancelRequested = false;
      chrome.alarms.clear('nextJob');
      await chrome.storage.local.set({
        jobs: msg.jobs, settings: msg.settings,
        nextJobFromIndex: null, nextJobAt: null
      });
      if (!isRunning) {
        isRunning = true;
        runBatch(0);
      }
    }
    if (msg.type === 'resetState') {
      cancelRequested = true;
      isRunning = false;
      chrome.alarms.clear('nextJob');
      await chrome.storage.local.set({ running: false, nextJobFromIndex: null, nextJobAt: null });
    }
    if (msg.type && msg.type.startsWith('tts-')) {
      const ok = await ensureTTSOffscreen();
      if (ok) {
        chrome.runtime.sendMessage(msg).catch(() => {});
      } else {
        safePost({ type: 'tts-state', playing: false, paused: false, error: 'tts_unsupported' });
      }
    }
  });

  port.onDisconnect.addListener(() => { popupPort = null; });
});

// ── Batch Runner ──────────────────────────────────────────────────────────────
async function runBatch(fromIndex = 0) {
  if (fromIndex === 0) {
    await chrome.storage.local.set({ running: true });
    chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
  }

  const { jobs = [], settings = {} } = await chrome.storage.local.get(['jobs', 'settings']);
  const mode = settings.mode || 'web';

  if (settings.combinedPrompt && fromIndex === 0) {
    const pending = jobs.filter(j => j.status === 'queued' || j.status === 'error');
    if (pending.length > 1) {
      await runBatchCombined(jobs, settings);
      if (await batchCancelled()) { isRunning = false; return; }
      await finalizeBatch();
      return;
    }
  }

  for (let i = fromIndex; i < jobs.length; i++) {
    if (await batchCancelled()) { isRunning = false; return; }

    const job = jobs[i];
    if (job.status === 'done') continue;

    await processJob(job, settings);

    if (await batchCancelled()) { isRunning = false; return; }

    const hasMore = jobs.slice(i + 1).some(j => j.status !== 'done' && j.status !== 'error');
    if (!hasMore) break;

    if (mode === 'web') {
      const ms = (settings.webDelay ?? 30) * 1000;
      const nextJobAt = Date.now() + ms;
      await chrome.storage.local.set({ nextJobFromIndex: i + 1, nextJobAt });
      safePost({ type: 'countdown', nextJobAt });
      chrome.alarms.create('nextJob', { delayInMinutes: ms / 60000 });
      if (ms < 60000) {
        setTimeout(() => {
          chrome.storage.local.get(['running', 'nextJobFromIndex']).then(({ running, nextJobFromIndex }) => {
            if (running && !isRunning) {
              isRunning = true;
              runBatch(nextJobFromIndex ?? 0);
            }
          });
        }, ms);
      }
      isRunning = false;
      return;
    } else {
      const ms = mode === 'api' ? 8000 + Math.random() * 7000 : 3000 + Math.random() * 4000;
      if (await cancellableSleep(ms)) { isRunning = false; return; }
    }
  }

  await finalizeBatch();
}

async function finalizeBatch() {
  isRunning = false;
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const doneCount = jobs.filter(j => j.status === 'done').length;
  await chrome.storage.local.set({ running: false, nextJobFromIndex: null, nextJobAt: null });
  chrome.alarms.clear('keepAlive');
  chrome.alarms.clear('nextJob');
  safePost({ type: 'batchDone' });

  if (doneCount > 0) {
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('logo.png'),
        title: 'YT Summarizer',
        message: `Processing completed for ${doneCount} video(s)!`
      });
    } catch (_) {}
  }
}

// ── Process Single Job ────────────────────────────────────────────────────────
async function processJob(job, settings) {
  try {
    const videoIdMatch = job.url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|\/v\/)([0-9A-Za-z_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;
    if (!videoId) throw new Error('Unable to extract video ID from URL.');

    let result = null;
    let debugLog = `=== DEBUG LOG v2.0 per ${videoId} ===\nURL: ${job.url}\n\n`;

    const transcriptLang = job.lang || settings.transcriptLang || 'en';
    debugLog += `Preferred transcript language: "${transcriptLang}"\n\n`;
    const effectivePrompt = job.prompt || settings.prompt;

    // ── Strategy 1: YouTube page scraping (most reliable with browser cookies)
    await updateJobStatus(job.id, 'active', '📋 Fetching YouTube page...');
    try {
      result = await fetchViaGetTranscript(videoId, (msg) => { debugLog += `[S1-PageScrape] ${msg}\n`; }, transcriptLang);
      if (result) debugLog += `[S1-PageScrape] ✅ Success!\n`;
    } catch (e) {
      debugLog += `[S1-PageScrape] ❌ Exception: ${e.message}\n`;
    }

    // ── Strategy 2: InnerTube Player API (Android)
    if (!result) {
      await updateJobStatus(job.id, 'active', '📱 Trying Android InnerTube...');
      try {
        result = await fetchViaAndroidPlayer(videoId, (msg) => { debugLog += `[S2-Android] ${msg}\n`; }, transcriptLang);
        if (result) debugLog += `[S2-Android] ✅ Success!\n`;
      } catch (e) {
        debugLog += `[S2-Android] ❌ Exception: ${e.message}\n`;
      }
    }

    // ── Strategy 3: Real tab (fallback)
    if (!result) {
      await updateJobStatus(job.id, 'active', '🔍 Opening YouTube tab (fallback)...');
      try {
        result = await tabFetchTranscript(videoId, (msg) => { debugLog += `[S3-Tab] ${msg}\n`; }, transcriptLang);
        if (result) debugLog += `[S3-Tab] ✅ Success!\n`;
      } catch (e) {
        debugLog += `[S3-Tab] ❌ Exception: ${e.message}\n`;
      }
    }

    if (!result?.transcript) {
      debugLog += '\n❌ ALL STRATEGIES FAILED\n';
      await chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(debugLog),
        filename: `debug_${videoId}.txt`,
        saveAs: false
      });
      throw new Error('No transcript found. Debug file downloaded.');
    }

    const { title, transcript } = result;
    debugLog += `\n✅ Transcript obtained: ${transcript.length} chars, title="${title}"\n`;

    const displayTitle = title || videoId;
    safePost({ type: 'jobTitleUpdate', jobId: job.id, title: displayTitle });
    const safeTitle = displayTitle.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 100);
    const mode = settings.mode || 'web';

    // ── Modalità: solo trascrizione
    if (mode === 'transcript') {
      await updateJobStatus(job.id, 'active', '💾 Saving transcript...');
      await chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(transcript),
        filename: `${safeTitle}_transcript.txt`,
        saveAs: false
      });
      await addToHistory(job.url, displayTitle);
      await updateJobStatus(job.id, 'done', `✅ Transcript saved: ${displayTitle.slice(0, 40)}`);
      return;
    }

    // ── Modalità: web
    if (mode === 'web') {
      const provider = settings.provider || 'anthropic';
      const webUrl = CONFIG.providerWebUrls[provider];
      if (!webUrl) {
        throw new Error(`${provider} does not support Web mode. Use API mode instead.`);
      }
      const providerLabel = provider === 'anthropic' ? 'Claude.ai'
                          : provider === 'openai'    ? 'ChatGPT'
                          : provider === 'gemini'    ? 'Gemini'
                          : provider;
      await updateJobStatus(job.id, 'active', `🌐 Opening ${providerLabel}...`);
      const webContent = `${effectivePrompt}\n\n---\n\n${transcript}`;
      if (!!settings.saveTranscriptFile) {
        await chrome.downloads.download({
          url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(webContent),
          filename: `${safeTitle}_transcript.txt`,
          saveAs: false
        });
      }
      const shouldPaste = settings.autoPaste || settings.autoSubmit;
      if (shouldPaste) {
        await chrome.storage.local.set({
          pendingLLMContent: { text: webContent, autoSubmit: !!settings.autoSubmit }
        });
      }
      await chrome.tabs.create({ url: webUrl, active: true });
      const doneLabel = settings.autoSubmit ? `✅ Sent to ${providerLabel}`
                      : settings.autoPaste   ? `✅ Pasted into ${providerLabel}`
                      :                        `✅ Opened ${providerLabel} (transcript saved)`;
      await addToHistory(job.url, displayTitle);
      await updateJobStatus(job.id, 'done', `${doneLabel}: ${displayTitle.slice(0, 35)}`);
      return;
    }

    // ── Modalità: API LLM
    const providerName = settings.provider || 'anthropic';
    await updateJobStatus(job.id, 'active', `🤖 ${providerName} (${settings.model}) — transcript ${(transcript.length/1000).toFixed(1)}k chars...`);
    let summary;
    {
      const maxRetries = 3;
      const baseWaitSec = 60;
      let lastErr;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          summary = await callLLM(transcript, { ...settings, prompt: effectivePrompt });
          lastErr = null;
          break;
        } catch (llmErr) {
          const m = llmErr.message || String(llmErr);
          if ((m.includes('429') || m.includes('Too Many Requests') || m.includes('overloaded')) && attempt < maxRetries) {
            const waitSec = baseWaitSec * Math.pow(2, attempt);
            debugLog += `\n⚠️ Rate limit (attempt ${attempt + 1}/${maxRetries}), waiting ${waitSec}s...\n`;
            for (let rem = waitSec; rem > 0; rem--) {
              if (cancelRequested) throw new Error('Interrupted by user');
              await updateJobStatus(job.id, 'active', `⏳ API rate limit — retry in ${rem}s (${attempt + 1}/${maxRetries})...`);
              await sleep(1000);
            }
            lastErr = llmErr;
            continue;
          }
          debugLog += `\n❌ LLM error: ${llmErr.message}\n`;
          await chrome.downloads.download({
            url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(debugLog),
            filename: `debug_${videoId}.txt`,
            saveAs: false
          });
          throw llmErr;
        }
      }
      if (lastErr) {
        debugLog += `\n❌ LLM error after retries: ${lastErr.message}\n`;
        await chrome.downloads.download({
            url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(debugLog),
            filename: `debug_${videoId}.txt`,
            saveAs: false
        });
        throw lastErr;
      }
    }

    const mdContent = `# ${displayTitle}\n\n${summary}`;
    await chrome.downloads.download({
      url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdContent),
      filename: `${safeTitle}.md`,
      saveAs: false
    });

    await addToHistory(job.url, displayTitle);
    await updateJobStatus(job.id, 'done', `✅ Completato: ${displayTitle.slice(0, 40)}`);

  } catch (err) {
    const msg = err.message || String(err);
    await updateJobStatus(job.id, 'error', `❌ ${msg.slice(0, 200)}`);
    console.warn(`[YT Summarizer] Error on ${job.url}:`, err);
  }
}

// ── Fetch transcript only (used by combined mode) ─────────────────────────────
async function fetchTranscriptForJob(job, settings) {
  const videoIdMatch = job.url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|\/v\/)([0-9A-Za-z_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;
  if (!videoId) throw new Error('Unable to extract video ID from URL.');

  const transcriptLang = job.lang || settings.transcriptLang || 'en';
  const noop = () => {};

  let result = null;
  try { result = await fetchViaGetTranscript(videoId, noop, transcriptLang); } catch (_) {}
  if (!result) { try { result = await fetchViaAndroidPlayer(videoId, noop, transcriptLang); } catch (_) {} }
  if (!result) { try { result = await tabFetchTranscript(videoId, noop, transcriptLang); } catch (_) {} }

  if (!result?.transcript) throw new Error('No transcript found.');
  return { videoId, title: result.title, transcript: result.transcript };
}

// ── Combined Batch: all transcripts → single prompt ───────────────────────────
async function runBatchCombined(jobs, settings) {
  const pending = jobs.filter(j => j.status === 'queued' || j.status === 'error');

  const fetched = [];
  for (let i = 0; i < pending.length; i++) {
    if (await batchCancelled()) return;
    const job = pending[i];
    await updateJobStatus(job.id, 'active', `📥 Fetching transcript ${i + 1}/${pending.length}...`);
    try {
      const result = await fetchTranscriptForJob(job, settings);
      fetched.push({ job, ...result });
      await updateJobStatus(job.id, 'active', `📄 Transcript ready (${i + 1}/${pending.length})`);
    } catch (err) {
      await updateJobStatus(job.id, 'error', `❌ ${err.message.slice(0, 200)}`);
    }
    if (i < pending.length - 1) {
      if (await cancellableSleep(1500 + Math.random() * 2000)) return;
    }
  }

  if (fetched.length === 0 || await batchCancelled()) return;

  const combinedTranscript = fetched.map((r, i) =>
    `## Video ${i + 1}: ${r.title || r.videoId}\nSource: ${r.job.url}\n\n${r.transcript}`
  ).join('\n\n---\n\n');

  const combinedContent = `${settings.prompt}\n\n---\n\n${combinedTranscript}`;
  const mode = settings.mode || 'web';

  if (mode === 'transcript') {
    await chrome.downloads.download({
      url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(combinedTranscript),
      filename: `combined_transcripts_${Date.now()}.txt`,
      saveAs: false
    });
    for (const r of fetched) {
      await addToHistory(r.job.url, r.title);
      await updateJobStatus(r.job.id, 'done', '✅ Combined transcript saved');
    }
    return;
  }

  if (mode === 'web') {
    const provider = settings.provider || 'anthropic';
    const webUrl = CONFIG.providerWebUrls[provider];
    if (!webUrl) {
      for (const r of fetched) await updateJobStatus(r.job.id, 'error', `❌ ${provider} does not support Web mode.`);
      return;
    }
    const providerLabel = provider === 'anthropic' ? 'Claude.ai'
                        : provider === 'openai'    ? 'ChatGPT'
                        : provider === 'gemini'    ? 'Gemini'
                        : provider;
    await chrome.downloads.download({
      url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(combinedContent),
      filename: `combined_transcripts_${Date.now()}.txt`,
      saveAs: false
    });
    const shouldPaste = settings.autoPaste || settings.autoSubmit;
    if (shouldPaste) {
      await chrome.storage.local.set({
        pendingLLMContent: { text: combinedContent, autoSubmit: !!settings.autoSubmit }
      });
    }
    await chrome.tabs.create({ url: webUrl, active: true });
    const doneLabel = settings.autoSubmit ? `✅ Sent to ${providerLabel}`
                    : settings.autoPaste   ? `✅ Pasted into ${providerLabel}`
                    :                        `✅ Opened ${providerLabel}`;
    for (const r of fetched) {
      await addToHistory(r.job.url, r.title);
      await updateJobStatus(r.job.id, 'done', `${doneLabel} (combined)`);
    }
    return;
  }

  for (const r of fetched) await updateJobStatus(r.job.id, 'active', `🤖 Sending combined to ${settings.provider || 'anthropic'} API...`);
  try {
    const summary = await callLLM(combinedTranscript, settings);
    const titles = fetched.map(r => r.title || r.videoId).join(' + ');
    const mdContent = `# Combined Summary\n\n_Videos: ${titles}_\n\n${summary}`;
    await chrome.downloads.download({
      url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdContent),
      filename: `combined_summary_${Date.now()}.md`,
      saveAs: false
    });
    for (const r of fetched) {
      await addToHistory(r.job.url, r.title);
      await updateJobStatus(r.job.id, 'done', '✅ Combined summary saved');
    }
  } catch (err) {
    for (const r of fetched) await updateJobStatus(r.job.id, 'error', `❌ ${err.message.slice(0, 200)}`);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function updateJobStatus(jobId, status, statusText) {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.status = status;
    job.statusText = statusText;
    await chrome.storage.local.set({ jobs });
  }
  safePost({ type: 'jobUpdate', jobId, status, statusText });
}

function safePost(msg) {
  try { if (popupPort) popupPort.postMessage(msg); } catch (_) {}
}

async function addToHistory(url, title) {
  const { videoHistory = [] } = await chrome.storage.local.get('videoHistory');
  const idx = videoHistory.findIndex(e => e.url === url);
  const entry = { url, title: title || url, date: new Date().toISOString() };
  if (idx !== -1) {
    videoHistory[idx] = entry;
  } else {
    videoHistory.unshift(entry);
  }
  await chrome.storage.local.set({ videoHistory });
}

// ── Playlist expansion ────────────────────────────────────────────────────────
// Turn a playlist URL into the list of its video URLs by scraping the playlist
// page's embedded ytInitialData, then following browse continuations for the
// (100-at-a-time) rest. Capped to keep huge playlists from flooding the queue.
const PLAYLIST_MAX = 500;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'expandPlaylist') {
    expandPlaylist(msg.url)
      .then(sendResponse)
      .catch(e => sendResponse({ error: e.message || String(e) }));
    return true; // keep the message channel open for the async response
  }
});

// Depth-unbounded search for the first value stored under `key`.
function deepFind(node, key, depth = 30) {
  if (!node || typeof node !== 'object' || depth < 0) return null;
  if (node[key] !== undefined) return node[key];
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') {
      const r = deepFind(v, key, depth - 1);
      if (r != null) return r;
    }
  }
  return null;
}

// Walk the whole tree collecting every playlist video (id + title). YouTube
// migrated the playlist layout to `lockupViewModel`; the legacy
// `playlistVideoRenderer` is still handled for older responses/clients.
function collectPlaylistVideos(node, out, seen) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectPlaylistVideos(n, out, seen);
    return;
  }
  const lv = node.lockupViewModel;
  if (lv?.contentId && lv.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && !seen.has(lv.contentId)) {
    seen.add(lv.contentId);
    out.push({ videoId: lv.contentId, title: lv.metadata?.lockupMetadataViewModel?.title?.content || null });
  }
  const r = node.playlistVideoRenderer;
  if (r?.videoId && !seen.has(r.videoId)) {
    seen.add(r.videoId);
    out.push({ videoId: r.videoId, title: r.title?.runs?.map(x => x.text).join('') || r.title?.simpleText || null });
  }
  for (const k in node) {
    if (k === 'lockupViewModel' || k === 'playlistVideoRenderer') continue;
    collectPlaylistVideos(node[k], out, seen);
  }
}

function extractYtInitialData(html) {
  const idx = html.indexOf('ytInitialData');
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

// The "load more" token for a playlist lives in a continuationItemRenderer that
// sits in the SAME array as the video items. ytInitialData contains several
// unrelated continuationItemRenderers (header shelves, related sections); a
// plain first-match deepFind often returns one of those, whose token fetches
// something other than the next playlist page — so the loop makes no progress
// and stops at the first 100. Scope the search to the array holding the videos.
function isPlaylistVideoNode(n) {
  return !!(n && typeof n === 'object' && (n.playlistVideoRenderer
    || (n.lockupViewModel && n.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')));
}
function tokenFromContinuationItem(cir) {
  return cir?.continuationEndpoint?.continuationCommand?.token
    || cir?.button?.buttonRenderer?.command?.continuationCommand?.token
    || deepFind(cir, 'token') || null;
}
function findContinuationToken(root) {
  let found = null;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.some(isPlaylistVideoNode)) {
        const cir = node.find(x => x?.continuationItemRenderer)?.continuationItemRenderer;
        const t = cir && tokenFromContinuationItem(cir);
        if (t) { found = t; return; }
      }
      for (const n of node) walk(n);
      return;
    }
    for (const k in node) walk(node[k]);
  };
  walk(root);
  // Fall back to the old global search if the scoped one came up empty.
  if (!found) {
    const cir = deepFind(root, 'continuationItemRenderer');
    found = cir ? deepFind(cir, 'token') : null;
  }
  return found;
}

async function expandPlaylist(url) {
  let listId;
  try { listId = new URL(url).searchParams.get('list'); } catch { listId = null; }
  if (!listId) throw new Error('No playlist id in URL');
  if (/^RD/.test(listId)) throw new Error('Mix/radio playlists are auto-generated and cannot be expanded');

  const seen = new Set();
  const videos = [];
  let total = null; // videos the playlist declares it has (may exceed what we load)
  let contDbg = null; // continuation diagnostics, surfaced when we can't load them all
  let dupes = 0; // playlist entries that repeat a video we already have

  // Scrape the playlist HTML page for the first ~100 videos. Hitting
  // /youtubei/v1/browse straight from the service worker gets served Google's
  // "Sorry" anti-abuse 403 (the chrome-extension Origin trips it, and the
  // declarativeNetRequest Origin rewrite doesn't reliably apply here), so we read
  // the plain HTML page instead — it embeds ytInitialData with the first page —
  // and page through the rest, when the playlist is longer, from a YouTube tab.
  //
  // credentials:'include' is required: an anonymous request from an EU visitor
  // is redirected to consent.youtube.com (not in host_permissions, so the fetch
  // then fails CORS). Sending the browser's existing consent cookie keeps the
  // request on www.youtube.com, whose host permission makes the response readable.
  try {
    const pageResp = await fetchWithTimeout(
      `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`,
      { credentials: 'include', headers: { 'Accept-Language': 'en-US,en;q=0.9' } },
      15000
    );
    if (pageResp.ok) {
      const html = await pageResp.text();
      let apiKey = CONFIG.youtube.apiKey, clientVersion = CONFIG.youtube.webClientVersion;
      const km = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/); if (km) apiKey = km[1];
      const vm = html.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/); if (vm) clientVersion = vm[1];
      const data = extractYtInitialData(html);
      if (data) {
        // The playlist's declared size. Different layouts expose it under
        // different keys (e.g. numVideosText = "26 videos"), so try each in turn,
        // then fall back to scraping the raw HTML for an "N videos" string.
        const parseCount = (v) => {
          const s = v?.runs?.map(r => r.text).join('') || v?.simpleText || v?.content || '';
          const m = s.replace(/[.,](?=\d{3}\b)/g, '').match(/\d+/);
          return m ? parseInt(m[0], 10) : NaN;
        };
        let n = NaN;
        for (const key of ['numVideosText', 'videoCountText', 'videoCountShortText', 'stats']) {
          n = parseCount(deepFind(data, key));
          if (Number.isFinite(n)) break;
        }
        if (!Number.isFinite(n)) {
          const hm = html.match(/([\d.,]+)\s*videos?\b/i);
          if (hm) n = parseInt(hm[1].replace(/[.,]/g, ''), 10);
        }
        if (Number.isFinite(n)) total = n;
        collectPlaylistVideos(data, videos, seen);
        const token = findContinuationToken(data);
        // Finish longer playlists from a real youtube.com tab, where the browse
        // continuation endpoint isn't hit with the anti-abuse 403. Attempt this
        // whenever the first page looks full even if we couldn't parse a token
        // here — the tab derives a valid token from its own live ytInitialData.
        const firstPage = videos.length;
        const shouldPage = firstPage < PLAYLIST_MAX && (token || firstPage >= 90 || (total && total > firstPage));
        console.log(`[playlist] listId=${listId} firstPage=${firstPage} declaredTotal=${total} htmlToken=${token ? 'yes' : 'no'} paging=${shouldPage ? 'yes' : 'no'}`);
        if (shouldPage) {
          const more = await tabBrowseContinuations(listId, token, apiKey, clientVersion, PLAYLIST_MAX, msg => {
            console.log('[playlist]', msg);
            const dm = /continuations dbg:\s*(\{.*\})/.exec(msg);
            if (dm) { try { contDbg = JSON.parse(dm[1]); } catch { /* keep null */ } }
          });
          for (const v of more.videos) {
            if (v?.videoId && !seen.has(v.videoId)) { seen.add(v.videoId); videos.push(v); }
          }
          // The live playlist tab reads the declared size more reliably than the
          // background HTML fetch; trust it when it isn't below what we loaded.
          if (Number.isFinite(more.total) && more.total >= videos.length) total = more.total;
          dupes = more.dupes || 0;
          console.log(`[playlist] after continuations: ${videos.length} videos (added ${videos.length - firstPage}, dupes ${dupes})`);
        }
      }
    }
  } catch (e) { console.log('[playlist] expand error:', e?.message || e); }

  if (videos.length === 0) throw new Error('No videos found (private, empty, or unavailable playlist)');

  const out = videos.slice(0, PLAYLIST_MAX).map(v => ({
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    title: v.title
  }));
  // "truncated" = we couldn't load every video the playlist claims to have
  // (hit PLAYLIST_MAX, or continuations were blocked past the first page).
  if (total == null || out.length > total) total = out.length;
  // If unique videos + repeats accounts for the declared total, we actually
  // loaded the whole playlist — the shortfall is just duplicate entries we
  // (correctly) collapsed, so it isn't truncated.
  const allSeen = out.length + dupes >= total;
  const truncated = out.length < total && !allSeen;
  // A non-2xx continuation status means YouTube actively blocked a page. If every
  // fetch was fine and we simply ran out, the shortfall is unavailable videos
  // (private/deleted) that the playlist still counts in its total.
  const blocked = !!(contDbg?.statuses?.some(s => !/:2\d\d$/.test(String(s))));
  console.log(`[playlist] result: ${out.length}/${total} dupes=${dupes} truncated=${truncated} blocked=${blocked}`, contDbg || '(no continuation dbg)');
  return { videos: out, count: out.length, total, dupes, truncated, blocked, contDbg };
}
