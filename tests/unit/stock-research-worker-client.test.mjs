import assert from "node:assert/strict";
import test from "node:test";

const { default: workerClient } = await import("../../docs/modules/stock-research-worker-client.js");

class FakeWorker {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
}

test("a worker timeout rejects every pending request and releases its lane", async () => {
  const timers = new Map();
  let id = 0;
  const lanePromise = workerClient.createWorkerLane({
    Worker: FakeWorker,
    setTimeout: (callback) => { timers.set(++id, callback); return id; },
    clearTimeout: (key) => timers.delete(key),
  }, "worker.js", {});
  const worker = FakeWorker.instances.at(-1);
  worker.onmessage({ data: { id: worker.messages[0].id, ready: true } });
  const lane = await lanePromise;
  const first = lane.analyze({}, [], "2026-09-01", {});
  const second = lane.analyze({}, [], "2026-09-01", {});
  const checked = Promise.all([assert.rejects(first, { code: "worker-timeout" }),
    assert.rejects(second, { code: "worker-timeout" })]);
  [...timers.values()][0]();
  await checked;
  assert.equal(timers.size, 0);
  assert.equal(lane.isTerminated(), true);
});

test("cancel stops waiting for shared preparation without cancelling its other consumers", async () => {
  const controller = new AbortController();
  let finish;
  const shared = new Promise((resolve) => { finish = resolve; });
  const waiting = workerClient.waitForTask(shared, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  finish("ready");
  assert.equal(await shared, "ready");
});

test("terminates a worker whose initialization fails", async () => {
  FakeWorker.instances.length = 0;
  const lanePromise = workerClient.createWorkerLane({ Worker: FakeWorker }, "worker.js", {});
  const worker = FakeWorker.instances[0];
  worker.onerror({ message: "init failed" });
  await assert.rejects(lanePromise, /init failed/);
  assert.equal(worker.terminated, true);
});

test("rejects pending analysis when its worker lane is terminated", async () => {
  FakeWorker.instances.length = 0;
  const lanePromise = workerClient.createWorkerLane({ Worker: FakeWorker }, "worker.js", {});
  const worker = FakeWorker.instances[0];
  const initId = worker.messages[0].id;
  worker.onmessage({ data: { id: initId, ready: true } });
  const lane = await lanePromise;
  const analysis = lane.analyze({ ticker: "005930.KS" }, [], "2026-08-29", {
    todayOnly: false,
    includeBuy: true,
    includeSell: false,
  });
  lane.terminate();
  await assert.rejects(analysis, /종료/);
  assert.equal(worker.terminated, true);
});
