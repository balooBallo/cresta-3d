/* Service worker: rende disponibile l'app (shell) offline.
 * Le tile delle mappe sono gestite dalla pagina tramite Cache Storage (cache "fm-rt" e "pack-*"). */
const SHELL = 'shell-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Rete prima (così gli aggiornamenti arrivano), cache se offline
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(SHELL).then(ca => ca.put(e.request, c)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
