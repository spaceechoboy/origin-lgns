/* Origin LGNS PWA service worker — 앱 셸 캐시(설치형 PWA 조건) + network-first.
   외부 RPC/API/CDN(폰트·차트)은 통과(캐시 안 함). 두 페이지(시세/이율) 공통. */
const CACHE = 'origin-lgns-shell-v1';
const SHELL = [
  './', './index.html', './rates.html', './manifest.json',
  './assets/shell.css', './assets/symbol.png',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-180.png', './icons/favicon-32.png', './icons/favicon-16.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(u)));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 같은 출처(앱 셸)만 network-first→cache 폴백. 외부 RPC/API/CDN은 그대로 통과.
  if (url.origin === location.origin && e.request.method === 'GET') {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html')))
    );
  }
});
