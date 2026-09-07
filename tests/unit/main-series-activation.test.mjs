import assert from "node:assert/strict";
import test from "node:test";

import {
  createMainSeriesActivationApp,
  createMainSeriesActivationCoordinator,
  resolveVisibleActivationSinceDate,
} from "../../docs/modules/main-series-activation.mjs";

test("visible activation range follows the current viewport before the default period", () => {
  assert.equal(resolveVisibleActivationSinceDate({
    currentRange: ["2026-01-08", "2026-09-01"],
    overlapDays: 7,
  }), "2026-01-01");
  assert.equal(resolveVisibleActivationSinceDate({
    activeMonths: 6,
    nowMs: Date.parse("2026-09-01T00:00:00Z"),
    overlapDays: 0,
  }), "2026-03-02");
});

test("cached price is revealed before volume, history, and feature completion", async () => {
  const calls = [];
  let releaseCompletion;
  const coordinator = createMainSeriesActivationCoordinator({
    profileFor: (key) => ({ key, requiresPrice: true, requiresVolume: true }),
    hasVisiblePrice: () => true,
    reveal: () => { calls.push("price"); },
    isActive: () => true,
    needsCompletion: () => true,
    prepareCompletion: async () => {
      calls.push("volume-history-start");
      await new Promise((resolve) => { releaseCompletion = resolve; });
      calls.push("volume-history-end");
    },
    prepareFeatures: () => calls.push("features"),
  });

  const activation = await coordinator.activate("005930.ks");
  assert.deepEqual(calls, ["price", "volume-history-start"]);
  releaseCompletion();
  assert.equal(await activation.completion, true);
  assert.deepEqual(calls, ["price", "volume-history-start", "volume-history-end", "features"]);
});

test("cancelling activation prevents stale background work from attaching features", async () => {
  const calls = [];
  let releaseCompletion;
  let active = true;
  const coordinator = createMainSeriesActivationCoordinator({
    profileFor: (key) => ({ key, requiresPrice: true }),
    hasVisiblePrice: () => true,
    reveal: () => true,
    isActive: () => active,
    needsCompletion: () => true,
    prepareCompletion: () => new Promise((resolve) => { releaseCompletion = resolve; }),
    prepareFeatures: () => calls.push("features"),
    cancelBackground: () => calls.push("cancel"),
  });

  const activation = await coordinator.activate("005930.KS");
  active = false;
  coordinator.cancel("005930.KS");
  releaseCompletion();
  assert.equal(await activation.completion, false);
  assert.deepEqual(calls, ["cancel"]);
});

test("macro keys keep their shared lowercase identity", async () => {
  const calls = [];
  const coordinator = createMainSeriesActivationCoordinator({
    profileFor: (key) => ({ key, requiresPrice: false }),
    hasVisiblePrice: () => true,
    reveal: (key) => calls.push(key),
  });

  const activation = await coordinator.activate("leading_cycle");
  assert.equal(activation.revealed, true);
  assert.deepEqual(calls, ["leading_cycle"]);
});

test("macro activation reveals available observations without stock-style range coverage", async () => {
  const calls = [];
  const activation = createMainSeriesActivationApp({
    state: {
      currentRange: () => ["2023-01-01", "2026-09-01"],
      dataRows: () => [[{ date: "2025-01-01", customer_deposit: 50 }]],
      isHidden: () => false,
      toNumber: Number,
      visibleCount: () => 1,
    },
    effects: {
      reveal: (key) => { calls.push(key); },
    },
  });

  const result = await activation.activate("customer_deposit");
  assert.equal(result.revealed, true);
  assert.deepEqual(calls, ["customer_deposit"]);
});

test("a freshly fetched visible window can reveal a newly listed stock", async () => {
  const coordinator = createMainSeriesActivationCoordinator({
    profileFor: (key) => ({ key, requiresPrice: true }),
    hasVisiblePrice: (_key, _context, result) => result?.ready === true,
    prepareVisible: async () => ({ ready: true }),
    reveal: () => true,
  });

  const activation = await coordinator.activate("123456.KQ");
  assert.equal(activation.revealed, true);
});

test("cancelling a timing-capable series shares timing and stock cleanup", () => {
  const calls = [];
  const activation = createMainSeriesActivationApp({
    state: {},
    prices: {},
    effects: {
      cancelStock: (key) => calls.push(["stock", key]),
      cancelTiming: (key) => calls.push(["timing", key]),
    },
  });

  activation.cancel("005930.KS");
  activation.cancel("^KS11");
  activation.cancel("leading_cycle");

  assert.deepEqual(calls, [
    ["timing", "005930.KS"],
    ["stock", "005930.KS"],
    ["timing", "^KS11"],
  ]);
});

test("activation prepares signal work only when the signal feature is on", async () => {
  const calls = [];
  const activation = createMainSeriesActivationApp({
    state: {
      currentRange: () => ["2026-01-01", "2026-09-01"],
      featurePlan: () => ({ signal: true, supplemental: false, requested: true }),
      isHidden: () => false,
      visibleCount: () => 1,
    },
    prices: {
      points: () => [
        { date: "2025-12-01", close: 90, volume: 900 },
        { date: "2026-08-31", close: 100, volume: 1000 },
      ],
      fullHistoryReady: () => true,
      hasVolume: () => true,
    },
    effects: {
      prepareTiming: (key) => calls.push(["timing", key]),
      requestComposition: (reason) => calls.push(["composition", reason]),
      reveal: (key) => calls.push(["reveal", key]),
      scheduleFeatures: (key) => calls.push(["supplemental", key]),
    },
  });

  const result = await activation.activate("005930.KS");
  assert.equal(await result.completion, true);
  assert.deepEqual(calls, [
    ["reveal", "005930.KS"],
    ["timing", "005930.KS"],
    ["composition", "series-features-ready"],
  ]);
});

test("activation schedules no marker preparation when every feature is off", async () => {
  const calls = [];
  const activation = createMainSeriesActivationApp({
    state: {
      currentRange: () => ["2026-01-01", "2026-09-01"],
      featurePlan: () => ({ signal: false, supplemental: false, requested: false }),
      isHidden: () => false,
      visibleCount: () => 1,
    },
    prices: {
      points: () => [
        { date: "2025-12-01", close: 90, volume: 900 },
        { date: "2026-08-31", close: 100, volume: 1000 },
      ],
      fullHistoryReady: () => true,
      hasVolume: () => true,
    },
    effects: {
      prepareTiming: () => calls.push("timing"),
      requestComposition: () => calls.push("composition"),
      reveal: () => calls.push("reveal"),
      scheduleFeatures: () => calls.push("supplemental"),
    },
  });

  const result = await activation.activate("005930.KS");
  assert.equal(await result.completion, true);
  assert.deepEqual(calls, ["reveal"]);
});

test("activation sends disclosure and insider work through one supplemental path", async () => {
  const calls = [];
  const featurePlan = {
    signal: false,
    disclosure: true,
    insider: true,
    supplemental: true,
    requested: true,
  };
  const activation = createMainSeriesActivationApp({
    state: {
      currentRange: () => ["2026-01-01", "2026-09-01"],
      featurePlan: () => featurePlan,
      isHidden: () => false,
      visibleCount: () => 1,
    },
    prices: {
      points: () => [
        { date: "2025-12-01", close: 90, volume: 900 },
        { date: "2026-08-31", close: 100, volume: 1000 },
      ],
      fullHistoryReady: () => true,
      hasVolume: () => true,
    },
    effects: {
      prepareTiming: () => calls.push("timing"),
      requestComposition: (reason) => calls.push(["composition", reason]),
      reveal: () => calls.push("reveal"),
      scheduleFeatures: (_key, _message, options) => calls.push([
        "supplemental",
        options.featurePlan,
      ]),
    },
  });

  const result = await activation.activate("005930.KS");
  assert.equal(await result.completion, true);
  assert.deepEqual(calls, [
    "reveal",
    ["supplemental", featurePlan],
    ["composition", "series-features-ready"],
  ]);
});
