import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/market-timing-service.js");
const { createMarketTimingService } = globalThis.ThinkStockMarketTimingService;

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
