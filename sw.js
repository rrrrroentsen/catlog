/* CatLog 猫咪日志 —— 离线缓存。
   做法：本站的文件「先走网络，3.5 秒没回来或者断网就用上次缓存的」。所以更新代码后不用改这里的版本号。
   同一个域名下还有别的工具，这里只碰 catlog- 开头的缓存，只管自己这个文件夹里的请求。 */
'use strict';
const CACHE = 'catlog-cache-v1';
const SCOPE = new URL('./', self.location.href);
const FILES = ['./', 'index.html', 'styles.css', 'core.js', 'charts.js', 'app.js', 'manifest.webmanifest', 'fredoka-500.woff2', 'fredoka-600.woff2', 'icon-192.png', 'apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.indexOf('catlog-') === 0 && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || url.pathname.indexOf(SCOPE.pathname) !== 0) return;   // 别的工具、后端接口都不管
  event.respondWith(networkFirst(req));
});
function networkFirst(req) {
  return caches.open(CACHE).then((cache) => {
    const fromNet = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; });
    const timeout = new Promise((resolve) => setTimeout(resolve, 3500));
    return Promise.race([fromNet.catch(() => undefined), timeout]).then((res) => {
      if (res) return res;
      return cache.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined)).then((hit) => hit || fromNet);
    });
  });
}
