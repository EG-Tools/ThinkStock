import assert from "node:assert/strict";
import test from "node:test";

import {
  createIdleResourceLifecycle,
  createWorkerInstance,
  workerConstructorOptions,
} from "../../docs/modules/worker-lifecycle.mjs";

test("constructs classic and module workers through one normalized boundary", () => {
  const calls = [];
  class FakeWorker {
    constructor(url, options) {
      calls.push({ url, options });
    }
  }
  const scope = { Worker: FakeWorker };

  createWorkerInstance(scope, "classic-worker.js");
  createWorkerInstance(scope, () => "module-worker.js", {
    type: "module",
    name: "thinkstock-module",
  });

  assert.deepEqual(calls, [
    { url: "classic-worker.js", options: undefined },
    {
      url: "module-worker.js",
      options: { type: "module", name: "thinkstock-module" },
    },
  ]);
  assert.deepEqual(workerConstructorOptions({ type: "classic", name: "" }), {});
});

test("idle resource lifecycle coalesces timers and runs only after becoming idle", () => {
  const timers = new Map();
  let sequence = 0;
  let idleRuns = 0;
  const lifecycle = createIdleResourceLifecycle({}, {
    idleMs: 75,
    setTimer: (callback, delay) => {
      const id = ++sequence;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onIdle: () => { idleRuns += 1; },
  });

  lifecycle.markIdle();
  lifecycle.markBusy();
  assert.equal(timers.size, 0);
  lifecycle.markIdle();
  assert.equal(timers.size, 1);
  const [{ callback, delay }] = timers.values();
  assert.equal(delay, 75);
  callback();
  assert.equal(idleRuns, 1);
  assert.equal(lifecycle.stats().idleRuns, 1);
});

test("disposed idle resource lifecycle cannot schedule new cleanup", () => {
  let scheduled = 0;
  const lifecycle = createIdleResourceLifecycle({}, {
    setTimer: () => { scheduled += 1; return scheduled; },
    clearTimer: () => {},
  });
  lifecycle.dispose();
  assert.equal(lifecycle.markIdle(), false);
  assert.equal(scheduled, 0);
});
