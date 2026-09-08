importScripts(
  "./modules/cache-refresh-policy.js?v=dev",
  "./assets/runtime-asset-paths.js?v=dev",
);

const CACHE_NAME = "thinkstock-dev-3.42";
const NETWORK_FIRST_TIMEOUT_MS = 3500;
const DATA_REFRESH_CONCURRENCY = 3;
const DATA_REFRESH_TIMEOUT_MS = 25000;
const DATA_MANIFEST_PATH = "./data/data_manifest.json";
const DATA_CACHE_PREFIX = "thinkstock-data-v1-";
const cacheRefreshPolicy = self.ThinkStockCacheRefreshPolicy;
if (!cacheRefreshPolicy) throw new Error("Cache refresh policy failed to load");
const runtimeAssetPaths = self.ThinkStockRuntimeAssetPaths;
if (!Array.isArray(runtimeAssetPaths)) throw new Error("Runtime asset paths failed to load");
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./assets/app.bundle.min.js?v=dev",
  "./modules/market-data.mjs?v=dev",
  "./modules/chart-adjustments.mjs?v=dev",
  "./modules/auxiliary-chart-contract.mjs?v=dev",
  "./modules/chart-display-sampler.mjs?v=dev",
  "./modules/cache-refresh-policy.js?v=dev",
  "./assets/runtime-asset-paths.js?v=dev",
  "./assets/data-worker.bundle.min.js?v=dev",
  "./assets/chart-model-worker.bundle.min.js?v=dev",
  "./vendor/plotly-thinkstock-2.35.2.min.js?v=dev",
  "./manifest.webmanifest",
  "./icon.svg",
  "./data/prices_recent.json",
  "./data/macro_data_recent.json",
  "./data/credit_data_recent.json",
  "./data/adr_data_recent.json",
  "./data/vkospi_data.json",
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
  "/data/vkospi_data.json",
  "/data/credit_data.json",
  "/data/credit_data_",
  "/data/disclosures.json",
  "/data/data_manifest.json",
  "/data/dart_corp_codes.json",
  "/data/dart_corp_codes/",
  "/data/krx_universe.json",
  "/data/ai_market_model.json",
  "/data/build_report.json",
  "/data/build_history.json",
  "/data/disclosures/",
];
const CORE_ASSET_PATHS = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/icon.svg",
  "/modules/market-data.mjs",
  "/modules/chart-adjustments.mjs",
  "/modules/auxiliary-chart-contract.mjs",
  "/modules/chart-display-sampler.mjs",
  "/modules/cache-refresh-policy.js",
  "/assets/runtime-asset-paths.js",
  "/modules/broker-report-worker.mjs",
  ...runtimeAssetPaths,
  "/vendor/plotly-thinkstock-2.35.2.min.js",
  "/vendor/pdf.min.mjs",
  "/vendor/pdf.worker.min.mjs",
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
  const shellManifest = await cachedDataManifest(shellCache);
  const shellRevision = cacheRefreshPolicy.normalizeManifestRevision(shellManifest?.revision);
  const shellTargetName = shellRevision ? `${DATA_CACHE_PREFIX}${shellRevision}` : "";
  const cacheNames = await caches.keys();
  if (shellTargetName && cacheNames.includes(shellTargetName)) {
    return { manifest: shellManifest, revision: shellRevision, name: shellTargetName };
  }

  const candidates = await Promise.all(cacheNames
    .filter((name) => cacheRefreshPolicy.isPersistentDataCacheName(name, DATA_CACHE_PREFIX))
    .map(async (name) => {
      const cache = await caches.open(name);
      const manifest = await cachedDataManifest(cache);
      const revision = cacheRefreshPolicy.normalizeManifestRevision(manifest?.revision);
      return revision ? { manifest, revision, name } : null;
    }));
  const previous = candidates
    .filter(Boolean)
    .sort((left, right) => String(right.manifest?.generated_at || "")
      .localeCompare(String(left.manifest?.generated_at || "")))[0];
  return previous || {
    manifest: shellManifest,
    revision: shellRevision,
    name: CACHE_NAME,
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
    // A versioned JavaScript request must never receive stale code or index.html.
    return Response.error();
  }
}

async function dataCacheFirst(request) {
  const shellCache = await caches.open(CACHE_NAME);
  const active = await activeDataCacheInfo(shellCache);
  const cache = active.name === CACHE_NAME ? shellCache : await caches.open(active.name);
  const cacheKey = cacheKeyForRequest(request);
  const cached = (await cache.match(cacheKey, { ignoreSearch: true }))
    || (cache !== shellCache ? await shellCache.match(cacheKey, { ignoreSearch: true }) : null);
  if (cached && request.cache !== "reload" && request.cache !== "no-store") return cached;
  try {
    const response = await fetch(request);
    await putIfOk(cache, cacheKey, response);
    return response;
  } catch (_) {
    return cached || Response.error();
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
      .then((keys) => Promise.all(
        cacheRefreshPolicy.planActivationCacheCleanup(keys, CACHE_NAME, DATA_CACHE_PREFIX)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  if (isVersionedAssetUrl(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  if (isDataManifestUrl(url)) {
    event.respondWith(manifestCacheFirst(event.request));
    return;
  }
  if (isDataUrl(url)) {
    event.respondWith(dataCacheFirst(event.request));
    return;
  }
  event.respondWith(isCoreAssetUrl(url) ? networkFirst(event.request) : staleWhileRevalidate(event.request));
});

function throwIfRefreshAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Data refresh aborted");
  error.name = "AbortError";
  throw error;
}

async function refreshCachedDataAtomically(context = {}) {
  const signal = context.signal || null;
  const generation = Math.max(1, Number(context.generation) || 1);
  let stagingName = "";
  let targetName = "";
  let activeName = "";
  let previousRevision = "";
  let targetPrepared = false;
  let promoted = false;
  let refreshed = 0;
  let reused = 0;
  let failed = 0;

  try {
    throwIfRefreshAborted(signal);
    const shellCache = await caches.open(CACHE_NAME);
    const active = await activeDataCacheInfo(shellCache);
    activeName = active.name;
    previousRevision = active.revision || "";
    const manifestUrl = new URL(DATA_MANIFEST_PATH, self.registration.scope).toString();
    const manifestResponse = await fetch(manifestUrl, { cache: "no-store", signal });
    if (!manifestResponse.ok) throw new Error(`Manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.clone().json();
    const revision = cacheRefreshPolicy.normalizeManifestRevision(manifest?.revision);
    if (!revision) throw new Error("Invalid data manifest revision");
    targetName = `${DATA_CACHE_PREFIX}${revision}`;
    stagingName = `${targetName}-staging-${generation}`;
    await caches.delete(stagingName);
    throwIfRefreshAborted(signal);
    const stagingCache = await caches.open(stagingName);
    const activeCache = active.name === CACHE_NAME ? shellCache : await caches.open(active.name);
    const dataBaseUrl = new URL("./data/", self.registration.scope).toString();
    const manifestEntries = cacheRefreshPolicy.planManifestRefreshEntries(
      active.manifest,
      manifest,
      dataBaseUrl,
    );
    const reusableKeys = new Set(
      manifestEntries.filter((entry) => entry.reuse).map((entry) => entry.cacheKey),
    );

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
    manifestEntries.forEach((entry) => {
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
      throwIfRefreshAborted(signal);
      if (reusableKeys.has(cacheKey)) {
        const cached = (await activeCache.match(cacheKey, { ignoreSearch: true }))
          || (activeCache !== shellCache
            ? await shellCache.match(cacheKey, { ignoreSearch: true })
            : null);
        if (cached) {
          if (sha256 && active.name === CACHE_NAME) {
            const cachedDigestBuffer = await self.crypto.subtle.digest(
              "SHA-256",
              await cached.clone().arrayBuffer(),
            );
            const cachedDigest = [...new Uint8Array(cachedDigestBuffer)]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("");
            if (cachedDigest !== sha256) throw new Error(`Cached digest mismatch for ${cacheKey}`);
          }
          throwIfRefreshAborted(signal);
          await putIfOk(stagingCache, cacheKey, cached);
          return { cacheKey, reused: true };
        }
      }
      const response = await fetch(request, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (sha256) {
        const digestBuffer = await self.crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
        const digest = [...new Uint8Array(digestBuffer)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        if (digest !== sha256) throw new Error(`Digest mismatch for ${cacheKey}`);
      }
      throwIfRefreshAborted(signal);
      await putIfOk(stagingCache, cacheKey, response);
      return { cacheKey, reused: false };
    }, DATA_REFRESH_CONCURRENCY);
    const succeeded = results.filter((result) => result.status === "fulfilled");
    reused = succeeded.filter((result) => result.value?.reused).length;
    refreshed = succeeded.length - reused;
    failed = results.length - succeeded.length;
    throwIfRefreshAborted(signal);
    if (failed > 0) {
      return { ok: false, refreshed, reused, failed, revision: previousRevision };
    }

    if (targetName !== active.name) {
      await caches.delete(targetName);
      targetPrepared = true;
    }
    throwIfRefreshAborted(signal);
    const readyTargetCache = await caches.open(targetName);
    const stagedRequests = await stagingCache.keys();
    for (const request of stagedRequests) {
      throwIfRefreshAborted(signal);
      const response = await stagingCache.match(request);
      if (response) await readyTargetCache.put(request, response);
    }
    throwIfRefreshAborted(signal);
    await readyTargetCache.put(manifestUrl, manifestResponse.clone());
    throwIfRefreshAborted(signal);
    await shellCache.put(manifestUrl, manifestResponse.clone());
    promoted = true;
    const cacheNames = await caches.keys();
    await Promise.allSettled(
      cacheNames
        .filter((name) => name.startsWith(DATA_CACHE_PREFIX) && name !== targetName)
        .map((name) => caches.delete(name)),
    );
    return { ok: true, refreshed, reused, failed: 0, revision };
  } catch (error) {
    if (signal?.aborted) {
      return {
        ok: false,
        refreshed,
        reused,
        failed: Math.max(1, failed),
        revision: previousRevision,
        aborted: true,
        timeout: context.didTimeout?.() === true,
      };
    }
    throw error;
  } finally {
    if (stagingName) await caches.delete(stagingName).catch(() => false);
    if (targetPrepared && !promoted && targetName && targetName !== activeName) {
      await caches.delete(targetName).catch(() => false);
    }
  }
}

const runSharedDataRefresh = cacheRefreshPolicy.createSharedTask(refreshCachedDataAtomically, {
  timeoutMs: DATA_REFRESH_TIMEOUT_MS,
});

self.addEventListener("message", (event) => {
  if (event.data === "REFRESH_DATA") {
    const replyPort = event.ports && event.ports[0];
    const refreshTask = runSharedDataRefresh().then((result) => {
      if (replyPort) replyPort.postMessage(result);
      return result;
    }).catch(() => {
      if (replyPort) replyPort.postMessage({ ok: false });
    });
    if (typeof event.waitUntil === "function") event.waitUntil(refreshTask);
  }
});
