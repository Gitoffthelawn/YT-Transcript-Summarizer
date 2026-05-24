export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showMsg(text, type = 'ok') {
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
