// Cache du navigateur pour la version web : les modèles 3D, les voix et les fichiers du jeu ne sont téléchargés qu'une fois.
const CACHE = 'dernier-relais-cinematic-v4';
// Jamais de réponse vide : sans réseau ni cache, le navigateur reçoit une erreur réseau ordinaire.
const orError = r => r || Response.error();
const STATIC = /\/(models|voix|pano|icons|assets)\//;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()),
));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (STATIC.test(url.pathname)) {
    // Fichiers lourds : cache d'abord, rafraîchi en arrière-plan.
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => orError(hit));
      return hit || net;
    }));
  } else {
    // Page et scripts : réseau d'abord (toujours la dernière version), cache en secours hors connexion.
    e.respondWith(fetch(req).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(req, r.clone())); return r; }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(orError)));
  }
});
