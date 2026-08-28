import assert from "node:assert/strict";
import test from "node:test";


import * as controllerModule from "../../docs/modules/chart-interaction-controller.mjs";


test("coalesces pointer moves and reuses geometry within the cache window", () => {
  let frameCallback = null;
  let timestamp = 100;
  let geometryReads = 0;
  const frames = [];
  const element = { _fullLayout: { xaxis: {}, yaxis: {} } };
  const controller = controllerModule.createPointerFrameController({}, {
    requestFrame: (callback) => {
      frameCallback = callback;
      return 1;
    },
    cancelFrame: () => {},
    now: () => timestamp,
    readGeometry: () => {
      geometryReads += 1;
      return { id: geometryReads };
    },
    processFrame: (payload) => frames.push(payload),
    geometryTtlMs: 200,
    hitTestIntervalMs: 50,
  });

  controller.schedule({ sourceEl: element, clientX: 10, findLineTarget: true });
  controller.schedule({ sourceEl: element, clientX: 20, findLineTarget: true });
  frameCallback();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].clientX, 20);
  assert.equal(frames[0].runHitTest, true);
  assert.equal(geometryReads, 1);

  timestamp = 120;
  controller.schedule({ sourceEl: element, clientX: 30, findLineTarget: true });
  frameCallback();
  assert.equal(frames[1].runHitTest, false);
  assert.equal(geometryReads, 1);

  timestamp = 360;
  controller.schedule({ sourceEl: element, clientX: 40, findLineTarget: true });
  frameCallback();
  assert.equal(frames[2].runHitTest, true);
  assert.equal(geometryReads, 2);
});

test("pointer drag uses the latest coalesced sample and cleans up on cancel", () => {
  const listeners = new Map();
  const target = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const moves = [];
  const endings = [];
  const session = controllerModule.bindPointerDrag(target, {
    pointerId: 9,
    onMove: (clientY) => moves.push(clientY),
    onEnd: (clientY, event, cancelled) => endings.push({ clientY, cancelled }),
  });

  listeners.get("pointermove")({
    pointerId: 9,
    preventDefault() {},
    getCoalescedEvents: () => [{ clientY: 10 }, { clientY: 24 }],
  });
  listeners.get("pointercancel")({ pointerId: 9, clientY: 30 });

  assert.deepEqual(moves, [24]);
  assert.deepEqual(endings, [{ clientY: 24, cancelled: true }]);
  assert.equal(session.isActive(), false);
  assert.equal(listeners.size, 0);
});

test("latest-frame scheduler applies only the newest drag range and flushes the final position", () => {
  let frameCallback = null;
  let cancelled = 0;
  const applied = [];
  const scheduler = controllerModule.createLatestFrameScheduler({}, (value) => applied.push(value), {
    requestFrame: (callback) => { frameCallback = callback; return 7; },
    cancelFrame: () => { cancelled += 1; },
  });

  scheduler.schedule([1, 2]);
  scheduler.schedule([3, 4]);
  frameCallback();
  assert.deepEqual(applied, [[3, 4]]);
  assert.equal(scheduler.stats().coalesced, 1);

  scheduler.schedule([5, 6]);
  scheduler.schedule([7, 8]);
  scheduler.flush();
  assert.deepEqual(applied, [[3, 4], [7, 8]]);
  assert.equal(cancelled, 1);
  assert.equal(scheduler.hasPending(), false);
});

test("series transform controller shares move, commit, and marker restore lifecycle", () => {
  const listeners = new Map();
  const target = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const calls = [];
  const controller = controllerModule.createSeriesTransformDragController({
    target,
    beginInteraction: () => { calls.push("begin"); return [1, 2]; },
    endInteraction: (payload) => calls.push(["end", payload.lockedXRange]),
    scheduleFrame: (_traceIndex, _seriesKey, options) => calls.push(["frame", options.commit]),
    restoreMarkers: () => calls.push("restore"),
  });
  controller.start({
    pointerId: 4,
    startClientY: 10,
    traceIndex: 2,
    seriesKey: "005930.KS",
    applyValue: (clientY) => calls.push(["value", clientY]),
    onCommit: () => calls.push("commit"),
  });

  listeners.get("pointermove")({ pointerId: 4, clientY: 20, preventDefault() {} });
  listeners.get("pointerup")({ pointerId: 4, clientY: 24 });
  assert.deepEqual(calls, [
    "begin",
    ["value", 20],
    ["frame", false],
    ["end", [1, 2]],
    ["value", 24],
    ["frame", true],
    "commit",
    "restore",
  ]);
});

test("series transform controller routes taps through the shared click path", () => {
  const listeners = new Map();
  const target = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: () => {},
  };
  const calls = [];
  const controller = controllerModule.createSeriesTransformDragController({
    target,
    beginInteraction: () => null,
    endInteraction: () => calls.push("end"),
    scheduleFrame: () => calls.push("frame"),
    restoreMarkers: () => calls.push("restore"),
  });
  controller.start({
    pointerId: 5,
    startClientY: 10,
    onClick: () => calls.push("click"),
  });
  listeners.get("pointerup")({ pointerId: 5, clientY: 11 });
  assert.deepEqual(calls, ["end", "click", "restore"]);
});
