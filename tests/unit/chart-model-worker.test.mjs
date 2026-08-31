import assert from "node:assert/strict";
import test from "node:test";
import auxiliaryChartModel from "../../docs/modules/auxiliary-chart-model.mjs";
import mainChartModel from "../../docs/modules/main-chart-model.mjs";
import {
  attachChartModelWorker,
  createChartModelWorkerRuntime,
} from "../../docs/modules/chart-model-worker-runtime.mjs";


function createWorkerHarness() {
  const runtime = createChartModelWorkerRuntime({
    auxiliaryChartModel,
    mainChartModel,
  });
  return {
    buildDirect(payload) {
      return mainChartModel.buildMainChartModel(payload);
    },
    send(payload, id = "test-request", type = "buildMainChartModel") {
      return runtime.handleMessage({ id, type, payload });
    },
  };
}


function runWorker(payload) {
  return createWorkerHarness().send(payload);
}


test("chart worker merges raw price, macro, and credit sources", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const response = runWorker({
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: dates.map((date, index) => ({
      date,
      leading_cycle: 99 + index,
      customer_deposit: 10 + index,
      kospi_credit: 5 + index,
      kosdaq_credit: 2 + index,
    })),
    creditRows: [
      { date: dates[1], customer_deposit: 100, kospi_credit: 50, kosdaq_credit: 20 },
      { date: dates[2], customer_deposit: 110, kospi_credit: 55, kosdaq_credit: 22 },
    ],
    creditCols: ["customer_deposit", "kospi_credit", "kosdaq_credit"],
    creditOffsetDays: 0,
    start: dates[0],
    end: dates[2],
    allowedSeries: ["AAA", "leading_cycle", "customer_deposit", "kospi_credit", "kosdaq_credit"],
    priorityOrder: ["AAA", "leading_cycle", "customer_deposit", "kospi_credit", "kosdaq_credit"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: {},
    seriesScales: {},
    displayBudget: 100,
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.rows.length, 3);
  assert.equal(response.result.rows[1].AAA, 101);
  assert.equal(response.result.rows[1].leading_cycle, 100);
  assert.equal(response.result.rows[1].customer_deposit, 100);
  assert.equal(response.result.rows[2].kospi_credit, 55);
  assert.ok(response.result.rows[0].customer_deposit > 80);
  assert.deepEqual(
    Array.from(response.result.selected),
    ["AAA", "leading_cycle", "customer_deposit", "kospi_credit", "kosdaq_credit"],
  );
  assert.ok(response.result.seriesModels.every((model) => model.baseLineWidth === 1));
});

test("chart worker and direct fallback share one model calculation", () => {
  const harness = createWorkerHarness();
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const payload = {
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index * 3 })),
    macroRows: dates.map((date, index) => ({
      date,
      leading_cycle: 101 + index / 10,
      adr_kospi: 90 + index,
      fear_greed: 40 + index,
    })),
    creditRows: [],
    creditCols: [],
    start: dates[0],
    end: dates.at(-1),
    frameStart: dates[1],
    frameEnd: dates.at(-1),
    allowedSeries: ["AAA", "leading_cycle", "adr_kospi", "fear_greed"],
    excludedSeries: ["adr_kospi", "fear_greed"],
    priorityOrder: ["AAA", "leading_cycle", "adr_kospi", "fear_greed"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: { AAA: 4 },
    seriesScales: { AAA: 1.25 },
    displayBudget: 100,
  };
  const workerResult = harness.send(payload);
  const directResult = harness.buildDirect(payload);

  assert.equal(workerResult.ok, true);
  assert.deepEqual(Array.from(workerResult.result.selected), ["AAA", "leading_cycle"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(workerResult.result)),
    JSON.parse(JSON.stringify(directResult)),
  );
});

test("chart worker applies credit offset only as a horizontal date shift", () => {
  const dates = ["2026-01-03", "2026-01-04", "2026-01-05"];
  const payload = {
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: dates.map((date, index) => ({ date, kospi_credit: 10 + index })),
    creditRows: dates.map((date, index) => ({ date, kospi_credit: 50 + index })),
    creditCols: ["kospi_credit"],
    start: dates[0],
    end: dates[2],
    allowedSeries: ["AAA", "kospi_credit"],
    priorityOrder: ["AAA", "kospi_credit"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: {},
    seriesScales: {},
    displayBudget: 100,
  };
  const zeroOffset = runWorker({ ...payload, creditOffsetDays: 0 });
  const twoDayOffset = runWorker({ ...payload, creditOffsetDays: 2 });
  const zeroCredit = zeroOffset.result.seriesModels.find((item) => item.series === "kospi_credit");
  const shiftedCredit = twoDayOffset.result.seriesModels.find((item) => item.series === "kospi_credit");
  const zeroPrice = zeroOffset.result.seriesModels.find((item) => item.series === "AAA");
  const shiftedPrice = twoDayOffset.result.seriesModels.find((item) => item.series === "AAA");

  assert.equal(zeroOffset.ok, true);
  assert.equal(twoDayOffset.ok, true);
  assert.deepEqual(Array.from(shiftedCredit.values), Array.from(zeroCredit.values));
  assert.deepEqual(Array.from(shiftedCredit.baseValues), Array.from(zeroCredit.baseValues));
  assert.deepEqual(Array.from(shiftedCredit.rawTexts), Array.from(zeroCredit.rawTexts));
  assert.deepEqual(
    Array.from(shiftedCredit.xValues),
    ["2026-01-01", "2026-01-02", "2026-01-03"],
  );
  assert.deepEqual(Array.from(shiftedPrice.xValues), Array.from(zeroPrice.xValues));
});

test("chart worker preserves each visible series latest valid point while thinning", () => {
  const dates = Array.from({ length: 60 }, (_, index) => `2026-03-${String(index + 1).padStart(2, "0")}`);
  const response = runWorker({
    priceRows: dates.map((date, index) => ({
      date,
      AAA: index <= 47 ? 100 + index : null,
      BBB: 200 + index,
    })),
    macroRows: [],
    creditRows: [],
    creditCols: [],
    start: dates[0],
    end: dates.at(-1),
    allowedSeries: ["AAA", "BBB"],
    priorityOrder: ["AAA", "BBB"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: {},
    seriesScales: {},
    displayBudget: 12,
  });

  assert.equal(response.ok, true);
  assert.ok(response.result.displayIndexes.includes(47));
  assert.ok(response.result.displayIndexes.includes(59));
});

test("chart worker preserves internal missing-data boundaries while thinning", () => {
  const dates = Array.from({ length: 60 }, (_, index) => (
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
  ));
  const response = runWorker({
    priceRows: dates.map((date, index) => ({
      date,
      AAA: index >= 20 && index <= 29 ? null : 100 + index,
    })),
    macroRows: [],
    creditRows: [],
    creditCols: [],
    start: dates[0],
    end: dates.at(-1),
    allowedSeries: ["AAA"],
    priorityOrder: ["AAA"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: {},
    seriesScales: {},
    displayBudget: 12,
  });

  assert.equal(response.ok, true);
  [19, 20, 29, 30].forEach((index) => assert.ok(response.result.displayIndexes.includes(index)));
});

test("chart worker preserves every daily point when simplification is disabled", () => {
  const dates = Array.from({ length: 1000 }, (_, index) => (
    new Date(Date.UTC(2022, 0, index + 1)).toISOString().slice(0, 10)
  ));
  const focusEnd = dates.at(-1);
  const response = runWorker({
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: [],
    creditRows: [],
    creditCols: [],
    start: dates[0],
    end: focusEnd,
    allowedSeries: ["AAA"],
    priorityOrder: ["AAA"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: {},
    seriesScales: {},
    displayBudget: 100,
    preserveDailyPoints: true,
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.displayIndexes, null);
  assert.equal(response.result.rows.length, dates.length);
});

test("chart worker renders loaded history while normalizing from the visible frame", () => {
  const dates = Array.from({ length: 100 }, (_, index) => (
    new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10)
  ));
  const response = runWorker({
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: [],
    creditRows: [],
    creditCols: [],
    start: dates[0],
    end: dates.at(-1),
    frameStart: dates[90],
    frameEnd: dates.at(-1),
    allowedSeries: ["AAA"],
    priorityOrder: ["AAA"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: {},
    seriesScales: {},
    displayBudget: 20,
    preserveDailyPoints: true,
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.rows.length, dates.length);
  assert.equal(response.result.normBases.AAA, 194.5);
  assert.equal(response.result.displayIndexes, null);
});


test("chart worker reuses cached sources for configuration-only requests", () => {
  const harness = createWorkerHarness();
  const dates = ["2026-01-01", "2026-01-02"];
  const sources = {
    priceRows: dates.map((date, index) => ({ date, AAA: 100 + index })),
    macroRows: dates.map((date, index) => ({ date, leading_cycle: 99 + index })),
    creditRows: [],
  };
  const config = {
    datasetKey: "stable-data",
    creditCols: [],
    creditOffsetDays: 0,
    start: dates[0],
    end: dates[1],
    allowedSeries: ["AAA", "leading_cycle"],
    priorityOrder: ["AAA", "leading_cycle"],
    displayNames: {},
    hiddenSeries: [],
    seriesOffsets: {},
    seriesScales: {},
    displayBudget: 100,
  };

  const first = harness.send({ ...config, sources });
  const second = harness.send({ ...config, seriesOffsets: { AAA: 5 } });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const firstSeries = first.result.seriesModels.find((item) => item.series === "AAA");
  const secondSeries = second.result.seriesModels.find((item) => item.series === "AAA");
  assert.equal(secondSeries.values[0] - firstSeries.values[0], 5);
});


test("chart worker builds and reuses auxiliary chart sources", () => {
  const harness = createWorkerHarness();
  const sources = {
    adrRows: [
      { date: "2026-01-01", adr_kospi: 75, adr_kosdaq: 125, fear_greed: 35 },
      { date: "2026-01-02", adr_kospi: 85, adr_kosdaq: 115, fear_greed: 45 },
    ],
    macroRows: [
      { date: "2026-01-02", news_sentiment: 104 },
    ],
  };
  const config = {
    datasetKey: "aux-data",
    startDate: "2026-01-01",
    adrLowThreshold: 80,
    adrHighThreshold: 120,
    newsLowThreshold: 90,
    newsHighThreshold: 110,
  };

  const first = harness.send(
    { ...config, sources },
    "aux-1",
    "buildAuxiliaryChartModel",
  );
  const second = harness.send(
    { ...config, startDate: "2026-01-02" },
    "aux-2",
    "buildAuxiliaryChartModel",
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(Array.from(first.result.dates), ["2026-01-01", "2026-01-02"]);
  assert.deepEqual(Array.from(second.result.dates), ["2026-01-02"]);
  assert.deepEqual(Array.from(second.result.newsDates), ["2026-01-02"]);
});


test("chart worker runtime ignores unknown messages and reports source cache misses", () => {
  const runtime = createChartModelWorkerRuntime({
    mainChartModel: { buildMainChartModel: (payload) => payload },
    auxiliaryChartModel: { buildAuxiliaryChartModel: (payload) => payload },
  });

  assert.equal(runtime.handleMessage({ type: "unknown" }), null);
  assert.match(
    runtime.handleMessage({
      id: "cache-miss",
      type: "buildMainChartModel",
      payload: { datasetKey: "missing" },
    }).error,
    /source cache miss/,
  );
});

test("chart worker prepares one dataset for repeated viewport requests", () => {
  let prepares = 0;
  const prepared = { id: "prepared" };
  const received = [];
  const runtime = createChartModelWorkerRuntime({
    prepareMainChartDataset: () => { prepares += 1; return prepared; },
    mainChartModel: {
      buildMainChartModel: (payload) => {
        received.push(payload.preparedDataset);
        return { frameStart: payload.frameStart };
      },
    },
    auxiliaryChartModel: { buildAuxiliaryChartModel: (payload) => payload },
  });
  const sources = {
    priceRows: [{ date: "2026-08-20", AAA: 100 }],
    macroRows: [],
    creditRows: [],
  };

  assert.equal(runtime.handleMessage({
    id: "first",
    type: "buildMainChartModel",
    payload: { datasetKey: "prices-1", sources, frameStart: "2026-08-20" },
  }).ok, true);
  assert.equal(runtime.handleMessage({
    id: "second",
    type: "buildMainChartModel",
    payload: { datasetKey: "prices-1", frameStart: "2026-08-21" },
  }).ok, true);

  assert.equal(prepares, 1);
  assert.deepEqual(received, [prepared, prepared]);
});


test("chart worker adapter posts runtime responses and detaches cleanly", () => {
  let messageHandler = null;
  const messages = [];
  const scope = {
    addEventListener(type, handler) {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener(type, handler) {
      if (type === "message" && handler === messageHandler) messageHandler = null;
    },
    postMessage(message) {
      messages.push(message);
    },
  };
  const adapter = attachChartModelWorker(scope, {
    mainChartModel: { buildMainChartModel: (payload) => ({ count: payload.priceRows.length }) },
    auxiliaryChartModel: { buildAuxiliaryChartModel: (payload) => payload },
  });

  messageHandler({
    data: {
      id: "main-1",
      type: "buildMainChartModel",
      payload: { priceRows: [{ date: "2026-01-01", AAA: 1 }] },
    },
  });
  assert.deepEqual(messages, [{ id: "main-1", ok: true, result: { count: 1 } }]);

  adapter.dispose();
  assert.equal(messageHandler, null);
});
