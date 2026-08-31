import assert from "node:assert/strict";
import test from "node:test";

import * as viewport from "../../docs/modules/chart-viewport-controller.mjs";
import { createChartNavigation } from "../../docs/modules/chart-navigation-app.mjs";

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

test("wheel zoom requests live vertical fitting while auto scale is on", () => {
  const applied = [];
  const navigation = createChartNavigation({}, {
    viewport,
    dayMs: 1,
    minimumSpan: 100,
    getElement: fakeElement,
    getCurrentRange: () => [200, 800],
    getDataRange: () => [0, 1000],
    isHistoryReady: () => true,
    isAutoScale: () => true,
    applyRange: (...args) => applied.push(args),
  });

  navigation.zoom(-1, "wheel-zoom");
  assert.equal(applied[0][2].liveFit, true);
});

test("smooth wheel zoom updates the linked viewport over animation frames", () => {
  const frames = [];
  const applied = [];
  const navigation = createChartNavigation({}, {
    viewport,
    dayMs: 1,
    minimumSpan: 100,
    getElement: fakeElement,
    getCurrentRange: () => [200, 800],
    getDataRange: () => [0, 1000],
    isHistoryReady: () => true,
    isAutoScale: () => true,
    smoothWheelZoom: true,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    applyRange: (...args) => {
      applied.push(args);
      return true;
    },
  });

  navigation.zoom(-1, "wheel-zoom");
  assert.equal(applied.length, 0);
  frames.shift()(0);
  frames.shift()(48);
  frames.shift()(96);

  assert.equal(applied.length, 3);
  assert.deepEqual(applied[0].slice(0, 2), [200, 800]);
  assert.ok(applied[1][0] > 200 && applied[1][0] < 260);
  assert.ok(applied[1][1] < 800 && applied[1][1] > 740);
  assert.deepEqual(applied[2].slice(0, 2), [260, 740]);
  assert.equal(applied[1][2].liveFit, true);
  assert.equal(applied[0][2].beginsInteraction, true);
  assert.equal(applied[1][2].beginsInteraction, false);
  assert.equal(applied[1][2].userInitiated, false);
  assert.equal(applied[2][2].userInitiated, true);
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

test("full-lifetime preparation refreshes an already loaded chart before reading its bounds", async () => {
  const calls = [];
  const navigation = createChartNavigation({}, {
    viewport,
    getElement: fakeElement,
    getCurrentRange: () => [100, 200],
    getDataRange: () => [0, 300],
    isHistoryReady: () => true,
    loadHistory: async () => calls.push("load"),
    afterHistoryLoaded: async (range) => calls.push(range),
    applyRange: () => {},
  });

  assert.equal(await navigation.ensureHistoryReady(true), true);
  assert.deepEqual(calls, ["load", [100, 200]]);
});

test("latest navigation animates the current span to the data boundary", async () => {
  const element = fakeElement();
  const frames = [];
  const applied = [];
  const renderRequests = [];
  const completionOrder = [];
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
    applyResetPolicy: () => { completionOrder.push("reset"); },
    requestRender: (request) => {
      completionOrder.push("render");
      renderRequests.push(request);
    },
    setViewportDragging: (value) => { dragging = value; },
  });

  assert.equal(navigation.slideToLatest(), true);
  assert.equal(dragging, true);
  assert.equal(element.classList.contains("is-viewport-panning"), true);
  frames.shift()(0);
  frames.shift()(1000);
  assert.equal(dragging, false);
  assert.deepEqual(applied.at(-1).slice(0, 2), [400_000, 1_000_000]);
  assert.equal(applied.filter(([start, end]) => start === 400_000 && end === 1_000_000).length, 1);
  assert.equal(element.classList.contains("is-viewport-panning"), false);
  await navigation.whenRangeSettled();
  assert.deepEqual(completionOrder, ["render"]);
  assert.deepEqual(renderRequests, [{
    preserveZoom: true,
    range: [400_000, 1_000_000],
    reason: "latest-slide",
    reframeNormalization: true,
    updateClass: "viewport",
  }]);
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

test("period presets keep the requested history before a right-side blank margin", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const latest = Date.parse("2026-08-01");
  const padding = 30 * dayMs;
  const applied = [];
  const renderRequests = [];
  const completionOrder = [];
  const navigation = createChartNavigation({}, {
    viewport,
    dayMs,
    getElement: fakeElement,
    getDataRange: () => [Date.parse("2020-01-01"), latest + padding],
    getRightPaddingMs: () => padding,
    toMilliseconds: Date.parse,
    shiftMonths: () => "2026-02-01",
    applyRange: (...args) => { applied.push(args); return true; },
    applyResetPolicy: () => completionOrder.push("reset"),
    requestRender: (request) => {
      completionOrder.push("render");
      renderRequests.push(request);
    },
  });

  assert.equal(navigation.showLatestPeriod(6), true);
  assert.deepEqual(applied[0].slice(0, 2), [
    Date.parse("2026-02-01"),
    latest + padding,
  ]);
  assert.deepEqual(renderRequests, [{
    preserveZoom: true,
    range: [
      Date.parse("2026-02-01"),
      latest + padding,
    ],
    reason: "range-preset",
    reframeNormalization: true,
    updateClass: "viewport-range",
  }]);
  assert.deepEqual(completionOrder, ["render"]);
});

test("a rejected period range does not queue a stale viewport render", () => {
  const renderRequests = [];
  const navigation = createChartNavigation({}, {
    viewport,
    getElement: fakeElement,
    getDataRange: () => [0, 1000],
    toMilliseconds: () => 200,
    shiftMonths: () => "ignored",
    applyRange: () => false,
    requestRender: (request) => renderRequests.push(request),
  });

  assert.equal(navigation.showLatestPeriod(6), true);
  assert.deepEqual(renderRequests, []);
});

test("period presets expose their buffered render completion", async () => {
  let completeRender;
  let settled = false;
  const navigation = createChartNavigation({}, {
    viewport,
    getElement: fakeElement,
    getDataRange: () => [0, 1000],
    toMilliseconds: () => 200,
    shiftMonths: () => "ignored",
    applyRange: () => true,
    requestRender: () => new Promise((resolve) => { completeRender = resolve; }),
  });

  assert.equal(navigation.showLatestPeriod(6), true);
  const wait = navigation.whenRangeSettled().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  completeRender();
  await wait;
  assert.equal(settled, true);
});
