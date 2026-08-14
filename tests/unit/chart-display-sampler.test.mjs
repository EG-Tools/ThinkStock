import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-display-sampler.js");
const sampler = globalThis.ThinkStockChartDisplaySampler;

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({ date: `d${index}` }));
}

test("keeps daily points when requested or already inside the budget", () => {
  assert.equal(sampler.buildDisplayIndexes(rows(20), [], [], [], 10, true), null);
  assert.equal(sampler.buildDisplayIndexes(rows(5), [], [], [], 10, false), null);
});

test("preserves extrema and finite segment boundaries while thinning", () => {
  const values = [null, 10, 8, 12, null, null, 7, 15, 9, null, 5, 6];
  const indexes = sampler.buildDisplayIndexes(
    rows(values.length),
    [{ series: "stock", values }],
    ["stock"],
    [],
    6,
  );

  for (const required of [0, 1, 3, 4, 5, 6, 8, 9, 10, 11]) {
    assert.equal(indexes.includes(required), true, `missing boundary ${required}`);
  }
});

test("samples only visible series when at least one series is visible", () => {
  const visible = [1, 2, 3, 4, 5, 6, 7, 8];
  const hidden = [1, 1000, 1, 1, 1, 1, 1, 1];
  const indexes = sampler.buildDisplayIndexes(
    rows(visible.length),
    [
      { series: "visible", values: visible },
      { series: "hidden", values: hidden },
    ],
    ["visible", "hidden"],
    ["hidden"],
    4,
  );

  assert.equal(indexes.includes(2), false);
  assert.deepEqual(indexes, [0, 1, 6, 7]);
  assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right));
});
