// claude_paste.js — Content script for claude.ai
// Selectors only; the paste/claim/submit logic lives in paste_common.js.

ytsRunPaste({
  inputSelectors: [
    '[contenteditable="true"][role="textbox"]',
    '.ProseMirror',
    '[contenteditable="true"]',
    'textarea',
  ],
  sendSelectors: [
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label*="Invia"]',
    'button[data-testid*="send"]',
    'button[data-testid*="submit"]',
    'button[type="submit"]',
  ],
  // Shown while Claude is answering; used to pace a multi-part transcript.
  stopSelectors: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="Interrompi"]',
    'button[data-testid="stop-button"]',
  ],
});
