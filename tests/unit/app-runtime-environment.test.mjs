import assert from "node:assert/strict";
import test from "node:test";

import { createAppRuntimeEnvironment } from "../../docs/modules/app-runtime-environment.mjs";

test("runtime environment keeps local protected routes on the local server", () => {
  const environment = createAppRuntimeEnvironment({
    location: { protocol: "http:", hostname: "127.0.0.1", search: "" },
  });

  assert.equal(environment.isLocalRuntime, true);
  assert.equal(environment.endpoints.aiAnalysis, "./api/analysis");
  assert.equal(environment.endpoints.tickerHistory, "./api/research/history");
  assert.equal(environment.endpoints.krxPrice, `${environment.gatewayUrl}/api/prices`);
});

test("runtime environment keeps e2e requests on the deployed gateway contract", () => {
  const environment = createAppRuntimeEnvironment({
    location: { protocol: "http:", hostname: "127.0.0.1", search: "?e2e=1" },
  });

  assert.equal(environment.isE2eRuntime, true);
  assert.equal(environment.isLocalRuntime, false);
  assert.equal(environment.endpoints.aiAnalysis, `${environment.gatewayUrl}/api/analysis`);
});
