import assert from "node:assert/strict";
import test from "node:test";

import {
  compareProviderSeries,
  fingerprintDatedSeries,
  inspectDatedSeries,
  mergeDatedSeriesRows,
  planSeriesRepairDates,
} from "../../shared/series-integrity.mjs";

test("merges valid incoming fields without erasing cached values", () => {
  const rows = mergeDatedSeriesRows(
    [
      { date: "2026-08-10", value: 10, other: 7 },
      { date: "2026-08-11", value: 11, other: 8 },
    ],
    [
      { date: "2026-08-11", value: 12, other: 0 },
      { date: "2026-08-12", value: 13, other: 9 },
    ],
    {
      keys: ["value", "other"],
      policies: { value: { rejectZero: true }, other: { rejectZero: true } },
    },
  );
  assert.deepEqual(rows, [
    { date: "2026-08-10", value: 10, other: 7 },
    { date: "2026-08-11", value: 12, other: 8 },
    { date: "2026-08-12", value: 13, other: 9 },
  ]);
});

test("does not coerce missing indicator values into zero", () => {
  const rows = mergeDatedSeriesRows([], [
    { date: "2026-01-02", leading_cycle: 102.2, news_sentiment: 112 },
    { date: "2026-01-03", leading_cycle: null, news_sentiment: 113.99 },
    { date: "2026-01-04", leading_cycle: "", news_sentiment: 116.9 },
  ]);

  assert.deepEqual(rows, [
    { date: "2026-01-02", leading_cycle: 102.2, news_sentiment: 112 },
    { date: "2026-01-03", news_sentiment: 113.99 },
    { date: "2026-01-04", news_sentiment: 116.9 },
  ]);
});

test("a partial series refresh preserves neighboring indicators on other dates", () => {
  const rows = mergeDatedSeriesRows(
    [
      { date: "2026-08-10", adr_kospi: 92.1, vkospi: 19.8 },
      { date: "2026-08-11", adr_kospi: 93.2, vkospi: 18.9 },
    ],
    [
      { date: "2026-08-11", vix: 15.28 },
      { date: "2026-08-12", vix: 15.6 },
    ],
    { keys: ["vix"], policies: { vix: { rejectZero: true } } },
  );
  assert.deepEqual(rows, [
    { date: "2026-08-10", adr_kospi: 92.1, vkospi: 19.8 },
    { date: "2026-08-11", adr_kospi: 93.2, vkospi: 18.9, vix: 15.28 },
    { date: "2026-08-12", vix: 15.6 },
  ]);
});

test("plans internal and official-tail repairs instead of checking only the latest row", () => {
  const rows = [
    { date: "2026-08-10", vkospi: 69.55 },
    { date: "2026-08-12", vkospi: 56.05 },
  ];
  assert.deepEqual(planSeriesRepairDates(rows, "vkospi", "2026-08-12", {
    latestKnownDate: "2026-08-12",
    lookbackDays: 4,
  }), ["2026-08-11"]);
  assert.deepEqual(planSeriesRepairDates(rows, "vkospi", "2026-08-12", {
    latestKnownDate: "2026-08-10",
    lookbackDays: 4,
  }), ["2026-08-11", "2026-08-12"]);
});

test("repair planning respects known exchange holidays and reference dates", () => {
  assert.deepEqual(planSeriesRepairDates(
    [{ date: "2026-08-10", close: 100 }, { date: "2026-08-12", close: 102 }],
    "close",
    "2026-08-12",
    {
      latestKnownDate: "2026-08-12",
      excludeDates: ["2026-08-11"],
      lookbackDays: 4,
    },
  ), []);
  assert.deepEqual(planSeriesRepairDates(
    [{ date: "2026-08-10", close: 100 }, { date: "2026-08-12", close: 102 }],
    "close",
    "2026-08-12",
    {
      latestKnownDate: "2026-08-12",
      referenceDates: ["2026-08-10", "2026-08-11", "2026-08-12"],
    },
  ), ["2026-08-11"]);
});

test("reports duplicate, gap, range, zero, and abrupt-change issues", () => {
  const report = inspectDatedSeries([
    { date: "2026-08-03", value: 100 },
    { date: "2026-08-03", value: 100 },
    { date: "2026-08-10", value: 0 },
    { date: "2026-08-11", value: 150 },
    { date: "2026-08-12", value: 100 },
    { date: "bad", value: 100 },
  ], {
    value: {
      minValue: 1,
      maxValue: 200,
      rejectZero: true,
      maxMissingBusinessDays: 2,
      maxRelativeChange: 0.2,
      maxAbsoluteChange: 20,
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.invalidDates, 1);
  assert.deepEqual(report.duplicateDates, ["2026-08-03"]);
  assert.equal(report.issues.some((issue) => issue.kind === "gap"), true);
  assert.equal(report.issues.some((issue) => issue.kind === "zero"), true);
  assert.equal(report.issues.some((issue) => issue.kind === "change"), true);
});

test("does not report known holidays as missing trading sessions", () => {
  const report = inspectDatedSeries([
    { date: "2026-09-23", value: 100 },
    { date: "2026-09-28", value: 101 },
  ], {
    value: { maxMissingBusinessDays: 0 },
  });
  assert.equal(report.ok, true);

  const referenceReport = inspectDatedSeries([
    { date: "2026-08-10", value: 100 },
    { date: "2026-08-12", value: 101 },
  ], {
    value: { maxMissingBusinessDays: 0 },
  }, {
    referenceDates: ["2026-08-10", "2026-08-12"],
  });
  assert.equal(referenceReport.ok, true);
});

test("reconciles matching providers and quarantines material disagreements", () => {
  const primary = [
    { date: "2026-08-10", close: 100 },
    { date: "2026-08-11", close: 101 },
  ];
  const matched = compareProviderSeries(primary, [
    { date: "2026-08-10", close: 100.1 },
    { date: "2026-08-11", close: 100.9 },
  ], { key: "close", relativeTolerance: 0.005 });
  assert.equal(matched.ok, true);
  assert.equal(matched.overlapCount, 2);
  assert.equal(matched.latestAgreementDate, "2026-08-11");

  const mismatch = compareProviderSeries(primary, [
    { date: "2026-08-10", close: 100 },
    { date: "2026-08-11", close: 91 },
  ], { key: "close", relativeTolerance: 0.02 });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, "mismatch");
  assert.equal(mismatch.mismatchCount, 1);
});

test("requires enough overlapping observations before trusting a provider", () => {
  const report = compareProviderSeries(
    [{ date: "2026-08-10", value: 1 }],
    [{ date: "2026-08-10", value: 1 }],
    { minimumOverlap: 2 },
  );
  assert.equal(report.ok, false);
  assert.equal(report.status, "insufficient-overlap");
});

test("tail fingerprints change only when relevant recent inputs change", () => {
  const base = [
    { date: "2026-08-08", close: 100, unrelated: 1 },
    { date: "2026-08-11", close: 101, unrelated: 1 },
    { date: "2026-08-12", close: 102, unrelated: 1 },
  ];
  const fingerprint = fingerprintDatedSeries(base, ["close"], { tail: 2, logicVersion: "timing-v2" });
  assert.equal(fingerprintDatedSeries([
    { ...base[0], close: 80 },
    base[1],
    base[2],
  ], ["close"], { tail: 2, logicVersion: "timing-v2" }), fingerprint);
  assert.notEqual(fingerprintDatedSeries([
    base[0],
    base[1],
    { ...base[2], close: 103 },
  ], ["close"], { tail: 2, logicVersion: "timing-v2" }), fingerprint);
});
