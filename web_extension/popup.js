import { PROVIDERS, getPreset } from './modules/config.js';
import { showMsg } from './modules/ui-utils.js';
import { state } from './modules/popup-state.js';
import { renderHistory, clearHistory } from './modules/popup-history.js';
import { populateTTSVoices, sendTTS, ttsPlay, ttsPauseResume, ttsStop, updateTTSStatus } from './modules/popup-tts.js';
import { applyProvider, persistSettings, saveSettings, updatePromptPreview, togglePromptEditor } from './modules/popup-settings.js';
import { renderJobs, updateJob, setUIAsRunning, setUIAsStopped, setMode, setChip, setOutputFormat, setSummaryLength, toggleJobSettings, updateJobEditBtn, setJobFormat, setJobLength, resetJobSettings, setJobLang } from './modules/popup-render.js';

const PANELS = ['panel-settings', 'panel-history', 'panel-tts'];

function closeAllPanels() {
  PANELS.forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('main-view').classList.remove('hidden');
}

function openPanel(panelId, onOpen) {
  PANELS.forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(panelId).classList.remove('hidden');
  document.getElementById('main-view').classList.add('hidden');
  if (onOpen) onOpen();
}

function togglePanel(panelId, onOpen) {
  const panel = document.getElementById(panelId);
  if (panel.classList.contains('hidden')) {
    openPanel(panelId, onOpen);
  } else {
    closeAllPanels();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get([
    'provider', 'apiKey', 'apiKeys', 'models', 'customEndpointUrl',
    'transcriptLang', 'customPrompt', 'mode',
    'useThinking', 'autoPaste', 'autoSubmit', 'combinedPrompt', 'saveTranscriptFile',
    'outputFormat', 'summaryLength', 'jobs', 'running', 'theme',
    'ttsState', 'ttsRate', 'ttsVoice', 'ttsText', 'webDelay'
  ]);

  const {
    transcriptLang, customPrompt, mode,
    useThinking, autoPaste, autoSubmit, combinedPrompt, saveTranscriptFile,
    outputFormat, summaryLength, jobs: savedJobs, running: savedRunning, theme,
    ttsState, ttsRate, ttsVoice, ttsText, webDelay
  } = stored;

  // Migrate legacy apiKey → apiKeys.anthropic
  let apiKeys = stored.apiKeys || {};
  if (stored.apiKey && !apiKeys.anthropic) {
    apiKeys = { ...apiKeys, anthropic: stored.apiKey };
    await chrome.storage.local.set({ apiKeys });
  }
  const models = stored.models || {};

  if (theme === 'dark') document.body.classList.add('dark');
  document.getElementById('btn-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
  document.getElementById('app-version').textContent = 'v' + chrome.runtime.getManifest().version;

  if (savedJobs) state.jobs = savedJobs;
  if (savedRunning) state.running = savedRunning;

  if (!savedRunning && state.jobs.some(j => j.status === 'done')) {
    state.jobs = state.jobs.filter(j => j.status !== 'done');
    chrome.storage.local.set({ jobs: state.jobs });
  }

  // TTS
  const savedRate = ttsRate ?? 1.0;
  document.getElementById('tts-rate').value = savedRate;
  document.getElementById('tts-rate-label').textContent = savedRate.toFixed(1) + '×';
  populateTTSVoices(ttsVoice);
  speechSynthesis.onvoiceschanged = () => populateTTSVoices(ttsVoice);
  if (ttsText) document.getElementById('tts-text').value = ttsText;
  if (ttsState) updateTTSStatus(ttsState);
  document.getElementById('web-delay').value = webDelay ?? 45;

  if (transcriptLang) {
    document.getElementById('transcript-lang-select').value = transcriptLang;
    const inlineSel = document.getElementById('lang-select-inline');
    if (inlineSel) inlineSel.value = transcriptLang;
  }

  const currentFmt = outputFormat || 'md';
  const currentLen = summaryLength || 'normal';
  const prompt = customPrompt || getPreset(transcriptLang || 'en', currentFmt, currentLen);
  document.getElementById('prompt-input').value = prompt;
  updatePromptPreview(prompt);

  const savedProvider = stored.provider || 'anthropic';
  await applyProvider(savedProvider, apiKeys, models, stored.customEndpointUrl || '');

  setMode(mode || 'web');
  setChip('chip-autopaste', !!autoPaste || !!autoSubmit);
  setChip('chip-autosubmit', !!autoSubmit);
  setChip('chip-combine', !!combinedPrompt);
  setChip('chip-thinking', !!useThinking);
  setChip('chip-save-file', !!saveTranscriptFile);
  setOutputFormat(currentFmt);
  setSummaryLength(currentLen);
  if (autoSubmit) document.getElementById('chip-autopaste').classList.add('locked');

  // ── Event listeners ───────────────────────────────────────────────────────

  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-history').addEventListener('click', () => togglePanel('panel-history', renderHistory));
  document.getElementById('btn-settings').addEventListener('click', () => togglePanel('panel-settings'));
  document.getElementById('btn-tts').addEventListener('click', () => togglePanel('panel-tts'));
  document.getElementById('btn-back-settings').addEventListener('click', closeAllPanels);
  document.getElementById('btn-back-history').addEventListener('click', closeAllPanels);
  document.getElementById('btn-back-tts').addEventListener('click', closeAllPanels);
  document.getElementById('tts-btn-play').addEventListener('click', ttsPlay);
  document.getElementById('tts-btn-pauseresume').addEventListener('click', ttsPauseResume);
  document.getElementById('tts-btn-stop').addEventListener('click', ttsStop);
  document.getElementById('tts-rate').addEventListener('input', async e => {
    const rate = parseFloat(e.target.value);
    document.getElementById('tts-rate-label').textContent = rate.toFixed(1) + '×';
    await chrome.storage.local.set({ ttsRate: rate });
    if (state.ttsPlaying) sendTTS({ type: 'tts-rate', rate });
  });
  document.getElementById('tts-voice').addEventListener('change', e => {
    const voiceName = e.target.value;
    if (voiceName) chrome.storage.local.set({ ttsVoice: voiceName });
    if (state.ttsPlaying) sendTTS({ type: 'tts-voice', voiceName: voiceName || undefined });
  });
  let ttsSaveTimer;
  document.getElementById('tts-text').addEventListener('input', e => {
    clearTimeout(ttsSaveTimer);
    ttsSaveTimer = setTimeout(() => chrome.storage.local.set({ ttsText: e.target.value }), 500);
  });
  document.getElementById('btn-clear-history').addEventListener('click', clearHistory);
  document.getElementById('history-list').addEventListener('click', e => {
    const link = e.target.closest('.history-link');
    if (link) { e.preventDefault(); chrome.tabs.create({ url: link.dataset.url }); }
  });

  document.getElementById('btn-donate').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://paypal.me/RobertoReale12' });
  });
  document.getElementById('btn-save-key').addEventListener('click', saveSettings);
  document.getElementById('btn-add').addEventListener('click', addUrl);
  document.getElementById('btn-add-tab').addEventListener('click', addCurrentTab);
  document.getElementById('btn-run').addEventListener('click', startBatch);
  document.getElementById('btn-reset').addEventListener('click', resetBatch);
  document.getElementById('btn-prompt-toggle').addEventListener('click', togglePromptEditor);

  // ── Inline language selector ─────────────────────────────────────────────
  document.getElementById('lang-select-inline').addEventListener('change', async (e) => {
    const lang = e.target.value;
    // Keep settings selector in sync
    document.getElementById('transcript-lang-select').value = lang;
    await chrome.storage.local.set({ transcriptLang: lang });
    // Refresh prompt preview with new lang
    const { outputFormat: fmt, summaryLength: len } =
      await chrome.storage.local.get(['outputFormat', 'summaryLength']);
    const { customPrompt } = await chrome.storage.local.get('customPrompt');
    // Only auto-update if not using a fully custom prompt
    const preset = getPreset(lang, fmt || 'md', len || 'normal');
    document.getElementById('prompt-input').value = preset;
    updatePromptPreview(preset);
    await chrome.storage.local.set({ customPrompt: preset });
  });

  // Keep the Advanced Settings lang selector in sync with inline one
  document.getElementById('transcript-lang-select').addEventListener('change', async (e) => {
    const lang = e.target.value;
    document.getElementById('lang-select-inline').value = lang;
    await chrome.storage.local.set({ transcriptLang: lang });
    const { outputFormat: fmt, summaryLength: len } =
      await chrome.storage.local.get(['outputFormat', 'summaryLength']);
    const preset = getPreset(lang, fmt || 'md', len || 'normal');
    document.getElementById('prompt-input').value = preset;
    updatePromptPreview(preset);
    await chrome.storage.local.set({ customPrompt: preset });
  });

  document.getElementById('url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addUrl();
  });

  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      const { apiKeys: storedKeys = {}, models: storedModels = {}, customEndpointUrl = '' } =
        await chrome.storage.local.get(['apiKeys', 'models', 'customEndpointUrl']);
      await applyProvider(tab.dataset.provider, storedKeys, storedModels, customEndpointUrl);
      persistSettings();
    });
  });

  let promptTimer = null;
  document.getElementById('prompt-input').addEventListener('input', () => {
    const val = document.getElementById('prompt-input').value;
    updatePromptPreview(val);
    clearTimeout(promptTimer);
    promptTimer = setTimeout(() => {
      chrome.storage.local.set({ customPrompt: val.trim() });
    }, 600);
  });

  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('disabled')) return;
      setMode(tab.dataset.mode);
      persistSettings();
    });
  });

  document.querySelectorAll('.chip:not(.chip-fmt):not(.chip-len)').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.classList.contains('locked')) return;
      const newOn = !chip.classList.contains('on');
      setChip(chip.id, newOn);
      if (chip.id === 'chip-autosubmit') {
        if (newOn) {
          setChip('chip-autopaste', true);
          document.getElementById('chip-autopaste').classList.add('locked');
        } else {
          document.getElementById('chip-autopaste').classList.remove('locked');
        }
      }
      persistSettings();
    });
  });

  document.querySelectorAll('.chip-fmt').forEach(chip => {
    chip.addEventListener('click', async () => {
      const fmt = chip.dataset.fmt;
      const { transcriptLang: lang, summaryLength: len } =
        await chrome.storage.local.get(['transcriptLang', 'summaryLength']);
      const preset = getPreset(lang || 'en', fmt, len || 'normal');
      document.getElementById('prompt-input').value = preset;
      updatePromptPreview(preset);
      setOutputFormat(fmt);
      await chrome.storage.local.set({ outputFormat: fmt, customPrompt: preset });
    });
  });

  document.querySelectorAll('.chip-len').forEach(chip => {
    chip.addEventListener('click', async () => {
      const len = chip.dataset.len;
      const { transcriptLang: lang, outputFormat: fmt } =
        await chrome.storage.local.get(['transcriptLang', 'outputFormat']);
      const preset = getPreset(lang || 'en', fmt || 'md', len);
      document.getElementById('prompt-input').value = preset;
      updatePromptPreview(preset);
      setSummaryLength(len);
      await chrome.storage.local.set({ summaryLength: len, customPrompt: preset });
    });
  });

  document.getElementById('job-list').addEventListener('click', e => {
    if (e.target.closest('.job-remove')?.dataset.jobId && !e.target.closest('.job-remove').disabled) {
      removeJob(Number(e.target.closest('.job-remove').dataset.jobId));
      return;
    }
    const editBtn = e.target.closest('.job-edit-btn');
    if (editBtn && !editBtn.disabled) { toggleJobSettings(Number(editBtn.dataset.jobId)); return; }
    const fmtChip = e.target.closest('.job-chip-fmt');
    if (fmtChip && !fmtChip.disabled) { setJobFormat(Number(fmtChip.dataset.jobId), fmtChip.dataset.fmt); return; }
    const lenChip = e.target.closest('.job-chip-len');
    if (lenChip && !lenChip.disabled) { setJobLength(Number(lenChip.dataset.jobId), lenChip.dataset.len); return; }
    const resetBtn = e.target.closest('.job-reset-btn');
    if (resetBtn && !resetBtn.disabled) { resetJobSettings(Number(resetBtn.dataset.jobId)); return; }
  });

  // Per-job language select uses 'change' event (not click)
  document.getElementById('job-list').addEventListener('change', e => {
    const langSel = e.target.closest('.job-lang-select');
    if (langSel && !langSel.disabled) {
      setJobLang(Number(langSel.dataset.jobId), langSel.value);
    }
  });

  let jobPromptTimer = null;
  document.getElementById('job-list').addEventListener('input', e => {
    const ta = e.target.closest('.job-prompt-input');
    if (!ta) return;
    const id = Number(ta.dataset.jobId);
    clearTimeout(jobPromptTimer);
    jobPromptTimer = setTimeout(async () => {
      const job = state.jobs.find(j => j.id === id);
      if (job) {
        job.prompt = ta.value.trim() || null;
        updateJobEditBtn(id, job);
        await chrome.storage.local.set({ jobs: state.jobs });
      }
    }, 600);
  });

  renderJobs();
  if (state.running) setUIAsRunning();
  connectPort();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Port ──────────────────────────────────────────────────────────────────────
function connectPort() {
  try {
    state.port = chrome.runtime.connect({ name: 'popup' });
    state.port.onMessage.addListener(msg => {
      if (msg.type === 'jobUpdate') {
        updateJob(msg.jobId, msg.status, msg.statusText);
      } else if (msg.type === 'jobTitleUpdate') {
        const job = state.jobs.find(j => j.id === msg.jobId);
        if (job && !job.title) {
          job.title = msg.title;
          chrome.storage.local.set({ jobs: state.jobs });
          const el = document.querySelector(`.job-title[data-job-id="${msg.jobId}"]`);
          if (el) { el.textContent = msg.title; el.classList.remove('loading'); }
        }
      } else if (msg.type === 'batchDone') {
        state.running = false;
        chrome.storage.local.set({ running: false });
        setUIAsStopped();
        renderJobs();
        showMsg('✅ Processing complete!', 'ok');
      } else if (msg.type === 'tts-state') {
        updateTTSStatus(msg);
      }
    });
    state.port.onDisconnect.addListener(() => { state.port = null; });
  } catch (_) {
    state.port = null;
  }
}

function ensurePort() {
  if (!state.port) connectPort();
  return state.port;
}

// ── Theme ─────────────────────────────────────────────────────────────────────
async function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  document.getElementById('btn-theme').textContent = isDark ? '☀️' : '🌙';
  await chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
}

// ── Job Management ────────────────────────────────────────────────────────────
async function addUrl() {
  const input = document.getElementById('url-input');
  const url = input.value.trim();
  if (!url) return;

  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    showMsg('Please enter a valid YouTube URL.', 'error');
    return;
  }

  const existing = state.jobs.find(j => j.url === url);
  if (existing) {
    if (existing.status === 'error' || existing.status === 'queued') {
      existing.status = 'queued';
      existing.statusText = 'Queued';
      await chrome.storage.local.set({ jobs: state.jobs });
    }
    input.value = '';
    renderJobs();
    return;
  }

  const job = { id: Date.now(), url, title: null, status: 'queued', statusText: 'Queued', prompt: null, format: null, length: null };
  state.jobs.push(job);
  await chrome.storage.local.set({ jobs: state.jobs });
  input.value = '';
  renderJobs();
  fetchVideoTitle(url).then(title => {
    if (!title) return;
    const j = state.jobs.find(j => j.url === url);
    if (j && !j.title) {
      j.title = title;
      chrome.storage.local.set({ jobs: state.jobs });
      const el = document.querySelector(`.job-title[data-job-id="${j.id}"]`);
      if (el) { el.textContent = title; el.classList.remove('loading'); }
    }
  });
}

async function addCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || (!tab.url.includes('youtube.com/watch') && !tab.url.includes('youtu.be/'))) {
    showMsg('Open a YouTube video in the current tab first.', 'error');
    return;
  }
  const existing = state.jobs.find(j => j.url === tab.url);
  if (existing) {
    if (existing.status === 'error') {
      existing.status = 'queued';
      existing.statusText = 'Queued';
      await chrome.storage.local.set({ jobs: state.jobs });
      renderJobs();
    }
    return;
  }
  const cleanTitle = tab.title ? tab.title.replace(/ - YouTube$/, '').trim() : null;
  state.jobs.push({ id: Date.now(), url: tab.url, title: cleanTitle || null, status: 'queued', statusText: 'Queued', prompt: null, format: null, length: null });
  await chrome.storage.local.set({ jobs: state.jobs });
  renderJobs();
}

async function removeJob(id) {
  if (state.running) return;
  state.jobs = state.jobs.filter(j => j.id !== id);
  await chrome.storage.local.set({ jobs: state.jobs });
  renderJobs();
}

// ── Batch ─────────────────────────────────────────────────────────────────────
async function startBatch() {
  const { apiKeys = {}, provider = 'anthropic' } =
    await chrome.storage.local.get(['apiKeys', 'provider']);

  const pending = state.jobs.filter(j => j.status === 'queued' || j.status === 'error');
  if (pending.length === 0) {
    showMsg('No videos queued for processing.', 'warn');
    return;
  }

  await persistSettings();
  const {
    models = {}, customEndpointUrl, transcriptLang, customPrompt, mode,
    useThinking, autoPaste, autoSubmit, combinedPrompt, saveTranscriptFile, webDelay: storedDelay
  } = await chrome.storage.local.get([
    'models', 'customEndpointUrl', 'transcriptLang', 'customPrompt', 'mode',
    'useThinking', 'autoPaste', 'autoSubmit', 'combinedPrompt', 'saveTranscriptFile', 'webDelay'
  ]);

  const globalFmt = [...document.querySelectorAll('.chip-fmt')].find(c => c.classList.contains('on'))?.dataset.fmt || 'md';
  const globalLen = [...document.querySelectorAll('.chip-len')].find(c => c.classList.contains('on'))?.dataset.len || 'normal';
  const resolvedJobs = state.jobs.map(job => {
    if (job.prompt) return job;
    if (job.format != null || job.length != null) {
      const fmt = job.format ?? globalFmt;
      const len = job.length ?? globalLen;
      return { ...job, prompt: getPreset(transcriptLang || 'en', fmt, len) };
    }
    return job;
  });

  const info          = PROVIDERS[provider] || PROVIDERS.anthropic;
  const currentApiKey = apiKeys[provider] || '';
  const currentModel  = models[provider] || info.defaultModel;
  const currentMode   = mode || 'web';

  if (currentMode === 'api' && !currentApiKey && provider !== 'custom') {
    showMsg(`API mode: set your ${info.name} API Key in Advanced Settings (⚙️) first.`, 'error');
    openPanel('panel-settings');
    return;
  }

  state.running = true;
  await chrome.storage.local.set({ running: true });
  setUIAsRunning();

  const p = ensurePort();
  if (!p) {
    showMsg('Unable to connect to background. Please reload the extension.', 'error');
    state.running = false;
    await chrome.storage.local.set({ running: false });
    setUIAsStopped();
    return;
  }

  p.postMessage({
    type: 'startBatch',
    jobs: resolvedJobs,
    settings: {
      provider,
      apiKey: currentApiKey,
      apiKeys,
      model: currentModel,
      customEndpointUrl: customEndpointUrl || '',
      prompt: customPrompt || getPreset('en', 'md', 'normal'),
      mode: currentMode,
      transcriptLang: transcriptLang || 'en',
      useThinking: !!useThinking,
      autoPaste: !!autoPaste,
      autoSubmit: !!autoSubmit,
      combinedPrompt: !!combinedPrompt,
      saveTranscriptFile: !!saveTranscriptFile,
      webDelay: storedDelay ?? 45
    }
  });
}

async function fetchVideoTitle(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch { return null; }
}

async function resetBatch() {
  state.jobs = state.jobs.map(j =>
    j.status === 'active' ? { ...j, status: 'error', statusText: '❌ Interrupted' } : j
  );
  await chrome.storage.local.set({ jobs: state.jobs, running: false });

  const p = ensurePort();
  if (p) { try { p.postMessage({ type: 'resetState' }); } catch (_) {} }

  state.running = false;
  setUIAsStopped();
  renderJobs();
  showMsg('State reset. You can restart processing.', 'ok');
}
