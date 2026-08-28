import assert from "node:assert/strict";
import test from "node:test";

import * as interactionMath from "../../docs/modules/chart-interaction-math.mjs";
const { mainChartRenderer: renderer } = await import("../../docs/modules/main-chart-renderer.mjs");

test("prepares stable handle geometry without rebuilding unchanged handles", () => {
  const traces = [{
    x: ["2026-01-01", "2026-01-02"],
    y: [100, 140],
    line: { color: "#33ddaa" },
    meta: { seriesKey: "eps:218410.KQ", isEpsTrace: true, handleLabel: "RFHIC EPS" },
  }];
  const xAxis = { _offset: 20, _length: 300, range: ["2026-01-01", "2026-01-02"] };
  const yAxis = { _offset: 10, _length: 200, range: [0, 200], l2p: (value) => 200 - value };
  const values = { "eps:218410.KQ": [100, 140] };
  const first = renderer.buildHandleLayouts(traces, values, xAxis, yAxis);
  const second = renderer.buildHandleLayouts(traces, values, xAxis, yAxis);

  assert.equal(first.signature, second.signature);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].isEps, true);
  assert.equal(first.items[0].rightX, 326);
});

test("anchors sparse EPS handles to the visible line intersections", () => {
  const trace = {
    x: ["2026-03-31", "2026-06-30"],
    y: [100, 190],
    meta: { isEpsTrace: true },
  };
  const endpoints = renderer.visibleEndpointValues(
    trace,
    trace.y,
    ["2026-04-30", "2026-05-31"],
    interactionMath.interpolateTraceYAtMs,
  );

  assert.ok(endpoints.first > 100 && endpoints.first < 190);
  assert.ok(endpoints.last > endpoints.first && endpoints.last < 190);
});

test("updates only matching EPS dates in the grouped hover trace", () => {
  const traces = [
    {
      x: ["2026-03-31", "2026-06-30"],
      y: [100, 120],
      meta: { seriesKey: "eps:218410.KQ", isEpsTrace: true },
    },
    {
      x: ["2026-03-31", "2026-04-01", "2026-06-30"],
      y: [100, 77, 120],
      meta: { isGroupedHoverTrace: true, hoverGroupTicker: "218410.KQ" },
    },
  ];
  const update = renderer.groupedHoverYUpdate(traces, 0, [130, 170]);

  assert.equal(update.traceIndex, 1);
  assert.deepEqual(update.y, [130, 77, 170]);
});

test("updates price hover anchors without overwriting EPS anchors", () => {
  const traces = [
    {
      x: ["2026-03-31", "2026-04-01", "2026-06-30"],
      y: [100, 101, 120],
      meta: { seriesKey: "218410.KQ" },
    },
    {
      x: ["2026-03-31", "2026-04-01", "2026-06-30"],
      y: [300, 101, 400],
      meta: {
        isGroupedHoverTrace: true,
        hoverGroupTicker: "218410.KQ",
        hoverGroupPointKinds: ["eps", "price", "eps"],
      },
    },
  ];

  const update = renderer.groupedHoverYUpdate(traces, 0, [130, 131, 170]);

  assert.equal(update.traceIndex, 1);
  assert.deepEqual(update.y, [300, 131, 400]);
});

test("uses one shared grouped-hover content path for historical and forecast EPS points", () => {
  const traces = [
    {
      x: ["2026-03-31", "2026-04-01"],
      y: [100, 101],
      text: ["10,000", "10,100"],
      line: { color: "#33ddaa" },
      meta: { overlayKind: "price", seriesKey: "218410.KQ" },
    },
    {
      x: ["2026-03-31", "2027-03-31"],
      y: [140, 180],
      text: ["2026년 1분기 EPS 100", "2027년 1분기 전망 EPS 160"],
      hoverinfo: "skip",
      hovertemplate: undefined,
      meta: { overlayKind: "eps", seriesKey: "eps:218410.KQ", isEpsTrace: true },
    },
  ];

  const [grouped] = renderer.buildGroupedHoverTraces({
    enabled: true,
    traces,
    seriesOrder: ["218410.KQ"],
    labelName: () => "RFHIC",
  });

  assert.equal(traces[1].hoverinfo, "skip");
  assert.equal(traces[1].hovertemplate, undefined);
  assert.equal(grouped.hovertemplate, "%{text}<extra></extra>");
  assert.equal(
    grouped.meta.pointHoverTemplate,
    "%{x|%Y.%-m.%-d}<br>%{customdata}<extra></extra>",
  );
  ["2026-03-31", "2027-03-31"].forEach((date) => {
    const text = grouped.text[grouped.x.indexOf(date)];
    assert.ok(text.includes("<br>EPS"));
    assert.ok(!text.includes("<b>EPS</b>"));
    assert.equal(grouped.customdata[grouped.x.indexOf(date)], text);
  });
});
