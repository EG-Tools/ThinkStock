import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/control-state-view.js");

const { clampPercent, createProgressView } = globalThis.ThinkStockProgressView;

test("shared progress view paints, clamps, anchors, and resets one DOM contract", () => {
  const root = { hidden: true, dataset: {} };
  const text = { textContent: "" };
  const bar = { style: { width: "0%" } };
  const view = createProgressView(globalThis, {
    getRoot: () => root,
    getText: () => text,
    getBar: () => bar,
  });

  assert.equal(view.paint(140, "loading", { visible: true }), 100);
  assert.deepEqual(view.snapshot(), { percent: 100, visible: true, text: "loading" });
  view.setAnchor("insider");
  assert.equal(root.dataset.anchor, "insider");
  view.reset({ hide: true, clearAnchor: true });
  assert.equal(bar.style.width, "0%");
  assert.equal(root.hidden, true);
  assert.equal(root.dataset.anchor, undefined);
  assert.equal(clampPercent(-10), 0);
});
