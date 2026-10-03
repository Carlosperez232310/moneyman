// MoneyMan service worker: cache-first app shell, network-first for the encrypted data blob.
const CACHE = 'moneyman-__VER__';
const DATA_CACHE = 'moneyman-data';
const ASSETS = ['./', 'index.html', 'css/app.css?v=__VER__', 'js/app.js?v=__VER__', 'manifest.json',
  'fonts/inter.woff2', 'fonts/sora.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Encrypted data: always try the network first (bypassing HTTP caches), fall back to the last good copy offline.
  if (url.pathname.endsWith('/data.enc.json')) {
    e.respondWith(fetch(new Request(url.pathname + '?t=' + Date.now(), {cache: 'no-store'})).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(DATA_CACHE).then(x => x.put('data.enc.json', c)); return r; }
      throw new Error('bad status ' + r.status);
    }).catch(() => caches.open(DATA_CACHE).then(x => x.match('data.enc.json')).then(hit => hit ||
      new Response('{"error":"offline"}', {status: 503, headers: {'Content-Type': 'application/json'}}))));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(hit => {
      const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put('index.html', c)); } return r; });
      return hit ? (net.catch(() => hit), hit) : net.catch(() => caches.match('./'));
    }));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r;
  })));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
