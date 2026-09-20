import assert from "node:assert/strict";
import test from "node:test";

import { createChartModelCache } from "../../docs/modules/chart-model-cache.mjs";
import {
  createChartModelResolver,
  createChartModelWorkerClient,
} from "../../docs/modules/chart-model-worker-client.mjs";

class FakeWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  respond(index, result = {}) {
    const message = this.messages[index];
    this.onmessage({ data: { id: message.id, ok: true, result } });
  }

  terminate() {
    this.terminated = true;
  }
}

test("can opt into a module worker without changing the request protocol", async () => {
  FakeWorker.instances = [];
  const client = createChartModelWorkerClient({
    Worker: FakeWorker,
    setTimeout,
    clearTimeout,
  }, {
    workerUrl: "worker.mjs",
    workerType: "module",
    workerName: "thinkstock-chart",
  });

  const request = client.request({ value: 1 });
  const worker = FakeWorker.instances[0];
  assert.deepEqual(worker.options, { type: "module", name: "thinkstock-chart" });
  worker.respond(0, { value: 1 });
  assert.deepEqual(await request, { value: 1 });
  client.dispose();
});

test("latest same-type request wins without restarting the worker", async () => {
  FakeWorker.instances = [];
  const client = createChartModelWorkerClient({
    Worker: FakeWorker,
    setTimeout,
    clearTimeout,
  }, { workerUrl: "worker.js", timeoutMs: 5000 });

  const first = client.request({ datasetKey: "data-a", sources: { rows: [1] }, value: 1 });
  const second = client.request({ datasetKey: "data-a", sources: { rows: [1] }, value: 2 });
  const worker = FakeWorker.instances[0];
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.terminated, false);

  worker.respond(0, { value: 1 });
  assert.equal(await first, null);
  assert.equal(worker.messages.length, 2);
  assert.equal("sources" in worker.messages[1].payload, false);
  worker.respond(1, { value: 2 });
  assert.deepEqual(await second, { value: 2 });

  assert.deepEqual(client.stats(), {
    dispatched: 2,
    sourceTransfers: 1,
    superseded: 1,
    dispatchByType: { buildMainChartModel: 2 },
    activeType: "",
    queuedTypes: [],
    workerActive: true,
    lifecycle: {
      disposed: false,
      idleMs: 60000,
      idleRuns: 0,
      timerPending: true,
    },
  });
  client.dispose();
});

test("a superseded timeout does not reject or trigger a synchronous fallback", async () => {
  FakeWorker.instances = [];
  const timers = new Map();
  let nextTimer = 0;
  const client = createChartModelWorkerClient({
    Worker: FakeWorker,
    setTimeout: (callback) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  }, { workerUrl: "worker.js", timeoutMs: 1000 });
  let syncBuilds = 0;
  const resolver = createChartModelResolver({
    cache: createChartModelCache(),
    requestWorker: (payload, type) => client.request(payload, type),
    buildSync: () => { syncBuilds += 1; return { value: "sync" }; },
    normalize: (model) => model,
  });
  const first = resolver.resolve({ cacheKey: "a", workerPayload: { value: "a" } });
  await Promise.resolve();
  const second = resolver.resolve({ cacheKey: "b", workerPayload: { value: "b" } });
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(await first, null);
  assert.equal(syncBuilds, 0);
  FakeWorker.instances.at(-1).respond(0, { value: "b" });
  assert.equal((await second).value, "b");
  client.dispose();
});

test("a superseded worker error is discarded while the queued request continues", async () => {
  FakeWorker.instances = [];
  const client = createChartModelWorkerClient({ Worker: FakeWorker, setTimeout, clearTimeout }, {
    workerUrl: "worker.js",
  });
  const first = client.request({ value: "a" });
  const second = client.request({ value: "b" });
  FakeWorker.instances[0].onerror({ message: "worker crashed" });
  assert.equal(await first, null);
  FakeWorker.instances[1].respond(0, { value: "b" });
  assert.deepEqual(await second, { value: "b" });
  client.dispose();
});

test("resolver ignores a stale worker failure after a newer revision starts", async () => {
  let rejectFirst;
  let syncBuilds = 0;
  const resolver = createChartModelResolver({
    cache: createChartModelCache(),
    requestWorker: (payload) => payload.value === "a"
      ? new Promise((_, reject) => { rejectFirst = reject; })
      : Promise.resolve({ value: "b" }),
    buildSync: () => { syncBuilds += 1; return { value: "sync" }; },
    normalize: (model) => model,
  });
  const first = resolver.resolve({ cacheKey: "a", workerPayload: { value: "a" } });
  await Promise.resolve();
  const second = resolver.resolve({ cacheKey: "b", workerPayload: { value: "b" } });
  rejectFirst(new Error("worker failed"));
  assert.equal(await first, null);
  assert.equal((await second).value, "b");
  assert.equal(syncBuilds, 0);
});

test("main chart work is prioritized after the active request settles", async () => {
  FakeWorker.instances = [];
  const client = createChartModelWorkerClient({
    Worker: FakeWorker,
    setTimeout,
    clearTimeout,
  }, { workerUrl: "worker.js", timeoutMs: 5000 });

  const active = client.request({ value: 1 }, "buildAuxiliaryChartModel");
  const auxiliary = client.request({ value: 2 }, "buildAuxiliaryChartModel");
  const main = client.request({ value: 3 }, "buildMainChartModel");
  const worker = FakeWorker.instances[0];
  worker.respond(0, { value: 1 });
  assert.equal(await active, null);
  assert.equal(worker.messages[1].type, "buildMainChartModel");
  worker.respond(1, { value: 3 });
  assert.deepEqual(await main, { value: 3 });
  worker.respond(2, { value: 2 });
  assert.deepEqual(await auxiliary, { value: 2 });
  client.dispose();
});

test("worker client restores reference-only rows for subsequent models", async () => {
  FakeWorker.instances = [];
  const client = createChartModelWorkerClient({ Worker: FakeWorker, setTimeout, clearTimeout }, {
    workerUrl: "worker.js",
  });
  const first = client.request({ datasetKey: "v1", sources: { priceRows: [1] } });
  const worker = FakeWorker.instances[0];
  const rows = [{ date: "2026-01-01", AAA: 1 }];
  worker.respond(0, { rows });
  assert.equal((await first).rows, rows);
  const second = client.request({ datasetKey: "v1", sources: { priceRows: [1] } });
  worker.onmessage({ data: {
    id: worker.messages[1].id,
    ok: true,
    rowsRef: "v1",
    result: { rows: null, value: 2 },
  } });
  assert.equal((await second).rows, rows);
  client.dispose();
});

test("missing row reference restarts the worker before the next request", async () => {
  FakeWorker.instances = [];
  const client = createChartModelWorkerClient({ Worker: FakeWorker, setTimeout, clearTimeout }, {
    workerUrl: "worker.js",
  });
  const first = client.request({ datasetKey: "v1", sources: { priceRows: [1] } });
  const worker = FakeWorker.instances[0];
  worker.onmessage({ data: {
    id: worker.messages[0].id,
    ok: true,
    rowsRef: "v1",
    result: { rows: null },
  } });
  await assert.rejects(first, /row cache miss/);
  assert.equal(worker.terminated, true);
  const second = client.request({ datasetKey: "v1", sources: { priceRows: [1] } });
  assert.equal("sources" in FakeWorker.instances[1].messages[0].payload, true);
  FakeWorker.instances[1].respond(0, { rows: [{ date: "2026-01-01" }] });
  assert.equal((await second).rows.length, 1);
  client.dispose();
});

test("chart model resolver shares cache, worker, normalization, and revision handling", async () => {
  const statuses = [];
  const sources = [];
  let workerCalls = 0;
  const resolver = createChartModelResolver({
    cache: createChartModelCache(),
    requestWorker: async (payload) => {
      workerCalls += 1;
      return { value: payload.value };
    },
    buildSync: () => assert.fail("sync fallback should not run"),
    normalize: (model) => ({ ...model, normalized: true }),
    onCacheStatus: (status) => statuses.push(status),
    onSource: (source) => sources.push(source),
  });

  const first = await resolver.resolve({
    cacheKey: "revision-1",
    workerPayload: { value: 7 },
  });
  const second = await resolver.resolve({
    cacheKey: "revision-1",
    workerPayload: { value: 99 },
  });

  assert.deepEqual(first, {
    value: 7,
    normalized: true,
    renderRevision: "revision-1",
  });
  assert.equal(second, first);
  assert.equal(workerCalls, 1);
  assert.deepEqual(statuses, ["miss", "hit"]);
  assert.deepEqual(sources, ["worker"]);
  assert.deepEqual(resolver.stats(), {
    workerBuilds: 1,
    syncFallbacks: 0,
    superseded: 0,
    invalidModels: 0,
  });
});

test("chart model resolver falls back to the synchronous model once", async () => {
  const fallbacks = [];
  const sources = [];
  const resolver = createChartModelResolver({
    cache: createChartModelCache(),
    requestWorker: async () => { throw new Error("worker unavailable"); },
    buildSync: (payload) => ({ value: payload.value }),
    normalize: (model) => ({ ...model }),
    onWorkerFallback: (error) => fallbacks.push(error.message),
    onSource: (source) => sources.push(source),
  });

  const model = await resolver.resolve({
    cacheKey: "revision-2",
    syncPayload: { value: 11 },
  });

  assert.deepEqual(model, { value: 11, renderRevision: "revision-2" });
  assert.deepEqual(fallbacks, ["worker unavailable"]);
  assert.deepEqual(sources, ["sync"]);
  assert.equal(resolver.stats().syncFallbacks, 1);
});

test("chart model resolver replaces an invalid worker result with the synchronous model", async () => {
  const fallbacks = [];
  const resolver = createChartModelResolver({
    cache: createChartModelCache(),
    requestWorker: async () => ({ invalid: true }),
    buildSync: () => ({ value: 17 }),
    normalize: (model) => (Number.isFinite(model?.value) ? { ...model } : null),
    onWorkerFallback: (error) => fallbacks.push(error.message),
  });

  const model = await resolver.resolve({ cacheKey: "revision-3" });

  assert.deepEqual(model, { value: 17, renderRevision: "revision-3" });
  assert.deepEqual(fallbacks, ["chart worker returned an invalid model"]);
  assert.deepEqual(resolver.stats(), {
    workerBuilds: 0,
    syncFallbacks: 1,
    superseded: 0,
    invalidModels: 1,
  });
});
