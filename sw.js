/* Service worker de Photos ESAM : l'appli s'ouvre et fonctionne sans réseau une fois visitée.
   Stratégie « cache d'abord, puis réseau » pour les fichiers de l'appli, dans un cache versionné.
   VERSION doit rester égale à APP_VERSION de index.html (vérifié par tests/test_fumee.mjs) : changer la version
   est ce qui fait proposer la mise à jour (« Nouvelle version disponible : recharger »).
   Aucune requête vers un autre domaine : seules les requêtes GET de la même origine, dans la portée de l'appli,
   passent par ici ; tout le reste est laissé au navigateur, sans mise en cache. */
"use strict";
const VERSION = "0.17";
const PREFIXE = "esam-picture-v";
const CACHE = PREFIXE + VERSION;
/* fichiers de l'appli, relatifs à sw.js (l'appli est publiée sous /esam-picture/) */
const FICHIERS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "vendor/anton-latin.woff2",
  "vendor/montserrat-latin.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png"
];

/* installation : précache (en contournant le cache HTTP pour prendre les fichiers de cette version) ;
   le nouveau service worker attend ensuite que l'utilisateur accepte la mise à jour (message « skipWaiting ») */
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS.map(f => new Request(f, {cache: "reload"})))));
});

/* activation : suppression des caches des versions précédentes (les seuls de l'appli : préfixe esam-picture-v) */
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf(PREFIXE) === 0 && k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener("message", e => {
  if(e.data && e.data.type === "skipWaiting") self.skipWaiting();
});

/* réponse du cache, sinon réseau puis mise en cache ; une page demandée hors ligne et absente du cache reçoit index.html */
self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin || req.url.indexOf(self.registration.scope) !== 0) return;
  if(req.headers.has("range")) return;   // lecture partielle (vidéo) : laissée au navigateur
  const page = req.mode === "navigate";
  e.respondWith(caches.open(CACHE).then(c => c.match(req, {ignoreSearch: page}).then(hit => {
    if(hit) return hit;
    return fetch(req).then(res => {
      if(res.ok && res.type === "basic") c.put(req, res.clone());
      return res;
    }, err => {
      if(page) return c.match("index.html").then(r => r || Promise.reject(err));
      throw err;
    });
  })));
});
