import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCrisisSignalPayload,
  normalizeCreditPayload,
  normalizeMacroPayload,
  normalizePricePayload,
} from "../../shared/runtime-data-contract.mjs";

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
  assert.throws(
    () => normalizeMacroPayload({ ok: true, leadingRows: [], newsRows: [] }),
    /no usable rows/,
  );
  assert.throws(
    () => normalizeMacroPayload({
      ok: true,
      leadingRows: [
        { date: "2026-06-01", leading_cycle: 105.7 },
        { date: "2026-06-02", leading_cycle: 102.869808 },
      ],
      newsRows: [],
    }),
    /implausible jump/,
  );
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
        fedFunds: 4.25,
        fedFundsChange6m: -0.75,
        uninversion: true,
      },
    ],
  });
  assert.deepEqual(payload.records, [{
    date: "2026-08-06",
    score: 62,
    curve: 30,
    labor: 17,
    credit: 15,
    t10y2y: 0.24,
    fedFunds: 4.25,
    fedFundsChange6m: -0.75,
    stage: "warning",
    uninversion: true,
  }]);
});
