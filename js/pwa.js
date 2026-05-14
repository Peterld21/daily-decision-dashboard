/**
 * PWA 注册：
 *  - 注册同源相对路径 sw.js（兼容 Cloudflare 根路径 + GitHub Pages 子路径）
 *  - 检测到新版本后弹一个非阻塞的「有新版本，刷新」toast
 *
 * 不影响主流程：注册逻辑全部 try/catch，失败时静默退化为普通网页。
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js', { scope: './' })
      .then((reg) => {
        // 已经有 worker 在等待 → 直接提示更新
        if (reg.waiting) showUpdateToast(reg);

        // 新版本检测：installing → installed（在 waiting 中）就提示
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(reg);
            }
          });
        });

        // 定时检查（每 30 分钟），适合长时间挂在前台的场景
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      })
      .catch((err) => console.warn('[pwa] sw register failed', err));

    // controllerchange 表示新 SW 接管，刷新页面拿新资源
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

function showUpdateToast(reg) {
  if (document.getElementById('pwa-update-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'pwa-update-toast';
  toast.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)',
    'bottom:calc(env(safe-area-inset-bottom,0) + 16px)',
    'background:#1565c0', 'color:#fff', 'padding:0.6rem 1rem',
    'border-radius:999px', 'font-size:0.85rem', 'font-weight:600',
    'box-shadow:0 4px 12px rgba(0,0,0,0.18)',
    'z-index:9999', 'display:flex', 'align-items:center', 'gap:0.5rem',
    'max-width:calc(100% - 32px)',
  ].join(';');
  toast.innerHTML = `
    <span>有新版本</span>
    <button id="pwa-refresh-btn" style="background:#fff;color:#1565c0;border:0;padding:0.3rem 0.7rem;border-radius:999px;font-weight:700;font-size:0.78rem;cursor:pointer;">刷新</button>
    <button id="pwa-dismiss-btn" aria-label="关闭" style="background:transparent;color:#fff;border:0;padding:0 0.3rem;font-size:1rem;cursor:pointer;line-height:1;">×</button>
  `;
  document.body.appendChild(toast);

  document.getElementById('pwa-refresh-btn').onclick = () => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  document.getElementById('pwa-dismiss-btn').onclick = () => toast.remove();
}
