// claude_paste.js — Content script for claude.ai
// Reads pending transcript+prompt from storage and auto-pastes into the chat input.

(async () => {
  const { pendingLLMContent } = await chrome.storage.local.get('pendingLLMContent');
  if (!pendingLLMContent) return;

  await chrome.storage.local.remove('pendingLLMContent');
  const { text, autoSubmit } = pendingLLMContent;

  const input = await waitForInput(15000);
  if (!input) return;

  input.focus();
  await sleep(400);

  pasteText(input, text);
  await sleep(400); // give the framework time to process the paste event

  if (autoSubmit) {
    await sleep(800);
    let attempts = 0;
    let sent = false;
    while (attempts < 6 && !sent) {
      if (clickSend()) {
        sent = true;
      } else {
        await sleep(500);
        attempts++;
      }
    }
    if (!sent) submitViaKey(input);
  }
})();

function waitForInput(timeoutMs) {
  return new Promise((resolve) => {
    const SELECTORS = [
      '[contenteditable="true"][role="textbox"]',
      '.ProseMirror',
      '[contenteditable="true"]',
      'textarea',
    ];

    const find = () => {
      for (const sel of SELECTORS) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      }
      return null;
    };

    const el = find();
    if (el) return resolve(el);

    const obs = new MutationObserver(() => {
      const found = find();
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(find()); }, timeoutMs);
  });
}

function pasteText(el, text) {
  // Method 1: ClipboardEvent — ProseMirror/Lexical/React editors handle this and call
  // preventDefault(), which makes dispatchEvent() return false. Use that as the signal
  // that the framework took over, so we skip Method 2 (avoiding double-paste).
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const notCancelled = el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    );
    if (!notCancelled) return; // framework called preventDefault() → paste was handled
  } catch (_) {}

  // Method 2: execCommand fallback — only reached if no framework intercepted the event
  try { document.execCommand('insertText', false, text); } catch (_) {}
}

function clickSend() {
  const SELECTORS = [
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label*="Invia"]',
    'button[data-testid*="send"]',
    'button[data-testid*="submit"]',
    'button[type="submit"]',
  ];
  for (const sel of SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) { btn.click(); return true; }
  }
  return false;
}

function submitViaKey(el) {
  // Dispatch both keydown and keyup — some frameworks listen to one, some to both
  const opts = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));

  // Ultimate fallback: native form submit
  const form = el.closest('form');
  if (form) { try { form.requestSubmit(); } catch (_) {} }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
