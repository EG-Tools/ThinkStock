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
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatch: (name) => listeners.get(name)?.(),
  };
}


test("range binding restores the previous range after history failure", async () => {
  const button = fakeElement({ months: "360" });
  let activeMonths = 120;
  let rendered = 0;
  const messages = [];
  bindings.bindRangeButtons({
    buttons: [button],
    getActiveMonths: () => activeMonths,
    setActiveMonths: (value) => { activeMonths = value; },
    clearPinnedRange: () => {},
    syncButtons: () => {},
    recentDataMonths: 120,
    isHistoricalDataLoaded: () => false,
    ensureHistoricalDataLoaded: async () => { throw new Error("offline"); },
    setMessage: (message) => messages.push(message),
    saveState: () => {},
    requestChartRender: () => { rendered += 1; },
  });

  await button.dispatch("click");
  assert.equal(activeMonths, 120);
  assert.equal(button.disabled, false);
  assert.equal(rendered, 0);
  assert.match(messages.at(-1)[0], /offline/);
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
