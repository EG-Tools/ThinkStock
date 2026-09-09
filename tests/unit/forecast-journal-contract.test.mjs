import assert from "node:assert/strict";
import test from "node:test";

import {
  FORECAST_ATTRIBUTION_COMPONENT_KEYS,
  buildForecastJournalRequestUrl,
  normalizeForecastModelVersion,
} from "../../shared/forecast-journal-contract.mjs";

test("forecast journal contract accepts the production version and complete attribution set", () => {
  assert.equal(normalizeForecastModelVersion("local|path-v20"), "local|path-v20");
  assert.equal(normalizeForecastModelVersion("invalid version"), "");
  assert.ok(FORECAST_ATTRIBUTION_COMPONENT_KEYS.includes("brokerResearch"));
  assert.ok(FORECAST_ATTRIBUTION_COMPONENT_KEYS.includes("journalCalibration"));
});

test("forecast journal reads and writes use the same ticker-qualified endpoint", () => {
  assert.equal(
    buildForecastJournalRequestUrl("/api/forecast-journal", "005930.ks"),
    "/api/forecast-journal?ticker=005930.KS",
  );
  assert.equal(
    buildForecastJournalRequestUrl("/api/forecast-journal?force=1", "218410.KQ"),
    "/api/forecast-journal?force=1&ticker=218410.KQ",
  );
});
