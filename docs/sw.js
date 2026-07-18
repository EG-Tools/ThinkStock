importScripts("./modules/cache-refresh-policy.js?v=dev");

const CACHE_NAME = "thinkstock-dev";
const NETWORK_FIRST_TIMEOUT_MS = 3500;
const DATA_REFRESH_CONCURRENCY = 3;
const DATA_MANIFEST_PATH = "./data/data_manifest.json";
const DATA_CACHE_PREFIX = `${CACHE_NAME}-data-`;
const cacheRefreshPolicy = self.ThinkStockCacheRefreshPolicy;
if (!cacheRefreshPolicy) throw new Error("Cache refresh policy failed to load");
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./assets/app.bundle.min.js?v=dev",
  "./modules/data-payload.js?v=dev",
  "./modules/market-data.js?v=dev",
  "./modules/cache-refresh-policy.js?v=dev",
  "./modules/auxiliary-chart-model.js?v=dev",
  "./modules/data-worker.js?v=dev",
  "./modules/chart-model-worker.js?v=dev",
  "./vendor/plotly-basic-2.35.2.min.js?v=dev",
  "./manifest.webmanifest",
  "./icon.svg",
  "./data/prices_recent.json",
  "./data/macro_data_recent.json",
  "./data/credit_data_recent.json",
  "./data/adr_data_recent.json",
  "./data/data_manifest.json",
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
  "/data/data_manifest.json",
  "/data/dart_corp_codes.json",
  "/data/dart_corp_codes/",
  "/data/krx_universe.json",
  "/data/build_report.json",
  "/data/build_history.json",
  "/data/disclosures/",
];
const CORE_ASSET_PATHS = [
  "/",
  "/index.html",
  "/styles.css",
  "/assets/app.bundle.min.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/modules/data-payload.js",
  "/modules/market-data.js",
  "/modules/cache-refresh-policy.js",
  "/modules/auxiliary-chart-model.js",
  "/modules/data-worker.js",
  "/modules/chart-model-worker.js",
  "/vendor/plotly-basic-2.35.2.min.js",
];

function isDataUrl(url) {
  return DATA_URL_PATTERNS.some((pattern) => url.pathname.includes(pattern));
}

function isDataManifestUrl(url) {
  return url.pathname.endsWith("/data/data_manifest.json");
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

async function cachedDataManifest(shellCache) {
  const manifestUrl = new URL(DATA_MANIFEST_PATH, self.registration.scope).toString();
  const response = await shellCache.match(manifestUrl, { ignoreSearch: true });
  if (!response) return null;
  try {
    const payload = await response.clone().json();
    return payload?.format === "segmented-data-v1" ? payload : null;
  } catch (_) {
    return null;
  }
}

async function activeDataCacheInfo(shellCache) {
  const manifest = await cachedDataManifest(shellCache);
  const revision = cacheRefreshPolicy.normalizeManifestRevision(manifest?.revision);
  return {
    manifest,
    revision,
    name: revision ? `${DATA_CACHE_PREFIX}${revision}` : CACHE_NAME,
  };
}

async function networkFirst(request) {
  const shellCache = await caches.open(CACHE_NAME);
  const requestUrl = new URL(request.url);
  const active = isDataUrl(requestUrl) && !isDataManifestUrl(requestUrl)
    ? await activeDataCacheInfo(shellCache)
    : { name: CACHE_NAME };
  const cache = active.name === CACHE_NAME ? shellCache : await caches.open(active.name);
  const cacheKey = cacheKeyForRequest(request);
  const cached = (await cache.match(cacheKey))
    || (await cache.match(request, { ignoreSearch: true }))
    || (cache !== shellCache ? await shellCache.match(cacheKey, { ignoreSearch: true }) : null);
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

async function manifestCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = cacheKeyForRequest(request);
  const cached = await cache.match(cacheKey, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    await putIfOk(cache, cacheKey, response);
    return response;
  } catch (_) {
    return Response.error();
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
  if (isDataManifestUrl(url)) {
    event.respondWith(manifestCacheFirst(event.request));
    return;
  }
  event.respondWith(
    isDataUrl(url) || isCoreAssetUrl(url)
      ? networkFirst(event.request)
      : staleWhileRevalidate(event.request),
  );
});

async function refreshCachedDataAtomically() {
  const shellCache = await caches.open(CACHE_NAME);
  const active = await activeDataCacheInfo(shellCache);
  const manifestUrl = new URL(DATA_MANIFEST_PATH, self.registration.scope).toString();
  const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`Manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.clone().json();
  const revision = cacheRefreshPolicy.normalizeManifestRevision(manifest?.revision);
  if (!revision) throw new Error("Invalid data manifest revision");
  const targetName = `${DATA_CACHE_PREFIX}${revision}`;
  const stagingName = `${targetName}-staging`;
  await caches.delete(stagingName);
  const stagingCache = await caches.open(stagingName);

  const requests = [
    ...await shellCache.keys(),
    ...(active.name !== CACHE_NAME ? await (await caches.open(active.name)).keys() : []),
  ];
  const byCacheKey = new Map();
  requests.forEach((request) => {
    try {
      const url = new URL(request.url);
      if (isDataUrl(url)) byCacheKey.set(String(cacheKeyForRequest(request)), request);
    } catch (_) {
      // Ignore malformed cache entries.
    }
  });
  cacheRefreshPolicy.manifestDataEntries(
    manifest,
    new URL("./data/", self.registration.scope).toString(),
  ).forEach((entry) => {
    byCacheKey.set(entry.cacheKey, {
      request: new Request(entry.request.url),
      sha256: entry.sha256,
    });
  });

  const planned = cacheRefreshPolicy.planDataRefreshRequests(
    [...byCacheKey.entries()]
      .filter(([cacheKey]) => cacheKey !== manifestUrl)
      .map(([cacheKey, value]) => ({
        cacheKey,
        request: value.request || value,
        sha256: value.sha256 || "",
      })),
  );
  const results = await cacheRefreshPolicy.runWithConcurrency(planned, async ({ cacheKey, request, sha256 }) => {
    const response = await fetch(request, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (sha256) {
      const digestBuffer = await self.crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
      const digest = [...new Uint8Array(digestBuffer)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== sha256) throw new Error(`Digest mismatch for ${cacheKey}`);
    }
    await putIfOk(stagingCache, cacheKey, response);
    return cacheKey;
  }, DATA_REFRESH_CONCURRENCY);
  const refreshed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - refreshed;
  if (failed > 0) {
    await caches.delete(stagingName);
    return { ok: false, refreshed, failed, revision: active.revision || "" };
  }

  if (targetName !== active.name) await caches.delete(targetName);
  const readyTargetCache = await caches.open(targetName);
  const stagedRequests = await stagingCache.keys();
  for (const request of stagedRequests) {
    const response = await stagingCache.match(request);
    if (response) await readyTargetCache.put(request, response);
  }
  await shellCache.put(manifestUrl, manifestResponse.clone());
  await caches.delete(stagingName);
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith(DATA_CACHE_PREFIX) && name !== targetName)
      .map((name) => caches.delete(name)),
  );
  return { ok: true, refreshed, failed: 0, revision };
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
