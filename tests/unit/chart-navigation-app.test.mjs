import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-viewport-controller.js");
await import("../../docs/modules/chart-navigation-app.js");

const viewport = globalThis.ThinkStockChartViewportController;
const { createChartNavigation } = globalThis.ThinkStockChartNavigationApp;

function fakeElement() {
  const classes = new Set();
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
}

test("chart navigation applies centered zoom through one range callback", () => {
  const element = fakeElement();
  const applied = [];
  const navigation = createChartNavigation({}, {
    viewport,
    dayMs: 1,
    minimumSpan: 100,
    getElement: () => element,
    getCurrentRange: () => [200, 800],
    getDataRange: () => [0, 1000],
    isHistoryReady: () => true,
    isAutoScale: () => true,
    applyRange: (...args) => applied.push(args),
  });

  assert.equal(navigation.zoom(-1, "unit-zoom"), true);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].slice(0, 2), [260, 740]);
  assert.deepEqual(applied[0][2], { source: "unit-zoom", fit: false, liveFit: true });
});

test("rapid wheel input accumulates from the latest requested range", () => {
  const applied = [];
  const navigation = createChartNavigation({}, {
    viewport,
    dayMs: 1,
    minimumSpan: 100,
    getElement: fakeElement,
    getCurrentRange: () => [200, 800],
    getDataRange: () => [0, 1000],
    isHistoryReady: () => true,
    applyRange: (...args) => {
      applied.push(args);
      return true;
    },
  });

  navigation.zoom(-1, "wheel-zoom");
  navigation.zoom(-1, "wheel-zoom");
  assert.deepEqual(applied.map((entry) => entry.slice(0, 2)), [
    [260, 740],
    [308, 692],
  ]);
});

test("wheel input discards a queued range after an external viewport change", () => {
  const applied = [];
  const message = { ...fakeElement(), textContent: "", hidden: true };
  let currentRange = [200, 800];
  const navigation = createChartNavigation({}, {
    viewport,
    dayMs: 1,
    minimumSpan: 100,
    getElement: fakeElement,
    getMessageElement: () => message,
    getCurrentRange: () => [...currentRange],
    getDataRange: () => [0, 1000],
    isHistoryReady: () => true,
    applyRange: (...args) => {
      applied.push(args);
      return true;
    },
  });

  navigation.zoom(-1, "wheel-zoom");
  currentRange = [0, 1000];
  navigation.zoom(1, "wheel-zoom");

  assert.equal(applied.length, 1);
  assert.equal(message.textContent, "기간을 더 이상 늘릴 수 없습니다.");

  currentRange = [900, 1000];
  navigation.zoom(-1, "wheel-zoom");
  assert.equal(applied.length, 1);
  assert.equal(message.textContent, "기간을 더 이상 줄일 수 없습니다.");
});

test("chart messages stay solid for three seconds and fade for two", () => {
  const message = { ...fakeElement(), textContent: "", hidden: true };
  const timers = [];
  const navigation = createChartNavigation({}, {
    viewport,
    getElement: fakeElement,
    getMessageElement: () => message,
    getCurrentRange: () => [0, 1000],
    applyRange: () => {},
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
  });

  navigation.showMessage("AI 계산 불가");

  assert.equal(message.hidden, false);
  assert.deepEqual(timers.map(({ delay }) => delay), [3000, 5000]);
  timers[0].callback();
  assert.equal(message.classList.contains("is-fading"), true);
  timers[1].callback();
  assert.equal(message.hidden, true);
});

test("full-history preparation is shared by concurrent navigation requests", async () => {
  let loads = 0;
  let release;
  const loading = new Promise((resolve) => { release = resolve; });
  const navigation = createChartNavigation({}, {
    viewport,
    getElement: fakeElement,
    getCurrentRange: () => [100, 200],
    getDataRange: () => [0, 300],
    isHistoryReady: () => false,
    loadHistory: async () => { loads += 1; await loading; },
    applyRange: () => {},
  });

  const first = navigation.ensureHistoryReady();
  const second = navigation.ensureHistoryReady();
  assert.equal(loads, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("latest navigation animates the current span to the data boundary", () => {
  const element = fakeElement();
  const frames = [];
  const applied = [];
  let dragging = false;
  const navigation = createChartNavigation({}, {
    viewport,
    dayMs: 1,
    getElement: () => element,
    getCurrentRange: () => [0, 600_000],
    getDataRange: () => [0, 1_000_000],
    isInteractionBusy: () => false,
    isAutoScale: () => true,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    applyRange: (...args) => applied.push(args),
    setViewportDragging: (value) => { dragging = value; },
  });

  assert.equal(navigation.slideToLatest(), true);
  assert.equal(dragging, true);
  assert.equal(element.classList.contains("is-viewport-panning"), true);
  frames.shift()(0);
  frames.shift()(1000);
  assert.equal(dragging, false);
  assert.deepEqual(applied.at(-1).slice(0, 2), [400_000, 1_000_000]);
  assert.equal(element.classList.contains("is-viewport-panning"), false);
});

test("latest navigation advances on its first delayed browser frame", () => {
  const element = fakeElement();
  const frames = [];
  const applied = [];
  const navigation = createChartNavigation({
    performance: { now: () => 100 },
  }, {
    viewport,
    dayMs: 1,
    getElement: () => element,
    getCurrentRange: () => [0, 600_000],
    getDataRange: () => [0, 1_000_000],
    isInteractionBusy: () => false,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    applyRange: (...args) => applied.push(args),
    setViewportDragging: () => {},
  });

  assert.equal(navigation.slideToLatest(), true);
  frames.shift()(180);
  assert.equal(applied.length, 1);
  assert.ok(applied[0][0] > 0);
  assert.ok(applied[0][1] > 600_000);
});
