import assert from "node:assert/strict";
import test from "node:test";

import * as module from "../../docs/modules/runtime-gateway-client.mjs";
import { createSharedRequestRegistry } from "../../docs/modules/shared-request-registry.mjs";

test("requests startup indices and visible prices through one endpoint", async () => {
  let request = null;
  const client = module.createRuntimeGatewayClient({
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        ok: true,
        indices: { ok: true, records: [{ ticker: "^KS11", date: "2026-08-10", close: 3200 }] },
        prices: { ok: true, requested: 1, succeeded: 1, results: [] },
      }), { status: 200 });
    },
    endpoints: { bootstrap: "https://worker.example/api/bootstrap" },
  });
  await client.fetchBootstrap({
    tickers: ["005930.KS"],
    since: "2026-08-01",
    forceNetwork: true,
  });
  assert.match(request.url, /\/api\/bootstrap\?/);
  assert.match(request.url, /tickers=005930.KS/);
  assert.match(request.url, /since=2026-08-01/);
  assert.match(request.url, /refresh=1/);
  assert.equal(request.init.headers.Authorization, "Bearer secret");
});

test("can omit index work from a stock-only bootstrap request", async () => {
  let requestedUrl = "";
  const client = module.createRuntimeGatewayClient({
    fetchWithTimeout: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ ok: true, prices: { ok: true, results: [] } }));
    },
    endpoints: { bootstrap: "https://worker.example/api/bootstrap" },
  });

  await client.fetchBootstrap({ tickers: ["005930.KS"], includeIndices: false });
  assert.match(requestedUrl, /indices=0/);
});

test("uses the local endpoint without exposing the access token", async () => {
  let request = null;
  const client = module.createRuntimeGatewayClient({
    isLocal: true,
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true, records: [] }), { status: 200 });
    },
    endpoints: { indices: "https://worker.example/api/indices" },
    localEndpoints: { indices: "./api/indices" },
  });
  await client.fetchIndices();
  assert.equal(request.url, "./api/indices");
  assert.equal(Object.hasOwn(request.init.headers, "Authorization"), false);
});

test("forwards an explicit index refresh to the selected runtime endpoint", async () => {
  let requestedUrl = "";
  const client = module.createRuntimeGatewayClient({
    isLocal: true,
    fetchWithTimeout: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ ok: true, records: [] }), { status: 200 });
    },
    endpoints: { indices: "https://worker.example/api/indices" },
    localEndpoints: { indices: "./api/indices" },
  });
  await client.fetchIndices({ forceNetwork: true });
  assert.equal(requestedUrl, "./api/indices?refresh=1");
});

test("requests only the missing index history after the local latest date", async () => {
  let requestedUrl = "";
  const client = module.createRuntimeGatewayClient({
    isLocal: true,
    fetchWithTimeout: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ ok: true, records: [] }), { status: 200 });
    },
    endpoints: { indices: "https://worker.example/api/indices" },
    localEndpoints: { indices: "./api/indices" },
  });
  await client.fetchIndices({ since: "2026-07-14", forceNetwork: true });
  assert.equal(requestedUrl, "./api/indices?since=2026-07-14&refresh=1");
});

test("forwards an explicit credit refresh to the selected runtime endpoint", async () => {
  let requestedUrl = "";
  const client = module.createRuntimeGatewayClient({
    isLocal: true,
    fetchWithTimeout: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
    },
    endpoints: { credit: "https://worker.example/api/credit" },
    localEndpoints: { credit: "./api/credit" },
  });
  await client.fetchCredit({ forceNetwork: true });
  assert.equal(requestedUrl, "./api/credit?refresh=1");
});

test("reads public crisis indicators without exposing the personal access token", async () => {
  let request = null;
  const client = module.createRuntimeGatewayClient({
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true, records: [], vixRows: [] }), { status: 200 });
    },
    endpoints: { crisisSignal: "https://worker.example/api/crisis-signal" },
  });
  await client.fetchCrisisSignal({ forceNetwork: true });
  assert.equal(request.url, "https://worker.example/api/crisis-signal?refresh=1");
  assert.equal(Object.hasOwn(request.init.headers, "Authorization"), false);
});

test("normalizes remote price data and reports contract failures", async () => {
  const failures = [];
  const client = module.createRuntimeGatewayClient({
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      assert.match(url, /ticker=005930\.KS/);
      assert.equal(init.headers.Authorization, "Bearer secret");
      return new Response(JSON.stringify({ ok: true, records: [{ date: "2026-08-10", close: 1 }] }), { status: 200 });
    },
    endpoints: { price: "https://worker.example/api/prices" },
    contract: {
      normalizePricePayload: () => { throw new Error("bad price"); },
    },
    onContractError: (source, error, meta) => failures.push({ source, error: error.message, meta }),
  });
  await assert.rejects(client.fetchPrice("005930.KS"), /bad price/);
  assert.deepEqual(failures, [{
    source: "price-contract",
    error: "bad price",
    meta: { ticker: "005930.KS" },
  }]);
});

test("adds an explicit refresh flag and clears invalid credentials", async () => {
  let unauthorized = 0;
  const client = module.createRuntimeGatewayClient({
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url) => {
      assert.equal(url, "https://worker.example/api/macro?refresh=1");
      return new Response(JSON.stringify({ error: "denied" }), { status: 401 });
    },
    endpoints: { macro: "https://worker.example/api/macro" },
    onUnauthorized: () => { unauthorized += 1; },
  });
  await assert.rejects(client.fetchMacro({ forceNetwork: true }), /denied/);
  assert.equal(unauthorized, 1);
});

test("requests multiple current prices through one authenticated endpoint", async () => {
  let calls = 0;
  const client = module.createRuntimeGatewayClient({
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      calls += 1;
      assert.match(url, /tickers=005930\.KS%2C000660\.KS/);
      assert.equal(init.headers.Authorization, "Bearer secret");
      return new Response(JSON.stringify({
        ok: true,
        results: [
          { ok: true, ticker: "005930.KS", records: [{ date: "2026-08-10", close: 71000 }] },
          { ok: true, ticker: "000660.KS", records: [{ date: "2026-08-10", close: 300000 }] },
        ],
      }), { status: 200 });
    },
    endpoints: { priceBatch: "https://worker.example/api/prices/batch" },
    contract: {
      normalizePriceBatchPayload: (payload) => payload,
    },
  });
  const payload = await client.fetchPrices(["005930.KS", "000660.KS", "005930.KS"]);
  assert.equal(calls, 1);
  assert.equal(payload.results.length, 2);
});

test("forwards explicit refresh flags for single and batch prices", async () => {
  const requestedUrls = [];
  const client = module.createRuntimeGatewayClient({
    fetchWithTimeout: async (url) => {
      requestedUrls.push(url);
      return new Response(JSON.stringify({ ok: true, records: [], results: [] }), { status: 200 });
    },
    endpoints: {
      price: "https://worker.example/api/prices",
      priceBatch: "https://worker.example/api/prices/batch",
    },
  });

  await client.fetchPrice("005930.KS", { forceNetwork: true });
  await client.fetchPrices(["005930.KS", "000660.KS"], { forceNetwork: true });

  assert.match(requestedUrls[0], /ticker=005930\.KS&refresh=1$/);
  assert.match(requestedUrls[1], /tickers=005930\.KS%2C000660\.KS&refresh=1$/);
});

test("rejects a superseded response before normalization can mutate state", async () => {
  const controller = new AbortController();
  let normalized = false;
  const client = module.createRuntimeGatewayClient({
    fetchWithTimeout: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        controller.abort(new DOMException("Superseded", "AbortError"));
        return { ok: true, rows: [{ date: "2026-08-12" }] };
      },
    }),
    endpoints: { macro: "https://worker.example/api/macro" },
    contract: {
      normalizeMacroPayload: (payload) => {
        normalized = true;
        return payload;
      },
    },
  });

  await assert.rejects(client.fetchMacro({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(normalized, false);
});

test("rejects a response from an incompatible runtime API", async () => {
  let mismatch = null;
  const client = module.createRuntimeGatewayClient({
    getAccessToken: () => "secret",
    fetchWithTimeout: async () => new Response(JSON.stringify({ ok: true, records: [] }), {
      status: 200,
      headers: { "X-ThinkStock-API-Version": "1" },
    }),
    endpoints: { indices: "https://worker.example/api/indices" },
    apiContract: {
      RUNTIME_API_VERSION_HEADER: "X-ThinkStock-API-Version",
      runtimeApiCompatibility: (value) => ({
        compatible: Number(value) >= 2,
        version: Number(value),
      }),
    },
    onVersionMismatch: (value) => { mismatch = value; },
  });
  await assert.rejects(client.fetchIndices(), /incompatible/);
  assert.equal(mismatch.version, 1);
});

test("routes progressive disclosures through the shared authenticated client", async () => {
  let request = null;
  const client = module.createRuntimeGatewayClient({
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true, records: [], nextPage: null }), { status: 200 });
    },
    endpoints: { disclosures: "https://worker.example/api/dart/disclosures" },
  });

  await client.fetchDisclosures({
    ticker: "005930.ks",
    corpCode: "00126380",
    since: "2026-08-01",
    page: 2,
  }, { forceNetwork: true });

  assert.match(request.url, /ticker=005930\.KS/);
  assert.match(request.url, /corpCode=00126380/);
  assert.match(request.url, /progressive=1/);
  assert.match(request.url, /since=2026-08-01/);
  assert.match(request.url, /page=2/);
  assert.match(request.url, /force=1/);
  assert.equal(request.init.headers.Authorization, "Bearer secret");
});

test("routes local insider trades without exposing the access token", async () => {
  let request = null;
  const client = module.createRuntimeGatewayClient({
    isLocal: true,
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true, records: [] }), { status: 200 });
    },
    endpoints: { insiderTrades: "https://worker.example/api/dart/insider-trades" },
    localEndpoints: { insiderTrades: "./api/dart/insider-trades" },
  });

  await client.fetchInsiderTrades({ ticker: "005930.KS", corpCode: "00126380" });
  assert.match(request.url, /^\.\/api\/dart\/insider-trades\?/);
  assert.equal(Object.hasOwn(request.init.headers, "Authorization"), false);
});

test("routes one completed DART EPS year through the local gateway", async () => {
  let request = null;
  const client = module.createRuntimeGatewayClient({
    isLocal: true,
    getAccessToken: () => "secret",
    fetchWithTimeout: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true, records: [] }), { status: 200 });
    },
    endpoints: { epsHistory: "https://worker.example/api/dart/eps-history" },
    localEndpoints: { epsHistory: "./api/dart/eps-history" },
  });

  await client.fetchEpsHistory({
    ticker: "218410.KQ",
    corpCode: "01078178",
    year: 2025,
  });
  assert.match(request.url, /^\.\/api\/dart\/eps-history\?/);
  assert.match(request.url, /ticker=218410.KQ/);
  assert.match(request.url, /corpCode=01078178/);
  assert.match(request.url, /year=2025/);
  assert.equal(Object.hasOwn(request.init.headers, "Authorization"), false);
});

test("shares simultaneous identical gateway requests", async () => {
  let calls = 0;
  let release;
  const client = module.createRuntimeGatewayClient({
    fetchWithTimeout: async () => {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
    },
    endpoints: { macro: "https://worker.example/api/macro" },
  });

  const first = client.fetchMacro();
  const second = client.fetchMacro();
  await Promise.resolve();
  await Promise.resolve();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(client.requestStats().sharedHits, 1);
});

test("uses the app registry and queues one forced refresh behind a normal request", async () => {
  const registry = createSharedRequestRegistry();
  const releases = [];
  const urls = [];
  const client = module.createRuntimeGatewayClient({
    requestRegistry: registry,
    fetchWithTimeout: async (url) => {
      urls.push(url);
      await new Promise((resolve) => releases.push(resolve));
      return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
    },
    endpoints: { macro: "https://worker.example/api/macro" },
  });

  const normal = client.fetchMacro();
  await Promise.resolve();
  await Promise.resolve();
  const forcedA = client.fetchMacro({ forceNetwork: true });
  const forcedB = client.fetchMacro({ forceNetwork: true });
  assert.equal(urls.length, 1);

  releases.shift()();
  await normal;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 2);
  assert.match(urls[1], /refresh=1$/);

  releases.shift()();
  await Promise.all([forcedA, forcedB]);
  assert.equal(urls.length, 2);
  assert.equal(registry.stats().queued, 2);
});
