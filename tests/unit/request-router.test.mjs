import assert from "node:assert/strict";
import test from "node:test";

import { matchRequestRoute, queryFlag } from "../../worker/src/request-router.mjs";

test("describes authentication and parameters for every Worker route", () => {
  assert.deepEqual(matchRequestRoute("/health", "GET"), {
    id: "health",
    path: "/health",
    methods: ["GET"],
    authenticated: false,
  });
  assert.equal(matchRequestRoute("/api/prices", "GET").ticker, true);
  assert.equal(matchRequestRoute("/api/indices", "GET").ticker, undefined);
  assert.equal(matchRequestRoute("/api/dart/disclosures", "GET").corpCode, true);
  assert.deepEqual(matchRequestRoute("/api/forecast-journal", "POST").methods, ["GET", "POST"]);
  assert.equal(matchRequestRoute("/api/credit", "POST"), null);
  assert.equal(matchRequestRoute("/missing", "GET"), null);
});

test("normalizes query flags in one place", () => {
  assert.equal(queryFlag("TRUE"), true);
  assert.equal(queryFlag("yes"), true);
  assert.equal(queryFlag("0"), false);
});
