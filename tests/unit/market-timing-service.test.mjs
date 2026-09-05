import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarketTimingService,
  createTimingCacheRecord,
  validTimingCacheRecord,
} from "../../docs/modules/market-timing-service.mjs";

class FakeWorker {
  constructor() {
    this.messages = [];
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(message) {
    this.messages.push(message);
    queueMicrotask(() => {
      const models = Object.fromEntries(message.targets.map((ticker) => [
        ticker,
        { indexKey: ticker, sourceTransferred: Boolean(message.sources) },
      ]));
      this.onmessage?.({ data: { id: message.id, models } });
    });
  }

  terminate() {}
}

test("uses the current global scope when no explicit scope is supplied", () => {
  const service = createMarketTimingService();
  assert.equal(service.stats().modelCount, 0);
  service.dispose();
});

test("transfers timing sources once per data signature and caches each model", async () => {
  const worker = new FakeWorker();
  const service = createMarketTimingService({}, {
    createWorker: () => worker,
    workerUrl: "timing-worker.js",
  });
  const sources = { dates: ["2026-01-02"], pricesByTicker: {}, volumesByTicker: {} };

  await service.prepare({ signature: "revision-a", targets: ["^KS11"], sources });
  await service.prepare({ signature: "revision-a", targets: ["^KQ11"], sources });
  await service.prepare({ signature: "revision-a", targets: ["^KS11", "^KQ11"], sources });

  assert.equal(worker.messages.length, 2);
  assert.equal(worker.messages[0].sources, sources);
  assert.equal("sources" in worker.messages[1], false);
  assert.equal(service.get("^ks11").indexKey, "^KS11");
  assert.equal(service.stats().modelCount, 2);
  assert.equal(service.stats().prepareRequests, 3);
  assert.equal(service.stats().modelCalculations, 2);
  assert.equal(service.stats().targetCacheHits, 2);
  assert.equal(service.stats().workerRequests, 2);
  assert.equal(service.stats().inputFingerprintCalculations, 2);
});

test("keeps unaffected ticker models when only one ticker input changes", async () => {
  const worker = new FakeWorker();
  const service = createMarketTimingService({}, {
    createWorker: () => worker,
    workerUrl: "timing-worker.js",
  });
  const firstSources = {
    dates: ["2026-01-02", "2026-01-05"],
    pricesByTicker: {
      "^KS11": [100, 101],
      "^KQ11": [200, 202],
      "005930.KS": [50, 52],
      "000660.KS": [80, 81],
    },
    volumesByTicker: {},
  };
  await service.prepare({
    signature: "prices-1",
    targets: ["005930.KS", "000660.KS"],
    sources: firstSources,
  });
  const preserved = service.get("000660.KS");

  await service.prepare({
    signature: "prices-2",
    targets: ["005930.KS", "000660.KS"],
    sources: {
      ...firstSources,
      pricesByTicker: {
        ...firstSources.pricesByTicker,
        "005930.KS": [50, 53],
      },
    },
  });

  assert.equal(worker.messages.length, 2);
  assert.deepEqual(worker.messages[1].targets, ["005930.KS"]);
  assert.equal(service.get("000660.KS"), preserved);
  assert.equal(service.stats().modelCalculations, 3);
  assert.equal(service.stats().modelCount, 2);
  assert.equal(service.stats().fingerprintCount, 2);
  assert.equal(service.stats().inputFingerprintCalculations, 4);
});

test("invalidates one in-memory timing model without clearing its peers", async () => {
  const worker = new FakeWorker();
  const service = createMarketTimingService({}, {
    createWorker: () => worker,
    workerUrl: "timing-worker.js",
  });
  const sources = {
    dates: ["2026-01-02"],
    pricesByTicker: {
      "^KS11": [100],
      "^KQ11": [200],
      "005930.KS": [50],
      "000660.KS": [80],
    },
    volumesByTicker: {},
  };
  await service.prepare({
    signature: "prices-1",
    targets: ["005930.KS", "000660.KS"],
    sources,
  });

  assert.equal(service.invalidate("005930.ks"), true);
  assert.equal(service.has("005930.KS"), false);
  assert.equal(service.has("000660.KS"), true);
  assert.equal(service.stats().fingerprintCount, 1);
});

test("falls back to the local calculator when Worker is unavailable", async () => {
  const service = createMarketTimingService({}, {
    buildMacdOscillator: ({ dates, prices }) => ({
      dates,
      prices,
      normalized: prices.map(() => 0),
    }),
    buildMarketTimingSignals: ({ indexKey, benchmarkPrices, volumes }) => ({
      indexKey,
      benchmarkPrices,
      volumes,
    }),
  });
  const sources = {
    dates: ["2026-01-02", "2026-01-05"],
    pricesByTicker: {
      "^KS11": [100, 101],
      "005930.KS": [50, 52],
    },
    volumesByTicker: { "005930.KS": [["2026-01-05", 900]] },
  };

  await service.prepare({ signature: "revision-b", targets: ["005930.KS"], sources });

  assert.deepEqual(service.get("005930.KS").benchmarkPrices, [100, 101]);
  assert.deepEqual(service.get("005930.KS").volumes, [null, 900]);
  assert.equal(service.stats().workerFallbacks, 1);
});

test("builds VKOSPI and VIX candidates from the shared volatility rows", async () => {
  let received = null;
  const volatilityRows = [
    { date: "2026-01-02", vkospi: 18, vix: 16 },
    { date: "2026-01-05", vkospi: 19, vix: 17 },
  ];
  const service = createMarketTimingService({}, {
    buildMacdOscillator: ({ dates, prices }) => ({
      dates,
      prices,
      normalized: prices.map(() => 0),
    }),
    buildKoreanVolatilityTimingRows: (rows) => rows.map((row) => ({
      date: row.date,
      vkospi: row.vkospi,
    })),
    buildExternalVolatilityTimingRows: (rows) => rows.map((row) => ({
      date: row.date,
      vix: row.vix,
    })),
    buildMarketTimingSignals: (options) => {
      received = options;
      return { indexKey: options.indexKey, signals: [], sellSignals: [] };
    },
  });

  await service.prepare({
    signature: "revision-volatility",
    targets: ["^KS11"],
    sources: {
      dates: ["2026-01-02", "2026-01-05"],
      pricesByTicker: { "^KS11": [100, 101] },
      volumesByTicker: {},
      volatilityRows,
    },
  });

  assert.deepEqual(received.koreanVolatilityRows, [
    { date: "2026-01-02", vkospi: 18 },
    { date: "2026-01-05", vkospi: 19 },
  ]);
  assert.deepEqual(received.externalVolatilityRows, [
    { date: "2026-01-02", vix: 16 },
    { date: "2026-01-05", vix: 17 },
  ]);
  assert.equal(received.koreanVolatilityPolicy.enabled, true);
  assert.equal(received.externalVolatilityPolicy.enabled, true);
  assert.equal(received.behaviorPolicy.enabled, true);
  assert.equal(received.behaviorPolicy.buyEnabled, true);
  assert.equal(received.behaviorPolicy.sellEnabled, false);
});

test("attaches point-in-time signal quality to locally calculated models", async () => {
  const service = createMarketTimingService({}, {
    buildMacdOscillator: ({ dates, prices }) => ({
      dates,
      prices,
      normalized: prices.map(() => 0),
    }),
    buildMarketTimingSignals: ({ indexKey }) => ({ indexKey, signals: [], sellSignals: [] }),
    evaluateMarketTimingModel: (_model, options) => ({
      status: "usable",
      sampleCount: options.prices.length,
    }),
  });
  const sources = {
    dates: ["2026-01-02", "2026-01-05"],
    pricesByTicker: { "^KS11": [100, 101] },
    volumesByTicker: {},
  };

  await service.prepare({ signature: "revision-quality", targets: ["^KS11"], sources });
  assert.deepEqual(service.get("^KS11").quality, { status: "usable", sampleCount: 2 });
});

test("attaches a diagnostic-only structural profile without changing timing signals", async () => {
  const service = createMarketTimingService({}, {
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: ({ indexKey }) => ({ indexKey, signals: [{ date: "2026-01-05" }] }),
    buildStructuralStockProfile: ({ series }) => ({
      version: "context-profile-v1",
      scores: { range: series === "005930.KS" ? 0.7 : 0.2 },
    }),
  });
  await service.prepare({
    signature: "revision-profile",
    targets: ["005930.KS"],
    sources: {
      dates: ["2026-01-02", "2026-01-05"],
      pricesByTicker: { "^KS11": [100, 101], "005930.KS": [50, 51] },
      volumesByTicker: {},
    },
  });

  const model = service.get("005930.KS");
  assert.deepEqual(model.signals, [{ date: "2026-01-05" }]);
  assert.equal(model.contextProfile.diagnosticOnly, true);
  assert.equal(model.contextProfile.structural.scores.range, 0.7);
});

test("exposes a compact timing-quality summary for diagnostics", async () => {
  const service = createMarketTimingService({}, {
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: ({ indexKey }) => ({ indexKey }),
    evaluateMarketTimingModel: () => ({ status: "limited", matureSamples: 4 }),
    summarizeMarketTimingQuality: (models) => ({
      evaluatedModels: [...models.values()].filter((model) => model?.quality).length,
    }),
  });
  await service.prepare({
    signature: "revision-summary",
    targets: ["^KS11"],
    sources: {
      dates: ["2026-01-02"],
      pricesByTicker: { "^KS11": [100] },
      volumesByTicker: {},
    },
  });

  assert.deepEqual(service.stats().quality, { evaluatedModels: 1 });
});

test("reuses a persisted timing model only when its input fingerprint matches", async () => {
  const records = new Map();
  const sources = {
    dates: ["2026-01-02", "2026-01-05"],
    pricesByTicker: { "^KS11": [100, 101] },
    volumesByTicker: {},
    macroRows: [{ date: "2026-01-05", leading_cycle: 101 }],
  };
  const cache = {
    readMany: async (keys) => new Map(keys.map((key) => [key, records.get(key)])),
    writeMany: async (entries) => entries.forEach((value, key) => records.set(key, value)),
  };
  const first = createMarketTimingService({}, {
    cache,
    buildMacdOscillator: ({ dates, prices }) => ({ dates, prices, normalized: prices.map(() => 0) }),
    buildMarketTimingSignals: ({ indexKey }) => ({ indexKey, signals: [{ date: "2026-01-05" }] }),
  });
  await first.prepare({ signature: "first-session", targets: ["^KS11"], sources });
  assert.equal(records.has("^KS11"), true);

  const second = createMarketTimingService({}, {
    cache,
    createWorker: () => { throw new Error("worker should not run on cache hit"); },
  });
  await second.prepare({ signature: "second-session", targets: ["^KS11"], sources });
  assert.deepEqual(second.get("^KS11").signals, [{ date: "2026-01-05" }]);
  assert.equal(second.stats().persistentCacheHits, 1);
  assert.equal(second.stats().modelCalculations, 0);
});

test("rejects timing models cached before the publication-date calculation revision", () => {
  const sources = {
    dates: ["2025-11-24"],
    pricesByTicker: { "207940.KS": [1789000], "^KS11": [4200] },
    volumesByTicker: {},
    macroRows: [{ date: "2025-11-01", leading_cycle: 100.9 }],
  };
  const current = createTimingCacheRecord("207940.KS", sources, {
    sellSignals: [{ date: "2025-11-24" }],
  });
  const stale = {
    ...current,
    fingerprint: current.fingerprint.replace(
      /^market-timing-cache-v\d+/,
      "market-timing-cache-v3",
    ),
  };

  assert.equal(validTimingCacheRecord(stale, "207940.KS", sources), false);
  assert.equal(validTimingCacheRecord(current, "207940.KS", sources), true);
});

test("exposes calculated signals before deferred cache persistence finishes", async () => {
  let scheduledTask = null;
  let cacheWrites = 0;
  const service = createMarketTimingService({}, {
    cache: {
      readMany: async () => new Map(),
      writeMany: async () => { cacheWrites += 1; },
    },
    schedulePersistence: (task, context) => {
      scheduledTask = { task, context };
      return Promise.resolve(true);
    },
    buildMacdOscillator: ({ dates, prices }) => ({
      dates,
      prices,
      normalized: prices.map(() => 0),
    }),
    buildMarketTimingSignals: ({ indexKey }) => ({ indexKey, signals: [], sellSignals: [] }),
  });

  await service.prepare({
    signature: "revision-deferred-cache",
    targets: ["^KS11"],
    sources: {
      dates: ["2026-08-28"],
      pricesByTicker: { "^KS11": [100] },
      volumesByTicker: {},
    },
  });

  assert.equal(service.has("^KS11"), true);
  assert.equal(cacheWrites, 0);
  assert.deepEqual(scheduledTask.context, {
    signature: "revision-deferred-cache",
    targets: ["^KS11"],
  });
  assert.equal(service.stats().deferredCacheWrites, 1);
  await scheduledTask.task();
  assert.equal(cacheWrites, 1);
});
