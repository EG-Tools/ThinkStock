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
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatch: (name) => listeners.get(name)?.(),
  };
}


test("range stepper restores the previous range after history failure", async () => {
  const stepper = fakeElement();
  const expandButton = fakeElement();
  const contractButton = fakeElement();
  let activeMonths = 120;
  let rendered = 0;
  const messages = [];
  bindings.bindRangeStepper({
    stepper,
    expandButton,
    contractButton,
    presets: [6, 12, 36, 60, 120, 180, 240, 360],
    getActiveMonths: () => activeMonths,
    setActiveMonths: (value) => { activeMonths = value; },
    clearPinnedRange: () => {},
    recentDataMonths: 120,
    isHistoricalDataLoaded: () => false,
    ensureHistoricalDataLoaded: async () => { throw new Error("offline"); },
    setMessage: (message) => messages.push(message),
    saveState: () => {},
    requestChartRender: () => { rendered += 1; },
  });

  await expandButton.dispatch("click");
  assert.equal(activeMonths, 120);
  assert.equal(expandButton.disabled, false);
  assert.equal(stepper.dataset.months, "120");
  assert.equal(rendered, 0);
  assert.match(messages.at(-1)[0], /offline/);
});


test("range stepper expands, contracts, and disables the reached boundary", async () => {
  const stepper = fakeElement();
  const expandButton = fakeElement();
  const contractButton = fakeElement();
  let activeMonths = 6;
  let rendered = 0;
  bindings.bindRangeStepper({
    stepper,
    expandButton,
    contractButton,
    presets: [6, 12, 36],
    getActiveMonths: () => activeMonths,
    setActiveMonths: (value) => { activeMonths = value; },
    clearPinnedRange: () => {},
    recentDataMonths: 120,
    isHistoricalDataLoaded: () => true,
    ensureHistoricalDataLoaded: async () => {},
    setMessage: () => {},
    saveState: () => {},
    requestChartRender: () => { rendered += 1; },
  });

  assert.equal(contractButton.disabled, true);
  assert.equal(expandButton.dataset.targetMonths, "12");
  await expandButton.dispatch("click");
  assert.equal(activeMonths, 12);
  assert.equal(stepper.dataset.months, "12");
  await contractButton.dispatch("click");
  assert.equal(activeMonths, 6);
  assert.equal(contractButton.disabled, true);
  assert.equal(rendered, 2);
});


test("range stepper stays busy until the requested chart range finishes rendering", async () => {
  const stepper = fakeElement();
  const expandButton = fakeElement();
  const contractButton = fakeElement();
  let activeMonths = 240;
  let finishRender;
  const renderFinished = new Promise((resolve) => { finishRender = resolve; });
  bindings.bindRangeStepper({
    stepper,
    expandButton,
    contractButton,
    presets: [120, 240, 360],
    getActiveMonths: () => activeMonths,
    setActiveMonths: (value) => { activeMonths = value; },
    clearPinnedRange: () => {},
    recentDataMonths: 120,
    isHistoricalDataLoaded: () => true,
    ensureHistoricalDataLoaded: async () => {},
    setMessage: () => {},
    saveState: () => {},
    requestChartRender: () => renderFinished,
  });

  const movePromise = expandButton.dispatch("click");
  await Promise.resolve();
  assert.equal(activeMonths, 360);
  assert.equal(expandButton.disabled, true);
  assert.equal(contractButton.disabled, false);
  finishRender();
  await movePromise;
  assert.equal(contractButton.disabled, false);
});


test("range stepper keeps rapid clicks and renders the final requested period", async () => {
  const stepper = fakeElement();
  const expandButton = fakeElement();
  const contractButton = fakeElement();
  let activeMonths = 120;
  let finishRender;
  let renderCalls = 0;
  const firstRender = new Promise((resolve) => { finishRender = resolve; });
  bindings.bindRangeStepper({
    stepper,
    expandButton,
    contractButton,
    presets: [120, 180, 240, 360],
    getActiveMonths: () => activeMonths,
    setActiveMonths: (value) => { activeMonths = value; },
    clearPinnedRange: () => {},
    recentDataMonths: 120,
    isHistoricalDataLoaded: () => true,
    ensureHistoricalDataLoaded: async () => {},
    setMessage: () => {},
    saveState: () => {},
    requestChartRender: () => {
      renderCalls += 1;
      return renderCalls === 1 ? firstRender : Promise.resolve();
    },
  });

  const firstMove = expandButton.dispatch("click");
  await Promise.resolve();
  await expandButton.dispatch("click");
  await expandButton.dispatch("click");
  assert.equal(activeMonths, 360);
  finishRender();
  await firstMove;
  assert.equal(stepper.dataset.months, "360");
  assert.equal(renderCalls, 2);
});


test("history window keeps zoom anchored to the latest right edge", () => {
  assert.deepEqual(bindings.resolveHistoryWindow({
    minDate: "2020-01-31",
    maxDate: "2026-08-07",
    months: 6,
    position: 1,
  }), {
    start: "2026-02-07",
    end: "2026-08-07",
    position: 1,
    canNavigate: true,
  });
  assert.deepEqual(bindings.resolveHistoryWindow({
    minDate: "2020-01-31",
    maxDate: "2026-08-07",
    months: 6,
    position: 0,
  }), {
    start: "2020-01-31",
    end: "2020-07-31",
    position: 0,
    canNavigate: true,
  });
});


test("history slider updates the selected past position and requests a fitted render", () => {
  const slider = fakeElement();
  let position = 1;
  let renderedWith = null;
  let cleared = 0;
  const controller = bindings.bindHistorySlider({
    slider,
    getPosition: () => position,
    setPosition: (value) => { position = value; },
    clearPinnedRange: () => { cleared += 1; },
    isHistoricalDataLoaded: () => true,
    ensureHistoricalDataLoaded: async () => {},
    setMessage: () => {},
    saveState: () => {},
    requestChartRender: (preserveZoom) => { renderedWith = preserveZoom; },
  });

  controller.sync({ position: 0.4, start: "2021-01-01", end: "2021-07-01", canNavigate: true });
  assert.equal(slider.value, "400");
  slider.value = "250";
  slider.dispatch("input");
  assert.equal(position, 0.25);
  assert.equal(cleared, 1);
  assert.equal(renderedWith, false);
});

test("history slider pans an active zoom without resetting its history window", () => {
  const slider = fakeElement();
  let position = 1;
  let pannedTo = null;
  let cleared = 0;
  let rendered = 0;
  bindings.bindHistorySlider({
    slider,
    getPosition: () => position,
    setPosition: (value) => { position = value; },
    panViewport: (value) => { pannedTo = value; return true; },
    clearPinnedRange: () => { cleared += 1; },
    isHistoricalDataLoaded: () => true,
    ensureHistoricalDataLoaded: async () => {},
    setMessage: () => {},
    saveState: () => {},
    requestChartRender: () => { rendered += 1; },
  });

  slider.value = "350";
  slider.dispatch("input");
  assert.equal(pannedTo, 0.35);
  assert.equal(position, 1);
  assert.equal(cleared, 0);
  assert.equal(rendered, 0);
});


test("disclosure toggle applies its fast path before rendering", () => {
  const button = fakeElement();
  let enabled = true;
  let hidden = 0;
  let rendered = 0;
  bindings.bindDisclosureToggle({
    button,
    getEnabled: () => enabled,
    setEnabled: (value) => { enabled = value; },
    markerCount: () => 3,
    syncButton: () => {},
    hidePopover: () => { hidden += 1; },
    saveState: () => {},
    applyFastState: () => true,
    requestChartRender: () => { rendered += 1; },
  });

  button.dispatch("click");
  assert.equal(enabled, false);
  assert.equal(hidden, 1);
  assert.equal(rendered, 0);
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
