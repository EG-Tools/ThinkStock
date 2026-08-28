import assert from "node:assert/strict";
import test from "node:test";

import * as policy from "../../docs/modules/chart-viewport-controller.mjs";

test("handle policy keeps fixed side rails and every plot area horizontally aligned", () => {
  assert.deepEqual(policy.resolve(true), {
    mainMargin: 36,
    auxiliaryMargin: 36,
    controlLeft: 35,
    controlRight: 34,
    sliderInset: 44,
  });
  assert.deepEqual(policy.resolve(false), {
    mainMargin: 36,
    auxiliaryMargin: 36,
    controlLeft: 14,
    controlRight: 12,
    sliderInset: 20,
  });
});

test("handle policy applies all layout variables in one operation", () => {
  const classes = new Set();
  const variables = new Map();
  const container = {
    classList: {
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
    style: {
      setProperty: (name, value) => variables.set(name, value),
    },
  };
  policy.applyContainer(container, false);
  assert.equal(classes.has("handles-hidden"), true);
  assert.equal(variables.get("--chart-control-left"), "14px");
  assert.equal(variables.get("--chart-control-right"), "12px");
  assert.equal(variables.get("--chart-history-inset"), "20px");
});
