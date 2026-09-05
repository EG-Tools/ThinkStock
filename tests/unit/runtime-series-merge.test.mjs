import assert from "node:assert/strict";
import test from "node:test";

import * as merge from "../../docs/modules/runtime-series-merge.mjs";

test("normalizes duplicate dated values through one shared path", () => {
  assert.deepEqual(merge.normalizeDatedRows([
    { date: "2026-08-02T09:00:00Z", news_sentiment: 99 },
    { date: "2026-08-01", news_sentiment: 98 },
    { date: "2026-08-02", news_sentiment: 101 },
    { date: "invalid", news_sentiment: 120 },
  ], ["news_sentiment"], { requireIsoDate: true }), [
    { date: "2026-08-01", news_sentiment: 98 },
    { date: "2026-08-02", news_sentiment: 101 },
  ]);
});

test("normalizes sparse positive credit fields without replacing valid duplicates with zero", () => {
  assert.deepEqual(merge.normalizeCreditInputRows([
    { date: "2026-08-01", kospi_credit: 10, customer_deposit: 0 },
    { date: "2026-08-01", kospi_credit: 0, customer_deposit: 20 },
  ], ["kospi_credit", "customer_deposit"]), [
    { date: "2026-08-01", kospi_credit: 10, customer_deposit: 20 },
  ]);
  assert.equal(merge.sameNullableNumber(null, ""), true);
  assert.equal(merge.sameNullableNumber(10, "10"), true);
});

test("merges dated macro values without discarding unrelated fields", () => {
  const result = merge.mergeDatedSeries({
    sourceRows: [{ date: "2026-08-01", leading_cycle: 101, policy_rate: 2.5 }],
    incomingRows: [{ date: "2026-08-01", policy_rate: 2.75 }, { date: "2026-08-02", policy_rate: 2.75 }],
    keys: ["policy_rate"],
  });

  assert.deepEqual(result.rows, [
    { date: "2026-08-01", leading_cycle: 101, policy_rate: 2.75 },
    { date: "2026-08-02", policy_rate: 2.75 },
  ]);
  assert.equal(result.updated, 2);
});

test("leading cycle ends at its last published observation", () => {
  const result = merge.mergeLeadingCycle({
    sourceRows: [
      { date: "2026-06-01", leading_cycle: 104.8 },
      { date: "2026-06-02", leading_cycle: 104.8 },
    ],
    denseRows: [{ date: "2026-06-01", leading_cycle: 104.8 }],
    priceDates: ["2026-06-01", "2026-06-02"],
    latestDate: "2026-06-01",
  });

  assert.equal(result.rows[1].leading_cycle, null);
});

test("leading cycle live rows replace stale observation dates and retain publication dates", () => {
  const state = {
    macro: [
      { date: "2026-01-01", leading_cycle: 99.8 },
      { date: "2026-02-01", leading_cycle: 101.6, news_sentiment: 95 },
      { date: "2026-02-03", leading_cycle: 100.2 },
      { date: "2026-07-14", news_sentiment: 105 },
    ],
  };
  const controller = merge.createRuntimeSeriesController({
    buildDenseMacroRows: (rows, targetDates) => targetDates.map((date) => {
      const available = rows.filter((row) => row.date <= date).at(-1);
      return { date, leading_cycle: available?.leading_cycle ?? null };
    }).filter((row) => row.leading_cycle !== null),
    getPriceDates: () => ["2026-02-03", "2026-07-14"],
    getRows: () => state.macro,
    setRows: (_name, rows) => { state.macro = rows; },
    markChanged: () => {},
    validate: (_label, _current, candidate) => ({ rows: candidate }),
  });

  const built = controller.buildLeadingCycleLiveRows([
    { date: "2026-01-01", leading_cycle: 99.8 },
    { date: "2026-02-01", leading_cycle: 100.2 },
    { date: "2026-08-01", leading_cycle: 103.8 },
    { date: "2026-09-01", leading_cycle: 104.2 },
  ]);
  const rowsByDate = new Map(built.rows.map((row) => [row.date, row]));

  assert.equal(rowsByDate.get("2026-02-01").leading_cycle, 100.2);
  assert.equal(rowsByDate.get("2026-02-03").leading_cycle, 100.2);
  assert.equal(rowsByDate.get("2026-09-01").leading_cycle, 104.2);
  assert.equal(built.latestDate, "2026-09-01");
});

test("credit merge preserves a valid previous field but never preserves zero source values", () => {
  const result = merge.mergeCreditRows({
    sourceRows: [{ date: "2026-08-07", kospi_credit: 10, customer_deposit: 0 }],
    incomingRows: [{ date: "2026-08-07", customer_deposit: 20 }],
    keys: ["kospi_credit", "customer_deposit"],
  });

  assert.deepEqual(result.rows, [{ date: "2026-08-07", kospi_credit: 10, customer_deposit: 20 }]);
});

test("credit component updates do not discard unrelated credit series", () => {
  const result = merge.mergeCreditRows({
    sourceRows: [{
      date: "2026-08-07",
      customer_deposit: 80,
      kospi_credit: 20,
      kosdaq_credit: 12,
    }],
    incomingRows: [{ date: "2026-08-07", kospi_credit: 21 }],
    keys: ["kospi_credit"],
  });

  assert.deepEqual(result.rows, [{
    date: "2026-08-07",
    customer_deposit: 80,
    kospi_credit: 21,
    kosdaq_credit: 12,
  }]);
});

test("normalizes only bounded crisis scores", () => {
  assert.deepEqual(merge.normalizeCrisisRows([
    { date: "2026-08-01", score: 80, t10y1y: -0.25 },
    { date: "2026-08-02", score: 120 },
  ]), [{
    date: "2026-08-01",
    score: 80,
    t10y1y: -0.25,
    stage: "crisis",
    uninversion: false,
  }]);
});

test("runtime controller commits each live series through one validated state path", () => {
  const state = {
    macro: [{ date: "2026-08-01", leading_cycle: 101 }],
    credit: [{ date: "2026-08-01", kospi_credit: 10, customer_deposit: 20 }],
    crisis: [],
    adr: [{ date: "2026-08-01", adr_kospi: 95 }],
  };
  const changed = [];
  const validated = [];
  const controller = merge.createRuntimeSeriesController({
    creditKeys: ["kospi_credit", "customer_deposit"],
    getRows: (name) => state[name],
    setRows: (name, rows) => { state[name] = rows; },
    markChanged: (name) => changed.push(name),
    validate: (label, _current, candidate) => {
      validated.push(label);
      return { rows: candidate };
    },
  });

  controller.applyNewsSentimentLiveRows([
    { date: "2026-08-02", news_sentiment: 102 },
  ]);
  controller.applyCreditLiveRows([
    { date: "2026-08-02", kospi_credit: 11, customer_deposit: 21 },
  ]);
  controller.applyCrisisSignalRows([
    { date: "2026-08-02", score: 55 },
  ]);
  controller.applyAuxiliarySeriesRows([
    { date: "2026-08-02", vix: 18 },
  ], "vix", "VIX");

  assert.equal(state.macro.at(-1).news_sentiment, 102);
  assert.equal(state.credit.at(-1).kospi_credit, 11);
  assert.equal(state.crisis.at(-1).stage, "warning");
  assert.equal(state.adr.at(-1).vix, 18);
  assert.deepEqual(changed, ["macro", "credit", "crisis", "adr"]);
  assert.deepEqual(validated, ["news sentiment", "credit balance", "recession signal", "VIX"]);
});

test("runtime transaction validates components separately but commits a shared store once", () => {
  const state = {
    macro: [{ date: "2026-08-01", leading_cycle: 101 }],
  };
  const changed = [];
  const validated = [];
  const controller = merge.createRuntimeSeriesController({
    getRows: (name) => state[name],
    setRows: (name, rows) => { state[name] = rows; },
    markChanged: (name) => changed.push(name),
    validate: (label, _current, candidate) => {
      validated.push(label);
      return { rows: candidate };
    },
  });
  const transaction = controller.beginTransaction("macro");
  transaction.stage(
    controller.buildNewsSentimentLiveRows([
      { date: "2026-08-02", news_sentiment: 102 },
    ], transaction.rows()),
    ["news_sentiment"],
    { label: "news sentiment" },
  );
  transaction.stage(
    controller.buildMacroIndicatorLiveRows([
      { date: "2026-08-02", policy_rate: 2.5 },
    ], ["policy_rate"], transaction.rows()),
    ["policy_rate"],
    { label: "policy rate" },
  );

  assert.deepEqual(changed, []);
  assert.equal(transaction.commit(), true);
  assert.equal(transaction.commit(), false);
  assert.deepEqual(changed, ["macro"]);
  assert.deepEqual(validated, ["news sentiment", "policy rate"]);
  assert.equal(state.macro.at(-1).news_sentiment, 102);
  assert.equal(state.macro.at(-1).policy_rate, 2.5);
});

test("runtime transaction rebases owned fields without erasing concurrent sibling updates", () => {
  const state = {
    adr: [{ date: "2026-08-10", vkospi: 18, fear_greed: 42 }],
  };
  const controller = merge.createRuntimeSeriesController({
    getRows: (name) => state[name],
    setRows: (name, rows) => { state[name] = rows; },
    validate: (_label, _current, candidate) => ({ rows: candidate }),
  });
  const transaction = controller.beginTransaction("adr");
  transaction.stage(
    controller.buildAuxiliarySeriesRows([
      { date: "2026-09-04", vkospi: 20.5 },
    ], "vkospi", transaction.rows()),
    ["vkospi"],
    { label: "VKOSPI" },
  );

  controller.applyAuxiliarySeriesRows([
    { date: "2026-09-04", fear_greed: 32 },
  ], "fear_greed", "fear greed");
  transaction.commit();

  assert.deepEqual(state.adr.at(-1), {
    date: "2026-09-04",
    fear_greed: 32,
    vkospi: 20.5,
  });
});

test("independent auxiliary series keeps a valid latest point after a provider gap", () => {
  const state = {
    adr: [{ date: "2026-08-12", fear_greed: 43 }],
  };
  const controller = merge.createRuntimeSeriesController({
    getRows: (name) => state[name],
    setRows: (name, rows) => { state[name] = rows; },
    validate: (label, currentRows, candidateRows, incomingRows, keys, options = {}) => (
      merge.assertRows({
        label,
        currentRows,
        candidateRows,
        incomingRows,
        keys,
        policies: merge.policiesFor(keys),
        ...options,
      })
    ),
  });

  const result = controller.applyAuxiliarySeriesRows([
    { date: "2026-09-04", fear_greed: 32 },
  ], "fear_greed", "fear greed");

  assert.equal(result.updated, 1);
  assert.deepEqual(state.adr.at(-1), { date: "2026-09-04", fear_greed: 32 });
});

test("credit builds can reuse an already normalized gateway payload", () => {
  const controller = merge.createRuntimeSeriesController({
    creditKeys: ["customer_deposit", "kospi_credit", "kosdaq_credit"],
    getRows: () => [],
  });
  const normalized = [{
    date: "2026-08-20",
    customer_deposit: 52,
    kospi_credit: 21,
    kosdaq_credit: 12,
  }];

  const result = controller.buildCreditLiveRows(
    normalized,
    [],
    ["kospi_credit"],
    { normalized: true },
  );

  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].kospi_credit, 21);
});
