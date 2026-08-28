import assert from "node:assert/strict";
import test from "node:test";
import adjustments from "../../docs/modules/chart-adjustments.mjs";

test("applies the same centered scale and vertical offset used by the main chart", () => {
  assert.deepEqual(adjustments.transformValues([90, 100, 110, null], 2, 5), [85, 105, 125, null]);
  const output = new Array(4);
  assert.equal(adjustments.transformValuesInto([90, 100, 110, null], 2, 5, output), output);
  assert.deepEqual(output, [85, 105, 125, null]);
  assert.equal(adjustments.resolveScale({}, "leading_cycle"), 20);
  assert.equal(adjustments.resolveScale({ "005930.KS": 1.5 }, "005930.KS"), 1.5);
  assert.deepEqual(adjustments.invertTransformValues([85, 105, 125, null], 2, 5), [90, 100, 110, null]);
});

test("converts pointer movement into chart offset and scale", () => {
  const yAxis = { range: [80, 120], _length: 200 };
  assert.equal(adjustments.offsetFromDrag(3, 100, 120, yAxis), -1);
  assert.equal(adjustments.scaleFromDrag(2, 100, 115), 1.8);
  assert.deepEqual(adjustments.resetTransforms(), { offsets: {}, scales: {} });
});

test("fits the visible viewport without changing transformed trace values", () => {
  const traces = [
    { x: ["2026-01-01", "2026-02-01", "2026-03-01"], y: [20, 80, 200] },
    { x: ["2026-01-01", "2026-02-01", "2026-03-01"], y: [40, 60, 90] },
    { x: ["2026-02-01"], y: [-500], visible: "legendonly" },
  ];
  const before = JSON.stringify(traces);
  assert.deepEqual(
    adjustments.fitRangeForTraces(traces, ["2026-02-01", "2026-03-01"], {
      paddingRatio: 0.1,
      minimumPadding: 1,
    }),
    [46, 214],
  );
  assert.equal(JSON.stringify(traces), before);
});

test("reuses parsed dates and scans only the visible slice during live fitting", () => {
  const dates = Array.from({ length: 1000 }, (_, index) => (
    new Date(Date.UTC(2020, 0, index + 1)).toISOString()
  ));
  const trace = { x: dates, y: dates.map((_, index) => index) };
  const originalParse = Date.parse;
  let parseCalls = 0;
  Date.parse = (value) => {
    parseCalls += 1;
    return originalParse(value);
  };
  try {
    const range = [dates[400], dates[410]];
    assert.deepEqual(adjustments.fitRangeForTraces([trace], range, {
      paddingRatio: 0,
      minimumPadding: 0,
    }), [400, 410]);
    const firstPassCalls = parseCalls;
    assert.ok(firstPassCalls >= dates.length);

    assert.deepEqual(adjustments.fitRangeForTraces([trace], range, {
      paddingRatio: 0,
      minimumPadding: 0,
    }), [400, 410]);
    assert.equal(parseCalls - firstPassCalls, 2);
  } finally {
    Date.parse = originalParse;
  }
});

test("fits long visible ranges with cached extrema blocks while ignoring gaps", () => {
  const dates = Array.from({ length: 512 }, (_, index) => (
    new Date(Date.UTC(2024, 0, index + 1)).toISOString()
  ));
  const values = dates.map((_, index) => index);
  values[130] = null;
  values[255] = Number.NaN;
  const trace = { x: dates, y: values };
  const range = [dates[64], dates[447]];
  assert.deepEqual(adjustments.fitRangeForTraces([trace], range, {
    paddingRatio: 0,
    minimumPadding: 0,
  }), [64, 447]);
  assert.deepEqual(adjustments.fitRangeForTraces([trace], range, {
    paddingRatio: 0,
    minimumPadding: 0,
  }), [64, 447]);
});

test("fits long visible ranges with cached extrema blocks while ignoring gaps", () => {
  const dates = Array.from({ length: 512 }, (_, index) => (
    new Date(Date.UTC(2024, 0, index + 1)).toISOString()
  ));
  const values = dates.map((_, index) => index);
  values[130] = null;
  values[255] = Number.NaN;
  const trace = { x: dates, y: values };
  const range = [dates[64], dates[447]];
  assert.deepEqual(adjustments.fitRangeForTraces([trace], range, {
    paddingRatio: 0,
    minimumPadding: 0,
  }), [64, 447]);
  assert.deepEqual(adjustments.fitRangeForTraces([trace], range, {
    paddingRatio: 0,
    minimumPadding: 0,
  }), [64, 447]);
});

test("manual chart edits only expand the current viewport when a trace would be clipped", () => {
  assert.deepEqual(adjustments.expandRangeToContain([60, 140], [80, 120]), [60, 140]);
  assert.deepEqual(adjustments.expandRangeToContain([60, 140], [40, 155]), [40, 155]);
  assert.deepEqual(adjustments.expandRangeToContain(null, [75, 125]), [75, 125]);
  assert.equal(adjustments.expandRangeToContain([60, 140], null), null);
});
