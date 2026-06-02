let utterance = null;
let currentRate = 1.0;
let utteranceId = 0;
let currentVoiceName = '';
let isSpeechPlaying = false;
let isSpeechPaused = false;
let isActive = false;
let chunks = [];
let chunkIndex = 0;
let chunkRetries = 0;
let watchdogTimer = null;
let rateChangeTimer = null;
let resumeInfinityTimer = null;

let localPlayId = 0;
let localAudioCtx = null;
let localAudioSource = null;
let isLocalPlaying = false;
let isLocalPaused = false;

const MAX_RETRIES = 3;
const WATCHDOG_MS = 3500;
const CANCEL_DELAY = 250;

function setState(data) {
  chrome.runtime.sendMessage({ type: 'tts-state', ...data }).catch(() => {});
}

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

function clearResumeInfinity() {
  if (resumeInfinityTimer) { clearInterval(resumeInfinityTimer); resumeInfinityTimer = null; }
}

function stopLocalAudio() {
  if (localAudioSource) { try { localAudioSource.stop(); } catch (_) {} localAudioSource = null; }
  if (localAudioCtx) { localAudioCtx.close().catch(() => {}); localAudioCtx = null; }
  isLocalPlaying = false;
  isLocalPaused = false;
}

async function playViaLocalServer(url, text) {
  localPlayId++;
  const id = localPlayId;
  stopLocalAudio();
  const cleanText = stripMarkdown(text);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: cleanText, text: cleanText })
    });
    if (localPlayId !== id) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (localPlayId !== id) return;
    localAudioCtx = new AudioContext();
    const audioBuffer = await localAudioCtx.decodeAudioData(buf);
    if (localPlayId !== id) return;
    localAudioSource = localAudioCtx.createBufferSource();
    localAudioSource.buffer = audioBuffer;
    localAudioSource.connect(localAudioCtx.destination);
    isLocalPlaying = true;
    isLocalPaused = false;
    localAudioSource.onended = () => {
      if (localPlayId !== id) return;
      isLocalPlaying = false;
      isLocalPaused = false;
      localAudioSource = null;
      setState({ playing: false, paused: false });
    };
    localAudioSource.start();
    setState({ playing: true, paused: false });
  } catch (err) {
    if (localPlayId !== id) return;
    isLocalPlaying = false;
    setState({ playing: false, paused: false, error: 'local_tts_error' });
  }
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/_{2}(.+?)_{2}/gs, '$1')
    .replace(/_(.+?)_/gs, '$1')
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[-]{3,}/gm, '')
    .replace(/={3,}/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitIntoChunks(text, maxLen = 250) {
  if (text.length <= maxLen) return [text];
  const result = [];
  let start = 0;
  while (start < text.length) {
    if (start + maxLen >= text.length) {
      result.push(text.slice(start).trim());
      break;
    }
    let cut = start + maxLen;
    for (let i = cut; i > start + maxLen / 2; i--) {
      if ('.?!'.includes(text[i]) && text[i + 1] === ' ') { cut = i + 2; break; }
    }
    if (cut === start + maxLen) {
      const sp = text.lastIndexOf(' ', cut);
      if (sp > start) cut = sp + 1;
    }
    result.push(text.slice(start, cut).trim());
    start = cut;
  }
  return result.filter(c => c.length > 0);
}

function speakChunk(id) {
  if (utteranceId !== id || chunkIndex >= chunks.length) return;

  utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
  utterance.rate = currentRate;

  if (currentVoiceName) {
    const voice = speechSynthesis.getVoices().find(v => v.name === currentVoiceName);
    if (voice) utterance.voice = voice;
  }

  // If onstart doesn't fire within WATCHDOG_MS, the engine is frozen — retry.
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    if (utteranceId !== id) return;
    if (chunkRetries < MAX_RETRIES) {
      chunkRetries++;
      speechSynthesis.cancel();
      setTimeout(() => { if (utteranceId === id) speakChunk(id); }, CANCEL_DELAY);
    } else {
      isActive = false;
      isSpeechPlaying = false;
      isSpeechPaused = false;
      utterance = null;
      setState({ playing: false, paused: false });
    }
  }, WATCHDOG_MS);

  utterance.onstart = () => {
    if (utteranceId !== id) return;
    clearWatchdog();
    chunkRetries = 0;
    isSpeechPlaying = true;
    isSpeechPaused = false;
    setState({ playing: true, paused: false });
    // Chrome silently freezes mid-utterance (after onstart) without firing any event.
    // Calling pause()+resume() every 5 s keeps the engine alive.
    clearResumeInfinity();
    resumeInfinityTimer = setInterval(() => {
      if (isSpeechPlaying && !isSpeechPaused) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 5000);
  };

  utterance.onend = () => {
    if (utteranceId !== id) return;
    clearWatchdog();
    clearResumeInfinity();
    chunkIndex++;
    if (chunkIndex < chunks.length) {
      setTimeout(() => speakChunk(id), 50);
    } else {
      isActive = false;
      utterance = null;
      isSpeechPlaying = false;
      isSpeechPaused = false;
      setState({ playing: false, paused: false });
    }
  };

  utterance.onerror = (e) => {
    if (utteranceId !== id) return;
    clearWatchdog();
    clearResumeInfinity();
    if (e.error === 'interrupted') return;
    if (chunkRetries < MAX_RETRIES) {
      chunkRetries++;
      setTimeout(() => { if (utteranceId === id) speakChunk(id); }, CANCEL_DELAY);
      return;
    }
    isActive = false;
    utterance = null;
    isSpeechPlaying = false;
    isSpeechPaused = false;
    setState({ playing: false, paused: false, error: e.error });
  };

  speechSynthesis.speak(utterance);
}

function doSpeak(text) {
  clearWatchdog();
  clearResumeInfinity();
  if (rateChangeTimer) { clearTimeout(rateChangeTimer); rateChangeTimer = null; }
  utteranceId++;
  const id = utteranceId;
  isActive = true;
  isSpeechPlaying = false;
  isSpeechPaused = false;
  chunkRetries = 0;
  chunks = splitIntoChunks(text);
  chunkIndex = 0;
  speechSynthesis.cancel();
  // Chrome silently drops speak() calls issued immediately after cancel().
  // 250ms gives the engine enough time to fully reset.
  setTimeout(() => { if (utteranceId === id) speakChunk(id); }, CANCEL_DELAY);
}

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'tts-speak': {
      localPlayId++;
      stopLocalAudio();
      currentRate = msg.rate ?? currentRate;
      currentVoiceName = msg.voiceName || '';
      const cleanText = stripMarkdown(msg.text);
      doSpeak(cleanText);
      break;
    }

    case 'tts-speak-local': {
      clearWatchdog();
      clearResumeInfinity();
      if (rateChangeTimer) { clearTimeout(rateChangeTimer); rateChangeTimer = null; }
      utteranceId++;
      isActive = false;
      isSpeechPlaying = false;
      isSpeechPaused = false;
      chunks = [];
      chunkIndex = 0;
      speechSynthesis.cancel();
      utterance = null;
      playViaLocalServer(msg.url, msg.text);
      break;
    }

    case 'tts-pause':
      if (isLocalPlaying && !isLocalPaused && localAudioCtx) {
        localAudioCtx.suspend().catch(() => {});
        isLocalPaused = true;
        setState({ playing: true, paused: true });
        break;
      }
      // Cancel-based pause: more reliable than speechSynthesis.pause() which
      // can silently fail. chunkIndex is preserved so resume restarts this chunk.
      if (!isSpeechPaused && isActive) {
        clearWatchdog();
        clearResumeInfinity();
        if (rateChangeTimer) { clearTimeout(rateChangeTimer); rateChangeTimer = null; }
        utteranceId++;
        speechSynthesis.cancel();
        isSpeechPlaying = false;
        isSpeechPaused = true;
        setState({ playing: true, paused: true });
      }
      break;

    case 'tts-resume':
      if (isLocalPaused && localAudioCtx) {
        localAudioCtx.resume().catch(() => {});
        isLocalPaused = false;
        isLocalPlaying = true;
        setState({ playing: true, paused: false });
        break;
      }
      // Restart from the current chunk; any rate/voice changes made while
      // paused are automatically applied because speakChunk reads currentRate
      // and currentVoiceName fresh each time.
      if (isSpeechPaused && chunkIndex < chunks.length) {
        isSpeechPaused = false;
        chunkRetries = 0;
        const id = ++utteranceId;
        speechSynthesis.cancel();
        setTimeout(() => { if (utteranceId === id) speakChunk(id); }, CANCEL_DELAY);
      }
      break;

    case 'tts-stop':
      clearWatchdog();
      clearResumeInfinity();
      if (rateChangeTimer) { clearTimeout(rateChangeTimer); rateChangeTimer = null; }
      utteranceId++;
      isActive = false;
      isSpeechPlaying = false;
      isSpeechPaused = false;
      chunks = [];
      chunkIndex = 0;
      chunkRetries = 0;
      speechSynthesis.cancel();
      utterance = null;
      localPlayId++;
      stopLocalAudio();
      setState({ playing: false, paused: false });
      break;

    case 'tts-rate':
      currentRate = msg.rate;
      if (isSpeechPlaying && !isSpeechPaused) {
        clearTimeout(rateChangeTimer);
        rateChangeTimer = setTimeout(() => {
          if (!isSpeechPlaying || isSpeechPaused) return;
          clearWatchdog();
          clearResumeInfinity();
          utteranceId++;
          const id = utteranceId;
          speechSynthesis.cancel();
          setTimeout(() => { if (utteranceId === id) speakChunk(id); }, CANCEL_DELAY);
        }, 400);
      }
      break;

    case 'tts-voice':
      currentVoiceName = msg.voiceName || '';
      break;
  }
});
