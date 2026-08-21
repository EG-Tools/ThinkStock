import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProviderError,
  createProviderHttpError,
  providerRetryDelayMs,
  retryAfterMs,
} from "../../shared/runtime-provider-resilience.mjs";

test("classifies provider failures without retrying permanent authentication errors", () => {
  assert.deepEqual(classifyProviderError(new Error("upstream HTTP 403")), {
    status: 403,
    category: "auth",
    retryable: false,
    retryAfterMs: 0,
  });
  assert.equal(classifyProviderError(new Error("fetch failed")).retryable, true);
  assert.equal(classifyProviderError(Object.assign(new Error("cancelled"), { name: "AbortError" })).retryable, false);
});

test("uses Retry-After for rate limits but caps excessive waits", () => {
  const error = createProviderHttpError("INDEXerGO", {
    status: 429,
    headers: { get: () => "12" },
  });
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 12_000);
  assert.equal(providerRetryDelayMs(error, 500), 12_000);
  assert.equal(providerRetryDelayMs(error, 500, { maximumMs: 5_000 }), 5_000);
  assert.equal(retryAfterMs("2"), 2_000);
});
