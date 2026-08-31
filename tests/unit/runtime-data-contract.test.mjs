import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBootstrapPayload,
  normalizeCrisisSignalPayload,
  normalizeCreditPayload,
  normalizeMacroPayload,
  normalizePriceBatchPayload,
  normalizePricePayload,
} from "../../shared/runtime-data-contract.mjs";

test("normalizes a partial startup bootstrap without discarding the usable source", () => {
  const payload = normalizeBootstrapPayload({
    ok: true,
    indices: {
      ok: true,
      records: [
        { ticker: "^KS11", date: "2026-08-10", close: 3200 },
        { ticker: "^KQ11", date: "2026-08-10", close: 860 },
      ],
    },
    prices: { ok: false, requested: 1, error: "price unavailable" },
  });
  assert.equal(payload.partial, true);
  assert.equal(payload.indices.records.length, 2);
  assert.deepEqual(payload.prices.results, []);
});

test("keeps only positive credit values and rejects zero-only updates", () => {
  assert.deepEqual(normalizeCreditPayload({
    ok: true,
    rows: [
      { date: "2026-08-06", kospi_credit: 20.1, kosdaq_credit: 0 },
      { date: "bad-date", customer_deposit: 80 },
    ],
  }).rows, [{ date: "2026-08-06", kospi_credit: 20.1 }]);

  assert.throws(
    () => normalizeCreditPayload({ ok: true, rows: [{ date: "2026-08-07", kospi_credit: 0 }] }),
    /no usable rows/,
  );
});

test("normalizes partial batch prices without hiding individual failures", () => {
  const payload = normalizePriceBatchPayload({
    ok: true,
    requested: 2,
    succeeded: 1,
    results: [
      { ok: true, ticker: "005930.KS", records: [{ date: "2026-08-10", close: 71000 }] },
      { ok: false, ticker: "000660.KS", error: "upstream unavailable" },
    ],
  });
  assert.equal(payload.succeeded, 1);
  assert.deepEqual(payload.results[0].records, [{ date: "2026-08-10", close: 71000 }]);
  assert.deepEqual(payload.results[1], {
    ok: false,
    ticker: "000660.KS",
    error: "upstream unavailable",
  });
});

test("keeps usable batch prices when another ticker payload is malformed", () => {
  const payload = normalizePriceBatchPayload({
    ok: true,
    results: [
      { ok: true, ticker: "005930.KS", records: [{ date: "2026-08-10", close: 71000 }] },
      { ok: true, ticker: "000660.KS", records: [{ date: "2026-08-10", close: 0 }] },
      { ok: true, ticker: "invalid", records: [{ date: "2026-08-10", close: 100 }] },
    ],
  });

  assert.equal(payload.succeeded, 1);
  assert.equal(payload.results[0].ok, true);
  assert.deepEqual(payload.results.slice(1).map((result) => result.ok), [false, false]);
});

test("accepts partial macro success but rejects an entirely empty response", () => {
  const normalized = normalizeMacroPayload({
    ok: true,
    leadingRows: [{ date: "2026-05-01", leading_cycle: 104.8 }],
    newsRows: [],
    policyRateRows: [{ date: "2026-05-01", policy_rate: 2.5 }],
    tradeRows: [{ date: "2026-05-01", export_value: 60, import_value: 55 }],
  });
  assert.deepEqual(normalized.leadingRows, [{ date: "2026-05-01", leading_cycle: 104.8 }]);
  assert.deepEqual(normalized.policyRateRows, [{ date: "2026-05-01", policy_rate: 2.5 }]);
  assert.deepEqual(normalized.tradeRows, [{ date: "2026-05-01", export_value: 60, import_value: 55 }]);
  assert.deepEqual(normalized.componentLatestDates, {
    leading_cycle: "2026-05-01",
    policy_rate: "2026-05-01",
    export_value: "2026-05-01",
    import_value: "2026-05-01",
  });
  assert.throws(
    () => normalizeMacroPayload({ ok: true, leadingRows: [], newsRows: [] }),
    /no usable rows/,
  );
  const partialAfterLeadingFailure = normalizeMacroPayload({
    ok: true,
    leadingRows: [
      { date: "2026-06-01", leading_cycle: 105.7 },
      { date: "2026-06-02", leading_cycle: 102.869808 },
    ],
    newsRows: [{ date: "2026-06-02", news_sentiment: 103 }],
  });
  assert.deepEqual(partialAfterLeadingFailure.leadingRows, []);
  assert.equal(partialAfterLeadingFailure.newsRows.length, 1);
  assert.match(partialAfterLeadingFailure.componentWarnings[0], /implausible jump/);
  assert.throws(() => normalizeMacroPayload({
    ok: true,
    leadingRows: [
      { date: "2026-06-01", leading_cycle: 105.7 },
      { date: "2026-06-02", leading_cycle: 102.869808 },
    ],
    newsRows: [],
  }), /implausible jump/);
});

test("rejects an empty or zero latest price so the cached close remains usable", () => {
  assert.deepEqual(normalizePricePayload({
    ok: true,
    records: [{ date: "2026-08-06", close: 71200 }],
  }).records, [{ date: "2026-08-06", close: 71200 }]);
  assert.throws(
    () => normalizePricePayload({ ok: true, records: [{ date: "2026-08-07", close: 0 }] }),
    /no usable rows/,
  );
});

test("normalizes crisis signal scores and preserves diagnostic components", () => {
  const payload = normalizeCrisisSignalPayload({
    ok: true,
    records: [
      { date: "bad", score: 80 },
      {
        date: "2026-08-06",
        score: 62.4,
        stage: "warning",
        curve: 30,
        labor: 17,
        credit: 15,
        t10y2y: 0.24,
        t10y1y: -0.18,
        fedFunds: 4.25,
        fedFundsChange6m: -0.75,
        vkospi: 18.7,
        vkospiChange20: 0.09,
        vix: 21.5,
        vixChange20: 0.12,
        krwUsd: 1375.4,
        krwUsdChange20: 0.018,
        uninversion: true,
      },
    ],
    termSpreadRows: [
      { date: "bad", t10y1y: 0.4 },
      { date: "2026-08-07", t10y1y: -0.13 },
    ],
    creditSpreadRows: [
      { date: "bad", us_credit_spread: 0.81 },
      { date: "2026-08-05", us_credit_spread: 0.66 },
    ],
    vkospiRows: [
      { date: "bad", vkospi: 20 },
      { date: "2026-08-06", vkospi: 18.7, vkospiHigh: 19.2 },
    ],
    vixRows: [
      { date: "bad", vix: 18 },
      { date: "2026-08-07", vix: 21.25, vixChange20: 0.08 },
    ],
  });
  assert.deepEqual(payload.records, [{
    date: "2026-08-06",
    score: 62,
    curve: 30,
    labor: 17,
    credit: 15,
    t10y2y: 0.24,
    t10y1y: -0.18,
    fedFunds: 4.25,
    fedFundsChange6m: -0.75,
    vkospi: 18.7,
    vkospiChange20: 0.09,
    vix: 21.5,
    vixChange20: 0.12,
    krwUsd: 1375.4,
    krwUsdChange20: 0.018,
    stage: "warning",
    uninversion: true,
  }]);
  assert.deepEqual(payload.termSpreadRows, [{
    date: "2026-08-07",
    t10y1y: -0.13,
  }]);
  assert.deepEqual(payload.creditSpreadRows, [{
    date: "2026-08-05",
    us_credit_spread: 0.66,
  }]);
  assert.deepEqual(payload.vkospiRows, [{
    date: "2026-08-06",
    vkospi: 18.7,
    vkospiHigh: 19.2,
  }]);
  assert.deepEqual(payload.vixRows, [{
    date: "2026-08-07",
    vix: 21.25,
    vixChange20: 0.08,
  }]);
  assert.deepEqual(payload.componentLatestDates, {
    score: "2026-08-06",
    t10y1y: "2026-08-07",
    us_credit_spread: "2026-08-05",
    vkospi: "2026-08-06",
    vix: "2026-08-07",
  });
});

test("normalization is deterministic across local and remote row ordering", () => {
  const local = normalizeCreditPayload({
    ok: true,
    rows: [
      { date: "2026-08-12", customer_deposit: 80 },
      { date: "2026-08-11", kospi_credit: 21 },
      { date: "2026-08-12", kosdaq_credit: 12 },
    ],
  });
  const remote = normalizeCreditPayload({
    ok: true,
    rows: [
      { date: "2026-08-12", kosdaq_credit: 12 },
      { date: "2026-08-12", customer_deposit: 80 },
      { date: "2026-08-11", kospi_credit: 21 },
    ],
  });

  assert.deepEqual(remote.rows, local.rows);
  assert.deepEqual(remote.componentLatestDates, local.componentLatestDates);
});

test("keeps a valid VKOSPI component when crisis records are unusable", () => {
  const payload = normalizeCrisisSignalPayload({
    ok: true,
    records: [{ date: "bad", score: 80 }],
    vkospiRows: [{ date: "2026-08-12", vkospi: 55.53 }],
  });

  assert.deepEqual(payload.records, []);
  assert.deepEqual(payload.vkospiRows, [{ date: "2026-08-12", vkospi: 55.53 }]);
  assert.equal(payload.latestDate, "2026-08-12");
  assert.equal(payload.componentWarnings.length, 1);
});

test("keeps a valid daily VIX component independently of crisis summary rows", () => {
  const payload = normalizeCrisisSignalPayload({
    ok: true,
    records: [],
    vixRows: [
      { date: "2026-08-12", vix: 18.42 },
      { date: "2026-08-13", vix: 0 },
    ],
  });

  assert.deepEqual(payload.vixRows, [{ date: "2026-08-12", vix: 18.42 }]);
  assert.equal(payload.latestDate, "2026-08-12");
});

test("bootstrap preserves valid indices when one price result is malformed", () => {
  const payload = normalizeBootstrapPayload({
    ok: true,
    indices: {
      ok: true,
      records: [{ ticker: "^KS11", date: "2026-08-12", close: 3200 }],
    },
    prices: {
      ok: true,
      requested: 1,
      results: [{ ok: true, ticker: "005930.KS", records: [{ date: "2026-08-12", close: 0 }] }],
    },
  });

  assert.equal(payload.indices.records.length, 1);
  assert.equal(payload.prices.succeeded, 0);
  assert.equal(payload.partial, true);
});
