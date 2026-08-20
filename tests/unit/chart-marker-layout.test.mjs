import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-marker-runtime.js");
const layout = globalThis.ThinkStockChartMarkerLayout;

test("collects marker y updates by stable marker identity", () => {
  const element = {
    data: [
      { meta: { insider: true, side: "buy" }, y: [1] },
      { meta: { insider: true, side: "sell" }, y: [2] },
      { meta: { disclosure: true }, y: [3] },
    ],
  };
  const result = layout.collectYUpdates(element, [
    {
      id: "insider",
      enabled: true,
      matches: (trace) => trace?.meta?.insider,
      keyOf: (trace) => trace.meta.side,
      traces: [
        { meta: { side: "sell" }, y: [20] },
        { meta: { side: "buy" }, y: [10] },
      ],
    },
    {
      id: "disclosure",
      enabled: true,
      matches: (trace) => trace?.meta?.disclosure,
      traces: { y: [30] },
    },
  ]);

  assert.deepEqual(result.traceIndexes, [0, 1, 2]);
  assert.deepEqual(result.yUpdates, [[10], [20], [30]]);
  assert.deepEqual(result.updated, ["insider", "disclosure"]);
  assert.equal(result.structureChanged, false);
});

test("reports marker structure changes instead of applying mismatched arrays", () => {
  const result = layout.collectYUpdates({ data: [] }, [{
    id: "disclosure",
    enabled: true,
    matches: (trace) => trace?.meta?.disclosure,
    traces: { y: [1] },
  }]);
  assert.equal(result.structureChanged, true);
  assert.deepEqual(result.traceIndexes, []);
});

test("skips marker restyles when the y positions are unchanged", () => {
  const result = layout.collectYUpdates({
    data: [{ meta: { disclosure: true }, x: ["2026-08-01"], y: [10] }],
  }, [{
    id: "disclosure",
    enabled: true,
    matches: (trace) => trace?.meta?.disclosure,
    traces: { meta: { disclosure: true }, x: ["2026-08-01"], y: [10] },
  }]);

  assert.equal(result.structureChanged, false);
  assert.deepEqual(result.traceIndexes, []);
  assert.deepEqual(result.yUpdates, []);
  assert.deepEqual(result.updated, []);
});

test("requests a structural render when a new ticker changes marker dates or payload", () => {
  const result = layout.collectYUpdates({
    data: [{
      meta: { insider: true, side: "buy" },
      x: ["2026-08-01"],
      y: [10],
      customdata: [{ ticker: "005930.KS" }],
    }],
  }, [{
    id: "insider",
    enabled: true,
    matches: (trace) => trace?.meta?.insider,
    keyOf: (trace) => trace.meta.side,
    traces: [{
      meta: { side: "buy" },
      x: ["2026-08-01", "2026-08-02"],
      y: [10, 20],
      customdata: [{ ticker: "005930.KS" }, { ticker: "000660.KS" }],
    }],
  }]);

  assert.equal(result.structureChanged, true);
  assert.deepEqual(result.traceIndexes, []);
});
