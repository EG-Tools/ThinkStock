import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SERIES_POLICIES as policies } from "../../docs/modules/data-health.mjs";
import * as transaction from "../../docs/modules/runtime-data-transaction.mjs";

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

test("rejects conflicting values for the same series date", () => {
  const result = transaction.validateSeriesRows({
    currentRows: [],
    candidateRows: [
      { date: "2026-08-12", kospi_credit: 12.4 },
      { date: "2026-08-12", kospi_credit: 0 },
    ],
    incomingRows: [],
    keys: ["kospi_credit"],
    policies: { kospi_credit: policies.kospi_credit },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "duplicate-date-conflict");
  assert.equal(result.issues[0].kind, "duplicate-conflict");
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

test("compares dated seed rows semantically without hiding an older correction", () => {
  const currentRows = [
    { date: "2020-01-02", kospi: 2100, optional: null },
    { date: "2026-08-25", kospi: 4200 },
  ];
  const equivalentRows = [
    { date: "2020-01-02", kospi: "2100" },
    { date: "2026-08-25", kospi: 4200, optional: "" },
  ];
  const correctedHistory = [
    { date: "2020-01-02", kospi: 2099 },
    equivalentRows[1],
  ];

  assert.equal(transaction.sameDatedRows(currentRows, equivalentRows), true);
  assert.equal(transaction.sameDatedRows(currentRows, correctedHistory), false);
});

test("compares disclosure text without coercing identifiers into numbers", () => {
  const currentRows = [{ date: "2026-08-25", ticker: "005930", title: "반기보고서" }];
  const sameRows = [{ date: "2026-08-25", ticker: "005930", title: "반기보고서" }];
  const differentTicker = [{ date: "2026-08-25", ticker: "5930", title: "반기보고서" }];

  assert.equal(transaction.sameDatedRows(currentRows, sameRows, { numericStrings: false }), true);
  assert.equal(transaction.sameDatedRows(currentRows, differentTicker, { numericStrings: false }), false);
});

test("price payload equality ignores generation metadata and series ordering", () => {
  const current = {
    generated_at: "2026-08-25T00:00:00Z",
    records: [{ date: "2026-08-25", "005930.KS": 100 }],
    series: ["005930.KS", "000660.KS"],
    display_names: { "005930.KS": "삼성전자", "000660.KS": "SK하이닉스" },
  };
  const equivalent = {
    generated_at: "2026-08-26T00:00:00Z",
    records: [{ date: "2026-08-25", "005930.KS": "100" }],
    series: ["000660.KS", "005930.KS"],
    display_names: { "000660.KS": "SK하이닉스", "005930.KS": "삼성전자" },
  };

  assert.equal(transaction.samePricePayload(current, equivalent), true);
  assert.equal(transaction.samePricePayload(current, {
    ...equivalent,
    display_names: { ...equivalent.display_names, "005930.KS": "삼성전자 변경" },
  }), false);
});

test("unchanged selection preserves the existing object reference", () => {
  const current = [{ date: "2026-08-25", value: 1 }];
  const candidate = [{ date: "2026-08-25", value: 1 }];
  const selected = transaction.selectChangedValue(
    current,
    candidate,
    transaction.sameDatedRows,
  );

  assert.equal(selected.changed, false);
  assert.equal(selected.value, current);
});

test("normalizes an incomplete restored seed state through one shared boundary", () => {
  const validPayload = { records: [], series: [], display_names: {} };
  assert.equal(
    transaction.normalizeRuntimeSeedComponents({ pricePayload: validPayload }).pricePayload,
    validPayload,
  );

  const normalized = transaction.normalizeRuntimeSeedComponents({
    pricePayload: { generated_at: "2026-08-28", records: null, display_names: [] },
    macroRows: null,
    creditRows: "invalid",
  });
  assert.deepEqual(normalized.pricePayload, {
    generated_at: "2026-08-28",
    records: [],
    series: [],
    display_names: {},
  });
  assert.deepEqual(normalized.macroRows, []);
  assert.deepEqual(normalized.creditRows, []);
  assert.deepEqual(normalized.adrRows, []);
  assert.deepEqual(normalized.disclosureRows, []);
});

function mergeRowsPreferIncoming(existingRows, incomingRows) {
  const rows = new Map((existingRows || []).map((row) => [row.date, { ...row }]));
  (incomingRows || []).forEach((row) => {
    rows.set(row.date, { ...(rows.get(row.date) || {}), ...row });
  });
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date));
}

const seedOperations = {
  mergeDisclosureRows: mergeRowsPreferIncoming,
  mergePricePayloadPreferIncoming: (existing, incoming) => ({
    ...existing,
    ...incoming,
    records: mergeRowsPreferIncoming(existing.records, incoming.records),
  }),
  mergePricePayloadPreservingExisting: (existing, incoming) => ({
    ...incoming,
    ...existing,
    records: mergeRowsPreferIncoming(incoming.records, existing.records),
  }),
  mergeRowsPreferIncoming,
  mergeRowsPreservingExisting: (existing, incoming) => mergeRowsPreferIncoming(incoming, existing),
  normalizeCreditRows: (rows) => rows,
  sanitizeDisclosureRows: (rows) => rows,
};

test("seed component merge keeps restored references when bundled values are unchanged", () => {
  const current = {
    pricePayload: {
      records: [{ date: "2026-08-25", "005930.KS": 100 }],
      series: ["005930.KS"],
      display_names: { "005930.KS": "삼성전자" },
    },
    macroRows: [{ date: "2026-08-25", leading_cycle: 101 }],
    creditRows: [{ date: "2026-08-25", kospi_credit: 20 }],
    adrRows: [{ date: "2026-08-25", adr_kospi: 90, vkospi: 18 }],
    disclosureRows: [],
  };
  const result = transaction.mergeRuntimeSeedComponents({
    current,
    parsed: {
      pricePayload: { ...current.pricePayload, generated_at: "new" },
      macroRows: [{ date: "2026-08-25", leading_cycle: "101" }],
      creditRows: [{ date: "2026-08-25", kospi_credit: 20 }],
      adrRows: [{ date: "2026-08-25", adr_kospi: 90 }],
      vkospiRows: [{ date: "2026-08-25", vkospi: 18 }],
    },
    mergeWithExisting: true,
    operations: seedOperations,
  });

  assert.deepEqual(result.changed, []);
  assert.equal(result.components.pricePayload, current.pricePayload);
  assert.equal(result.components.macroRows, current.macroRows);
  assert.equal(result.components.creditRows, current.creditRows);
  assert.equal(result.components.adrRows, current.adrRows);
});

test("ADR and volatility seed changes commit as one component revision", () => {
  const current = {
    pricePayload: { records: [], series: [], display_names: {} },
    macroRows: [],
    creditRows: [],
    adrRows: [{ date: "2026-08-25", adr_kospi: 90, vkospi: 18 }],
    disclosureRows: [],
  };
  const result = transaction.mergeRuntimeSeedComponents({
    current,
    parsed: {
      adrRows: [{ date: "2026-08-25", adr_kospi: 91 }],
      vkospiRows: [{ date: "2026-08-25", vkospi: 19 }],
    },
    mergeWithExisting: true,
    operations: seedOperations,
  });

  assert.deepEqual(result.changed, ["adr"]);
  assert.deepEqual(result.components.adrRows, [
    { date: "2026-08-25", adr_kospi: 91, vkospi: 19 },
  ]);
});
