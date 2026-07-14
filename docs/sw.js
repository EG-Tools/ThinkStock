const CACHE_NAME = "thinkstock-dev";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./modules/chart-loader.js?v=dev",
  "./modules/data-worker.js?v=dev",
  "./app.js?v=dev",
  "./manifest.webmanifest",
  "./icon.svg",
  "./data/prices.json",
  "./data/macro_data.json",
  "./data/adr_data.json",
  "./data/credit_data.json",
  "./data/disclosures.json",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => null));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Keep both data and shell files network-first, with cached files as fallback.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isData = url.pathname.includes("/data/");

  if (isData) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
  }
});

// Delete cached data when the app requests REFRESH_DATA.
self.addEventListener("message", (event) => {
  if (event.data === "REFRESH_DATA") {
    const replyPort = event.ports && event.ports[0];
    caches.open(CACHE_NAME).then(async (cache) => {
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((req) => {
            try {
              return new URL(req.url).pathname.includes("/data/");
            } catch (_) {
              return false;
            }
          })
          .map((req) => cache.delete(req))
      );
      if (replyPort) replyPort.postMessage({ ok: true });
    }).catch(() => {
      if (replyPort) replyPort.postMessage({ ok: false });
    });
  }
});
