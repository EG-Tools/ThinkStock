"use strict";

/**
 * Adds a request-specific cache key while preserving an existing query string.
 * The clock is injectable so callers can test the URL without changing globals.
 */
export function appendCacheBust(url, now = Date.now) {
  const stamp = `_=${now()}`;
  return String(url || "").includes("?") ? `${url}&${stamp}` : `${url}?${stamp}`;
}

export function isAbortError(error) {
  return error?.name === "AbortError" || /aborted|aborterror/i.test(String(error?.message || ""));
}

export function throwIfAborted(signal, message = "Request was superseded by a newer refresh") {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(message);
  error.name = "AbortError";
  throw error;
}

/**
 * Creates the shared browser fetch boundary used by startup, refresh, and gateway calls.
 * Dependencies are injectable for deterministic unit tests without changing app globals.
 */
export function createFetchWithTimeout(options = {}) {
  const defaultTimeoutMs = Math.max(1, Number(options.defaultTimeoutMs) || 12_000);
  const fetchImpl = options.fetch || ((...args) => globalThis.fetch(...args));
  const AbortControllerImpl = options.AbortController || globalThis.AbortController;
  const setTimer = options.setTimeout || globalThis.setTimeout.bind(globalThis);
  const clearTimer = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);

  return async function fetchWithTimeout(resource, init = {}, timeoutMs = defaultTimeoutMs) {
    const requestTimeoutMs = Number.isFinite(Number(timeoutMs))
      ? Math.max(1, Number(timeoutMs))
      : defaultTimeoutMs;
    const controller = new AbortControllerImpl();
    const externalSignal = init?.signal;
    let timedOut = false;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);

    try {
      return await fetchImpl(resource, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new Error(`요청 시간 초과(${Math.round(requestTimeoutMs / 1000)}초)`);
      throw error;
    } finally {
      clearTimer(timer);
      externalSignal?.removeEventListener?.("abort", abortFromExternal);
    }
  };
}

export function workerConstructorOptions(options = {}) {
  const constructorOptions = {};
  if (String(options.type || "").toLowerCase() === "module") {
    constructorOptions.type = "module";
  }
  const name = String(options.name || "").trim();
  if (name) constructorOptions.name = name;
  return Object.freeze(constructorOptions);
}

export function createWorkerInstance(scope = globalThis, workerUrl = "", options = {}) {
  const url = typeof workerUrl === "function" ? workerUrl() : String(workerUrl || "");
  if (!url || typeof scope.Worker !== "function") {
    throw new Error("worker constructor is unavailable");
  }
  const constructorOptions = workerConstructorOptions(options);
  return Object.keys(constructorOptions).length
    ? new scope.Worker(url, constructorOptions)
    : new scope.Worker(url);
}

export function createIdleResourceLifecycle(scope = globalThis, options = {}) {
  const idleMs = Math.max(0, Number(options.idleMs) || 60000);
  const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
  const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new Error("idle resource timer dependencies are incomplete");
  }

  let timer = 0;
  let disposed = false;
  let idleRuns = 0;

  function cancel() {
    if (timer) clearTimer(timer);
    timer = 0;
  }

  function markBusy() {
    if (disposed) return false;
    cancel();
    return true;
  }

  function markIdle() {
    if (disposed) return false;
    cancel();
    timer = setTimer(() => {
      timer = 0;
      if (disposed) return;
      idleRuns += 1;
      options.onIdle?.();
    }, idleMs);
    timer?.unref?.();
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
  }

  return Object.freeze({
    cancel,
    dispose,
    markBusy,
    markIdle,
    stats: () => Object.freeze({
      disposed,
      idleMs,
      idleRuns,
      timerPending: Boolean(timer),
    }),
  });
}

export default Object.freeze({
  appendCacheBust,
  createFetchWithTimeout,
  createIdleResourceLifecycle,
  createWorkerInstance,
  isAbortError,
  throwIfAborted,
  workerConstructorOptions,
});
