import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/stock-research-contract.js");
await import("../../docs/modules/stock-research-storage.js");
await import("../../docs/modules/stock-research.js");
await import("../../docs/modules/stock-research-app.js");

const contract = globalThis.ThinkStockStockResearchContract;
const storageApi = globalThis.ThinkStockStockResearchStorage;

test("stock research universe defaults to 400 and stays within 100-1000", () => {
  assert.equal(storageApi.normalizeUniverseSize(null), 400);
  assert.equal(storageApi.normalizeUniverseSize(249), 200);
  assert.equal(storageApi.normalizeUniverseSize(951), 1000);
  assert.equal(storageApi.normalizeUniverseSize(5000), 1000);
});

test("stock research description follows the configured per-market count", () => {
  assert.equal(
    globalThis.ThinkStockStockResearchApp.researchUniverseDescription(600),
    "시총 상위 300+300 중 상대적 안정성 필터를 통과한 공부 후보입니다. 매수 추천이 아닙니다.",
  );
});
const storageModule = globalThis.ThinkStockStockResearchStorage;
const research = globalThis.ThinkStockStockResearch;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("stock research keeps cache format and calculation versions independent", () => {
  const storage = memoryStorage();
  const payload = {
    schema: contract.CACHE_FORMAT_SCHEMA,
    strategy: contract.CALCULATION_VERSION,
    candidates: [],
  };
  storageModule.saveCache(storage, payload);

  const saved = JSON.parse(storage.getItem(contract.CACHE_KEY));
  assert.equal(saved.formatSchema, contract.CACHE_FORMAT_SCHEMA);
  assert.equal(saved.calculationVersion, contract.CALCULATION_VERSION);
  assert.equal(storageModule.loadCache(storage, contract.CALCULATION_VERSION)?.formatSchema, 1);
  assert.equal(storageModule.loadCache(storage, "different-calculation"), null);

  saved.formatSchema += 1;
  storage.setItem(contract.CACHE_KEY, JSON.stringify(saved));
  assert.equal(storageModule.loadCache(storage, contract.CALCULATION_VERSION), null);
});

test("stock research reuses recent cache variants by configured universe size", () => {
  const storage = memoryStorage();
  const payload = (universeSize, generatedAt) => ({
    schema: contract.CACHE_FORMAT_SCHEMA,
    strategy: contract.CALCULATION_VERSION,
    calculationVersion: contract.CALCULATION_VERSION,
    universeSize,
    generatedAt,
    candidates: [],
  });
  storageModule.saveCacheVariant(storage, payload(400, "2026-08-13T01:00:00Z"));
  storageModule.saveCacheVariant(storage, payload(600, "2026-08-13T02:00:00Z"));

  assert.equal(storageModule.loadCacheVariant(storage, contract.CALCULATION_VERSION, 400)?.universeSize, 400);
  assert.equal(storageModule.loadCacheVariant(storage, contract.CALCULATION_VERSION, 600)?.universeSize, 600);
  assert.equal(storageModule.loadCacheVariant(storage, contract.CALCULATION_VERSION, 800), null);
  storageModule.removeCache(storage);
  assert.equal(storage.getItem(contract.CACHE_VARIANTS_KEY), null);
});

test("stock research model and tests share one calculation contract", () => {
  assert.equal(research.CALCULATION_VERSION, contract.CALCULATION_VERSION);
  assert.equal(research.STRATEGY_VERSION, contract.CALCULATION_VERSION);
  assert.equal(research.RECENT_SIGNAL_WINDOW, contract.RECENT_SIGNAL_WINDOW);
  assert.equal(research.ONE_MONTH_SIGNAL_WINDOW, contract.ONE_MONTH_SIGNAL_WINDOW);
});
