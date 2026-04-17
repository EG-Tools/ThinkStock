const CACHE_NAME = "thinkstock-v13";
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
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          return res;
        });
      })
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
    caches.open(CACHE_NAME).then((cache) => {
      ASSETS.filter((a) => a.includes("/data/")).forEach((url) => cache.delete(url));
    });
  }
});
