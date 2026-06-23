/* =====================================================================
 * Service Worker：PWA 离线 + 加速
 *
 * 缓存策略（两层 cache）：
 *   1) shell-<ver>   →  HTML / CSS / JS / Manifest / Icons
 *                       策略：stale-while-revalidate（先返缓存，后台拉新）
 *   2) data-<ver>    →  data/*.json
 *                       策略：network-first，离线回落到上次缓存
 *
 * 跨源资源（ECharts / marked CDN）不走 SW —— 让浏览器 HTTP 缓存接管。
 * 升级流程：CACHE_VERSION 一变，旧 cache 在 activate 时全删；
 *           skipWaiting + clients.claim 让新 SW 立刻接管下一次导航。
 * ===================================================================== */

const CACHE_VERSION = 'v2-20260623a';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const DATA_CACHE  = `data-${CACHE_VERSION}`;

// 关键 app shell：必须能离线加载主页 + 主流程 JS
const SHELL_FILES = [
  './',
  'index.html',
  'css/main.css',
  'js/utils.js',
  'js/app.js',
  'js/pwa.js',
  'js/benchmark-indices.js',
  'js/chart-helpers.js',
  'js/macro-hero.js',
  'js/intel-digest.js',
  'js/summary-table.js',
  'js/stock-cards.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // best-effort precache：单个文件失败不阻断整体安装
    await Promise.all(SHELL_FILES.map((url) =>
      cache.add(url).catch((err) => console.warn('[sw] precache miss', url, err))
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => !n.endsWith(CACHE_VERSION)).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// 允许页面发消息让 SW 立刻 skipWaiting（用于「点了刷新就生效」）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 跨源（CDN）：不拦截
  if (url.origin !== self.location.origin) return;

  // data/* → network-first（JSON / ai_infra HTML 优先拉最新）
  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // js/css → network-first，避免 stale-while-revalidate 长期卡在旧版前端
  if (url.pathname.includes('/js/') || url.pathname.includes('/css/')) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // 其余 shell → stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // 离线、且未缓存：让上层 JS 自己处理
    return new Response(JSON.stringify({ error: 'offline', url: req.url }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
