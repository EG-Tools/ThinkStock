import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/broker-report-worker-client.js");

const { createBrokerReportWorkerClient } = globalThis.ThinkStockBrokerReportWorkerClient;

test("reuses one PDF worker and transfers a private byte copy", async () => {
  const workers = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      workers.push(this);
    }

    postMessage(message, transfer) {
      assert.equal(transfer[0], message.bytes);
      queueMicrotask(() => this.onmessage({ data: {
        id: message.id,
        pages: [{ page: 1, lines: ["FY 2026E 2027E"] }],
      } }));
    }

    terminate() {}
  }
  const scope = { Worker: FakeWorker, clearTimeout, setTimeout };
  const client = createBrokerReportWorkerClient(scope, { workerUrl: "/broker-worker.js" });
  const original = new Uint8Array([1, 2, 3]);
  const first = await client.extractPages(original);
  const second = await client.extractPages(original);

  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].options, { type: "module" });
  assert.deepEqual(first[0].lines, ["FY 2026E 2027E"]);
  assert.equal(second.length, 1);
  assert.equal(original.byteLength, 3);
  client.dispose();
});

test("one worker timeout rejects every request attached to the terminated worker", async () => {
  let terminated = 0;
  class SilentWorker {
    postMessage() {}
    terminate() { terminated += 1; }
  }
  const scope = {
    Worker: SilentWorker,
    clearTimeout() {},
    setTimeout(callback) {
      queueMicrotask(callback);
      return Symbol("timer");
    },
  };
  const client = createBrokerReportWorkerClient(scope, {
    workerUrl: "/broker-worker.js",
    timeoutMs: 3000,
  });
  const results = await Promise.allSettled([
    client.extractPages(new Uint8Array([1])),
    client.extractPages(new Uint8Array([2])),
  ]);

  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.match(results[0].reason.message, /timeout/);
  assert.match(results[1].reason.message, /timeout/);
  assert.equal(terminated, 1);
});
