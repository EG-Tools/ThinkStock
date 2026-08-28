import assert from "node:assert/strict";
import test from "node:test";
import * as browserJournal from "../../docs/modules/ai-forecast-journal.mjs";

import {
  compactForecastJournalRecords,
  FORECAST_JOURNAL_LIMIT,
  mergeForecastJournalRecords,
} from "../../worker/src/forecast-journal.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
function recordAt(index) {
  const base = Date.parse("2025-10-01T00:00:00Z") + (index * DAY_MS);
  const asOf = new Date(base).toISOString().slice(0, 10);
  const targetDate = new Date(base + (28 * DAY_MS)).toISOString().slice(0, 10);
  return {
    id: `218410.KQ:${asOf}:retention-v1`,
    ticker: "218410.KQ",
    asOf,
    basePrice: 100 + index,
    modelVersion: "retention-v1",
    createdAt: 1000 + index,
    updatedAt: 1000 + index,
    horizons: {
      20: { targetDate, predictedPrice: 101 + index, lowerPrice: 90, upperPrice: 500 },
    },
  };
}

test("worker journal preserves six-month samples without exceeding its payload budget", () => {
  const source = Array.from({ length: 500 }, (_, index) => recordAt(index));
  const compacted = mergeForecastJournalRecords([], source, "218410.KQ");
  const latest = Date.parse(`${compacted.at(-1).asOf}T00:00:00Z`);
  const ages = compacted.map((record) => (
    (latest - Date.parse(`${record.asOf}T00:00:00Z`)) / DAY_MS
  ));

  assert.equal(compacted.length, FORECAST_JOURNAL_LIMIT);
  assert.deepEqual(
    compacted.slice(-24).map((record) => record.asOf),
    source.slice(-24).map((record) => record.asOf),
  );
  assert.ok(ages.some((age) => age >= 180 && age <= 220));
  assert.ok(Math.max(...ages) >= 450);
});

test("browser and worker retain the same dense, weekly, and monthly forecast samples", () => {
  const source = Array.from({ length: 500 }, (_, index) => recordAt(index));
  const browserIds = Array.from(
    browserJournal.compactForecastRecords(source),
    (record) => record.id,
  );
  const workerIds = compactForecastJournalRecords(source).map((record) => record.id).reverse();

  assert.deepEqual(browserIds, workerIds);
});
