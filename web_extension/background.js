// ── background.js — Service Worker ───────────────────────────────────────────
import { callLLM } from './modules/llm-api.js';
import { fetchViaAndroidPlayer, fetchViaGetTranscript, fetchViaTimedText, tabFetchTranscript } from './modules/youtube-api.js';
import { CONFIG } from './modules/config.js';
import { sleep } from './modules/utils.js';

let popupPort = null;
let isRunning = false;

// Required in MV3 to keep the service worker alive during processing
chrome.alarms.onAlarm.addListener(() => {});

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
      await chrome.storage.local.set({ jobs: msg.jobs, settings: msg.settings });
      if (!isRunning) runBatch();
    }
    if (msg.type === 'resetState') {
      isRunning = false;
      await chrome.storage.local.set({ running: false });
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
async function runBatch() {
  isRunning = true;
  await chrome.storage.local.set({ running: true });
  chrome.alarms.create('keepAlive', { periodInMinutes: 1 });

  let processed = 0;
  try {
    const { jobs = [], settings = {} } = await chrome.storage.local.get(['jobs', 'settings']);
    const pending = jobs.filter(j => j.status === 'queued' || j.status === 'error');

    if (settings.combinedPrompt && pending.length > 1) {
      processed = pending.length;
      await runBatchCombined(jobs, settings);
    } else {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.status === 'done' || job.status === 'error') continue;
        await processJob(job, settings);
        processed++;
        if (i < jobs.length - 1) {
          const mode = settings.mode || 'web';
          let ms;
          if (mode === 'api') {
            ms = 8000 + Math.random() * 7000;
          } else if (mode === 'web') {
            ms = (settings.webDelay ?? 45) * 1000;
          } else {
            ms = 3000 + Math.random() * 4000;
          }
          await sleep(ms);
        }
      }
    }
  } finally {
    isRunning = false;
    await chrome.storage.local.set({ running: false });
    chrome.alarms.clear('keepAlive');
    safePost({ type: 'batchDone' });
  }

  if (processed > 0) {
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('logo.png'),
        title: 'YT Summarizer',
        message: `Processing completed for ${processed} video(s)!`
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

    // ── Strategy 1: InnerTube Player API (Android)
    await updateJobStatus(job.id, 'active', '📱 Trying Android InnerTube...');
    try {
      result = await fetchViaAndroidPlayer(videoId, (msg) => { debugLog += `[S1-Android] ${msg}\n`; }, transcriptLang);
      if (result) debugLog += `[S1-Android] ✅ Success!\n`;
    } catch (e) {
      debugLog += `[S1-Android] ❌ Exception: ${e.message}\n`;
    }

    // ── Strategy 2: get_transcript endpoint
    if (!result) {
      await updateJobStatus(job.id, 'active', '📋 Trying get_transcript API...');
      try {
        result = await fetchViaGetTranscript(videoId, (msg) => { debugLog += `[S2-GetTranscript] ${msg}\n`; }, transcriptLang);
        if (result) debugLog += `[S2-GetTranscript] ✅ Success!\n`;
      } catch (e) {
        debugLog += `[S2-GetTranscript] ❌ Exception: ${e.message}\n`;
      }
    }

    // ── Strategy 3: Legacy timedtext API
    if (!result) {
      await updateJobStatus(job.id, 'active', '📄 Trying timedtext API...');
      try {
        result = await fetchViaTimedText(videoId, (msg) => { debugLog += `[S3-Timedtext] ${msg}\n`; }, transcriptLang);
        if (result) debugLog += `[S3-Timedtext] ✅ Success!\n`;
      } catch (e) {
        debugLog += `[S3-Timedtext] ❌ Exception: ${e.message}\n`;
      }
    }

    // ── Strategy 4: Real tab (fallback)
    if (!result) {
      await updateJobStatus(job.id, 'active', '🔍 Opening YouTube tab (fallback)...');
      try {
        result = await tabFetchTranscript(videoId, (msg) => { debugLog += `[S4-Tab] ${msg}\n`; }, transcriptLang);
        if (result) debugLog += `[S4-Tab] ✅ Success!\n`;
      } catch (e) {
        debugLog += `[S4-Tab] ❌ Exception: ${e.message}\n`;
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

  const transcriptLang = settings.transcriptLang || 'en';
  const noop = () => {};

  let result = null;
  try { result = await fetchViaAndroidPlayer(videoId, noop, transcriptLang); } catch (_) {}
  if (!result) { try { result = await fetchViaGetTranscript(videoId, noop, transcriptLang); } catch (_) {} }
  if (!result) { try { result = await fetchViaTimedText(videoId, noop, transcriptLang); } catch (_) {} }
  if (!result) { try { result = await tabFetchTranscript(videoId, noop, transcriptLang); } catch (_) {} }

  if (!result?.transcript) throw new Error('No transcript found.');
  return { videoId, title: result.title, transcript: result.transcript };
}

// ── Combined Batch: all transcripts → single prompt ───────────────────────────
async function runBatchCombined(jobs, settings) {
  const pending = jobs.filter(j => j.status === 'queued' || j.status === 'error');

  const fetched = [];
  for (let i = 0; i < pending.length; i++) {
    const job = pending[i];
    await updateJobStatus(job.id, 'active', `📥 Fetching transcript ${i + 1}/${pending.length}...`);
    try {
      const result = await fetchTranscriptForJob(job, settings);
      fetched.push({ job, ...result });
      await updateJobStatus(job.id, 'active', `📄 Transcript ready (${i + 1}/${pending.length})`);
    } catch (err) {
      await updateJobStatus(job.id, 'error', `❌ ${err.message.slice(0, 200)}`);
    }
    if (i < pending.length - 1) await sleep(1500 + Math.random() * 2000);
  }

  if (fetched.length === 0) return;

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
