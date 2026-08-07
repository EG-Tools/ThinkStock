import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-visual-frame.js");
const visualFrame = globalThis.ThinkStockChartVisualFrame;

test("coalesces series, marker, and handle invalidations into one frame", () => {
  let callback = null;
  const frames = [];
  const coordinator = visualFrame.createCoordinator({}, {
    requestFrame: (next) => {
      callback = next;
      return 1;
    },
    cancelFrame: () => {},
    applyFrame: (frame) => frames.push(frame),
  });

  coordinator.schedule({ seriesKey: "005930.KS", traceIndex: 0, handles: true, reason: "line-drag" });
  coordinator.schedule({ seriesKey: "005930.KS", traceIndex: 2, markers: true, reason: "line-drag" });
  coordinator.schedule({ seriesKey: "000660.KS", traceIndex: 1, markers: true, reason: "scale-drag" });
  callback();

  assert.deepEqual(frames, [{
    series: [
      { seriesKey: "005930.KS", traceIndex: 2 },
      { seriesKey: "000660.KS", traceIndex: 1 },
    ],
    markers: true,
    handles: true,
    reasons: ["line-drag", "scale-drag"],
  }]);
  assert.equal(coordinator.hasPending(), false);
});

test("flush applies a pending marker-only frame immediately", () => {
  let cancelled = 0;
  const frames = [];
  const coordinator = visualFrame.createCoordinator({}, {
    requestFrame: () => 7,
    cancelFrame: (id) => { cancelled = id; },
    applyFrame: (frame) => frames.push(frame),
  });

  coordinator.schedule({ markers: true, handles: true, reason: "axis-range" });
  const frame = coordinator.flush();

  assert.equal(cancelled, 7);
  assert.deepEqual(frame, {
    series: [],
    markers: true,
    handles: true,
    reasons: ["axis-range"],
  });
  assert.deepEqual(frames, [frame]);
});
