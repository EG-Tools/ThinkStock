import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_STORAGE_CONTRACT,
  boundedOrNull,
  escapeHtml,
  finiteOrNull,
  normalizedIsoDate,
  positiveOrNull,
} from "../../shared/runtime-foundation.mjs";

test("escapes external text through one shared HTML contract", () => {
  assert.equal(escapeHtml(`<RFHIC & "DART">`), "&lt;RFHIC &amp; &quot;DART&quot;&gt;");
});

test("runtime value contract rejects missing and malformed numeric values", () => {
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull(""), null);
  assert.equal(finiteOrNull(false), null);
  assert.equal(finiteOrNull("12.5"), 12.5);
  assert.equal(positiveOrNull(0), null);
  assert.equal(positiveOrNull("3"), 3);
  assert.equal(boundedOrNull(101, 0, 100), null);
  assert.equal(boundedOrNull(100, 0, 100), 100);
  assert.equal(normalizedIsoDate("2026-08-15T12:00:00Z"), "2026-08-15");
  assert.equal(normalizedIsoDate("2026-8-15"), "");
});

test("runtime storage contract owns every IndexedDB store name", () => {
  assert.equal(RUNTIME_STORAGE_CONTRACT.dbName, "thinkstock-runtime-cache-v1");
  assert.equal(RUNTIME_STORAGE_CONTRACT.dbVersion, 9);
  assert.deepEqual(Object.values(RUNTIME_STORAGE_CONTRACT.stores), [
    "snapshots",
    "tickerPrices",
    "tickerDisclosures",
    "tickerAiAnalysis",
    "tickerAiForecast",
    "tickerAiForecastJournal",
    "tickerResearchHistory",
    "stockResearchResults",
    "tickerBrokerResearch",
    "tickerTimingModels",
  ]);
});
