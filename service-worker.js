const CACHE_NAME = "phantom-card-battle-v0.1.40";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./version.json",
  "./src/data/cards.js",
  "./src/data/npcs.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/coins/coin-front.webp",
  "./assets/coins/coin-back.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key !== CACHE_NAME)
      .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== location.origin || request.method !== "GET") return;

  const isAppShell = request.mode === "navigate" || [
    "/index.html",
    "/app.js",
    "/style.css",
    "/firebase-config.js",
    "/service-worker.js",
    "/src/data/cards.js",
    "/src/data/npcs.js"
  ].some((path) => url.pathname.endsWith(path));

  if (isAppShell) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
