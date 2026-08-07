import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("docs/modules/ai-forecast-journal.js"), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
const journal = context.ThinkStockAiForecastJournal;

function forecast(overrides = {}) {
  const dates = Array.from({ length: 127 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index));
    return date.toISOString().slice(0, 10);
  });
  const prices = Array.from({ length: 127 }, (_, index) => 100 + index);
  return {
    dates,
    prices,
    lowerPrices: prices.map((price) => price - 10),
    upperPrices: prices.map((price) => price + 10),
    ...overrides,
  };
}

test("normalizes array forecasts and creates a deterministic record ID", () => {
  const first = journal.buildForecastRecord({
    ticker: " 218410.kq ",
    modelVersion: "market-v3",
    forecast: forecast(),
    createdAt: 1000,
  });
  const second = journal.buildForecastRecord({
    ticker: "218410.KQ",
    modelVersion: "market-v3",
    forecast: forecast(),
    createdAt: 2000,
  });

  assert.equal(first.id, second.id);
  assert.equal(first.id, "218410.KQ:2026-01-02:market-v3");
  assert.equal(first.basePrice, 100);
  assert.deepEqual(Object.keys(first.horizons), ["5", "10", "20", "63", "126"]);
  assert.equal(first.horizons[5].predictedPrice, 105);
  assert.equal(first.horizons[10].predictedPrice, 110);
  assert.equal(first.horizons[20].days, 20);
  assert.equal(first.horizons[20].targetDate, "2026-01-22");
  assert.equal(first.horizons[20].predictedPrice, 120);
  assert.equal(first.horizons[20].lowerPrice, 110);
  assert.equal(first.horizons[20].upperPrice, 130);
  assert.equal(first.horizons[20].score, null);
});

test("rejects malformed identity, dates, prices, and incomplete horizons", () => {
  assert.equal(journal.buildForecastRecord({
    ticker: "INVALID",
    modelVersion: "v1",
    forecast: forecast(),
  }), null);
  assert.equal(journal.buildForecastRecord({
    ticker: "005930.KS",
    modelVersion: "",
    forecast: forecast(),
  }), null);
  assert.equal(journal.normalizeForecastResult(forecast({ prices: [100] })), null);
  assert.equal(journal.normalizeForecastResult({
    asOf: "2026-02-30",
    basePrice: 100,
    horizons: {},
  }), null);
});

test("scores matured horizons against the first price on or after each target", () => {
  const record = journal.buildForecastRecord({
    ticker: "005930.KS",
    modelVersion: "v1",
    forecast: {
      asOf: "2026-01-02",
      basePrice: 100,
      horizons: {
        5: { targetDate: "2026-01-09", predictedPrice: 104, lowerPrice: 95, upperPrice: 110 },
        10: { targetDate: "2026-01-16", predictedPrice: 107, lowerPrice: 96, upperPrice: 112 },
        20: { targetDate: "2026-02-02", predictedPrice: 110, lowerPrice: 95, upperPrice: 115 },
        63: { targetDate: "2026-04-02", predictedPrice: 90, lowerPrice: 85, upperPrice: 95 },
        126: { targetDate: "2026-07-02", predictedPrice: 130, lowerPrice: 120, upperPrice: 140 },
      },
    },
    createdAt: 1000,
  });
  const scored = journal.scoreForecastRecord(record, [
    { date: "2026-01-09", close: 102 },
    { date: "2026-01-16", close: 105 },
    { date: "2026-04-03", close: 80 },
    { date: "2026-01-30", close: 999 },
    { date: "2026-02-03", close: 108 },
    { date: "invalid", close: 1 },
  ], 2000);

  assert.equal(scored.horizons[5].score.actualPrice, 102);
  assert.equal(scored.horizons[10].score.actualPrice, 105);
  assert.ok(scored.horizons[10].score.squaredLogError >= 0);
  assert.equal(scored.horizons[20].score.actualDate, "2026-02-03");
  assert.equal(scored.horizons[20].score.actualPrice, 108);
  assert.ok(Math.abs(scored.horizons[20].score.absLogError - Math.abs(Math.log(108 / 110))) < 1e-12);
  assert.equal(scored.horizons[20].score.directionCorrect, true);
  assert.equal(scored.horizons[20].score.intervalCovered, true);
  assert.equal(scored.horizons[63].score.directionCorrect, true);
  assert.equal(scored.horizons[63].score.intervalCovered, false);
  assert.equal(scored.horizons[126].score, null);
  assert.equal(scored.updatedAt, 2000);
});

test("preserves every immature horizon when history has not reached its target", () => {
  const record = journal.buildForecastRecord({
    ticker: "005930.KS",
    modelVersion: "v1",
    forecast: forecast(),
    createdAt: 1000,
  });
  const scored = journal.scoreForecastRecord(record, [
    { date: "2026-01-05", close: 103 },
  ], 2000);

  assert.deepEqual(scored, record);
  assert.equal(scored.horizons[5].score, null);
  assert.equal(scored.horizons[10].score, null);
  assert.equal(scored.horizons[20].score, null);
  assert.equal(scored.horizons[63].score, null);
  assert.equal(scored.horizons[126].score, null);
});

test("deduplicates records, preserves completed scores, and caps history at 60", () => {
  const base = journal.buildForecastRecord({
    ticker: "005930.KS",
    modelVersion: "v1",
    forecast: forecast(),
    createdAt: 1000,
  });
  const scored = journal.scoreForecastRecord(base, [
    { date: "2026-01-22", close: 121 },
  ], 1500);
  const replacement = {
    ...base,
    updatedAt: 2000,
    horizons: {
      ...base.horizons,
      20: { ...base.horizons[20], predictedPrice: 122 },
    },
  };
  const template = forecast();
  const records = Array.from({ length: 65 }, (_, index) => journal.buildForecastRecord({
    ticker: "005930.KS",
    modelVersion: `archive-${index}`,
    forecast: {
      ...template,
      dates: template.dates.map((date) => {
        const shifted = new Date(`${date}T00:00:00Z`);
        shifted.setUTCDate(shifted.getUTCDate() - index);
        return shifted.toISOString().slice(0, 10);
      }),
    },
    createdAt: 3000 + index,
  }));
  const merged = journal.mergeForecastRecords([scored, ...records], [replacement]);
  const duplicate = merged.find((record) => record.id === base.id);

  assert.equal(merged.length, 60);
  assert.equal(new Set(merged.map((record) => record.id)).size, 60);
  assert.equal(duplicate.horizons[20].predictedPrice, 122);
  assert.equal(duplicate.horizons[20].score.actualPrice, 121);
  assert.ok(merged.every((record, index) => index === 0 || merged[index - 1].asOf >= record.asOf));
});

test("preserves compact model inputs and per-horizon numeric attribution", () => {
  const attribution = {
    format: "ai-attribution-v1",
    horizons: Object.fromEntries(journal.FORECAST_HORIZONS.map((days) => [days, {
      days,
      expectedLogReturn: days / 1000,
      components: {
        localModel: days / 1200,
        marketRegime: days / 6000,
      },
    }])),
  };
  const record = journal.buildForecastRecord({
    ticker: "005930.KS",
    modelVersion: "path-v8",
    forecast: forecast({
      attribution,
      audit: {
        format: "ai-audit-v1",
        features: { adr_latest: 73.2, adr_change_28d: -8.4, model_feature_00: 0.25 },
        sources: { price_rows: 1500, internet_news_rows: 0 },
        scenarioWeights: { upside: 30, sideways: 45, downside: 25 },
      },
    }),
    createdAt: 1000,
  });

  assert.equal(record.audit.features.adr_latest, 73.2);
  assert.equal(record.audit.sources.internet_news_rows, 0);
  assert.equal(record.horizons[10].attribution.expectedLogReturn, 0.01);
  assert.equal(record.horizons[10].attribution.components.marketRegime, 0.01 / 6);

  const cloudLike = {
    ...record,
    updatedAt: 2000,
    audit: null,
    horizons: Object.fromEntries(Object.entries(record.horizons).map(([key, value]) => [
      key,
      { ...value, attribution: null },
    ])),
  };
  const merged = journal.mergeForecastRecords([record], [cloudLike]);
  assert.equal(merged[0].audit.features.adr_latest, 73.2);
  assert.equal(merged[0].horizons[126].attribution.components.localModel, 126 / 1200);
});

test("scores the ten-session checkpoint once and keeps the immutable result", () => {
  const record = journal.buildForecastRecord({
    ticker: "005930.KS",
    modelVersion: "path-v8",
    forecast: forecast(),
    createdAt: 1000,
  });
  const history = [{ date: record.horizons[10].targetDate, close: 92 }];
  const first = journal.scoreForecastRecord(record, history, 2000);
  const second = journal.scoreForecastRecord(first, history, 3000);

  assert.equal(first.horizons[10].score.directionCorrect, false);
  assert.ok(first.horizons[10].score.signedLogError < 0);
  assert.equal(second.horizons[10].score.scoredAt, 2000);
  assert.equal(second.updatedAt, 2000);
});
