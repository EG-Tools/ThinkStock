import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatchRequestRoute,
  matchRequestRoute,
  queryFlag,
} from "../../worker/src/request-router.mjs";

test("describes authentication and parameters for every Worker route", () => {
  assert.deepEqual(matchRequestRoute("/health", "GET"), {
    id: "health",
    path: "/health",
    methods: ["GET"],
    authenticated: false,
  });
  assert.equal(matchRequestRoute("/api/prices", "GET").ticker, true);
  assert.equal(matchRequestRoute("/api/bootstrap", "GET").id, "bootstrap");
  assert.equal(matchRequestRoute("/api/broker-reports", "GET").ticker, true);
  assert.equal(matchRequestRoute("/api/broker-report-pdf", "GET").ticker, undefined);
  assert.deepEqual(matchRequestRoute("/api/admin/session", "POST").methods, ["POST"]);
  assert.equal(matchRequestRoute("/api/research/universe", "GET").ticker, undefined);
  assert.deepEqual(matchRequestRoute("/api/research/summary", "POST").methods, ["GET", "POST"]);
  assert.equal(matchRequestRoute("/api/research/history", "GET").ticker, true);
  assert.equal(matchRequestRoute("/api/research/profile", "GET").ticker, true);
  assert.equal(matchRequestRoute("/api/indices", "GET").ticker, undefined);
  assert.equal(matchRequestRoute("/api/adr", "GET").id, "adr");
  assert.deepEqual(matchRequestRoute("/api/crisis-signal", "GET"), {
    id: "crisis-signal",
    path: "/api/crisis-signal",
    methods: ["GET"],
    authenticated: false,
  });
  assert.equal(matchRequestRoute("/api/dart/disclosures", "GET").corpCode, true);
  assert.equal(matchRequestRoute("/api/dart/disclosures", "GET").provider, "dart");
  assert.deepEqual(matchRequestRoute("/api/forecast-journal", "POST").methods, ["GET", "POST"]);
  assert.equal(matchRequestRoute("/api/credit", "POST"), null);
  assert.deepEqual(matchRequestRoute("/api/credit/sync", "POST").methods, ["POST"]);
  assert.equal(matchRequestRoute("/missing", "GET"), null);
});

test("normalizes query flags in one place", () => {
  assert.equal(queryFlag("TRUE"), true);
  assert.equal(queryFlag("yes"), true);
  assert.equal(queryFlag("0"), false);
});

test("dispatches a matched route through the shared handler table", async () => {
  const route = matchRequestRoute("/api/prices", "GET");
  const result = await dispatchRequestRoute(route, {
    prices: async (context, matchedRoute) => `${matchedRoute.id}:${context.ticker}`,
  }, { ticker: "005930.KS" });

  assert.equal(result, "prices:005930.KS");
  assert.equal(dispatchRequestRoute({ id: "missing" }, {}, {}), null);
});
