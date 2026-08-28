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
