import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrisisSignalRows,
  buildDerivedDifferenceRows,
  buildTreasurySpreadRows,
  buildUsCreditSpreadRows,
  fetchCrisisSignalSources,
  fetchCrisisSignalSeries,
  fetchUsCreditSpreadSeries,
  fredSeriesUrl,
  normalizeFredObservations,
} from "../../worker/src/crisis-signal.mjs";

const dates = (count, start = "2024-01-02") => Array.from({ length: count }, (_, index) => {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

const observations = (dateList, valueAt) => dateList.map((date, index) => ({
  date,
  value: String(valueAt(index)),
}));

test("normalizes FRED missing values and duplicate dates", () => {
  assert.deepEqual(normalizeFredObservations([
    { date: "2026-01-02", value: "." },
    { date: "2026-01-01", value: "1.2" },
    { date: "2026-01-01", value: "1.3" },
  ]), [{ date: "2026-01-01", value: 1.3 }]);
});

test("builds an authenticated FRED observations URL", () => {
  const url = new URL(fredSeriesUrl("T10Y2Y", "secret", "2000-01-01"));
  assert.equal(url.hostname, "api.stlouisfed.org");
  assert.equal(url.searchParams.get("series_id"), "T10Y2Y");
  assert.equal(url.searchParams.get("api_key"), "secret");
  assert.equal(url.searchParams.get("observation_start"), "2000-01-01");
});

test("builds the daily 10-year minus 1-year Treasury spread from matching FRED dates", () => {
  assert.deepEqual(buildTreasurySpreadRows([
    { date: "2026-08-27", value: "4.21" },
    { date: "2026-08-28", value: "4.18" },
  ], [
    { date: "2026-08-27", value: "3.82" },
    { date: "2026-08-28", value: "4.31" },
    { date: "2026-08-29", value: "4.25" },
  ]), [
    { date: "2026-08-27", t10y1y: 0.39 },
    { date: "2026-08-28", t10y1y: -0.13 },
  ]);
});

test("builds monthly-average derived differences without filling missing periods", () => {
  assert.deepEqual(buildDerivedDifferenceRows([
    { date: "2026-07-01", value: "4.72" },
    { date: "2026-08-01", value: "4.81" },
    { date: "2026-09-01", value: "4.90" },
  ], [
    { date: "2026-07-01", value: "4.00" },
    { date: "2026-07-02", value: "4.20" },
    { date: "2026-08-03", value: "4.15" },
  ], { outputKey: "us_credit_spread", alignment: "monthly-average" }), [
    { date: "2026-07-01", us_credit_spread: 0.62 },
    { date: "2026-08-01", us_credit_spread: 0.66 },
  ]);
});

test("uses monthly history only before the daily OAS series begins", () => {
  assert.deepEqual(buildUsCreditSpreadRows({
    historicalCorporateRows: [
      { date: "2026-07-01", value: "4.72" },
      { date: "2026-08-01", value: "4.81" },
    ],
    treasury3yRows: [
      { date: "2026-07-01", value: "4.00" },
      { date: "2026-07-02", value: "4.20" },
      { date: "2026-08-03", value: "4.15" },
    ],
    dailyOasRows: [
      { date: "2026-08-27", value: "0.39" },
      { date: "2026-08-28", value: "0.41" },
    ],
  }), [
    { date: "2026-07-01", us_credit_spread: 0.62 },
    { date: "2026-08-01", us_credit_spread: 0.66 },
    { date: "2026-08-27", us_credit_spread: 0.39 },
    { date: "2026-08-28", us_credit_spread: 0.41 },
  ]);
});

test("incremental credit-spread refresh requests only the direct daily OAS", async () => {
  const requested = [];
  const result = await fetchUsCreditSpreadSeries(async (url) => {
    requested.push(new URL(url).searchParams.get("series_id"));
    return {
      ok: true,
      json: async () => ({ observations: [{ date: "2026-08-27", value: "0.39" }] }),
    };
  }, "secret", { startDate: "2026-08-27", includeHistory: false });

  assert.deepEqual(requested, ["BAMLC1A0C13Y"]);
  assert.deepEqual(result.rows, [{ date: "2026-08-27", us_credit_spread: 0.39 }]);
});

test("fetches global VIX and won-dollar series only for an explicit experiment", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(new URL(url).searchParams.get("series_id"));
    return {
      ok: true,
      json: async () => ({ observations: [{ date: "2026-01-02", value: "1" }] }),
    };
  };

  await fetchCrisisSignalSeries(fetchImpl, "secret");
  assert.equal(requested.includes("VIXCLS"), false);
  assert.equal(requested.includes("DEXKOUS"), false);

  requested.length = 0;
  await fetchCrisisSignalSeries(fetchImpl, "secret", { includeExternalRisk: true });
  assert.equal(requested.includes("VIXCLS"), true);
  assert.equal(requested.includes("DEXKOUS"), true);
});

test("refreshes VIX independently when another FRED group fails", async () => {
  const fetchImpl = async (url) => {
    const seriesId = new URL(url).searchParams.get("series_id");
    if (seriesId === "ICSA") throw new Error("claims unavailable");
    return {
      ok: true,
      json: async () => ({
        observations: [{ date: "2026-08-18", value: seriesId === "VIXCLS" ? "15.84" : "1" }],
      }),
    };
  };

  const result = await fetchCrisisSignalSources(fetchImpl, "secret");
  assert.equal(result.core, null);
  assert.equal(result.vix.at(-1).value, 15.84);
  assert.equal(result.krwUsd.at(-1).value, 1);
  assert.ok(result.treasuryYields.DGS10.length > 0);
  assert.ok(result.treasuryYields.DGS1.length > 0);
  assert.ok(result.creditRates.HQMCB3YR.length > 0);
  assert.ok(result.creditRates.DGS3.length > 0);
  assert.ok(result.creditRates.BAMLC1A0C13Y.length > 0);
  assert.ok(result.creditRates.rows.length > 0);
  assert.match(result.errors.core, /claims unavailable/);
  assert.equal(result.errors.vix, "");
});

test("caps un-inversion without labor or credit confirmation below warning", () => {
  const daily = dates(220);
  const weekly = daily.filter((_, index) => index % 7 === 0);
  const monthly = daily.filter((_, index) => index % 30 === 0);
  const rows = buildCrisisSignalRows({
    T10Y2Y: observations(daily, (index) => (index < 140 ? -0.6 : 0.5)),
    T10Y3M: observations(daily, (index) => (index < 140 ? -0.9 : 0.4)),
    UNRATE: observations(monthly, () => 4.0),
    ICSA: observations(weekly, () => 210000),
    BAA10Y: observations(daily, () => 1.6),
    SAHMREALTIME: observations(monthly, () => 0.05),
  });
  const latest = rows.at(-1);
  assert.equal(latest.uninversion, true);
  assert.ok(latest.curve >= 24);
  assert.ok(latest.score < 50);
  assert.notEqual(latest.stage, "warning");
});

test("raises warning when un-inversion is confirmed by labor and credit stress", () => {
  const daily = dates(240);
  const weekly = daily.filter((_, index) => index % 7 === 0);
  const monthly = daily.filter((_, index) => index % 30 === 0);
  const rows = buildCrisisSignalRows({
    T10Y2Y: observations(daily, (index) => (index < 150 ? -0.7 : 0.8)),
    T10Y3M: observations(daily, (index) => (index < 150 ? -1.0 : 0.7)),
    UNRATE: observations(monthly, (index) => 4 + index * 0.12),
    ICSA: observations(weekly, (index) => 180000 + index * 5000),
    BAA10Y: observations(daily, (index) => 1.5 + Math.max(0, index - 150) * 0.02),
    SAHMREALTIME: observations(monthly, (index) => Math.max(0, index * 0.1 - 0.1)),
    FEDFUNDS: observations(monthly, (index) => 5 - index * 0.2),
  });
  const latest = rows.at(-1);
  assert.ok(latest.score >= 50);
  assert.ok(["warning", "crisis"].includes(latest.stage));
  assert.ok(latest.labor >= 8);
  assert.ok(latest.credit >= 8);
  assert.ok(latest.fedFunds > 0);
  assert.ok(latest.fedFundsChange6m < -1);
});

test("preserves VIX and won-dollar candidates without changing the crisis score formula", () => {
  const daily = dates(90);
  const base = {
    T10Y2Y: observations(daily, () => 0.4),
    T10Y3M: observations(daily, () => 0.2),
    BAA10Y: observations(daily, () => 1.5),
  };
  const withoutCandidates = buildCrisisSignalRows(base);
  const withCandidates = buildCrisisSignalRows({
    ...base,
    DGS10: observations(daily, () => 4.2),
    DGS1: observations(daily, (index) => (index < 45 ? 4.8 : 3.7)),
    VIXCLS: observations(daily, (index) => 15 + index * 0.1),
    DEXKOUS: observations(daily, (index) => 1300 + index),
  });
  const latest = withCandidates.at(-1);

  assert.equal(latest.score, withoutCandidates.at(-1).score);
  assert.ok(latest.vix > 20);
  assert.ok(latest.vixChange20 > 0);
  assert.ok(latest.krwUsd > 1300);
  assert.ok(latest.krwUsdChange20 > 0);
  assert.equal(latest.t10y1y, 0.5);
});
