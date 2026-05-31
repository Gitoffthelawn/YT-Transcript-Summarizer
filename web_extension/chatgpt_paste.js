// chatgpt_paste.js — Content script for chatgpt.com
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
  await sleep(400);

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
      '#prompt-textarea',
      '[contenteditable="true"][data-testid]',
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
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const notCancelled = el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    );
    if (!notCancelled) return;
  } catch (_) {}
  try { document.execCommand('insertText', false, text); } catch (_) {}
}

function clickSend() {
  const SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[data-testid*="send"]',
    'button[type="submit"]',
  ];
  for (const sel of SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) { btn.click(); return true; }
  }
  return false;
}

function submitViaKey(el) {
  const opts = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
  const form = el.closest('form');
  if (form) { try { form.requestSubmit(); } catch (_) {} }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
