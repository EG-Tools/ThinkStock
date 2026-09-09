import assert from "node:assert/strict";
import test from "node:test";

import { createAuxiliaryChartApp } from "../../docs/modules/auxiliary-chart-app.mjs";

function createRegistry() {
  const values = new Map();
  return {
    get(key, factory) {
      if (!values.has(key)) values.set(key, factory());
      return values.get(key);
    },
    async getAsync(key, factory) {
      if (!values.has(key)) values.set(key, await factory());
      return values.get(key);
    },
    peek: (key) => values.get(key) || null,
  };
}

test("auxiliary chart app preserves every target while using the latest viewport", async () => {
  const registry = createRegistry();
  const scheduled = [];
  const renders = [];
  let applyRequests = null;
  const runtime = {
    renderAll: async (range, options) => renders.push({ range, targets: options.targets }),
    viewportRefreshTargets: () => ["macd", "auxiliary"],
  };
  const app = createAuxiliaryChartApp({}, {
    registry,
    runtimeKey: "runtime",
    renderQueueKey: "queue",
    loadFeature: async () => ({
      runtime: { createAuxiliaryChartRuntime: () => runtime },
      model: {},
      macd: { buildMacdOscillator: () => ({}) },
    }),
    createRuntimeOptions: () => ({}),
    createLatestFrameQueue: (_scope, options) => {
      applyRequests = options.apply;
      return {
        schedule: (key, request) => scheduled.push({ key, request }),
        whenSettled: async () => {},
      };
    },
    macdModelCache: { resolve: (_key, _fingerprint, build) => build() },
    fingerprintDatedSeries: () => "fingerprint",
    getPriceRows: () => [],
    getDisparityDays: () => 60,
    supportsTechnicalSeries: () => true,
  });

  app.scheduleRender([1, 2], { targets: ["macd"] });
  app.scheduleRender([3, 4], { targets: ["auxiliary"] });

  assert.deepEqual(scheduled.map((item) => item.key), ["macd", "auxiliary"]);
  await applyRequests(scheduled.map((item) => item.request));
  assert.deepEqual(renders, [{ range: [3, 4], targets: ["macd", "auxiliary"] }]);
});

test("auxiliary chart app refreshes the committed viewport before repainting", async () => {
  const registry = createRegistry();
  const order = [];
  let queueApply = null;
  const runtime = {
    viewportRefreshTargets: () => ["macd"],
    renderAll: async () => order.push("render"),
  };
  const app = createAuxiliaryChartApp({}, {
    registry,
    runtimeKey: "runtime",
    renderQueueKey: "queue",
    loadFeature: async () => ({
      runtime: { createAuxiliaryChartRuntime: () => runtime },
      model: {},
      macd: { buildMacdOscillator: () => ({}) },
    }),
    createRuntimeOptions: () => ({}),
    createLatestFrameQueue: (_scope, options) => {
      queueApply = options.apply;
      const requests = [];
      return {
        schedule: (_key, request) => requests.push(request),
        whenSettled: async () => {
          await queueApply(requests.splice(0));
          order.push("settled");
        },
      };
    },
    macdModelCache: { resolve: (_key, _fingerprint, build) => build() },
    fingerprintDatedSeries: () => "fingerprint",
    getPriceRows: () => [],
    getDisparityDays: () => 60,
    supportsTechnicalSeries: () => true,
    getMainRange: () => [10, 20],
    scheduleCommittedViewport: () => { order.push("commit"); return true; },
    flushCommittedViewport: async () => order.push("flush"),
  });

  await app.getRuntime();
  await app.refreshViewport();

  assert.deepEqual(order, ["commit", "flush", "render", "settled"]);
});

test("auxiliary chart app shares its cached MACD model with feature consumers", () => {
  const records = [
    { date: "2026-07-13", "^KS11": 3200 },
    { date: "2026-07-14", "^KS11": 3220 },
  ];
  const builds = [];
  const resolutions = [];
  const app = createAuxiliaryChartApp({}, {
    registry: createRegistry(),
    macdModelCache: {
      resolve(key, fingerprint, build) {
        resolutions.push({ key, fingerprint });
        return build();
      },
    },
    fingerprintDatedSeries: (rows, keys, options) => {
      assert.equal(rows, records);
      assert.deepEqual(keys, ["^KS11"]);
      assert.equal(options.logicVersion, "macd-v3-disparity-60");
      return "price-fingerprint";
    },
    getPriceRows: () => records,
    getDisparityDays: () => 60,
    supportsTechnicalSeries: () => true,
  });

  const model = app.getMacdModelForSeries("^ks11", (input) => {
    builds.push(input);
    return { signal: 0.5 };
  });

  assert.deepEqual(model, { signal: 0.5 });
  assert.deepEqual(resolutions, [{ key: "^KS11", fingerprint: "price-fingerprint" }]);
  assert.deepEqual(builds, [{
    dates: ["2026-07-13", "2026-07-14"],
    prices: [3200, 3220],
    disparityPeriod: 60,
  }]);
});
