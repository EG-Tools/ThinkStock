const CACHE_NAME = "thinkstock-dev";
const NETWORK_FIRST_TIMEOUT_MS = 3500;
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./modules/data-payload.js?v=dev",
  "./modules/market-data.js?v=dev",
  "./modules/performance-monitor.js?v=dev",
  "./modules/chart-loader.js?v=dev",
  "./modules/disclosure-policy.js?v=dev",
  "./modules/dart-disclosure.js?v=dev",
  "./modules/service-worker-client.js?v=dev",
  "./modules/runtime-refresh.js?v=dev",
  "./modules/data-worker.js?v=dev",
  "./modules/chart-model-worker.js?v=dev",
  "./app.js?v=dev",
  "./vendor/plotly-basic-2.35.2.min.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./data/prices_recent.json",
  "./data/macro_data_recent.json",
  "./data/credit_data_recent.json",
  "./data/adr_data_recent.json",
  "./data/disclosures.json",
];
const DATA_URL_PATTERNS = [
  "/data/prices.json",
  "/data/prices_",
  "/data/macro_data.json",
  "/data/macro_data_",
  "/data/adr_data.json",
  "/data/adr_data_",
  "/data/credit_data.json",
  "/data/credit_data_",
  "/data/disclosures.json",
  "/data/build_report.json",
  "/data/disclosures/",
];
const CORE_ASSET_PATHS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/modules/data-payload.js",
  "/modules/market-data.js",
  "/modules/performance-monitor.js",
  "/modules/chart-loader.js",
  "/modules/disclosure-policy.js",
  "/modules/dart-disclosure.js",
  "/modules/service-worker-client.js",
  "/modules/runtime-refresh.js",
  "/modules/data-worker.js",
  "/modules/chart-model-worker.js",
];

function isDataUrl(url) {
  return DATA_URL_PATTERNS.some((pattern) => url.pathname.includes(pattern));
}

function cacheKeyForRequest(request) {
  const url = new URL(request.url);
  if (!isDataUrl(url)) return request;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isCoreAssetUrl(url) {
  return CORE_ASSET_PATHS.some((path) => url.pathname.endsWith(path));
}

function isVersionedAssetUrl(url) {
  return url.searchParams.has("v") && isCoreAssetUrl(url);
}

async function putIfOk(cache, request, response) {
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = cacheKeyForRequest(request);
  const cached = (await cache.match(cacheKey)) || (await cache.match(request, { ignoreSearch: true }));
  if (!cached) {
    try {
      const response = await fetch(request);
      await putIfOk(cache, cacheKey, response);
      return response;
    } catch (_) {
      return Response.error();
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_FIRST_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    await putIfOk(cache, cacheKey, response);
    return response;
  } catch (_) {
    return cached;
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    await putIfOk(cache, request, response);
    return response;
  } catch (_) {
    return (await caches.match(request, { ignoreSearch: true })) || caches.match("./index.html");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      await putIfOk(cache, request, response);
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  return (await refresh) || caches.match(request, { ignoreSearch: true }) || caches.match("./index.html");
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE_ASSETS.map((asset) => cache.add(asset))))
      .catch(() => null),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isVersionedAssetUrl(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  event.respondWith(
    isDataUrl(url) || isCoreAssetUrl(url)
      ? networkFirst(event.request)
      : staleWhileRevalidate(event.request),
  );
});

async function refreshCachedDataAtomically() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  const byCacheKey = new Map();
  requests.forEach((request) => {
    try {
      const url = new URL(request.url);
      if (isDataUrl(url)) byCacheKey.set(String(cacheKeyForRequest(request)), request);
    } catch (_) {
      // Ignore malformed cache entries.
    }
  });

  const results = await Promise.allSettled([...byCacheKey.entries()].map(async ([cacheKey, request]) => {
    const response = await fetch(request, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await putIfOk(cache, cacheKey, response);
    if (request.url !== cacheKey) await cache.delete(request);
    return cacheKey;
  }));
  const refreshed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - refreshed;
  return { ok: failed === 0, refreshed, failed };
}

self.addEventListener("message", (event) => {
  if (event.data === "REFRESH_DATA") {
    const replyPort = event.ports && event.ports[0];
    const refreshTask = refreshCachedDataAtomically().then((result) => {
      if (replyPort) replyPort.postMessage(result);
      return result;
    }).catch(() => {
      if (replyPort) replyPort.postMessage({ ok: false });
    });
    if (typeof event.waitUntil === "function") event.waitUntil(refreshTask);
  }
});
