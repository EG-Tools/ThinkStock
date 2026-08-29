export function createScheduledSettlementRuntime(scope = globalThis, options = {}) {
  const getDelayMs = typeof options.getDelayMs === "function" ? options.getDelayMs : () => null;
  const shouldRun = typeof options.shouldRun === "function" ? options.shouldRun : () => true;
  const shouldSchedule = typeof options.shouldSchedule === "function"
    ? options.shouldSchedule
    : shouldRun;
  const isBusy = typeof options.isBusy === "function" ? options.isBusy : () => false;
  const settle = typeof options.settle === "function" ? options.settle : async () => false;
  const offsetMs = Math.max(0, Number(options.offsetMs) || 0);
  const retryMs = Math.max(250, Number(options.retryMs) || 1500);
  let timer = 0;
  let running = false;

  function clear() {
    if (timer) scope.clearTimeout?.(timer);
    timer = 0;
  }

  function arm(delayMs) {
    clear();
    timer = scope.setTimeout?.(run, Math.max(250, Number(delayMs) || 0)) || 0;
    return Boolean(timer);
  }

  async function run() {
    timer = 0;
    if (running || !shouldRun()) return false;
    if (isBusy()) return arm(retryMs) && false;
    running = true;
    try {
      return await settle();
    } finally {
      running = false;
    }
  }

  function schedule() {
    clear();
    if (!shouldSchedule()) return false;
    const delayMs = Number(getDelayMs());
    if (!Number.isFinite(delayMs) || delayMs < 0) return false;
    return arm(delayMs + offsetMs);
  }

  return Object.freeze({
    clear,
    dispose: clear,
    isRunning: () => running,
    isScheduled: () => Boolean(timer),
    run,
    schedule,
  });
}
