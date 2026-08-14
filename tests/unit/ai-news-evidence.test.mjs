import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisHeadlineSimilarity,
  isTrustedAnalysisNewsUrl,
  normalizeAnalysisNewsEvidence,
} from "../../shared/ai-news-evidence.mjs";

const articleUrl = (articleId, officeId = 1) => (
  `https://finance.naver.com/item/news_read.naver?article_id=${articleId}&office_id=${officeId}&code=005930`
);

test("accepts only trusted Naver Finance stock-news URLs", () => {
  assert.equal(isTrustedAnalysisNewsUrl(articleUrl(1)), true);
  assert.equal(isTrustedAnalysisNewsUrl("https://blog.naver.com/example/1"), false);
  assert.equal(isTrustedAnalysisNewsUrl("http://finance.naver.com/item/news_read.naver?code=005930"), false);
});

test("clusters near-date reports about the same event without losing mention metadata", () => {
  const rows = normalizeAnalysisNewsEvidence([
    {
      ticker: "005930.KS",
      date: "2026-08-08",
      title: "삼성전자 대규모 공급 계약 체결",
      source: "연합뉴스",
      url: articleUrl(1, 1),
    },
    {
      ticker: "005930.KS",
      date: "2026-08-07",
      title: "[단독] 삼성전자, 대규모 공급계약 체결",
      source: "한국경제",
      url: articleUrl(2, 2),
    },
    {
      ticker: "005930.KS",
      date: "2026-08-08",
      title: "개인 투자자의 낙관적 전망",
      source: "blog",
      url: "https://blog.naver.com/example/1",
    },
  ], { ticker: "005930.KS", requireTrustedUrl: true });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].clusterSize, 2);
  assert.deepEqual(rows[0].clusterSources, ["연합뉴스", "한국경제"]);
  assert.ok(
    analysisHeadlineSimilarity(
      "삼성전자 대규모 공급 계약 체결",
      "[단독] 삼성전자, 대규모 공급계약 체결",
    ) >= 0.72,
  );
});

test("keeps different events separate even when they share a company name", () => {
  const rows = normalizeAnalysisNewsEvidence([
    {
      ticker: "005930.KS",
      date: "2026-08-08",
      title: "삼성전자 대규모 공급 계약 체결",
      source: "A",
      url: articleUrl(1),
    },
    {
      ticker: "005930.KS",
      date: "2026-08-08",
      title: "삼성전자 목표주가 하향",
      source: "B",
      url: articleUrl(2),
    },
  ], { ticker: "005930.KS" });

  assert.equal(rows.length, 2);
});
