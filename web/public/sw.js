/* NULLNODE service worker — app shell offline, nothing else.
 *
 * Hard rule: /api/ and /auth/ are never touched. Caching a model answer or a
 * login redirect would be both useless and a privacy leak into the browser's
 * cache storage. Only the static shell is persisted.
 */
const VERSION = 'nullnode-v1';
const SHELL = `${VERSION}-shell`;
const KEEP = [SHELL];

const OFFLINE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>HORS LIGNE</title>
<style>body{margin:0;height:100dvh;display:grid;place-items:center;background:#04070a;color:#63796f;
font:13px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-align:center;padding:2rem}
b{color:#22e07a;display:block;margin-bottom:.6rem;font-weight:600}</style></head>
<body><div><b>// LIAISON INTERROMPUE</b>NŒUD INJOIGNABLE — RÉESSAYEZ UNE FOIS LE RÉSEAU REVENU</div></body></html>`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isCacheable = (res) =>
  res && res.ok && res.type === 'basic' && !res.redirected && !new URL(res.url).pathname.startsWith('/auth/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Navigations: always try the network first, so a logged-out session gets
  // its redirect to the login form instead of a stale shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (isCacheable(res)) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match('/');
          return cached || new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        })
    );
    return;
  }

  // Hashed build assets are immutable: cache-first is always correct here.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          if (isCacheable(res)) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // Icons, manifest: serve from cache, refresh in the background.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(request).then((hit) => {
        const network = fetch(request).then((res) => {
          if (isCacheable(res)) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        });
        return hit || network;
      })
    );
  }
});
