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
