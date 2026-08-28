import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeDataApp } from "../../docs/modules/runtime-data-app.mjs";

function createScope() {
  const status = {
    hidden: true,
    textContent: "",
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
  return {
    document: { getElementById: () => status },
    requestAnimationFrame: (callback) => callback(),
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout() {},
  };
}

test("completed runtime status stays solid for three seconds and fades for two", () => {
  const classes = new Set();
  const timers = [];
  const status = {
    hidden: true,
    textContent: "",
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
    },
  };
  const app = createRuntimeDataApp({
    document: { getElementById: () => status },
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  });

  app.setStatus("ready", "최신 데이터 확인 완료");

  assert.equal(status.hidden, false);
  assert.equal(timers[0].delay, 3000);
  timers[0].callback();
  assert.equal(classes.has("is-fading"), true);
  assert.equal(timers[1].delay, 2000);
  timers[1].callback();
  assert.equal(status.hidden, true);
});

test("runtime refresh shares one in-flight request until a forced refresh supersedes it", async () => {
  const pending = [];
  const app = createRuntimeDataApp(createScope(), {
    runRefresh: (_element, options) => new Promise((resolve) => pending.push({ options, resolve })),
  });

  const first = app.refresh(null);
  const shared = app.refresh(null);
  assert.equal(shared, first);
  const forced = app.refresh(null, { forceNetwork: true });
  assert.equal(pending[0].options.signal.aborted, true);

  pending[0].resolve({ cancelled: true });
  pending[1].resolve({ ok: true });
  assert.deepEqual(await forced, { ok: true });
});

test("runtime app aborts its active refresh when disposed", async () => {
  let activeSignal = null;
  const app = createRuntimeDataApp(createScope(), {
    runRefresh: (_element, { signal }) => new Promise((resolve) => {
      activeSignal = signal;
      signal.addEventListener("abort", () => resolve({ cancelled: true }), { once: true });
    }),
  });

  const refresh = app.refresh(null);
  app.dispose();

  assert.equal(activeSignal.aborted, true);
  assert.deepEqual(await refresh, { cancelled: true });
});

test("runtime startup restores the last view before loading history and rendering", async () => {
  const calls = [];
  const app = createRuntimeDataApp(createScope(), { runRefresh: async () => ({ ok: true }) });
  const restored = await app.prepareInitialData({
    restoreSnapshot: async () => { calls.push("snapshot"); return true; },
    loadSeed: async () => calls.push("seed"),
    needsHistorical: () => true,
    loadHistorical: async () => calls.push("history"),
    plotlyReady: Promise.resolve({ plotly: {} }),
    renderMain: async () => calls.push("render"),
    setProgress: () => {},
  });

  assert.equal(restored, true);
  assert.deepEqual(calls, ["snapshot", "history", "render"]);
});

test("runtime startup releases the loader at the critical phase", async () => {
  let refreshOptions = null;
  const onCriticalProgress = () => {};
  const app = createRuntimeDataApp(createScope(), {
    runRefresh: async (_element, options) => {
      refreshOptions = options;
      await options.onCriticalReady();
      return { ok: true };
    },
  });
  await app.refreshDuringStartup(null, {
    restoredSnapshot: true,
    mergeSeed: async () => {},
    onCriticalProgress,
  });

  assert.equal(refreshOptions.awaitCriticalRender, true);
  assert.equal(refreshOptions.awaitSupplementalRender, true);
  assert.equal(refreshOptions.deferSupplementalUntilReady, true);
  assert.equal(refreshOptions.incrementalSupplementalRender, true);
  assert.equal(refreshOptions.onCriticalProgress, onCriticalProgress);
});

test("runtime startup settles a fast supplemental refresh before releasing completion", async () => {
  let releaseSupplemental = null;
  const supplemental = new Promise((resolve) => { releaseSupplemental = resolve; });
  const app = createRuntimeDataApp(globalThis, {
    runRefresh: async (_element, options) => {
      options.onCriticalReady();
      await supplemental;
      return { ok: true };
    },
  });

  const startup = app.refreshDuringStartup(null, { settleAfterCriticalMs: 100 });
  releaseSupplemental();

  assert.deepEqual(await startup, {
    critical: { ok: true },
    settled: true,
  });
});

test("runtime startup does not hold completion behind a slow supplemental refresh", async () => {
  let releaseSupplemental = null;
  let settleTimer = null;
  const supplemental = new Promise((resolve) => { releaseSupplemental = resolve; });
  const scope = {
    setTimeout(callback) { settleTimer = callback; return 1; },
    clearTimeout() {},
  };
  const app = createRuntimeDataApp(scope, {
    runRefresh: async (_element, options) => {
      options.onCriticalReady();
      await supplemental;
      return { ok: true };
    },
  });

  const startup = app.refreshDuringStartup(null, { settleAfterCriticalMs: 100 });
  await Promise.resolve();
  settleTimer();

  assert.deepEqual(await startup, {
    critical: { ok: true },
    settled: false,
  });
  releaseSupplemental();
});

test("runtime startup cannot hang when a refresh finishes before reporting its phase", async () => {
  const app = createRuntimeDataApp(createScope(), {
    runRefresh: async () => ({ ok: true }),
  });

  await app.refreshDuringStartup(null);
});

test("runtime app exposes per-source last-good refresh state", () => {
  let now = 100;
  const states = new Map();
  const ledger = {
    canAttempt: (source, options) => ({ allowed: options?.force === true, source, waitMs: 123 }),
    success: (source, detail) => states.set(source, { state: "ready", ...detail, at: now }),
    failure: (source, error) => states.set(source, { state: "stale", error: error.message, at: now }),
    observe: (source, detail) => states.set(source, { ...states.get(source), ...detail, observedAt: now }),
    snapshot: () => Object.fromEntries(states),
  };
  const app = createRuntimeDataApp(createScope(), { sourceLedger: ledger, runRefresh: async () => ({}) });
  app.noteSourceSuccess("adr", { latestDate: "2026-08-10" });
  now = 200;
  app.noteSourceFailure("credit", new Error("offline"));

  assert.deepEqual(app.getSourceStates(), {
    adr: { state: "ready", latestDate: "2026-08-10", at: 100 },
    credit: { state: "stale", error: "offline", at: 200 },
  });
  assert.equal(app.canAttemptSource("credit").allowed, false);
  assert.equal(app.canAttemptSource("credit", { force: true }).allowed, true);
});

test("runtime app records refresh coverage and quality in one transaction", () => {
  const calls = [];
  const ledger = {
    success: (source, detail) => { calls.push(["success", source, detail]); return detail; },
    observe: (source, detail) => { calls.push(["observe", source, detail]); return detail; },
    snapshot: () => ({}),
  };
  const app = createRuntimeDataApp(createScope(), { sourceLedger: ledger, runRefresh: async () => ({}) });
  app.noteSourceResult("credit", {
    stale: true,
    revision: "credit-42",
    quality: {
      firstDate: "2021-01-01",
      latestDate: "2026-08-12",
      anomalyCount: 0,
      gapCount: 2,
    },
  });

  assert.deepEqual(calls.map(([name]) => name), ["success", "observe"]);
  assert.equal(calls[1][2].latestDate, "2026-08-12");
  assert.equal(calls[1][2].gapCount, 2);
  assert.equal(calls[1][2].isStale, true);
});

test("runtime app records each partial refresh component independently", () => {
  const calls = [];
  const ledger = {
    success: (source, detail) => { calls.push(["success", source, detail]); return detail; },
    failure: (source, error) => { calls.push(["failure", source, error.message]); return error; },
    observe: (source, detail) => { calls.push(["observe", source, detail]); return detail; },
    snapshot: () => ({}),
  };
  const app = createRuntimeDataApp(createScope(), { sourceLedger: ledger, runRefresh: async () => ({}) });
  app.noteSourceResult("macro", {
    latestDate: "2026-08-12",
    components: {
      "macro:leading": { ok: true, latestDate: "2026-06-01", updated: 1 },
      "macro:news": { ok: false, error: "news unavailable", latestDate: "" },
    },
  });

  assert.deepEqual(calls.map(([name, source]) => [name, source]), [
    ["success", "macro"],
    ["observe", "macro"],
    ["success", "macro:leading"],
    ["observe", "macro:leading"],
    ["failure", "macro:news"],
  ]);
});
