const CACHE = 'agu-preview-v1';
const ROOT = new URL('./', self.location.href);
const SHELL = [
  './', './index.html', './styles.css', './chapter.css', './capabilities.css', './use.css',
  './app.js', './console.js', './head-tracking.js', './install.js', './vendor/gsap.min.js',
  './manifest.webmanifest', './assets/metal-human-poster.jpg', './assets/agu-pixel.svg',
  './assets/app-icon-192.png', './assets/app-icon-512.png',
].map(path => new URL(path, ROOT).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('agu-preview-') && key !== CACHE).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never intercept video ranges, external services, API traffic or writes.
  if (request.method !== 'GET' || request.headers.has('range') || url.origin !== ROOT.origin) return;
  const isPage = request.mode === 'navigate' && [ROOT.pathname, `${ROOT.pathname}index.html`].includes(url.pathname);
  if (!isPage && !SHELL.includes(url.href)) return;
  const key = isPage ? ROOT.href : url.href;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && response.status === 200 && response.type !== 'opaque') {
        // Finish cache writes before the worker can be suspended.
        await cache.put(key, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      const cached = await cache.match(key);
      if (cached) return cached;
      return new Response('AGU is unavailable offline. Reconnect and try again.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
