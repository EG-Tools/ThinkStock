import assert from "node:assert/strict";
import test from "node:test";

import {
  runtimeApiCompatibility,
  runtimeJsonHeaders,
} from "../../shared/runtime-api-contract.mjs";

test("accepts the current API and reports an older incompatible API", () => {
  assert.deepEqual(runtimeApiCompatibility("3"), {
    compatible: true,
    legacy: false,
    minimum: 2,
    version: 3,
  });
  assert.deepEqual(runtimeApiCompatibility("1"), {
    compatible: false,
    legacy: false,
    minimum: 2,
    version: 1,
  });
});

test("temporarily accepts a missing version for an older deployed Worker", () => {
  assert.equal(runtimeApiCompatibility(null).compatible, true);
  assert.equal(runtimeApiCompatibility(null, { allowMissing: false }).compatible, false);
});

test("shares one no-store JSON response contract across local and Worker runtimes", () => {
  assert.deepEqual(runtimeJsonHeaders({ referrerPolicy: "same-origin" }), {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "same-origin",
    "X-ThinkStock-API-Version": "3",
    "X-Content-Type-Options": "nosniff",
  });
});
