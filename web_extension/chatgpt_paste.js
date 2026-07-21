// chatgpt_paste.js — Content script for chatgpt.com
// Selectors only; the paste/claim/submit logic lives in paste_common.js.

ytsRunPaste({
  inputSelectors: [
    '#prompt-textarea',
    '[contenteditable="true"][data-testid]',
    '.ProseMirror',
    '[contenteditable="true"]',
    'textarea',
  ],
  sendSelectors: [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[data-testid*="send"]',
    'button[type="submit"]',
  ],
});
