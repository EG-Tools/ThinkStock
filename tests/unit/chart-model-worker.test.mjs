import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const source = await readFile(path.resolve("docs/modules/chart-model-worker.js"), "utf8");


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
  vm.runInNewContext(source, context);
  assert.equal(typeof messageHandler, "function");
  return {
    send(payload, id = `test-${messages.length + 1}`) {
      messageHandler({ data: { id, type: "buildMainChartModel", payload } });
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
