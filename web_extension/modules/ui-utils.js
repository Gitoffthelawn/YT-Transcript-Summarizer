export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Persistent banner pinned at the top of the queue view. Unlike showMsg it does
// not auto-hide — it stays until dismissed or replaced, so an import count (e.g.
// "100 of 166 imported") remains visible while the user scrolls the queue.
// Pass text === '' to hide it.
export function showBanner(text, type = 'ok') {
  const banner = document.getElementById('import-banner');
  const label  = document.getElementById('import-banner-text');
  if (!banner || !label) return;
  if (!text) { banner.classList.add('hidden'); return; }
  label.textContent = text;
  banner.classList.remove('warn', 'error');
  if (type === 'warn' || type === 'error') banner.classList.add(type);
  banner.classList.remove('hidden');
}

export function showMsg(text, type = 'ok') {
  const btnMsg  = document.getElementById('btn-msg');
  const mainView = document.getElementById('main-view');

  if (btnMsg && mainView && !mainView.classList.contains('hidden')) {
    const isError = type === 'error';
    const isWarn  = type === 'warn';
    btnMsg.textContent  = text;
    btnMsg.style.background   = isError ? 'rgba(239,68,68,0.2)'  : isWarn ? 'rgba(234,179,8,0.2)'  : 'rgba(34,197,94,0.2)';
    btnMsg.style.borderColor  = isError ? 'rgba(239,68,68,0.4)'  : isWarn ? 'rgba(234,179,8,0.4)'  : 'rgba(34,197,94,0.4)';
    btnMsg.style.color        = isError ? '#f87171'               : isWarn ? '#fbbf24'               : '#4ade80';
    btnMsg.classList.remove('hidden');
    clearTimeout(btnMsg._hideTimer);
    btnMsg._hideTimer = setTimeout(() => btnMsg.classList.add('hidden'), 3000);
    return;
  }

  // Fallback floating toast — used when main view is hidden (e.g. TTS panel open)
  const existing = document.getElementById('toast-msg');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'toast-msg';
  el.textContent = text;
  el.style.cssText = `
    position: fixed; bottom: 70px; left: 12px; right: 12px;
    padding: 10px 14px; border-radius: 8px; font-size: 12px;
    font-weight: 500; z-index: 9999; text-align: center;
    animation: fadeIn 0.2s ease;
    background: ${type === 'error' ? 'rgba(239,68,68,0.2)' : type === 'warn' ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)'};
    border: 1px solid ${type === 'error' ? 'rgba(239,68,68,0.4)' : type === 'warn' ? 'rgba(234,179,8,0.4)' : 'rgba(34,197,94,0.4)'};
    color: ${type === 'error' ? '#f87171' : type === 'warn' ? '#fbbf24' : '#4ade80'};
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
