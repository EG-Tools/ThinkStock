import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/runtime-foundation.mjs");

await import("../../docs/modules/cache-lifecycle-policy.js");
await import("../../docs/modules/ai-forecast-cache.js");

const { createForecastCache } = globalThis.ThinkStockAiForecastCache;

test("reuses a persisted forecast only for the same input fingerprint", async () => {
  const records = new Map();
  let writes = 0;
  const cache = createForecastCache({
    read: async (ticker) => records.get(ticker) || null,
    write: async (ticker, record) => { writes += 1; records.set(ticker, record); },
    remove: async (ticker) => records.delete(ticker),
  });
  await cache.set("005930.KS", "input-a", { dates: ["2026-08-08"] });
  let restoredWrites = 0;
  const secondSession = createForecastCache({
    read: async (ticker) => records.get(ticker) || null,
    write: async (ticker, record) => { restoredWrites += 1; records.set(ticker, record); },
    remove: async (ticker) => records.delete(ticker),
  });

  assert.deepEqual(await secondSession.get("005930.KS", "input-a"), { dates: ["2026-08-08"] });
  assert.equal(restoredWrites, 0);
  assert.equal(records.get("005930.KS")?.cacheMeta?.source, "ai-forecast");
  assert.equal(await secondSession.get("005930.KS", "input-b"), null);
  assert.equal(records.has("005930.KS"), false);
  assert.ok(writes >= 1);
});

test("keeps a fresh in-memory forecast when persistence is unavailable", async () => {
  const cache = createForecastCache({
    write: async () => { throw new Error("IndexedDB unavailable"); },
  });
  const forecast = { dates: ["2026-08-12"], prices: [71000] };

  assert.equal(await cache.set("005930.KS", "input-a", forecast), false);
  assert.deepEqual(await cache.get("005930.KS", "input-a"), forecast);
});
