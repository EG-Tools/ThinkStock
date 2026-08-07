import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/chart-interaction-controller.js");
const controllerModule = globalThis.ThinkStockChartInteractionController;


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
