import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/cache-refresh-policy.js");
const policy = globalThis.ThinkStockCacheRefreshPolicy;


function entry(path) {
  return {
    cacheKey: `https://example.test${path}`,
    request: { url: `https://example.test${path}` },
  };
}


test("refreshes recent and disclosure data before history and full payloads", () => {
  const planned = policy.planDataRefreshRequests([
    entry("/data/prices.json"),
    entry("/data/prices_history.json"),
    entry("/data/build_report.json"),
    entry("/data/prices_recent.json"),
    entry("/data/disclosures/005930.json"),
  ]);

  assert.deepEqual(planned.map((item) => new URL(item.request.url).pathname), [
    "/data/disclosures/005930.json",
    "/data/prices_recent.json",
    "/data/prices_history.json",
    "/data/build_report.json",
    "/data/prices.json",
  ]);
});


test("limits background refresh concurrency without losing result order", async () => {
  let active = 0;
  let peak = 0;
  const results = await policy.runWithConcurrency([0, 1, 2, 3, 4], async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  }, 2);

  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.value), [0, 2, 4, 6, 8]);
});
