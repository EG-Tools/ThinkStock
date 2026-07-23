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
  assert.deepEqual(Object.keys(first.horizons), ["20", "63", "126"]);
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
        20: { targetDate: "2026-02-02", predictedPrice: 110, lowerPrice: 95, upperPrice: 115 },
        63: { targetDate: "2026-04-02", predictedPrice: 90, lowerPrice: 85, upperPrice: 95 },
        126: { targetDate: "2026-07-02", predictedPrice: 130, lowerPrice: 120, upperPrice: 140 },
      },
    },
    createdAt: 1000,
  });
  const scored = journal.scoreForecastRecord(record, [
    { date: "2026-04-03", close: 80 },
    { date: "2026-01-30", close: 999 },
    { date: "2026-02-03", close: 108 },
    { date: "invalid", close: 1 },
  ], 2000);

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
    { date: "2026-01-10", close: 103 },
  ], 2000);

  assert.deepEqual(scored, record);
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
