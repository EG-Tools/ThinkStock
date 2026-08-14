import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisEvidenceFingerprint,
  analysisFeatureManifest,
  koreanDateFromTimestamp,
  mergePointInTimeAnalysisSnapshots,
  selectAnalysisEvidenceAsOf,
} from "../../shared/ai-analysis-snapshots.mjs";

function snapshot(asOf, targetPrice, extra = {}) {
  return {
    asOf,
    savedAt: Date.parse(`${asOf}T03:00:00Z`),
    consensus: { targetPrice, institutions: 3 },
    financials: [],
    news: [],
    ...extra,
  };
}

test("uses the Korean calendar day for analysis captured after midnight", () => {
  assert.equal(koreanDateFromTimestamp(Date.parse("2026-08-11T18:30:00Z")), "2026-08-12");
});

test("keeps recent same-month changes while compacting older history by month", () => {
  const result = mergePointInTimeAnalysisSnapshots([
    snapshot("2025-12-01", 100),
    snapshot("2025-12-20", 110),
    snapshot("2026-05-01", 120),
    snapshot("2026-05-01", 120, { savedAt: Date.parse("2026-05-01T08:00:00Z") }),
    snapshot("2026-05-20", 130),
    snapshot("2026-06-10", 140),
  ], []);

  assert.deepEqual(result.map((item) => item.asOf), [
    "2025-12-20",
    "2026-05-01",
    "2026-05-20",
    "2026-06-10",
  ]);
});

test("drops unchanged daily copies but preserves a later return to an old state", () => {
  const result = mergePointInTimeAnalysisSnapshots([
    snapshot("2026-06-01", 100),
    snapshot("2026-06-02", 100),
    snapshot("2026-06-03", 120),
    snapshot("2026-06-04", 100),
  ], []);

  assert.deepEqual(result.map((item) => item.asOf), ["2026-06-01", "2026-06-03", "2026-06-04"]);
});

test("ignores fetch timestamps when deciding whether evidence actually changed", () => {
  const first = snapshot("2026-06-01", 100, {
    consensus: { targetPrice: 100, institutions: 3, fetchedAt: "2026-06-01T03:00:00Z" },
  });
  const second = snapshot("2026-06-02", 100, {
    consensus: { targetPrice: 100, institutions: 3, fetchedAt: "2026-06-02T03:00:00Z" },
  });
  assert.equal(analysisEvidenceFingerprint(first), analysisEvidenceFingerprint(second));
  assert.deepEqual(
    mergePointInTimeAnalysisSnapshots([first, second], []).map((item) => item.asOf),
    ["2026-06-01"],
  );
});

test("records compact feature-family availability for later ablation audits", () => {
  const manifest = analysisFeatureManifest(snapshot("2026-06-01", 100, {
    financials: [{ period: "2026-03", reportDate: "2026-05-15", revenue: 10 }],
    news: [{ date: "2026-05-30", title: "result", source: "official", url: "https://example.com" }],
  }));
  assert.equal(manifest.families.consensus, true);
  assert.equal(manifest.families.financials, 1);
  assert.equal(manifest.families.news, 1);
  assert.equal(manifest.sourceDates.financials, "2026-05-15");
  assert.equal(manifest.sourceDates.news, "2026-05-30");
});

test("selects only evidence captured and published by the forecast cutoff", () => {
  const record = {
    savedAt: Date.parse("2026-06-10T03:00:00Z"),
    consensus: { targetPrice: 200, institutions: 5 },
    financials: [],
    news: [],
    snapshots: [
      snapshot("2026-05-01", 100, {
        financials: [{ period: "2026-03", reportDate: "2026-05-02", revenue: 10 }],
        news: [{ date: "2026-05-03", title: "first" }],
      }),
      snapshot("2026-06-01", 180, {
        financials: [
          { period: "2026-03", reportDate: "2026-05-02", revenue: 10 },
          { period: "2026-06", reportDate: "2026-06-10", revenue: 20 },
        ],
        news: [{ date: "2026-06-02", title: "second" }],
      }),
    ],
  };

  const may = selectAnalysisEvidenceAsOf(record, "2026-05-15");
  assert.equal(may.asOf, "2026-05-01");
  assert.equal(may.consensus.targetPrice, 100);
  assert.equal(may.consensus.asOfDate, "2026-05-01");
  assert.equal(may.financials.length, 1);
  assert.equal(may.news.length, 1);

  const earlyJune = selectAnalysisEvidenceAsOf(record, "2026-06-05");
  assert.equal(earlyJune.asOf, "2026-06-01");
  assert.equal(earlyJune.financials.length, 1);
  assert.equal(earlyJune.news[0].title, "second");
  assert.equal(selectAnalysisEvidenceAsOf(record, "2026-04-30"), null);
});
