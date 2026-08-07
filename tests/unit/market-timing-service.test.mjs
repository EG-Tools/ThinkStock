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
