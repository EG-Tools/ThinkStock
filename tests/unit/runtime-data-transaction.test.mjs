import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/runtime-foundation.mjs");
await import("../../shared/series-integrity.mjs");
await import("../../docs/modules/data-health.js");
await import("../../docs/modules/runtime-data-transaction.js");
const transaction = globalThis.ThinkStockRuntimeDataTransaction;
const policies = globalThis.ThinkStockDataHealth.DEFAULT_SERIES_POLICIES;

test("rejects a new zero or abrupt credit value without condemning an older known anomaly", () => {
  const currentRows = [
    { date: "2026-01-01", kospi_credit: 10 },
    { date: "2026-01-02", kospi_credit: 14 },
  ];
  const candidateRows = [...currentRows, { date: "2026-01-03", kospi_credit: 0 }];
  const result = transaction.validateSeriesRows({
    currentRows,
    candidateRows,
    incomingRows: [{ date: "2026-01-03", kospi_credit: 0 }],
    keys: ["kospi_credit"],
    policies: { kospi_credit: policies.kospi_credit },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "incoming-range");
});

test("accepts a valid append and preserves historical coverage", () => {
  const currentRows = [
    { date: "2026-01-01", customer_deposit: 72 },
    { date: "2026-01-02", customer_deposit: 73 },
  ];
  const candidateRows = [...currentRows, { date: "2026-01-03", customer_deposit: 74 }];
  const result = transaction.validateSeriesRows({
    currentRows,
    candidateRows,
    incomingRows: candidateRows.slice(-1),
    keys: ["customer_deposit"],
    policies: { customer_deposit: policies.customer_deposit },
  });

  assert.equal(result.ok, true);
  assert.equal(result.quality.firstDate, "2026-01-01");
  assert.equal(result.quality.latestDate, "2026-01-03");
  assert.equal(result.quality.isEmpty, false);
  assert.equal(result.quality.series.customer_deposit.count, 3);
});

test("permits an explicit publication-end trim but rejects accidental history loss", () => {
  const currentRows = [
    { date: "2026-05-01", leading_cycle: 104.8 },
    { date: "2026-06-01", leading_cycle: 104.8 },
  ];
  const candidateRows = [
    { date: "2026-05-01", leading_cycle: 104.8 },
    { date: "2026-06-01", leading_cycle: null },
  ];
  assert.equal(transaction.validateSeriesRows({
    currentRows,
    candidateRows,
    incomingRows: [{ date: "2026-05-01", leading_cycle: 104.8 }],
    keys: ["leading_cycle"],
    policies: { leading_cycle: policies.leading_cycle },
    allowLatestRegressionKeys: ["leading_cycle"],
    allowCountDecreaseKeys: ["leading_cycle"],
  }).ok, true);

  assert.equal(transaction.validateSeriesRows({
    currentRows,
    candidateRows,
    incomingRows: [],
    keys: ["leading_cycle"],
    policies: { leading_cycle: policies.leading_cycle },
  }).ok, false);
});

test("last-good ledger preserves the latest successful source after a refresh failure", () => {
  let now = 100;
  const ledger = transaction.createLastGoodLedger({ now: () => now });
  ledger.success("credit", { latestDate: "2026-08-10", detail: "3 rows" });
  now = 200;
  const failed = ledger.failure("credit", new Error("HTTP 503"));

  assert.equal(failed.state, "stale");
  assert.equal(failed.lastSuccessAt, 100);
  assert.equal(failed.latestDate, "2026-08-10");
  assert.equal(failed.lastError, "HTTP 503");
  assert.equal(ledger.snapshot().credit.failureCount, 1);
});

test("rejects a crisis feed that silently loses its last-good coverage", () => {
  const currentRows = [
    { date: "2026-08-08", score: 40 },
    { date: "2026-08-10", score: 42 },
  ];
  const result = transaction.validateSeriesRows({
    currentRows,
    candidateRows: currentRows.slice(0, 1),
    incomingRows: currentRows.slice(0, 1),
    keys: ["score"],
    policies: { score: policies.score },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "latest-regressed:score");
});

test("accepts a crisis feed with ordinary score transitions", () => {
  const candidateRows = [
    { date: "2026-08-08", score: 40 },
    { date: "2026-08-10", score: 55 },
    { date: "2026-08-11", score: 27 },
  ];
  const result = transaction.validateSeriesRows({
    currentRows: [],
    candidateRows,
    incomingRows: candidateRows,
    keys: ["score"],
    policies: { score: policies.score },
  });

  assert.equal(result.ok, true);
});

test("rejects a candidate that introduces a missing trusted market date", () => {
  const currentRows = [
    { date: "2026-08-10", vkospi: 52 },
    { date: "2026-08-11", vkospi: 53 },
    { date: "2026-08-12", vkospi: 55 },
  ];
  const candidateRows = [currentRows[0], currentRows[2]];
  const result = transaction.validateSeriesRows({
    currentRows,
    candidateRows,
    incomingRows: [],
    keys: ["vkospi"],
    policies: { vkospi: policies.vkospi },
    gapPolicies: { vkospi: policies.vkospi },
    referenceDates: ["2026-08-10", "2026-08-11", "2026-08-12"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "introduced-gap");
  assert.equal(result.issues[0].latestDate, "2026-08-11");
  assert.equal(result.quality.gapCount, 1);
});

test("quarantines a bad latest value while preserving the last-good series", () => {
  const currentRows = [
    { date: "2026-08-12", kospi_credit: 12.4 },
    { date: "2026-08-13", kospi_credit: 12.5 },
  ];
  const result = transaction.repairSeriesRows({
    currentRows,
    candidateRows: [...currentRows, { date: "2026-08-14", kospi_credit: 0 }],
    incomingRows: [{ date: "2026-08-14", kospi_credit: 0 }],
    keys: ["kospi_credit"],
    policies: { kospi_credit: policies.kospi_credit },
  });

  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.deepEqual(result.rows, currentRows);
  assert.deepEqual(result.repair.quarantined, [
    { date: "2026-08-14", key: "kospi_credit", kind: "zero" },
  ]);
});

test("source ledger throttles repeated failures but permits a forced refresh", () => {
  let now = 1_000;
  const ledger = transaction.createLastGoodLedger({ now: () => now, retryBaseMs: 2_000 });
  ledger.failure("adr", new Error("HTTP 503"));
  assert.equal(ledger.canAttempt("adr").allowed, false);
  assert.equal(ledger.canAttempt("adr").waitMs, 2_000);
  assert.equal(ledger.canAttempt("adr", { force: true }).allowed, true);
  now = 3_000;
  assert.equal(ledger.canAttempt("adr").allowed, true);
});
