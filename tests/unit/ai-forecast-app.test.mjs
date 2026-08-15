import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/control-state-view.js");
await import("../../docs/modules/ai-forecast-app.js");

const { createAiForecastApp } = globalThis.ThinkStockAiForecastApp;

function createProgressScope() {
  const elements = {
    aiForecastProgress: { hidden: true },
    aiForecastProgressText: { textContent: "" },
    aiForecastProgressBar: { style: {} },
  };
  const timers = [];
  return {
    elements,
    timers,
    document: { getElementById: (id) => elements[id] || null },
    requestAnimationFrame: (callback) => callback(),
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout() {},
  };
}

test("AI forecast app falls back when workers are unavailable", async () => {
  const scope = createProgressScope();
  const app = createAiForecastApp(scope, {
    buildFallback: (options) => ({ ticker: options.ticker, source: "fallback" }),
  });

  assert.deepEqual(await app.run({ ticker: "005930.KS" }), {
    ticker: "005930.KS",
    source: "fallback",
  });
});

test("AI forecast progress never moves backward and hides after completion", () => {
  const scope = createProgressScope();
  const app = createAiForecastApp(scope);

  app.startProgress("prepare");
  app.setProgress(45, "calculate");
  app.setProgress(20, "late update");
  assert.equal(scope.elements.aiForecastProgressBar.style.width, "45%");
  assert.equal(scope.elements.aiForecastProgressText.textContent, "late update 45%");

  app.finishProgress();
  assert.equal(scope.elements.aiForecastProgressBar.style.width, "100%");
  scope.timers.at(-1)();
  assert.equal(scope.elements.aiForecastProgress.hidden, true);
  assert.equal(app.isProgressActive(), false);
});

test("AI forecast app resolves pending work as cancelled when targets change", async () => {
  let workerInstance = null;
  class FakeWorker {
    constructor(url) { this.url = url; workerInstance = this; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
  }
  const scope = { ...createProgressScope(), Worker: FakeWorker };
  const app = createAiForecastApp(scope, { workerUrl: "forecast-worker.js" });
  const request = app.run({ ticker: "000660.KS" });

  assert.equal(workerInstance.message.id, 1);
  app.cancelCalculations();
  assert.equal(await request, null);
  assert.equal(workerInstance.terminated, true);
});
