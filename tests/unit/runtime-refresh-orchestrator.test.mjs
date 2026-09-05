import assert from "node:assert/strict";
import test from "node:test";

const {
  createRuntimeRefreshChangeApplier,
  createRuntimeRefreshPolicy,
  createRuntimeRefreshOrchestrator,
  planRuntimeRefreshSources,
  partitionRuntimeRefreshSources,
  planRuntimeRefreshRendering,
  runRefreshPhases,
  shouldScheduleHiddenStockRefresh,
} = await import("../../docs/modules/runtime-refresh-orchestrator.mjs");

test("one change applier renders price first and finalizes timing once", async () => {
  let revisions = { price: 2, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 };
  const renders = [];
  let waits = 0;
  const applyChanges = createRuntimeRefreshChangeApplier({
    getDataRevisions: () => revisions,
    isAutoScale: () => true,
    isTimingVisible: () => true,
    markPendingAutoFit: () => {},
    requestMainRender: (request) => renders.push(request),
    waitForMainRender: async () => { waits += 1; },
  });

  const critical = await applyChanges(
    { price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 },
    { phase: "critical", finalizeDerived: false, awaitMainRender: true },
  );
  assert.equal(critical.priceDataChanged, true);
  assert.equal(renders[0].updateClass, "price");

  revisions = { ...revisions, macro: 2 };
  await applyChanges(
    critical.revisionsAfter,
    { phase: "supplemental", finalizeDerived: true, pendingDerivedInputChanged: true },
  );
  assert.equal(renders[1].updateClass, "timing");
  assert.equal(waits, 1);
});

test("auxiliary refresh uses the shared render queue without delaying data readiness", async () => {
  let releaseRender;
  const renderSettled = new Promise((resolve) => { releaseRender = resolve; });
  const requests = [];
  const applyChanges = createRuntimeRefreshChangeApplier({
    getDataRevisions: () => ({
      price: 1,
      macro: 1,
      credit: 1,
      crisis: 1,
      adr: 2,
      disclosure: 1,
    }),
    requestAuxiliaryRender: () => requests.push("auxiliary"),
    waitForAuxiliaryRender: () => renderSettled,
  });

  await applyChanges(
    { price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 },
    { phase: "supplemental", awaitAuxiliaryRender: false },
  );
  assert.deepEqual(requests, ["auxiliary"]);

  let completed = false;
  const awaited = applyChanges(
    { price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 },
    { phase: "supplemental", awaitAuxiliaryRender: true },
  ).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  releaseRender();
  await awaited;
  assert.equal(completed, true);
});

function createRefreshPolicy(overrides = {}) {
  const state = {
    visible: [],
    session: {
      hiddenAuxiliaryPanels: new Set(["adr", "vkospi", "newsSentiment", "fearGreed"]),
      hiddenSeries: new Set(["leading_cycle", "t10y1y", "us_credit_spread", "customer_deposit"]),
      showAiForecast: false,
      showCoMovement: false,
      showDisclosures: false,
      showInsiderTrades: false,
      showRecessionSignals: true,
    },
    sourceStates: {},
    ...overrides,
  };
  return {
    policy: createRuntimeRefreshPolicy({
      getCreditSeries: () => ["customer_deposit"],
      getPricePayload: () => ({ records: [] }),
      getSession: () => state.session,
      getSourceStates: () => state.sourceStates,
      getVisibleSeries: () => state.visible,
      hasVolumeHistory: (ticker) => state.hasVolumeHistory?.(ticker) ?? true,
      isForecastSeries: (series) => series === "^KS11" || /\.K[QS]$/.test(series),
      isStockSeries: (series) => /\.K[QS]$/.test(series),
      latestDatesByTicker: () => ({}),
      mainMacroSeries: ["leading_cycle", "t10y1y", "us_credit_spread"],
      marketIndexSeries: ["^KS11", "^KQ11"],
      planPriceRefresh: ({ tickers, forceNetwork }) => ({
        requiredTickers: forceNetwork ? [...tickers] : [...tickers],
      }),
      shouldConfirmSource: () => false,
      toNumber: Number,
    }),
    state,
  };
}

test("one refresh policy owns visible targets and benchmark dependencies", () => {
  const { policy, state } = createRefreshPolicy({ visible: ["005930.KS"] });
  state.session.showCoMovement = true;
  const plan = policy.planCriticalRefresh();
  assert.deepEqual(plan.prices.requiredTickers, ["005930.KS"]);
  assert.deepEqual(plan.indices.requiredTickers, ["^KS11", "^KQ11"]);
});

test("critical startup adds missing index and visible-stock volume inputs", () => {
  const ready = new Set();
  const { policy } = createRefreshPolicy({
    visible: ["005930.KS"],
    hasVolumeHistory: (ticker) => ready.has(ticker),
  });
  const missing = policy.planCriticalRefresh();
  assert.deepEqual(missing.indices.requiredTickers, ["^KS11", "^KQ11"]);
  assert.equal(missing.indices.requireVolumeHistory, true);
  assert.deepEqual(missing.prices.requiredTickers, ["005930.KS"]);

  ready.add("^KS11");
  ready.add("^KQ11");
  ready.add("005930.KS");
  const complete = policy.planCriticalRefresh();
  assert.equal(complete.indices.requireVolumeHistory, false);
  assert.deepEqual(complete.prices.requiredTickers, []);
});

test("stock latest prices are claimed once per app session until forced refresh", () => {
  const { policy, state } = createRefreshPolicy({ visible: ["005930.KS"] });
  assert.deepEqual(policy.planCriticalRefresh().prices.requiredTickers, ["005930.KS"]);
  assert.deepEqual(policy.planCriticalRefresh().prices.requiredTickers, []);
  assert.deepEqual(
    policy.planCriticalRefresh({ forceNetwork: true }).prices.requiredTickers,
    ["005930.KS"],
  );

  state.visible = [];
  assert.deepEqual(policy.claimStockPriceRefresh(["000660.KS"]).requiredTickers, ["000660.KS"]);
  assert.deepEqual(policy.claimStockPriceRefresh(["000660.KS"]).requiredTickers, []);
  policy.forgetStockPriceRefresh("000660.KS");
  assert.deepEqual(policy.claimStockPriceRefresh(["000660.KS"]).requiredTickers, ["000660.KS"]);
});

test("signal inputs stay dormant when no visible forecast target exists", () => {
  const { policy, state } = createRefreshPolicy();
  assert.equal(policy.isSourceForeground("crisis"), false);
  assert.equal(policy.isSourceForeground("macro"), false);
  assert.equal(policy.isSourceForeground("credit"), false);
  assert.equal(policy.isSourceForeground("adr"), false);
  assert.equal(policy.isSourceForeground("fearGreed"), false);

  state.visible = ["005930.KS"];
  assert.equal(policy.isSourceForeground("crisis"), true);
  assert.equal(policy.isSourceForeground("macro"), true);
  assert.equal(policy.isSourceForeground("credit"), true);
  assert.equal(policy.isSourceForeground("adr"), true);
  assert.equal(policy.isSourceForeground("fearGreed"), true);
});

test("shared source freshness skips ready data unless refresh is forced", () => {
  const { policy, state } = createRefreshPolicy({
    sourceStates: {
      macro: { state: "ready", qualityState: "ready", lastSuccessAt: Date.now() },
    },
  });
  assert.equal(policy.shouldRefreshSource("macro"), false);
  assert.equal(policy.shouldRefreshSource("macro", { forceNetwork: true }), true);
  state.sourceStates.macro.isStale = true;
  assert.equal(policy.shouldRefreshSource("macro"), true);
});

test("active timing confirms every analysis input once even when prior state is fresh", () => {
  const fresh = { state: "ready", qualityState: "ready", lastSuccessAt: Date.now() };
  const { policy } = createRefreshPolicy({
    visible: ["005930.KS"],
    sourceStates: Object.fromEntries(
      ["adr", "crisis", "credit", "fearGreed", "macro"].map((source) => [source, fresh]),
    ),
  });

  ["adr", "crisis", "credit", "fearGreed", "macro"].forEach((source) => {
    assert.equal(policy.shouldRefreshSource(source), true, source);
  });
});

test("auxiliary panels wake the source that actually owns their data", () => {
  const { policy, state } = createRefreshPolicy();
  state.session.showRecessionSignals = false;

  state.session.hiddenAuxiliaryPanels.delete("vkospi");
  assert.equal(policy.isSourceForeground("crisis"), true);
  assert.equal(policy.isSourceForeground("adr"), false);
  state.session.hiddenAuxiliaryPanels.add("vkospi");

  state.session.hiddenAuxiliaryPanels.delete("newsSentiment");
  assert.equal(policy.isSourceForeground("macro"), true);
  assert.equal(policy.isSourceForeground("adr"), false);
  state.session.hiddenAuxiliaryPanels.add("newsSentiment");

  state.session.hiddenAuxiliaryPanels.delete("adr");
  assert.equal(policy.isSourceForeground("adr"), true);
});

test("automatic refresh omits sources that are not needed by the active view", () => {
  const tasks = ["macro", "credit", "adr"].map((source) => ({ source, task: () => source }));
  const automatic = partitionRuntimeRefreshSources(tasks, {
    isForeground: (source) => source === "macro",
  });
  assert.deepEqual(automatic.foreground.map(({ source }) => source), ["macro"]);
  assert.deepEqual(automatic.deferred, []);

  const explicit = partitionRuntimeRefreshSources(tasks, {
    includeDeferred: true,
    isForeground: (source) => source === "macro",
  });
  assert.deepEqual(explicit.foreground.map(({ source }) => source), ["macro"]);
  assert.deepEqual(explicit.deferred.map(({ source }) => source), ["credit", "adr"]);
});

test("one source plan removes fresh and duplicate work before execution", () => {
  const task = () => true;
  const plan = planRuntimeRefreshSources([
    { source: "macro", task },
    { source: "macro", task },
    { source: "credit", task },
    { source: "adr", task },
  ], {
    includeDeferred: true,
    isForeground: (source) => source !== "adr",
    shouldRefresh: (source) => source !== "credit",
  });

  assert.deepEqual(plan.foreground.map(({ source }) => source), ["macro"]);
  assert.deepEqual(plan.deferred.map(({ source }) => source), ["adr"]);
  assert.deepEqual(plan.skipped.map(({ source, reason }) => [source, reason]), [
    ["macro", "duplicate"],
    ["credit", "fresh"],
  ]);
});

test("hidden stock refresh only runs when explicitly requested", () => {
  assert.equal(shouldScheduleHiddenStockRefresh({}), false);
  assert.equal(shouldScheduleHiddenStockRefresh({ forceNetwork: true }), false);
  assert.equal(shouldScheduleHiddenStockRefresh({ refreshHidden: true }), true);
});

test("a superseded source request does not create provider backoff", async () => {
  let failures = 0;
  const revisions = {
    price: 1,
    macro: 1,
    credit: 1,
    crisis: 1,
    adr: 1,
    disclosure: 1,
  };
  const abortError = new Error("superseded");
  abortError.name = "AbortError";
  const orchestrator = createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges: async () => ({
      revisionsAfter: revisions,
      mainDataChanged: false,
      priceDataChanged: false,
      derivedInputChanged: false,
      adrDataChanged: false,
      disclosureDataChanged: false,
    }),
    canUseDartGateway: () => false,
    cancelAdrFinalRetry: () => {},
    chartSession: { showDisclosures: false },
    getDataRevisions: () => revisions,
    isAbortError: (error) => error?.name === "AbortError",
    isSourceForeground: (source) => source === "macro",
    planCriticalRefresh: () => ({
      indices: { requiredTickers: [] },
      prices: { requiredTickers: [] },
    }),
    recordPerfSample: () => {},
    refreshEcosMacroFromGateway: async () => { throw abortError; },
    refreshSourceWithRetry: (_source, task) => task(),
    runRefreshPhases,
    runtimeDataApp: {
      canAttemptSource: () => ({ allowed: true }),
      notePhase: () => {},
      noteSourceFailure: () => { failures += 1; },
    },
    scheduleLastRuntimeSnapshotSave: () => {},
    setMessage: () => {},
    setRuntimeRefreshStatus: () => {},
    shouldRefreshSource: () => true,
    startPerfSample: () => 0,
    state: { disclosureRows: [], lastDisclosureTraceStats: { markers: 0 } },
    throwIfAborted: () => {},
  });

  await assert.rejects(() => orchestrator.run(null), { name: "AbortError" });
  assert.equal(failures, 0);
});

test("an already current critical plan performs no index or stock request", async () => {
  const calls = { bootstrap: 0, indices: 0, prices: 0 };
  const phases = [];
  const renderPhases = [];
  const revisions = Object.freeze({
    price: 1,
    macro: 1,
    credit: 1,
    crisis: 1,
    adr: 1,
    disclosure: 1,
  });
  const orchestrator = createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges: async (_before, options) => {
      renderPhases.push(options.phase);
      return {
        revisionsAfter: revisions,
        mainDataChanged: false,
        priceDataChanged: false,
        derivedInputChanged: false,
        adrDataChanged: false,
        disclosureDataChanged: false,
      };
    },
    canUseDartGateway: () => false,
    cancelAdrFinalRetry: () => {},
    chartSession: { showDisclosures: false },
    fetchCriticalRuntimeBootstrap: async () => { calls.bootstrap += 1; },
    getDataRevisions: () => revisions,
    isAbortError: () => false,
    isSourceForeground: () => false,
    planCriticalRefresh: () => ({
      indices: { requiredTickers: [] },
      prices: { requiredTickers: [] },
    }),
    preloadCustomStocks: async () => { calls.prices += 1; },
    recordPerfSample: () => {},
    refreshCoreIndexSeries: async () => { calls.indices += 1; },
    runRefreshPhases,
    runtimeDataApp: { notePhase: (phase) => phases.push(phase) },
    scheduleLastRuntimeSnapshotSave: () => {},
    setMessage: () => {},
    setRuntimeRefreshStatus: () => {},
    startPerfSample: () => 0,
    state: { disclosureRows: [], lastDisclosureTraceStats: { markers: 0 } },
    throwIfAborted: () => {},
  });

  await orchestrator.run(null);

  assert.deepEqual(calls, { bootstrap: 0, indices: 0, prices: 0 });
  assert.deepEqual(renderPhases, ["critical", "supplemental"]);
  assert.deepEqual(phases, ["criticalReady", "supplementalReady"]);
});

test("startup confirms visible prices before final signal inputs and timing", async () => {
  const events = [];
  let revisions = {
    price: 1,
    macro: 1,
    credit: 1,
    crisis: 1,
    adr: 1,
    disclosure: 1,
  };
  const applyChanges = createRuntimeRefreshChangeApplier({
    getDataRevisions: () => revisions,
    isAutoScale: () => true,
    isTimingVisible: () => true,
    markPendingAutoFit: () => {},
    requestMainRender: ({ updateClass }) => events.push(`render:${updateClass}`),
    waitForMainRender: async () => {},
  });
  const orchestrator = createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges: applyChanges,
    canUseDartGateway: () => false,
    cancelAdrFinalRetry: () => {},
    chartSession: { showDisclosures: false, showRecessionSignals: true },
    getDataRevisions: () => revisions,
    isAbortError: () => false,
    isSourceForeground: (source) => source === "macro",
    planCriticalRefresh: () => ({
      indices: { requiredTickers: [] },
      prices: { requiredTickers: ["005930.KS"] },
    }),
    preloadCustomStocks: async () => {
      events.push("fetch:price");
      revisions = { ...revisions, price: 2 };
      return { failedNames: [] };
    },
    recordPerfSample: () => {},
    refreshEcosMacroFromGateway: async () => {
      events.push("fetch:macro");
      revisions = { ...revisions, macro: 2 };
      return { applied: [] };
    },
    refreshSourceWithRetry: (_source, task) => task(),
    runRefreshPhases,
    runtimeDataApp: {
      canAttemptSource: () => ({ allowed: true }),
      notePhase: (phase) => events.push(`phase:${phase}`),
      noteSourceResult: () => {},
    },
    scheduleLastRuntimeSnapshotSave: () => {},
    setMessage: () => {},
    setRuntimeRefreshStatus: () => {},
    shouldRefreshSource: () => true,
    startPerfSample: () => 0,
    state: { disclosureRows: [], lastDisclosureTraceStats: { markers: 0 } },
    throwIfAborted: () => {},
  });

  await orchestrator.run(null, { awaitCriticalRender: true, awaitSupplementalRender: true });

  assert.deepEqual(events, [
    "fetch:price",
    "render:price",
    "phase:criticalReady",
    "fetch:macro",
    "phase:supplementalReady",
    "render:timing",
  ]);
});

test("manual refresh checks hidden macro and auxiliary sources after the visible phase", async () => {
  const refreshed = [];
  const fearGreedForceValues = [];
  const phases = [];
  const revisions = Object.freeze({
    price: 1,
    macro: 1,
    credit: 1,
    crisis: 1,
    adr: 1,
    disclosure: 1,
  });
  const orchestrator = createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges: async (_before, options) => ({
      revisionsAfter: revisions,
      mainDataChanged: false,
      priceDataChanged: false,
      derivedInputChanged: false,
      adrDataChanged: false,
      disclosureDataChanged: false,
      phase: options.phase,
    }),
    canUseDartGateway: () => false,
    cancelAdrFinalRetry: () => {},
    chartSession: { showDisclosures: false },
    getDataRevisions: () => revisions,
    isAbortError: () => false,
    isRetryableAdrRefreshError: () => false,
    isSourceForeground: () => false,
    planCriticalRefresh: () => ({
      indices: { requiredTickers: [] },
      prices: { requiredTickers: [] },
    }),
    preloadCustomStocks: async () => ({ failedNames: [] }),
    recordPerfSample: () => {},
    refreshAdrFromWebWithRetry: async () => { refreshed.push("adr"); return { changed: 0 }; },
    refreshCreditFromGateway: async () => { refreshed.push("credit"); return { applied: [] }; },
    refreshCrisisSignalFromGateway: async () => { refreshed.push("crisis"); return { applied: [] }; },
    refreshEcosMacroFromGateway: async () => { refreshed.push("macro"); return { applied: [] }; },
    refreshFearGreedFromWeb: async (_signal, forceNetwork) => {
      refreshed.push("fearGreed");
      fearGreedForceValues.push(forceNetwork);
      return { added: 0 };
    },
    refreshSourceWithRetry: (_source, task) => task(),
    runRefreshPhases,
    runtimeDataApp: {
      canAttemptSource: () => ({ allowed: true }),
      notePhase: (phase) => phases.push(phase),
      noteSourceResult: () => {},
    },
    scheduleAdrFinalRetry: () => {},
    scheduleLastRuntimeSnapshotSave: () => {},
    setMessage: () => {},
    setRuntimeRefreshStatus: () => {},
    shouldRefreshSource: () => true,
    startPerfSample: () => 0,
    state: { disclosureRows: [], lastDisclosureTraceStats: { markers: 0 } },
    throwIfAborted: () => {},
  });

  await orchestrator.run(null, { forceNetwork: true });

  assert.deepEqual(refreshed.sort(), ["adr", "credit", "crisis", "fearGreed", "macro"]);
  assert.deepEqual(fearGreedForceValues, [true]);
  assert.deepEqual(phases, ["criticalReady", "supplementalReady", "deferredReady"]);
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

test("one main refresh absorbs simultaneous auxiliary and disclosure rendering", () => {
  assert.deepEqual(planRuntimeRefreshRendering(
    { price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 },
    { price: 2, macro: 1, credit: 1, crisis: 1, adr: 2, disclosure: 2 },
  ), {
    mainDataChanged: true,
    priceDataChanged: true,
    derivedInputChanged: true,
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
    priceDataChanged: false,
    derivedInputChanged: true,
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
  const forgottenPriceClaims = [];
  let snapshotSchedules = 0;
  const renderOptions = [];
  const revisions = Object.freeze({ price: 1, macro: 1, credit: 1, crisis: 1, adr: 1, disclosure: 1 });
  const orchestrator = createRuntimeRefreshOrchestrator({
    applyRuntimeRefreshChanges: async (_revisions, options) => {
      renderOptions.push(options);
      return ({
      revisionsAfter: revisions,
      mainDataChanged: false,
      priceDataChanged: false,
      derivedInputChanged: false,
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
    forgetStockPriceRefresh: (tickers) => forgottenPriceClaims.push(...tickers),
    planCriticalRefresh: () => ({
      indices: { requiredTickers: ["^KS11", "^KQ11"] },
      prices: { requiredTickers: ["005930.KS"] },
    }),
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
    {
      awaitMainRender: false,
      awaitAuxiliaryRender: false,
      pendingDerivedInputChanged: false,
      phase: "critical",
      finalizeDerived: false,
    },
    {
      awaitMainRender: true,
      awaitAuxiliaryRender: true,
      pendingDerivedInputChanged: false,
      phase: "supplemental",
      finalizeDerived: true,
      forceDerivedFinalize: true,
    },
  ]);
  assert.equal(progress.at(-1).percent, 96);
  assert.equal(messages.some((line) => line.includes("price HTTP 503")), true);
  assert.equal(messages.some((line) => line.includes("KRX 지수 갱신 오류: HTTP 503")), true);
  assert.deepEqual(forgottenPriceClaims, ["005930.KS"]);
});
