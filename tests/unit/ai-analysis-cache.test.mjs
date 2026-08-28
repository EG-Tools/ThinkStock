import assert from "node:assert/strict";
import test from "node:test";
import {
  FINANCIAL_SUMMARY_VERSION,
  SCHEMA_VERSION,
  hasCurrentFinancialSummary,
  hasDartEpsHistoryCoverage,
  isAnalysisFresh,
  mergeFinancialRecords,
  mergeSnapshots,
  normalizeAnalysisRecord,
} from "../../docs/modules/ai-analysis-cache.mjs";

test("refreshes legacy partial EPS caches once and accepts current coverage", () => {
  const legacy = normalizeAnalysisRecord("218410.KQ", {
    savedAt: Date.UTC(2026, 7, 24),
    financials: [{
      ticker: "218410.KQ",
      period: "2024-12",
      frequency: "annual",
      estimate: false,
      eps: 700,
    }],
  });
  assert.equal(hasCurrentFinancialSummary(legacy), false);

  const current = normalizeAnalysisRecord("218410.KQ", {
    savedAt: Date.UTC(2026, 7, 24),
    financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
    financials: [{
      ticker: "218410.KQ",
      period: "2021-12",
      frequency: "annual",
      estimate: false,
      eps: 100,
    }],
  }, legacy);
  assert.equal(current.financialSummaryVersion, FINANCIAL_SUMMARY_VERSION);
  assert.equal(hasCurrentFinancialSummary(current), true);
});

test("merges complementary financial fields without erasing cached values", () => {
  const records = mergeFinancialRecords([{
    ticker: "005930.KS",
    period: "2026-06",
    frequency: "quarter",
    estimate: true,
    revenue: 100,
    operatingProfit: 20,
    reportDate: "2026-07-20",
  }], [{
    ticker: "005930.KS",
    period: "2026-06",
    frequency: "quarter",
    estimate: false,
    revenue: null,
    operatingProfitSurprise: 12.5,
  }]);

  assert.equal(records.length, 1);
  assert.equal(records[0].estimate, false);
  assert.equal(records[0].revenue, 100);
  assert.equal(records[0].operatingProfit, 20);
  assert.equal(records[0].operatingProfitSurprise, 12.5);
  assert.equal(records[0].reportDate, "2026-07-20");
});

test("preserves accumulated financial periods while applying new analysis", () => {
  const now = Date.UTC(2026, 6, 23);
  const existing = {
    schema: SCHEMA_VERSION,
    ticker: "218410.KQ",
    savedAt: now - 40,
    financials: [{
      ticker: "218410.KQ",
      period: "2024-12",
      frequency: "annual",
      estimate: false,
      revenue: 1000,
    }],
  };
  const result = normalizeAnalysisRecord("218410.KQ", {
    savedAt: now,
    consensus: { ticker: "218410.KQ", targetPrice: 130000, institutions: 5 },
    financials: [{
      ticker: "218410.KQ",
      period: "2025-12",
      frequency: "annual",
      estimate: false,
      revenue: 1300,
    }],
  }, existing, now);
  assert.equal(result.financials.length, 2);
  assert.equal(result.consensus.targetPrice, 130000);
  assert.equal(result.lastAccessed, now);
  assert.equal(result.cacheMeta.source, "ai-analysis");
  assert.ok(result.cacheMeta.contentFingerprint);
});

test("retains 2021 EPS after the upstream rolling window advances to 2030", () => {
  const existing = normalizeAnalysisRecord("218410.KQ", {
    savedAt: Date.UTC(2026, 7, 24),
    financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
    financials: [{
      ticker: "218410.KQ",
      period: "2021-12",
      frequency: "annual",
      estimate: false,
      eps: 120,
    }],
  });
  const refreshed = normalizeAnalysisRecord("218410.KQ", {
    savedAt: Date.UTC(2030, 7, 24),
    financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
    financials: [{
      ticker: "218410.KQ",
      period: "2025-12",
      frequency: "annual",
      estimate: false,
      eps: 300,
    }, {
      ticker: "218410.KQ",
      period: "2030-06",
      frequency: "quarter",
      estimate: false,
      eps: 90,
    }],
  }, existing);

  assert.deepEqual(
    [...refreshed.financials].map((record) => record.period),
    ["2021-12", "2025-12", "2030-06"],
  );
});

test("keeps DART actual EPS when a later Naver refresh overlaps the same period", () => {
  const existing = normalizeAnalysisRecord("218410.KQ", {
    savedAt: 10,
    financials: [{
      ticker: "218410.KQ",
      period: "2025-12",
      frequency: "quarter",
      estimate: false,
      eps: 474,
      source: "DART",
      epsDerived: true,
    }],
    dartEpsHistoryVersion: 1,
    dartEpsCompletedYears: [2025],
    dartEpsHistoryStartYear: 2016,
    dartEpsHistoryEndYear: 2025,
  }, null, 10);
  const refreshed = normalizeAnalysisRecord("218410.KQ", {
    savedAt: 20,
    financials: [{
      ticker: "218410.KQ",
      period: "2025-12",
      frequency: "quarter",
      estimate: false,
      eps: 999,
    }],
  }, existing, 20);

  assert.equal(refreshed.financials[0].eps, 474);
  assert.equal(refreshed.financials[0].source, "DART");
  assert.equal(refreshed.financials[0].epsDerived, true);
});

test("tracks completed DART EPS years independently from records", () => {
  const record = normalizeAnalysisRecord("218410.KQ", {
    savedAt: 10,
    financials: [{ ticker: "218410.KQ", period: "2025-12", frequency: "annual", eps: 100 }],
    dartEpsHistoryVersion: 1,
    dartEpsCompletedYears: [2016, 2017, 2018],
    dartEpsHistoryStartYear: 2016,
    dartEpsHistoryEndYear: 2018,
  }, null, 10);
  assert.equal(hasDartEpsHistoryCoverage(record, { startYear: 2016, endYear: 2018 }, 1), true);
  assert.equal(hasDartEpsHistoryCoverage(record, { startYear: 2016, endYear: 2019 }, 1), false);
});

test("checks analysis age without discarding today's cached record", () => {
  const now = Date.UTC(2026, 6, 23);
  const record = { schema: SCHEMA_VERSION, savedAt: now - (29 * 24 * 60 * 60 * 1000) };
  assert.equal(isAnalysisFresh(record, 30 * 24 * 60 * 60 * 1000, now), true);
  assert.equal(isAnalysisFresh(record, 28 * 24 * 60 * 60 * 1000, now), false);
});

test("normalizes and replaces the current stock-news snapshot", () => {
  const existing = normalizeAnalysisRecord("005930.KS", {
    savedAt: 10,
    news: [{
      date: "2026-08-07",
      title: "old",
      source: "Naver",
      url: "https://finance.naver.com/item/news_read.naver?article_id=1&office_id=2&code=005930",
    }],
  }, null, 10);
  const result = normalizeAnalysisRecord("005930.KS", {
    savedAt: 20,
    news: [
      {
        date: "2026-08-08",
        title: "new",
        source: "Naver",
        url: "https://finance.naver.com/item/news_read.naver?article_id=3&office_id=4&code=005930",
      },
      {
        date: "2026-08-08",
        title: "new",
        source: "Naver",
        url: "https://finance.naver.com/item/news_read.naver?article_id=3&office_id=4&code=005930",
      },
    ],
  }, existing, 20);

  assert.equal(result.news.length, 1);
  assert.equal(result.news[0].title, "new");
  assert.equal(result.news[0].ticker, "005930.KS");
});

test("rejects personal web posts and clusters duplicate official coverage", () => {
  const result = normalizeAnalysisRecord("005930.KS", {
    savedAt: Date.parse("2026-08-08T03:00:00Z"),
    news: [
      {
        date: "2026-08-08",
        title: "삼성전자 대규모 공급 계약 체결",
        source: "연합뉴스",
        url: "https://finance.naver.com/item/news_read.naver?article_id=10&office_id=1&code=005930",
      },
      {
        date: "2026-08-07",
        title: "[단독] 삼성전자, 대규모 공급계약 체결",
        source: "한국경제",
        url: "https://finance.naver.com/item/news_read.naver?article_id=11&office_id=2&code=005930",
      },
      {
        date: "2026-08-08",
        title: "개인 투자 분석",
        source: "blog",
        url: "https://blog.naver.com/example/1",
      },
    ],
  }, null, Date.parse("2026-08-08T03:00:00Z"));

  assert.equal(result.news.length, 1);
  assert.equal(result.news[0].clusterSize, 2);
  assert.deepEqual([...result.news[0].clusterSources], ["연합뉴스", "한국경제"]);
});

test("keeps multiple recent point-in-time changes from the same month", () => {
  const snapshots = mergeSnapshots([
    {
      asOf: "2026-05-01",
      savedAt: Date.parse("2026-05-01T03:00:00Z"),
      consensus: { targetPrice: 100, institutions: 2 },
    },
  ], [
    {
      asOf: "2026-05-20",
      savedAt: Date.parse("2026-05-20T03:00:00Z"),
      consensus: { targetPrice: 120, institutions: 3 },
    },
    { asOf: "2026-06-10", savedAt: Date.parse("2026-06-10T03:00:00Z"), financials: [{
      ticker: "005930.KS", period: "2026-03", frequency: "quarter", revenue: 10,
    }] },
  ], "005930.KS");

  assert.equal(snapshots.length, 3);
  assert.equal(snapshots[0].asOf, "2026-05-01");
  assert.equal(snapshots[1].consensus.targetPrice, 120);
  assert.equal(snapshots[2].financials.length, 1);
});

test("normalizes server snapshots together with the latest analysis", () => {
  const now = Date.parse("2026-07-20T03:00:00Z");
  const record = normalizeAnalysisRecord("005930.KS", {
    savedAt: now,
    consensus: { targetPrice: 150, institutions: 4 },
    snapshots: [{
      asOf: "2026-07-01",
      savedAt: Date.parse("2026-07-01T03:00:00Z"),
      consensus: { targetPrice: 140, institutions: 3 },
    }],
  }, null, now);

  assert.equal(record.schema, SCHEMA_VERSION);
  assert.equal(record.snapshots.length, 2);
  assert.equal(record.snapshots[0].consensus.targetPrice, 140);
  assert.equal(record.snapshots[1].consensus.targetPrice, 150);
});

test("reconstructs historical actual financial snapshots in the browser cache", () => {
  const record = normalizeAnalysisRecord("005930.KS", {
    savedAt: Date.parse("2026-07-20T03:00:00Z"),
    financials: [
      { ticker: "005930.KS", period: "2025-12", frequency: "quarter", estimate: false, reportDate: "2026-02-11", operatingProfit: 10 },
      { ticker: "005930.KS", period: "2026-03", frequency: "quarter", estimate: true, reportDate: "2026-04-30", operatingProfit: 20 },
    ],
  });

  assert.equal(record.schema, SCHEMA_VERSION);
  assert.equal(record.snapshots.some((snapshot) => snapshot.asOf === "2026-02-12"), true);
  assert.equal(record.snapshots.some((snapshot) => snapshot.asOf === "2026-05-01"), false);
});
