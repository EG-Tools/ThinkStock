import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProviderError,
  createProviderHttpError,
  providerRetryDelayMs,
  retryAfterMs,
  unwrapBrowserQuickActionContent,
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

test("unwraps shared Browser Run text without provider-specific decoders", () => {
  assert.equal(unwrapBrowserQuickActionContent(JSON.stringify({
    success: true,
    result: "<pre>&lt;script&gt;const value=&quot;ok&quot;;&lt;/script&gt;</pre>",
  })), '<script>const value="ok";</script>');
});
