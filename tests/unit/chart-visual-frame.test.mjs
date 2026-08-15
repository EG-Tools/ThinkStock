import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-update-coordinator.js");
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
    transactionId: 1,
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
    transactionId: 1,
    series: [],
    markers: true,
    handles: true,
    reasons: ["axis-range"],
  });
  assert.deepEqual(frames, [frame]);
});

test("serializes async visual frames instead of racing Plotly updates", async () => {
  const callbacks = [];
  const applied = [];
  let releaseFirst;
  const coordinator = visualFrame.createCoordinator({}, {
    requestFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
    cancelFrame: () => {},
    applyFrame: async (frame) => {
      applied.push(frame.transactionId);
      if (frame.transactionId === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
  });

  coordinator.schedule({ seriesKey: "A", reason: "drag" });
  callbacks.shift()();
  coordinator.schedule({ seriesKey: "B", reason: "drag" });
  assert.deepEqual(applied, [1]);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  callbacks.shift()();
  await coordinator.whenSettled();
  assert.deepEqual(applied, [1, 2]);
});
