"use strict";

function workerConstructorOptions(options = {}) {
  const constructorOptions = {};
  if (String(options.type || "").toLowerCase() === "module") {
    constructorOptions.type = "module";
  }
  const name = String(options.name || "").trim();
  if (name) constructorOptions.name = name;
  return Object.freeze(constructorOptions);
}

function createWorkerInstance(scope = globalThis, workerUrl = "", options = {}) {
  const url = typeof workerUrl === "function" ? workerUrl() : String(workerUrl || "");
  if (!url || typeof scope.Worker !== "function") {
    throw new Error("worker constructor is unavailable");
  }
  const constructorOptions = workerConstructorOptions(options);
  return Object.keys(constructorOptions).length
    ? new scope.Worker(url, constructorOptions)
    : new scope.Worker(url);
}

function createIdleResourceLifecycle(scope = globalThis, options = {}) {
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

export {
  createIdleResourceLifecycle,
  createWorkerInstance,
  workerConstructorOptions,
};
