import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/data-seed-loader.js");
const loaderModule = globalThis.ThinkStockDataSeedLoader;


test("loads a recent segment before considering the full payload", async () => {
  const requests = [];
  const loader = loaderModule.createDataSeedLoader({
    appendCacheBust: (path) => `${path}?fresh=1`,
    fetchWithTimeout: async (path) => {
      requests.push(path);
      if (path.startsWith("./data/data_manifest.json")) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            format: "segmented-data-v1",
            revision: "fixture",
            datasets: {
              prices: { recent: { file: "prices-r1.json" } },
            },
          }),
        };
      }
      return { ok: true, text: async () => "recent" };
    },
  });

  const result = await loader.fetchSegmentedSeedText("./data/prices.json", "recent", true);

  assert.deepEqual(result, { text: "recent", usedFullFallback: false });
  assert.deepEqual(requests, [
    "./data/data_manifest.json?fresh=1",
    "./data/prices-r1.json?fresh=1",
  ]);
});


test("falls back to the stable full payload after refresh failures", async () => {
  const requests = [];
  const loader = loaderModule.createDataSeedLoader({
    appendCacheBust: (path) => `${path}?fresh=1`,
    fetchWithTimeout: async (path) => {
      requests.push(path);
      if (path === "./data/prices.json") return { ok: true, text: async () => "full" };
      throw new Error("offline");
    },
  });

  const result = await loader.fetchSegmentedSeedText("./data/prices.json", "history", true);

  assert.deepEqual(result, { text: "full", usedFullFallback: true });
  assert.deepEqual(requests, [
    "./data/data_manifest.json?fresh=1",
    "./data/data_manifest.json",
    "./data/prices_history.json?fresh=1",
    "./data/prices_history.json",
    "./data/prices.json?fresh=1",
    "./data/prices.json",
  ]);
});
