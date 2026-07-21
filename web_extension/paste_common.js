// paste_common.js — shared auto-paste logic for the provider content scripts.
// Loaded before claude_paste.js / chatgpt_paste.js / gemini_paste.js, which now
// only declare their selectors. The three files used to carry three drifting
// copies of this code.

// The payload is only valid for a short while after the background opened the
// tab. Without this, a payload left behind by a tab that was closed before it
// loaded stayed in storage forever and got pasted into an unrelated visit days
// later.
const PENDING_TTL_MS = 5 * 60 * 1000;

function ytsSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Take ownership of the pending payload without deleting it yet: two chat tabs
 * loading at the same time must not both paste, but a paste that never happens
 * (slow page, logged out) must not destroy the transcript either.
 */
async function ytsClaimPending() {
  const { pendingLLMContent } = await chrome.storage.local.get('pendingLLMContent');
  if (!pendingLLMContent?.text) return null;

  if (pendingLLMContent.ts && Date.now() - pendingLLMContent.ts > PENDING_TTL_MS) {
    await chrome.storage.local.remove('pendingLLMContent');
    return null;
  }
  if (pendingLLMContent.claimedBy && Date.now() - (pendingLLMContent.claimedAt || 0) < 60000) {
    return null; // another tab is already handling it
  }

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await chrome.storage.local.set({
    pendingLLMContent: { ...pendingLLMContent, claimedBy: token, claimedAt: Date.now() }
  });
  // Re-read: if another tab claimed it in the meantime, its token wins.
  const { pendingLLMContent: after } = await chrome.storage.local.get('pendingLLMContent');
  if (after?.claimedBy !== token) return null;
  return { text: after.text, autoSubmit: after.autoSubmit };
}

async function ytsReleasePending(consumed) {
  if (consumed) {
    await chrome.storage.local.remove('pendingLLMContent');
    return;
  }
  // Hand it back so the next attempt (a reload, or another tab) can pick it up.
  const { pendingLLMContent } = await chrome.storage.local.get('pendingLLMContent');
  if (!pendingLLMContent) return;
  const { claimedBy, claimedAt, ...rest } = pendingLLMContent;
  await chrome.storage.local.set({ pendingLLMContent: rest });
}

function ytsWaitForInput(selectors, timeoutMs) {
  return new Promise((resolve) => {
    const find = () => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      }
      return null;
    };

    const el = find();
    if (el) return resolve(el);

    let timer = null;
    const obs = new MutationObserver(() => {
      const found = find();
      if (found) { clearTimeout(timer); obs.disconnect(); resolve(found); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(() => { obs.disconnect(); resolve(find()); }, timeoutMs);
  });
}

function ytsPasteText(el, text) {
  // Method 1: ClipboardEvent — ProseMirror/Lexical/React editors handle this and call
  // preventDefault(), which makes dispatchEvent() return false. Use that as the signal
  // that the framework took over, so we skip Method 2 (avoiding double-paste).
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const notCancelled = el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    );
    if (!notCancelled) return true; // framework called preventDefault() → paste was handled
  } catch (_) {}

  // Method 2: execCommand fallback — only reached if no framework intercepted the event
  try { if (document.execCommand('insertText', false, text)) return true; } catch (_) {}

  // Method 3: plain <textarea>/<input>, where neither of the above applies.
  try {
    if ('value' in el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  } catch (_) {}
  return false;
}

// Did any of the text actually make it into the editor? Guards against silently
// dropping the transcript when a site changes its input handling.
function ytsInputHasText(el, text) {
  const probe = text.slice(0, 40).trim();
  const current = ('value' in el && typeof el.value === 'string') ? el.value : (el.innerText || el.textContent || '');
  return current.length > 20 && (!probe || current.includes(probe.slice(0, 20)));
}

function ytsClickSend(selectors) {
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { btn.click(); return true; }
  }
  return false;
}

function ytsSubmitViaKey(el) {
  // Dispatch both keydown and keyup — some frameworks listen to one, some to both
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));

  // Ultimate fallback: native form submit
  const form = el.closest('form');
  if (form) { try { form.requestSubmit(); } catch (_) {} }
}

/**
 * Entry point used by each provider script.
 * @param {{inputSelectors: string[], sendSelectors: string[]}} cfg
 */
async function ytsRunPaste(cfg) {
  const pending = await ytsClaimPending();
  if (!pending) return;

  let consumed = false;
  try {
    const input = await ytsWaitForInput(cfg.inputSelectors, 20000);
    if (!input) return; // released in `finally`, so the payload survives

    input.focus();
    await ytsSleep(400);

    ytsPasteText(input, pending.text);
    await ytsSleep(600); // give the framework time to process the paste event

    if (!ytsInputHasText(input, pending.text)) {
      console.warn('[YT Summarizer] paste did not reach the editor — leaving the payload for a retry');
      return;
    }
    consumed = true;

    if (pending.autoSubmit) {
      await ytsSleep(800);
      let sent = false;
      for (let attempts = 0; attempts < 6 && !sent; attempts++) {
        if (ytsClickSend(cfg.sendSelectors)) sent = true;
        else await ytsSleep(500);
      }
      if (!sent) ytsSubmitViaKey(input);
    }
  } finally {
    await ytsReleasePending(consumed);
  }
}
