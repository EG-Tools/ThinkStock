import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/app-ui-bindings.js");
const bindings = globalThis.ThinkStockAppUiBindings;


function fakeElement(dataset = {}) {
  const listeners = new Map();
  const classes = new Set();
  return {
    dataset,
    disabled: false,
    value: "",
    title: "",
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
    getAttribute(name) {
      return this[name] ?? null;
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatch(name, event) {
      const listener = listeners.get(name);
      if (listener) return listener(event);
      return name === "click" ? this.onclick?.() : undefined;
    },
  };
}


test("chart range controls select presets and slide to the latest window", () => {
  const sixMonthsButton = fakeElement({ months: "6" });
  const oneYearButton = fakeElement({ months: "12" });
  const latestButton = fakeElement();
  const calls = [];
  const controller = bindings.bindChartRangeControls({
    rangeButtons: [sixMonthsButton, oneYearButton],
    latestButton,
    selectMonths: (months, source) => {
      calls.push(["range", months, source]);
      return true;
    },
    jumpLatest: (source) => {
      calls.push(["latest", source]);
      return true;
    },
  });

  sixMonthsButton.dispatch("click");
  oneYearButton.dispatch("click");
  latestButton.dispatch("click");
  controller.selectMonths(36);
  controller.jumpLatest();
  assert.deepEqual(calls, [
    ["range", 6, "range-preset"],
    ["range", 12, "range-preset"],
    ["latest", "latest-slide"],
    ["range", 36, "range-preset"],
    ["latest", "latest-slide"],
  ]);
});


test("chart tools toggle hides controls without changing their feature states", () => {
  const button = fakeElement();
  const container = fakeElement();
  let enabled = true;
  let saved = 0;
  bindings.bindChartToolsToggle({
    button,
    container,
    getEnabled: () => enabled,
    setEnabled: (value) => { enabled = value; },
    saveState: () => { saved += 1; },
  });

  assert.equal(button["aria-pressed"], "true");
  assert.equal(container.classList.contains("tools-hidden"), false);
  button.dispatch("click");
  assert.equal(enabled, false);
  assert.equal(button["aria-pressed"], "false");
  assert.equal(container.classList.contains("tools-hidden"), true);
  assert.equal(saved, 1);
  button.dispatch("click");
  assert.equal(enabled, true);
  assert.equal(container.classList.contains("tools-hidden"), false);
  assert.equal(saved, 2);
});


test("main chart tool actions share scale, co-movement, and handle state transitions", async () => {
  const scaleButton = fakeElement();
  const coMovementButton = fakeElement();
  const handlesButton = fakeElement();
  const state = {
    autoChartReset: false,
    showCoMovement: false,
    showChartHandles: true,
    pinnedXRange: null,
  };
  const calls = [];
  bindings.bindMainChartToolActions({
    state,
    scaleButton,
    coMovementButton,
    handlesButton,
    canUseCoMovement: () => true,
    setAutoScale: (enabled) => { state.autoChartReset = enabled; calls.push("scale"); },
    syncScale: () => calls.push("sync-scale"),
    syncCoMovement: () => calls.push("sync-co"),
    renderCoMovement: () => calls.push("render-co"),
    getVisibleRange: () => [Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1)],
    applyHandlesLayout: () => calls.push("handles"),
    saveState: () => calls.push("save"),
    requestChartRender: () => calls.push("render-chart"),
  });

  scaleButton.dispatch("click");
  coMovementButton.dispatch("click");
  handlesButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.autoChartReset, true);
  assert.equal(state.showCoMovement, true);
  assert.equal(state.showChartHandles, false);
  assert.deepEqual(state.pinnedXRange, [
    "2026-01-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z",
  ]);
  assert.deepEqual(calls, [
    "scale", "sync-scale", "save", "render-chart",
    "save", "sync-co", "render-co",
    "save", "handles",
  ]);
});


test("main chart control view renders shared button state from the chart session", () => {
  const elements = new Map([
    ["resetHandles", fakeElement()],
    ["chartHandlesToggle", fakeElement()],
    ["recessionToggle", fakeElement()],
    ["coMovementToggle", fakeElement()],
  ]);
  const state = {
    autoChartReset: true,
    cursorLineMode: "vertical",
    newsSentimentMovingAverageDays: 1,
    showChartHandles: false,
    showRecessionSignals: true,
    showCoMovement: true,
  };
  const view = bindings.createMainChartControlView({
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  }, {
    state,
    controlStateView: {
      syncControl(button, next) {
        button?.classList.toggle("is-active", Boolean(next.active));
        if (next.pressed !== undefined) button?.setAttribute("aria-pressed", String(next.pressed));
        if (next.title !== undefined && button) button.title = next.title;
        return next;
      },
      syncChoiceControls: () => 0,
    },
    getSignalCounts: () => ({ buy: 2, sell: 3, recession: 1 }),
    resolveCoMovementTarget: () => "005930.KS",
    labelName: () => "삼성전자",
  });

  view.syncScale();
  view.syncHandles();
  view.syncSignal();
  view.syncCoMovement();
  assert.equal(elements.get("resetHandles")["aria-pressed"], "true");
  assert.equal(elements.get("chartHandlesToggle")["aria-pressed"], "false");
  assert.match(elements.get("recessionToggle").title, /매수 2/);
  assert.match(elements.get("coMovementToggle").title, /삼성전자/);
});


test("disclosure toggle applies its fast path before rendering", () => {
  const button = fakeElement();
  let enabled = true;
  let hidden = 0;
  let disabled = 0;
  let rendered = 0;
  bindings.bindDisclosureToggle({
    button,
    getEnabled: () => enabled,
    setEnabled: (value) => { enabled = value; },
    markerCount: () => 3,
    syncButton: () => {},
    hidePopover: () => { hidden += 1; },
    onDisabled: () => { disabled += 1; },
    saveState: () => {},
    applyFastState: () => true,
    requestChartRender: () => { rendered += 1; },
  });

  button.dispatch("click");
  assert.equal(enabled, false);
  assert.equal(hidden, 1);
  assert.equal(disabled, 1);
  assert.equal(rendered, 0);
});


test("disclosure toggle starts background preparation when enabled", () => {
  const button = fakeElement();
  let enabled = false;
  let prepared = 0;
  bindings.bindDisclosureToggle({
    button,
    getEnabled: () => enabled,
    setEnabled: (value) => { enabled = value; },
    markerCount: () => 0,
    syncButton: () => {},
    hidePopover: () => {},
    onEnabled: () => { prepared += 1; },
    saveState: () => {},
    applyFastState: () => true,
    requestChartRender: () => {},
  });

  button.dispatch("click");
  assert.equal(enabled, true);
  assert.equal(prepared, 1);
});


test("prepared toggle coalesces clicks and commits state after preparation", async () => {
  const button = fakeElement();
  let enabled = false;
  let resolvePreparation;
  const preparation = new Promise((resolve) => { resolvePreparation = resolve; });
  const calls = [];
  const bound = bindings.bindPreparedToggle({
    button,
    getEnabled: () => enabled,
    setEnabled: (value) => { enabled = value; calls.push(["state", value]); },
    prepare: () => preparation,
    syncButton: () => calls.push(["sync", enabled]),
    onChanged: (value) => calls.push(["changed", value]),
  });
  assert.equal(bound, true);
  assert.equal(button.dataset.bound, "1");
  assert.equal(typeof button.onclick, "function");
  assert.equal(bindings.bindPreparedToggle({ button }), false);

  const firstClick = button.dispatch("click");
  const secondClick = button.dispatch("click");
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(enabled, false);
  resolvePreparation();
  await Promise.all([firstClick, secondClick]);
  assert.equal(enabled, true);
  assert.equal(button.getAttribute("aria-busy"), "false");
  assert.deepEqual(calls, [
    ["sync", false],
    ["state", true],
    ["sync", true],
    ["changed", true],
  ]);
});


test("prepared toggle keeps disabled state when preparation fails", async () => {
  const button = fakeElement();
  let enabled = false;
  let errors = 0;
  bindings.bindPreparedToggle({
    button,
    getEnabled: () => enabled,
    setEnabled: (value) => { enabled = value; },
    prepare: async () => { throw new Error("failed"); },
    onError: () => { errors += 1; },
  });

  await button.dispatch("click");
  assert.equal(enabled, false);
  assert.equal(errors, 1);
  assert.equal(button.getAttribute("aria-busy"), "false");
});


test("manual refresh always clears the spinning state", async () => {
  const button = fakeElement();
  const loadCalls = [];
  bindings.bindManualRefresh({
    button,
    setMessage: () => {},
    hasServiceWorkerController: () => true,
    requestServiceWorkerDataRefresh: async () => ({ ok: true }),
    hasRuntimeDataLoaded: () => true,
    loadData: async (...args) => loadCalls.push(args),
    loadLastRuntimeSnapshot: async () => false,
    renderChart: async () => {},
    refreshRuntimeData: async () => {},
  });

  await button.dispatch("click");
  assert.deepEqual(loadCalls, [[false, { mergeWithExisting: true }]]);
  assert.equal(button.classList.contains("spinning"), false);
});


test("stock selection view keeps suggestion state and delegated actions in one binding", () => {
  const container = fakeElement();
  const suggestionList = fakeElement();
  container.innerHTML = "";
  suggestionList.innerHTML = "";
  suggestionList.hidden = true;
  container.contains = () => true;
  suggestionList.contains = () => true;
  suggestionList.querySelectorAll = () => [];
  const document = {
    getElementById(id) {
      return id === "customStockButtons" ? container : suggestionList;
    },
  };
  const removed = [];
  const selected = [];
  const view = bindings.createStockSelectionView({ document }, {
    escapeHtml: (value) => String(value),
    seriesColor: () => "#123456",
    onRemove: (ticker) => removed.push(ticker),
    onSuggestion: (item) => selected.push(item.ticker),
  });

  assert.equal(view.renderStocks([{ ticker: "005930.KS", name: "삼성전자" }]), 1);
  assert.match(container.innerHTML, /005930\.KS/);
  assert.equal(view.renderSuggestions([
    { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
    { ticker: "000660.KS", name: "SK하이닉스", code: "000660", market: "KOSPI" },
  ]), 2);
  assert.equal(suggestionList.hidden, false);
  assert.equal(view.moveSuggestion(1), 0);
  assert.equal(view.moveSuggestion(1), 1);
  assert.equal(view.activeSuggestion().ticker, "000660.KS");

  container.dispatch("click", {
    target: {
      closest: () => ({ dataset: { removeSeries: "005930.KS" } }),
    },
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(removed, ["005930.KS"]);

  const suggestionButton = { dataset: { suggestIdx: "0" } };
  suggestionList.dispatch("click", {
    target: { closest: () => suggestionButton },
  });
  assert.deepEqual(selected, ["005930.KS"]);
  view.hideSuggestions();
  assert.equal(view.suggestionCount(), 0);
  assert.equal(suggestionList.hidden, true);
});
