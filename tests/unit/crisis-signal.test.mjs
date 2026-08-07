import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrisisSignalRows,
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
