import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-adjustments.js");
const adjustments = globalThis.ThinkStockChartAdjustments;

test("applies the same centered scale and vertical offset used by the main chart", () => {
  assert.deepEqual(adjustments.transformValues([90, 100, 110, null], 2, 5), [85, 105, 125, null]);
  assert.equal(adjustments.resolveScale({}, "leading_cycle"), 20);
  assert.equal(adjustments.resolveScale({ "005930.KS": 1.5 }, "005930.KS"), 1.5);
});

test("converts pointer movement into chart offset and scale", () => {
  const yAxis = { range: [80, 120], _length: 200 };
  assert.equal(adjustments.offsetFromDrag(3, 100, 120, yAxis), -1);
  assert.equal(adjustments.scaleFromDrag(2, 100, 115), 1.8);
  assert.deepEqual(adjustments.resetTransforms(), { offsets: {}, scales: {} });
});
