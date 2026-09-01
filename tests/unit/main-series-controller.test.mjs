import assert from "node:assert/strict";
import test from "node:test";

import { createMainSeriesController } from "../../docs/modules/chart-session-controller.mjs";

test("enforces one visible-series limit for indices, macro data, and stocks", () => {
  const hidden = new Set(["C"]);
  let notified = 0;
  const controller = createMainSeriesController({
    hiddenSeries: hidden,
    maximumVisible: 2,
    getSeriesKeys: () => ["A", "B", "C"],
    onLimit: () => { notified += 1; },
  });

  assert.equal(controller.setVisible("c", true), false);
  assert.equal(notified, 1);
  controller.setVisible("B", false);
  assert.equal(controller.setVisible("c", true), true);
  assert.deepEqual(controller.visibleKeys(), ["A", "C"]);
});

test("resolves the latest visible stock without duplicating app-level selection logic", () => {
  const controller = createMainSeriesController({
    hiddenSeries: new Set(["A"]),
    maximumVisible: 3,
    getSeriesKeys: () => ["A", "005930.KS", "035420.KS"],
  });
  assert.equal(controller.resolveVisibleStock("", (key) => key.endsWith(".KS")), "035420.KS");
});

test("stale render projections cannot rewrite the latest activation order", () => {
  const hidden = new Set(["A", "B"]);
  let activationOrder = [];
  const controller = createMainSeriesController({
    hiddenSeries: hidden,
    maximumVisible: 3,
    getSeriesKeys: () => ["A", "B"],
    getActivationOrder: () => activationOrder,
    setActivationOrder: (value) => { activationOrder = [...value]; },
  });

  controller.setVisible("A", true);
  controller.setVisible("B", true);
  controller.setVisible("A", false);
  controller.setVisible("A", true);
  assert.deepEqual(activationOrder, ["B", "A"]);

  assert.deepEqual(controller.activationOrder(["A"]), ["A"]);
  assert.deepEqual(activationOrder, ["B", "A"]);
  assert.deepEqual(controller.activationOrder(["A", "B"]), ["B", "A"]);
});
