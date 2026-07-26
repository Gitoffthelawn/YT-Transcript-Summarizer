// gemini_paste.js — Content script for gemini.google.com
// Selectors only; the paste/claim/submit logic lives in paste_common.js.

ytsRunPaste({
  inputSelectors: [
    'rich-textarea .ql-editor',
    '.ql-editor',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea',
  ],
  sendSelectors: [
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label*="Invia"]',
    'button[data-testid*="send"]',
    '.send-button',
    'button[type="submit"]',
  ],
  // Shown while Gemini is answering; used to pace a multi-part transcript.
  stopSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="Interrompi"]',
    '.stop-icon',
  ],
});
