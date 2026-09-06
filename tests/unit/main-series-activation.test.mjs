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
      isHidden: () => true,
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
