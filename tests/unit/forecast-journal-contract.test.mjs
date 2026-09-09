import assert from "node:assert/strict";
import test from "node:test";

import {
  FORECAST_ATTRIBUTION_COMPONENT_KEYS,
  normalizeForecastModelVersion,
} from "../../shared/forecast-journal-contract.mjs";

test("forecast journal contract accepts the production version and complete attribution set", () => {
  assert.equal(normalizeForecastModelVersion("local|path-v20"), "local|path-v20");
  assert.equal(normalizeForecastModelVersion("invalid version"), "");
  assert.ok(FORECAST_ATTRIBUTION_COMPONENT_KEYS.includes("brokerResearch"));
  assert.ok(FORECAST_ATTRIBUTION_COMPONENT_KEYS.includes("journalCalibration"));
});
