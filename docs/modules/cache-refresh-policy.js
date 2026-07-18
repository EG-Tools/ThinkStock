(function initCacheRefreshPolicy(globalScope) {
  "use strict";

  const DEFAULT_CONCURRENCY = 3;

  function refreshPriority(request) {
    const pathname = new URL(request.url).pathname.toLowerCase();
    if (
      pathname.includes("_recent.json")
      || pathname.endsWith("/disclosures.json")
      || pathname.includes("/data/disclosures/")
    ) return 0;
    if (pathname.includes("_history.json")) return 1;
    if (
      pathname.endsWith("/build_report.json")
      || pathname.endsWith("/build_history.json")
    ) return 2;
    return 3;
  }

  function planDataRefreshRequests(entries) {
    return [...entries].sort((left, right) => {
      const priorityDifference = refreshPriority(left.request) - refreshPriority(right.request);
      if (priorityDifference) return priorityDifference;
      return String(left.cacheKey).localeCompare(String(right.cacheKey));
    });
  }

  function normalizeManifestRevision(value) {
    const revision = String(value || "").toLowerCase().replace(/[^a-f0-9]/g, "");
    return revision.length >= 12 ? revision.slice(0, 24) : "";
  }

  function manifestDataEntries(manifest, baseUrl) {
    if (manifest?.format !== "segmented-data-v1" || !manifest?.datasets) return [];
    const entries = [];
    Object.values(manifest.datasets).forEach((dataset) => {
      ["recent", "history"].forEach((segment) => {
        const descriptor = dataset?.[segment];
        const filename = String(descriptor?.file || "");
        const digest = String(descriptor?.sha256 || "").toLowerCase();
        if (!filename || !/^[a-f0-9]{64}$/.test(digest)) return;
        const url = new URL(filename, baseUrl).toString();
        entries.push({
          cacheKey: url,
          request: { url },
          sha256: digest,
          segment,
        });
      });
    });
    return entries;
  }

  async function runWithConcurrency(items, worker, concurrency = DEFAULT_CONCURRENCY) {
    const source = Array.isArray(items) ? items : [];
    if (!source.length) return [];
    const limit = Math.max(1, Math.min(source.length, Number(concurrency) || DEFAULT_CONCURRENCY));
    const results = new Array(source.length);
    let nextIndex = 0;

    async function runNext() {
      while (nextIndex < source.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = { status: "fulfilled", value: await worker(source[index], index) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }

    await Promise.all(Array.from({ length: limit }, () => runNext()));
    return results;
  }

  globalScope.ThinkStockCacheRefreshPolicy = Object.freeze({
    DEFAULT_CONCURRENCY,
    manifestDataEntries,
    normalizeManifestRevision,
    refreshPriority,
    planDataRefreshRequests,
    runWithConcurrency,
  });
}(typeof self !== "undefined" ? self : globalThis));
