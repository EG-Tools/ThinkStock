import assert from "node:assert/strict";
import test from "node:test";
import sampler from "../../docs/modules/chart-display-sampler.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

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

test("keeps every daily point inside a buffered viewport window", () => {
  const dates = Array.from({ length: 100 }, (_, index) => (
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
  ));
  const viewRange = [dates[40], dates[49]];
  const result = sampler.buildViewportIndexes(dates, viewRange, {
    bufferRatio: 1,
    minimumBufferMs: 0,
  });

  assert.equal(result.window.full, false);
  assert.ok(result.indexes.length > 10);
  assert.deepEqual(
    result.indexes,
    Array.from(
      { length: result.indexes.at(-1) - result.indexes[0] + 1 },
      (_, index) => result.indexes[0] + index,
    ),
  );
  assert.ok(result.indexes[0] < 40);
  assert.ok(result.indexes.at(-1) > 49);
});

test("requests a new viewport window only near or outside buffered edges", () => {
  const dates = Array.from({ length: 100 }, (_, index) => (
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
  ));
  const { window } = sampler.buildViewportIndexes(dates, [dates[40], dates[49]], {
    bufferRatio: 1,
  });

  assert.equal(sampler.inspectViewportCoverage(window, [dates[42], dates[47]]).needsRefresh, false);
  assert.equal(sampler.inspectViewportCoverage(window, [dates[20], dates[29]]).needsRefresh, true);
  assert.equal(sampler.inspectViewportCoverage(window, [dates[5], dates[14]]).outside, true);
});

test("slices aligned auxiliary arrays with the same viewport indexes", () => {
  const dates = Array.from({ length: 30 }, (_, index) => (
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
  ));
  const values = dates.map((_, index) => index * 2);
  const result = sampler.sliceViewportArrays(dates, [values], [dates[10], dates[14]], {
    bufferRatio: 0,
  });

  assert.equal(result.dates.length, result.arrays[0].length);
  assert.equal(result.arrays[0][0], dates.indexOf(result.dates[0]) * 2);
  assert.equal(result.arrays[0].at(-1), dates.indexOf(result.dates.at(-1)) * 2);
});

test("viewport controller reuses one buffered window for lines and markers", async () => {
  const timers = [];
  const renders = [];
  const controller = sampler.createViewportWindowController({}, {
    dayMs: DAY_MS,
    bufferRatio: 1,
    minimumBufferMs: DAY_MS,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
    requestRender: (state) => renders.push(state),
  });
  const rows = Array.from({ length: 20 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  }));
  const model = {
    rows,
    selected: ["A"],
    seriesModels: [{
      series: "A",
      xValues: rows.map((row) => row.date),
      values: rows.map((_, index) => index),
      baseValues: rows.map((_, index) => index),
      rawTexts: rows.map((_, index) => String(index)),
    }],
  };
  const built = controller.build(model, [rows[8].date, rows[10].date]);
  assert.ok(built.displayIndexes.length < rows.length);
  assert.equal(built.markerSeriesModels[0].values.length, built.displayIndexes.length);
  assert.equal(controller.eventArguments(model, { start: rows[0].date, end: rows.at(-1).date })[1][0].values.length,
    built.displayIndexes.length);

  model.seriesModels[0].values = model.seriesModels[0].values.map((value) => value + 100);
  const liveMarkerModel = controller.eventArguments(model, {
    start: rows[0].date,
    end: rows.at(-1).date,
  })[1][0];
  assert.deepEqual(
    liveMarkerModel.values,
    built.displayIndexes.map((index) => index + 100),
    "marker refresh must use the transformed live series instead of the initial viewport copy",
  );
  const repeatedArguments = controller.eventArguments(model, {
    start: rows[0].date,
    end: rows.at(-1).date,
  });
  assert.equal(repeatedArguments[1][0], liveMarkerModel);
  assert.equal(controller.stats().eventSliceHits, 2);
  assert.equal(controller.stats().eventSliceMisses, 1);

  assert.equal(controller.schedule(Date.parse(rows[0].date), Date.parse(rows[2].date)), true);
  timers.at(-1).callback();
  assert.deepEqual(renders, [{ outside: true }]);
});

test("viewport controller preserves sliced array identities for an unchanged model window", () => {
  const controller = sampler.createViewportWindowController({}, {
    dayMs: DAY_MS,
    bufferRatio: 0.5,
    minimumBufferMs: DAY_MS,
  });
  const rows = Array.from({ length: 40 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  }));
  const model = {
    rows,
    displayIndexes: null,
    seriesModels: [{
      series: "005930.KS",
      xValues: rows.map((row) => row.date),
      values: rows.map((_, index) => 100 + index),
      baseValues: rows.map((_, index) => 100 + index),
      rawTexts: rows.map((_, index) => String(100 + index)),
    }],
  };

  const first = controller.build(model, [rows[12].date, rows[22].date]);
  const second = controller.build(model, [rows[12].date, rows[22].date]);
  const shiftedInsideBuffer = controller.build(model, [rows[13].date, rows[21].date]);

  assert.equal(second.displayIndexes, first.displayIndexes);
  assert.equal(second.markerSeriesModels, first.markerSeriesModels);
  assert.equal(shiftedInsideBuffer.markerSeriesModels, first.markerSeriesModels);
  assert.equal(controller.stats().hits, 2);
  assert.equal(controller.stats().misses, 1);
  assert.equal(controller.stats().hitRate, 2 / 3);
  assert.deepEqual(controller.stats().hitReasons, { covered: 2 });
  assert.deepEqual(controller.stats().missReasons, { cold: 1 });
  assert.deepEqual(controller.stats().seriesBands, { "1": { hits: 2, misses: 1 } });

  model.seriesModels[0].values = [...model.seriesModels[0].values];
  const changed = controller.build(model, [rows[12].date, rows[22].date]);
  assert.notEqual(changed.markerSeriesModels, first.markerSeriesModels);
  assert.equal(controller.stats().hits, 2);
  assert.equal(controller.stats().misses, 2);
  assert.deepEqual(controller.stats().missReasons, { cold: 1, series: 1 });
});
