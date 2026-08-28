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

export default Object.freeze({
  appendCacheBust,
  createFetchWithTimeout,
  isAbortError,
  throwIfAborted,
});
