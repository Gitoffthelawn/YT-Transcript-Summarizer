import { state } from './popup-state.js';
import { escHtml, showMsg } from './ui-utils.js';

export function populateTTSVoices(savedVoice) {
  const sel = document.getElementById('tts-voice');
  if (!sel) return;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  sel.innerHTML = '<option value="">Default</option>' +
    voices.map(v =>
      `<option value="${escHtml(v.name)}"${v.name === savedVoice ? ' selected' : ''}>${escHtml(v.name)} (${v.lang})</option>`
    ).join('');
}

export function sendTTS(msg) {
  try { if (state.port) state.port.postMessage(msg); } catch (_) {}
}

export async function ttsPlay() {
  const text = document.getElementById('tts-text').value.trim();
  if (!text) { showMsg('Paste some text to read aloud.', 'warn'); return; }

  const playBtn = document.getElementById('tts-btn-play');
  const statusEl = document.getElementById('tts-status-text');
  if (playBtn) playBtn.disabled = true;
  if (statusEl) { statusEl.textContent = '◌ Starting…'; statusEl.className = 'tts-status-text'; }

  const { ttsLocalUrl } = await chrome.storage.local.get('ttsLocalUrl');
  if (ttsLocalUrl) {
    sendTTS({ type: 'tts-speak-local', url: ttsLocalUrl, text });
    return;
  }

  const rate = parseFloat(document.getElementById('tts-rate').value);
  const voiceName = document.getElementById('tts-voice').value;
  if (voiceName) chrome.storage.local.set({ ttsVoice: voiceName });
  sendTTS({ type: 'tts-speak', text, rate, voiceName: voiceName || undefined });
}

export function ttsPauseResume() {
  if (state.ttsPlaying && !state.ttsPaused) sendTTS({ type: 'tts-pause' });
  else if (state.ttsPlaying && state.ttsPaused) sendTTS({ type: 'tts-resume' });
}

export function ttsStop() {
  sendTTS({ type: 'tts-stop' });
}

export function updateTTSStatus(st) {
  state.ttsPlaying = !!st.playing;
  state.ttsPaused  = !!st.paused;

  const statusEl = document.getElementById('tts-status-text');
  const playBtn  = document.getElementById('tts-btn-play');
  const pauseBtn = document.getElementById('tts-btn-pauseresume');
  const stopBtn  = document.getElementById('tts-btn-stop');
  if (!statusEl) return;

  if (st.error === 'tts_unsupported') {
    statusEl.textContent = '⚠️ TTS not supported';
    statusEl.className = 'tts-status-text error';
    if (playBtn)  playBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
    if (stopBtn)  stopBtn.disabled = true;
    return;
  }

  if (state.ttsPlaying && !state.ttsPaused) {
    statusEl.textContent = '● Playing';
    statusEl.className = 'tts-status-text playing';
    if (playBtn)  playBtn.disabled = true;
    if (pauseBtn) { pauseBtn.textContent = '⏸'; pauseBtn.disabled = false; }
    if (stopBtn)  stopBtn.disabled = false;
  } else if (state.ttsPlaying && state.ttsPaused) {
    statusEl.textContent = '⏸ Paused';
    statusEl.className = 'tts-status-text paused';
    if (playBtn)  playBtn.disabled = true;
    if (pauseBtn) { pauseBtn.textContent = '▶'; pauseBtn.disabled = false; }
    if (stopBtn)  stopBtn.disabled = false;
  } else {
    statusEl.textContent = st.error ? '❌ Error' : '';
    statusEl.className = 'tts-status-text';
    if (playBtn)  playBtn.disabled = false;
    if (pauseBtn) { pauseBtn.textContent = '⏸'; pauseBtn.disabled = true; }
    if (stopBtn)  stopBtn.disabled = true;
  }
}
