import assert from "node:assert/strict";
import test from "node:test";

const {
  createRuntimeRefreshRenderBatcher,
  createRuntimeRefreshOrchestrator,
  planRuntimeRefreshRendering,
  runRefreshPhases,
  shouldScheduleHiddenStockRefresh,
} = await import("../../docs/modules/runtime-refresh-orchestrator.mjs");

test("hidden stock refresh stays out of automatic startup and runs on explicit refresh", () => {
  assert.equal(shouldScheduleHiddenStockRefresh({}), false);
  assert.equal(shouldScheduleHiddenStockRefresh({ forceNetwork: true }), true);
  assert.equal(shouldScheduleHiddenStockRefresh({ refreshHidden: true }), true);
});

test("supplemental refresh can wait for the visible startup boundary", async () => {
  const calls = [];
  let releaseSupplemental = null;
  const ready = new Promise((resolve) => { releaseSupplemental = resolve; });
  const task = runRefreshPhases({
    startSupplementalAfterCritical: true,
    criticalTasks: [async () => { calls.push("critical"); return 1; }],
    supplementalTasks: [async () => { calls.push("supplemental"); return 2; }],
    onCritical: () => calls.push("critical-ready"),
    beforeSupplemental: async () => {
      calls.push("waiting");
      await ready;
    },
    onSupplemental: () => calls.push("supplemental-ready"),
  });

  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["critical", "critical-ready", "waiting"]);
  releaseSupplemental();
  assert.deepEqual(await task, {
    criticalResults: [1],
    supplementalResults: [2],
  });
  assert.deepEqual(calls, [
    "critical",
    "critical-ready",
    "waiting",
    "supplemental",
    "supplemental-ready",
  ]);
});

test("supplemental render batch absorbs auxiliary and marker work into a main render", async () => {
  const tasks = [];
  const rendered = [];
  const scheduler = {
    enqueue: (_key, task, options) => {
      tasks.push({ task, options });
      return Promise.resolve(true);
    },
  };
  const batcher = createRuntimeRefreshRenderBatcher({
    scheduler,
    renderMain: () => rendered.push("main"),
    renderAuxiliary: () => rendered.push("auxiliary"),
    renderDisclosure: () => rendered.push("disclosure"),
  });

  batcher.schedule({ auxiliary: true });
  batcher.schedule({ main: true, disclosure: true });
  assert.deepEqual(batcher.snapshot(), { main: true, auxiliary: true, disclosure: true });
  await tasks.at(-1).task();
  assert.deepEqual(rendered, ["main"]);
  assert.deepEqual(batcher.snapshot(), { main: false, auxiliary: false, disclosure: false });
  assert.equal(tasks.at(-1).options.priority, 20);
});

test("one main refresh absorbs simultaneous auxiliary and disclosure rendering", () => {
  assert.deepEqual(planRuntimeRefreshRendering(
    { price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 },
    { price: 2, macro: 1, credit: 1, crisis: 1, adr: 2, disclosure: 2 },
  ), {
    mainDataChanged: true,
    adrDataChanged: true,
    disclosureDataChanged: true,
    renderAuxiliaryOnly: false,
    renderDisclosureOnly: false,
  });
});

test("isolated auxiliary and disclosure changes keep their partial render paths", () => {
  assert.deepEqual(planRuntimeRefreshRendering(
    { price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 },
    { price: 1, macro: 1, credit: 1, crisis: 1, adr: 2, disclosure: 2 },
  ), {
    mainDataChanged: false,
    adrDataChanged: true,
    disclosureDataChanged: true,
    renderAuxiliaryOnly: true,
    renderDisclosureOnly: true,
  });
});

test("unavailable live index and prices keep saved data and allow supplemental refresh to finish", async () => {
  const phases = [];
  const preloadScopes = [];
  const preloadPayloads = [];
  const indexPayloads = [];
  let bootstrapCalls = 0;
  const progress = [];
  const messages = [];
  const hiddenSchedules = [];
  let snapshotSchedules = 0;
  const renderOptions = [];
  const revisions = Object.freeze({ price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 });
  const orchestrator = createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges: async (_revisions, options) => {
      renderOptions.push(options);
      return ({
      revisionsAfter: revisions,
      mainDataChanged: false,
      adrDataChanged: false,
      disclosureDataChanged: false,
      });
    },
    canUseDartGateway: () => false,
    cancelAdrFinalRetry: () => {},
    chartSession: { showDisclosures: false },
    getDataRevisions: () => revisions,
    isAbortError: (error) => error?.name === "AbortError",
    isRetryableAdrRefreshError: () => false,
    fetchCriticalRuntimeBootstrap: async () => {
      bootstrapCalls += 1;
      return {
        indices: { ok: true, records: [] },
        prices: { ok: true, requested: 0, succeeded: 0, results: [] },
      };
    },
    preloadCustomStocks: async (options) => {
      preloadScopes.push(options.scope);
      preloadPayloads.push(options.priceBatchPayload || null);
      throw new Error("price HTTP 503");
    },
    recordPerfSample: () => {},
    refreshAdrFromWebWithRetry: async () => ({ changed: 0, latestDate: "" }),
    refreshCoreIndexSeries: async (options) => {
      indexPayloads.push(options.payload || null);
      throw new Error("HTTP 503");
    },
    refreshCreditFromGateway: async () => ({ applied: [], warnings: [] }),
    refreshCrisisSignalFromGateway: async () => ({ applied: [], warnings: [] }),
    refreshDartDisclosuresForVisibleTickersFromApi: async () => ({ fetched: 0, failed: [] }),
    refreshEcosMacroFromGateway: async () => ({ applied: [], warnings: [] }),
    refreshFearGreedFromWeb: async () => ({ added: 0, latestDate: "" }),
    refreshSourceWithRetry: (_name, task) => task(),
    runRefreshPhases,
    runtimeDataApp: { notePhase: (name) => phases.push(name) },
    scheduleAdrFinalRetry: () => {},
    scheduleHiddenStockRefresh: (options) => hiddenSchedules.push(options),
    scheduleLastRuntimeSnapshotSave: () => { snapshotSchedules += 1; },
    setMessage: (_element, lines) => messages.push(...lines),
    setRuntimeRefreshStatus: () => {},
    startPerfSample: () => 0,
    state: { disclosureRows: [], lastDisclosureTraceStats: { markers: 0 } },
    throwIfAborted: () => {},
  });

  await orchestrator.run(null, {
    onCriticalProgress: (value) => progress.push(value),
    awaitSupplementalRender: true,
  });

  assert.deepEqual(phases, ["criticalReady", "supplementalReady"]);
  assert.equal(bootstrapCalls, 1);
  assert.deepEqual(preloadScopes, ["visible"]);
  assert.equal(preloadPayloads[0]?.ok, true);
  assert.equal(hiddenSchedules.length, 0);
  assert.equal(snapshotSchedules, 0);
  assert.equal(indexPayloads[0]?.ok, true);
  assert.deepEqual(renderOptions, [
    { awaitMainRender: false, backgroundBatch: false, awaitBackgroundBatch: false },
    { awaitMainRender: false, backgroundBatch: true, awaitBackgroundBatch: true },
  ]);
  assert.equal(progress.at(-1).percent, 96);
  assert.equal(messages.some((line) => line.includes("price HTTP 503")), true);
  assert.equal(messages.some((line) => line.includes("KRX 지수 갱신 오류: HTTP 503")), true);
});
