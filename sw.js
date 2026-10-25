/* Carnet value — service worker : permet d'ouvrir l'app sans réseau.
   Change VERSION à chaque nouvelle version du code pour forcer la mise à jour. */
const VERSION = "carnet-v1";
const SHELL = ["./", "./index.html", "./config.js", "./supabase-db.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll([...SHELL, CDN])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isShell = url.origin === self.location.origin;
  const isStatic = req.url === CDN || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!isShell && !isStatic) return; // les données Supabase passent toujours par le réseau
  if (isShell) {
    // réseau d'abord (pour recevoir les nouvelles versions), cache si hors ligne
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })));
  }
});
