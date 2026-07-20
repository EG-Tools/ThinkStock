import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const source = await readFile(path.resolve("docs/modules/chart-model-worker.js"), "utf8");
const marketDataSource = await readFile(path.resolve("docs/modules/market-data.js"), "utf8");
const auxiliaryChartModelSource = await readFile(
  path.resolve("docs/modules/auxiliary-chart-model.js"),
  "utf8",
);


function createWorkerHarness() {
  let messageHandler = null;
  const messages = [];
  const context = {
    self: {
      addEventListener(type, handler) {
        if (type === "message") messageHandler = handler;
      },
      postMessage(message) {
        messages.push(message);
      },
    },
  };
  context.importScripts = (modulePath) => {
    if (/market-data\.js/.test(modulePath)) {
      vm.runInContext(marketDataSource, context);
      return;
    }
    if (/auxiliary-chart-model\.js/.test(modulePath)) {
      vm.runInContext(auxiliaryChartModelSource, context);
      return;
    }
    assert.fail(`unexpected worker dependency: ${modulePath}`);
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  assert.equal(typeof messageHandler, "function");
  return {
    send(payload, id = `test-${messages.length + 1}`, type = "buildMainChartModel") {
      messageHandler({ data: { id, type, payload } });
      return messages[messages.length - 1];
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
