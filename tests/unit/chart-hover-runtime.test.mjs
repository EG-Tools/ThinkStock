import assert from "node:assert/strict";
import test from "node:test";

import * as hoverModule from "../../docs/modules/chart-hover-runtime.mjs";

test("chart hover requests the complete unified popup at the selected x value", () => {
  const frames = [];
  const hoverCalls = [];
  let popupVisible = false;
  const scope = {
    Plotly: {
      Fx: {
        hover: (...args) => { hoverCalls.push(args); popupVisible = true; },
        unhover: () => {},
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => ({ curveNumber: 0, pointNumber: 1 }),
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const chart = {
    id: "chart",
    querySelector: (selector) => (popupVisible && selector.includes(".legend") ? {} : null),
    data: [{
      x: ["2026-08-08", "2026-08-11"],
      meta: { seriesKey: "005930.KS" },
    }],
  };

  runtime.syncHoverToChart(chart, "2026-08-10");
  frames.shift()();
  assert.deepEqual(hoverCalls[0][1], [{ xval: "2026-08-10" }]);
  assert.equal(runtime.nearestMainLineDate(chart, "2026-08-10"), "2026-08-11");

  frames.shift()();
  popupVisible = false;
  runtime.syncHoverToChart(chart, "2026-08-10");
  frames.shift()();
  assert.equal(hoverCalls.length, 2);
});

test("chart hover requests one unified date after grouped rows are combined", () => {
  const frames = [];
  const hoverCalls = [];
  const combined = [
    "RFHIC · 가격 31,000<br>매수 신호",
    "삼성전자 · 가격 88,000<br>매도 신호",
  ].join("<br>────────────<br>");
  const inputTraces = [
    {
      x: ["2026-07-10"],
      text: [combined],
      customdata: [combined],
      hovertemplate: "%{text}<extra></extra>",
      meta: {
        isGroupedHoverTrace: true,
        isGroupedHoverOwnerTrace: true,
        hoverGroupTicker: "218410.KQ",
        pointHoverTemplate: "%{x}<br>%{customdata}<extra></extra>",
      },
    },
    {
      x: ["2026-07-10"],
      text: ["삼성전자 · 가격 88,000<br>매도 신호"],
      customdata: ["삼성전자 · 가격 88,000<br>매도 신호"],
      hoverinfo: "skip",
      meta: {
        isGroupedHoverTrace: true,
        hoverGroupTicker: "005930.KS",
        pointHoverTemplate: "%{x}<br>%{customdata}<extra></extra>",
      },
    },
  ];
  const fullTraces = inputTraces.map((trace) => ({
    ...trace,
    customdata: [...trace.customdata],
    meta: { ...trace.meta },
    text: [...trace.text],
  }));
  const scope = {
    Plotly: {
      Fx: {
        hover: (_chart, points) => hoverCalls.push({ points }),
        unhover: () => {},
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => ({ curveNumber: 0, pointNumber: 0 }),
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const chart = {
    id: "chart",
    data: inputTraces,
    _fullData: fullTraces,
    querySelector: () => null,
  };

  runtime.syncHoverToChart(chart, "2026-07-10");
  frames.shift()();

  assert.deepEqual(hoverCalls[0].points, [{ xval: "2026-07-10" }]);
  assert.match(inputTraces[0].customdata[0], /RFHIC[\s\S]*삼성전자/);
  assert.match(inputTraces[0].customdata[0], /매수 신호[\s\S]*매도 신호/);
  assert.equal(inputTraces[1].hoverinfo, "skip");
  frames.shift()();
  assert.equal(inputTraces[0].customdata[0], combined);
  assert.equal(fullTraces[0].customdata[0], combined);
});

test("chart hover refreshes the same date when grouped popup data changes", () => {
  const frames = [];
  const hoverCalls = [];
  const scope = {
    Plotly: {
      Fx: {
        hover: (...args) => hoverCalls.push(args),
        unhover: () => {},
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => ({ curveNumber: 0, pointNumber: 0 }),
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const chart = {
    id: "chart",
    data: [{
      x: ["2026-07-10"],
      meta: { isGroupedHoverTrace: true, renderFingerprint: "before-zoom" },
    }],
    querySelector: (selector) => (selector.includes(".legend") ? {} : null),
  };

  runtime.syncHoverToChart(chart, "2026-07-10");
  frames.shift()();
  frames.shift()();
  chart.data = [{
    x: ["2026-07-10"],
    meta: { isGroupedHoverTrace: true, renderFingerprint: "after-zoom" },
  }];
  runtime.syncHoverToChart(chart, "2026-07-10");
  frames.shift()();

  assert.equal(hoverCalls.length, 2);
});

test("chart hover pins grouped marker details to their exact owner point", () => {
  const frames = [];
  const hoverCalls = [];
  let pointPopupVisible = false;
  const inputTrace = {
    x: ["2026-06-29", "2026-06-30"],
    customdata: ["RFHIC · 가격 23,000", "RFHIC · 가격 23,600<br>EPS · 2분기 240"],
    hovertemplate: "%{text}<extra></extra>",
    meta: {
      hoverGroupHasDetails: [false, true],
      isGroupedHoverOwnerTrace: true,
      isGroupedHoverTrace: true,
      pointHoverTemplate: "%{x}<br>%{customdata}<extra></extra>",
      renderFingerprint: "eps-detail",
    },
  };
  const fullTrace = { ...inputTrace, meta: { ...inputTrace.meta } };
  const scope = {
    Plotly: {
      Fx: {
        hover: (_chart, points) => {
          hoverCalls.push(points);
          pointPopupVisible = Object.hasOwn(points[0] || {}, "curveNumber");
        },
        unhover: () => { pointPopupVisible = false; },
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => ({ curveNumber: 0, pointNumber: 0 }),
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const chart = {
    id: "chart",
    data: [inputTrace],
    _fullData: [fullTrace],
    querySelector: (selector) => (pointPopupVisible && selector.includes(".hovertext") ? {} : null),
  };

  runtime.syncHoverToChart(chart, "2026-06-30");
  frames.shift()();
  assert.deepEqual(hoverCalls, [[{ curveNumber: 0, pointIndex: 1, pointNumber: 1 }]]);
  frames.shift()();
  assert.equal(inputTrace.hovertemplate, "%{text}<extra></extra>");
  assert.equal(fullTrace.hovertemplate, "%{text}<extra></extra>");
});

test("chart hover adds one date header only for a point popup fallback", () => {
  const frames = [];
  const hoverCalls = [];
  const inputTrace = {
    x: ["2026-06-30"],
    hovertemplate: "%{text}<extra></extra>",
    meta: {
      isGroupedHoverTrace: true,
      pointHoverTemplate: "%{x|%Y.%-m.%-d}<br>%{customdata}<extra></extra>",
    },
  };
  const fullTrace = { ...inputTrace, meta: { ...inputTrace.meta } };
  const scope = {
    Plotly: {
      Fx: {
        hover: (_chart, points) => {
          hoverCalls.push({ points, template: fullTrace.hovertemplate });
        },
        unhover: () => {},
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => ({ curveNumber: 0, pointNumber: 0 }),
    getTraceTimeMsArray: () => [Date.parse("2026-06-30T00:00:00Z")],
    toMsSafe: () => Date.parse("2026-06-30T00:00:00Z"),
  });
  const chart = {
    id: "chart",
    data: [inputTrace],
    _fullData: [fullTrace],
    querySelector: () => null,
  };

  runtime.syncHoverToChart(chart, "2026-06-30");
  frames.shift()();
  frames.shift()();

  assert.deepEqual(hoverCalls[0].points, [{ xval: "2026-06-30" }]);
  assert.deepEqual(hoverCalls[1].points, [{ curveNumber: 0, pointNumber: 0 }]);
  assert.equal(
    hoverCalls[1].template,
    "%{x|%Y.%-m.%-d}<br>%{customdata}<extra></extra>",
  );
  assert.equal(inputTrace.hovertemplate, "%{text}<extra></extra>");
  assert.equal(fullTrace.hovertemplate, "%{text}<extra></extra>");
});

test("chart hover normalizes every point-popup content row to the price-popup indent", () => {
  function line(text, left, x = "9") {
    const baseX = Number.parseFloat(x) || 0;
    const attributes = new Map([["x", x]]);
    return {
      textContent: text,
      contains: () => false,
      getAttribute: (name) => attributes.get(name) ?? null,
      getBoundingClientRect: () => ({
        left: left + (Number.parseFloat(attributes.get("x")) || 0) - baseX,
      }),
      hasAttribute: (name) => attributes.has(name),
      setAttribute: (name, value) => attributes.set(name, String(value)),
    };
  }
  const date = line("2024.3.31", 100);
  const ticker = line("RFHIC", 132);
  const eps = line("EPS", 121);
  const lines = [date, ticker, eps];
  const pathAttributes = new Map();
  const pointFrame = {
    getAttribute: (name) => pathAttributes.get(name) ?? null,
    getBBox: () => ({ x: 2, y: 4, width: 80, height: 44 }),
    setAttribute: (name, value) => pathAttributes.set(name, String(value)),
  };
  const hoverLayer = {
    querySelectorAll: (selector) => {
      if (selector === "g.hovertext > path") return [pointFrame];
      return selector.includes("tspan.line") ? lines : [];
    },
  };
  const runtime = hoverModule.createChartHoverRuntime({
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  }, {
    findNearestHoverPoint: () => null,
    getTraceTimeMsArray: () => [],
    toMsSafe: () => NaN,
  });

  assert.equal(runtime.normalizeHoverPopupIndent({
    querySelector: () => hoverLayer,
  }), true);
  assert.equal(ticker.getBoundingClientRect().left, 138);
  assert.equal(eps.getBoundingClientRect().left, 138);
  assert.equal(pathAttributes.get("data-thinkstock-flat-frame"), "1");
  assert.match(pathAttributes.get("d"), /^M 6 4 H 78/);

  // Re-running on the same Plotly nodes must not accumulate the correction.
  assert.equal(runtime.normalizeHoverPopupIndent({
    querySelector: () => hoverLayer,
  }), true);
  assert.equal(ticker.getBoundingClientRect().left, 138);
  assert.equal(eps.getBoundingClientRect().left, 138);
});

test("chart hover keeps the unified price popup on the same indent", () => {
  function line(text, left, x) {
    const baseX = Number.parseFloat(x) || 0;
    const attributes = new Map([["x", x]]);
    return {
      textContent: text,
      contains: () => false,
      getAttribute: (name) => attributes.get(name) ?? null,
      getBoundingClientRect: () => ({
        left: left + (Number.parseFloat(attributes.get("x")) || 0) - baseX,
      }),
      hasAttribute: (name) => attributes.has(name),
      setAttribute: (name, value) => attributes.set(name, String(value)),
    };
  }
  const date = line("2015.10.15", 100, "3");
  const ticker = line("RFHIC", 138, "40");
  const hoverLayer = {
    querySelectorAll: (selector) => {
      if (selector === "text.legendtitletext") return [date];
      if (selector === "text.legendtext") return [ticker];
      return [];
    },
  };
  const runtime = hoverModule.createChartHoverRuntime({
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  }, {
    findNearestHoverPoint: () => null,
    getTraceTimeMsArray: () => [],
    toMsSafe: () => NaN,
  });

  assert.equal(runtime.normalizeHoverPopupIndent({
    querySelector: () => hoverLayer,
  }), true);
  assert.equal(ticker.getBoundingClientRect().left, 138);
});

test("chart hover retries the same date while only a point fallback is visible", () => {
  const frames = [];
  const hoverCalls = [];
  let popupKind = "point";
  const unifiedPopup = { querySelector: () => null, querySelectorAll: () => [] };
  const scope = {
    Plotly: {
      Fx: {
        hover: (_chart, points) => {
          hoverCalls.push(points);
          if (hoverCalls.length >= 2) popupKind = "unified";
        },
        unhover: () => {},
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => null,
    getTraceTimeMsArray: () => [Date.parse("2026-06-30T00:00:00Z")],
    toMsSafe: () => Date.parse("2026-06-30T00:00:00Z"),
  });
  const chart = {
    id: "chart",
    data: [],
    querySelector: (selector) => (
      selector.includes(".legend") && popupKind === "unified" ? unifiedPopup : null
    ),
  };

  runtime.syncHoverToChart(chart, "2026-06-30");
  frames.shift()();
  frames.shift()();
  runtime.syncHoverToChart(chart, "2026-06-30");
  frames.shift()();
  frames.shift()();
  assert.equal(hoverCalls.length, 2);

  runtime.syncHoverToChart(chart, "2026-06-30");
  frames.shift()();
  assert.equal(hoverCalls.length, 2);
});

test("chart hover rebuilds signal details when Plotly reuses the point popup for price only", () => {
  const frames = [];
  const hoverCalls = [];
  let popupContent = "가격";
  const pointText = {
    getAttribute: (name) => (name === "data-unformatted" ? popupContent : null),
    textContent: "",
  };
  const pointPopup = {
    querySelector: (selector) => (selector === "text.nums" ? pointText : null),
    querySelectorAll: () => [],
  };
  const inputTrace = {
    x: ["2026-06-30"],
    hovertemplate: "%{text}<extra></extra>",
    meta: {
      hoverGroupHasDetails: [true],
      isGroupedHoverOwnerTrace: true,
      isGroupedHoverTrace: true,
      pointHoverTemplate: "%{x}<br>%{customdata}<extra></extra>",
    },
  };
  const scope = {
    Plotly: {
      Fx: {
        hover: (_chart, points) => {
          hoverCalls.push(points);
          popupContent = "가격\n매수 신호";
        },
        unhover: () => {},
      },
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
  };
  const runtime = hoverModule.createChartHoverRuntime(scope, {
    findNearestHoverPoint: () => ({ curveNumber: 0, pointNumber: 0 }),
    getTraceTimeMsArray: () => [Date.parse("2026-06-30T00:00:00Z")],
    toMsSafe: () => Date.parse("2026-06-30T00:00:00Z"),
  });
  const chart = {
    id: "chart",
    data: [inputTrace],
    _fullData: [{ ...inputTrace, meta: { ...inputTrace.meta } }],
    querySelector: (selector) => (
      selector === ".hoverlayer > g.hovertext" ? pointPopup : null
    ),
  };
  const flushFrames = () => {
    while (frames.length) frames.shift()();
  };

  runtime.syncHoverToChart(chart, "2026-06-30");
  flushFrames();
  assert.equal(hoverCalls.length, 1);

  runtime.syncHoverToChart(chart, "2026-06-30");
  flushFrames();
  assert.equal(hoverCalls.length, 1);

  // Plotly may keep the same SVG group while replacing its text after zoom.
  popupContent = "가격";
  runtime.syncHoverToChart(chart, "2026-06-30");
  flushFrames();
  assert.equal(hoverCalls.length, 2);
});

test("chart hover exposes event markers only on the exact selected date", () => {
  const runtime = hoverModule.createChartHoverRuntime({
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  }, {
    findNearestHoverPoint: () => null,
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const line = { x: ["2026-08-08", "2026-08-11"], meta: { seriesKey: "005930.KS" } };
  const exact = { x: ["2026-08-11"], meta: { isDisclosureTrace: true } };
  const other = { x: ["2026-08-08"], meta: { isInsiderTradeTrace: true } };
  const chart = {
    data: [line, exact, other],
    _fullData: [line, exact, other],
    _fullLayout: { xaxis: { _offset: 0, p2d: () => "2026-08-11" } },
    getBoundingClientRect: () => ({ left: 0 }),
  };

  runtime.configureExactDateEventHover(chart, { clientX: 100 });
  assert.equal(exact.hoverinfo, "all");
  assert.equal(other.hoverinfo, "skip");
});

test("grouped chart hover keeps visual event glyphs silent", () => {
  const runtime = hoverModule.createChartHoverRuntime({
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  }, {
    findNearestHoverPoint: () => null,
    getTraceTimeMsArray: (trace) => trace.x.map((date) => Date.parse(`${date}T00:00:00Z`)),
    toMsSafe: (value) => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`),
  });
  const line = { x: ["2026-08-11"], meta: { seriesKey: "005930.KS" } };
  const grouped = { x: ["2026-08-11"], meta: { isGroupedHoverTrace: true } };
  const disclosure = { x: ["2026-08-11"], hoverinfo: "all", meta: { isDisclosureTrace: true } };
  const insider = { x: ["2026-08-11"], hoverinfo: "none", meta: { isInsiderTradeTrace: true } };
  const chart = {
    data: [line, grouped, disclosure, insider],
    _fullData: [line, grouped, disclosure, insider],
    _fullLayout: { xaxis: { _offset: 0, p2d: () => "2026-08-11" } },
    getBoundingClientRect: () => ({ left: 0 }),
  };

  runtime.configureExactDateEventHover(chart, { clientX: 100 });
  assert.equal(disclosure.hoverinfo, "skip");
  assert.equal(insider.hoverinfo, "skip");
});
