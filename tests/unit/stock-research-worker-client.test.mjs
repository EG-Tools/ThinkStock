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
