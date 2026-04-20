const CACHE_NAME = "thinkstock-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./data/prices.json",
  "./data/macro_data.json",
  "./data/sample_macro_data.csv",
  "./data/adr_data.json",
  "./data/credit_data.json",
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

// 데이터 파일: cache-first (빠른 시작, 새로고침 버튼으로만 갱신)
// 앱 셸: network-first (코드 변경 즉시 반영)
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

// 앱에서 REFRESH_DATA 메시지를 받으면 데이터 캐시만 삭제
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
