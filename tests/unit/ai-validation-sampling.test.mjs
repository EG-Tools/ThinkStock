import assert from "node:assert/strict";
import test from "node:test";

import {
  assignValidationArchetypes,
  buildRandomValidationBatches,
  buildStratifiedValidationDesign,
  buildValidationCandidateProfile,
  validationIssuerKey,
} from "../../shared/ai-validation-sampling.mjs";

test("random validation batches are reproducible, disjoint, and report their stocks", () => {
  const records = Array.from({ length: 80 }, (_, index) => ({
    ticker: `${String(index + 1).padStart(6, "0")}.${index % 2 ? "KQ" : "KS"}`,
    name: `무작위회사${index + 1}`,
    market: index % 2 ? "KOSDAQ" : "KOSPI",
  }));
  records[0].name = "동일회사";
  records.push({ ticker: "000081.KS", name: "동일회사우", market: "KOSPI" });
  records.push({ ticker: "000082.KQ", name: "테스트스팩", market: "KOSDAQ" });
  const first = buildRandomValidationBatches(records, { seed: 41, batchSize: 10, batchCount: 5 });
  const second = buildRandomValidationBatches(records, { seed: 41, batchSize: 10, batchCount: 5 });
  const selected = first.batches.flatMap((batch) => batch.records);

  assert.deepEqual(first, second);
  assert.equal(first.batches.length, 5);
  first.batches.forEach((batch) => assert.equal(batch.records.length, 10));
  assert.equal(new Set(selected.map((row) => row.ticker)).size, 50);
  assert.ok(selected.every((row) => row.name && row.market));
  assert.equal(selected.some((row) => row.name.endsWith("우")), false);
  assert.equal(selected.some((row) => row.name.includes("스팩")), false);
});

function syntheticSeries(index, rows = 1000) {
  const dates = [];
  const prices = [];
  let price = 100 + index;
  const start = Date.UTC(2020, 0, 1);
  for (let day = 0; dates.length < rows; day += 1) {
    const date = new Date(start + (day * 86400000));
    if ([0, 6].includes(date.getUTCDay())) continue;
    const drift = ((index % 5) - 2) * 0.00025;
    const wave = Math.sin((dates.length + index) / (18 + (index % 13))) * (0.002 + ((index % 7) * 0.0005));
    price *= Math.exp(drift + wave);
    dates.push(date.toISOString().slice(0, 10));
    prices.push(price);
  }
  return { dates, prices };
}

test("candidate profiles derive price behavior without using future metadata", () => {
  const series = syntheticSeries(7);
  const profile = buildValidationCandidateProfile({
    ticker: "000007.KS",
    name: "테스트금융지주",
    market: "KOSPI",
    marketRank: 7,
    marketUniverseSize: 60,
    series,
  }, { benchmarkSeries: syntheticSeries(1) });
  assert.equal(profile.ticker, "000007.KS");
  assert.equal(profile.rows, 1000);
  assert.equal(profile.semantic.bank, true);
  assert.equal(profile.semantic.holding, true);
  assert.ok(Number.isFinite(profile.annualizedVolatility));
  assert.ok(profile.firstDate < profile.lastDate);
});

test("relative archetypes always include size and volatility while retaining semantic tags", () => {
  const raw = Array.from({ length: 30 }, (_, index) => buildValidationCandidateProfile({
    ticker: `${String(index + 1).padStart(6, "0")}.KS`,
    name: index === 4 ? "테스트은행" : `테스트${index}`,
    market: "KOSPI",
    marketRank: index + 1,
    marketUniverseSize: 30,
    series: syntheticSeries(index),
  }, { benchmarkSeries: syntheticSeries(2) }));
  const profiles = assignValidationArchetypes(raw);
  profiles.forEach((profile) => {
    assert.equal(profile.tags.filter((tag) => tag.startsWith("size-")).length, 1);
    assert.equal(profile.tags.filter((tag) => tag.startsWith("volatility-")).length, 1);
  });
  assert.ok(profiles[4].tags.includes("bank"));
});

test("cached research industry metadata supplies semantic archetypes missing from the company name", () => {
  const profile = buildValidationCandidateProfile({
    ticker: "006280.KS",
    name: "녹십자",
    industry: "제약",
    market: "KOSPI",
    marketRank: 25,
    marketUniverseSize: 200,
    series: syntheticSeries(9),
  }, { benchmarkSeries: syntheticSeries(1) });
  const [classified] = assignValidationArchetypes([profile]);
  assert.equal(classified.semantic.pharmaBiotech, true);
  assert.ok(classified.tags.includes("pharma-biotech"));
});

test("stratified design keeps ticker-disjoint holdout and balanced market quotas", () => {
  const candidates = ["KOSPI", "KOSDAQ"].flatMap((market, marketIndex) => (
    Array.from({ length: 90 }, (_, index) => buildValidationCandidateProfile({
      ticker: `${String((marketIndex * 1000) + index + 1).padStart(6, "0")}.${market === "KOSPI" ? "KS" : "KQ"}`,
      name: index % 17 === 0 ? `테스트${market}은행` : `테스트${market}${index}`,
      market,
      marketRank: index + 1,
      marketUniverseSize: 90,
      series: syntheticSeries(index + (marketIndex * 71)),
    }, { benchmarkSeries: syntheticSeries(marketIndex + 2) }))
  ));
  const first = buildStratifiedValidationDesign(candidates, {
    targetPerMarket: 40,
    auditPerMarket: 10,
    breadthPerMarket: 20,
    minimumPerTag: 8,
    holdoutFraction: 0.25,
    seed: 1234,
  });
  const second = buildStratifiedValidationDesign(candidates, {
    targetPerMarket: 40,
    auditPerMarket: 10,
    breadthPerMarket: 20,
    minimumPerTag: 8,
    holdoutFraction: 0.25,
    seed: 1234,
  });
  assert.deepEqual(first, second);
  assert.equal(first.selection.KOSPI.length, 40);
  assert.equal(first.selection.KOSDAQ.length, 40);
  assert.equal(first.holdout.KOSPI.length, 10);
  assert.equal(first.holdout.KOSDAQ.length, 10);
  assert.equal(first.fastSelection.KOSPI.length, 20);
  assert.equal(first.fastSelection.KOSDAQ.length, 20);
  assert.equal(first.audit.KOSPI.length, 10);
  assert.equal(first.audit.KOSDAQ.length, 10);
  assert.equal(first.confirmationAudit.KOSPI.length, 10);
  assert.equal(first.confirmationAudit.KOSDAQ.length, 10);
  assert.equal(first.breadthDevelopment.KOSPI.length, 20);
  assert.equal(first.breadthDevelopment.KOSDAQ.length, 20);
  const development = new Set(Object.values(first.development).flat());
  Object.values(first.holdout).flat().forEach((ticker) => assert.equal(development.has(ticker), false));
  const selected = new Set(Object.values(first.selection).flat());
  Object.values(first.audit).flat().forEach((ticker) => assert.equal(selected.has(ticker), false));
  Object.values(first.confirmationAudit).flat().forEach((ticker) => assert.equal(selected.has(ticker), false));
  const occupied = new Set([
    ...Object.values(first.selection).flat(),
    ...Object.values(first.audit).flat(),
    ...Object.values(first.confirmationAudit).flat(),
  ]);
  Object.values(first.breadthDevelopment).flat().forEach((ticker) => assert.equal(occupied.has(ticker), false));
  Object.values(first.audit).flat().forEach((ticker) => {
    assert.ok(first.profiles[ticker]);
    assert.ok(first.profiles[ticker].tags.length > 0);
  });
  assert.ok(first.coverage.available.bank >= 2);
  assert.ok(first.coverage.selected.bank >= 1);
  assert.ok(first.coverage.audit.bank >= 1);
  assert.ok(Object.values(first.coverage.confirmationAudit).filter((count) => count > 0).length >= 8);
  assert.equal(first.deficits.length, 0);
  assert.ok(Array.isArray(first.confirmationAuditDeficits));
});

test("issuer families keep common and preferred shares out of separate validation cohorts", () => {
  assert.equal(validationIssuerKey("현대차2우B", "005387.KS"), validationIssuerKey("현대차", "005380.KS"));
  const candidates = Array.from({ length: 50 }, (_, index) => ({
    ticker: `${String(index).padStart(6, "0")}.KS`,
    name: index === 0 ? "테스트" : (index === 1 ? "테스트우" : `회사${index}`),
    issuerKey: validationIssuerKey(index === 0 ? "테스트" : (index === 1 ? "테스트우" : `회사${index}`)),
    market: "KOSPI",
    marketRank: index + 1,
    marketUniverseSize: 50,
    rows: 1260,
    annualizedVolatility: 0.1 + (index * 0.002),
    annualizedReturn: ((index % 5) - 2) * 0.04,
    trendRSquared: 0.2,
    rangeScore: (index % 10) / 10,
    cycleScore: (index % 7) / 7,
    maximumDrawdown: 0.2,
    benchmarkCorrelation: 0.5,
    semantic: {},
    tags: [],
  }));
  const design = buildStratifiedValidationDesign(candidates, {
    targetPerMarket: 20,
    auditPerMarket: 5,
    fastPerMarket: 10,
    minimumPerTag: 1,
  });
  const selected = design.selection.KOSPI;
  assert.equal(selected.includes("000000.KS") && selected.includes("000001.KS"), false);
});
