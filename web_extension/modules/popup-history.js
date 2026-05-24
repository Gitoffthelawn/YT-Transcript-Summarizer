import { escHtml } from './ui-utils.js';

export async function renderHistory() {
  const { videoHistory = [] } = await chrome.storage.local.get('videoHistory');
  const list = document.getElementById('history-list');
  if (videoHistory.length === 0) {
    list.innerHTML = '<div class="empty-state">No videos processed yet.</div>';
    return;
  }
  list.innerHTML = videoHistory.map(e => {
    const d = new Date(e.date);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="history-item">
      <a class="history-link" href="#" data-url="${escHtml(e.url)}" title="${escHtml(e.url)}">${escHtml(e.title)}</a>
      <span class="history-date">${escHtml(dateStr)}</span>
    </div>`;
  }).join('');
}

export async function clearHistory() {
  await chrome.storage.local.remove('videoHistory');
  await renderHistory();
}
