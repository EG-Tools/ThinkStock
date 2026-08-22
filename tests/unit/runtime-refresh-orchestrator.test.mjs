import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/shared-request-registry.js");
await import("../../docs/modules/runtime-refresh-orchestrator.js");

const { runRefreshPhases } = globalThis.ThinkStockRuntimeRefresh;
const {
  createRuntimeRefreshOrchestrator,
  planRuntimeRefreshRendering,
} = globalThis.ThinkStockRuntimeRefreshOrchestrator;

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
  const revisions = Object.freeze({ price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 });
  const orchestrator = createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges: async () => ({
      revisionsAfter: revisions,
      mainDataChanged: false,
      adrDataChanged: false,
      disclosureDataChanged: false,
    }),
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
    scheduleLastRuntimeSnapshotSave: () => {},
    setMessage: (_element, lines) => messages.push(...lines),
    setRuntimeRefreshStatus: () => {},
    startPerfSample: () => 0,
    state: { disclosureRows: [], lastDisclosureTraceStats: { markers: 0 } },
    throwIfAborted: () => {},
  });

  await orchestrator.run(null, {
    onCriticalProgress: (value) => progress.push(value),
  });

  assert.deepEqual(phases, ["criticalReady", "supplementalReady"]);
  assert.equal(bootstrapCalls, 1);
  assert.deepEqual(preloadScopes, ["visible"]);
  assert.equal(preloadPayloads[0]?.ok, true);
  assert.equal(hiddenSchedules.length, 1);
  assert.equal(hiddenSchedules[0].forceRefresh, false);
  assert.equal(indexPayloads[0]?.ok, true);
  assert.equal(progress.at(-1).percent, 96);
  assert.equal(messages.some((line) => line.includes("price HTTP 503")), true);
  assert.equal(messages.some((line) => line.includes("KRX 지수 갱신 오류: HTTP 503")), true);
});
