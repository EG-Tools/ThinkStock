import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCacheBust,
  createFetchWithTimeout,
  isAbortError,
  throwIfAborted,
} from "../../docs/modules/browser-request-runtime.mjs";

test("appends a deterministic cache key to plain and queried URLs", () => {
  assert.equal(appendCacheBust("./data.json", () => 123), "./data.json?_=123");
  assert.equal(appendCacheBust("./data.json?v=1", () => 123), "./data.json?v=1&_=123");
});

test("classifies and raises abort errors through one shared contract", () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => throwIfAborted(controller.signal),
    (error) => error?.name === "AbortError" && isAbortError(error),
  );
  assert.equal(isAbortError(new Error("request aborted by caller")), true);
  assert.equal(isAbortError(new Error("network failed")), false);
});

test("forwards an external abort signal to the active request", async () => {
  const external = new AbortController();
  let receivedSignal = null;
  const request = createFetchWithTimeout({
    defaultTimeoutMs: 1000,
    fetch: async (_resource, init) => {
      receivedSignal = init.signal;
      return await new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
  });

  const pending = request("/runtime", { signal: external.signal });
  external.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(receivedSignal.aborted, true);
});

test("reports a timed out request with the existing Korean message", async () => {
  const request = createFetchWithTimeout({
    defaultTimeoutMs: 5,
    fetch: async (_resource, init) => await new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });

  await assert.rejects(request("/slow"), /요청 시간 초과\(0초\)/);
});
