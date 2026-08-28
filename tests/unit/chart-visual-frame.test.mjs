import assert from "node:assert/strict";
import test from "node:test";

import * as visualFrame from "../../docs/modules/chart-update-coordinator.mjs";

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
  coordinator.schedule({
    seriesKey: "005930.KS",
    traceIndex: 2,
    markers: true,
    commit: true,
    reason: "line-drag",
  });
  coordinator.schedule({ seriesKey: "000660.KS", traceIndex: 1, markers: true, reason: "scale-drag" });
  callback();

  assert.deepEqual(frames, [{
    transactionId: 1,
    series: [
      { seriesKey: "005930.KS", traceIndex: 2, commit: true },
      { seriesKey: "000660.KS", traceIndex: 1 },
    ],
    markers: true,
    handles: true,
    reasons: ["line-drag", "scale-drag"],
  }]);
  assert.equal(coordinator.hasPending(), false);
  assert.deepEqual(coordinator.stats(), {
    scheduled: 3,
    coalesced: 1,
    applied: 1,
    seriesUpdates: 2,
    markerFrames: 1,
    handleFrames: 1,
    framePending: false,
    inFlight: false,
    pendingSeries: 0,
    pendingMarkers: false,
    pendingHandles: false,
  });
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

test("keeps dated markers constrained during live and committed series transforms", async () => {
  const restyles = [];
  const commits = [];
  let rebuilds = 0;
  const element = {
    data: [
      { meta: { seriesKey: "005930.KS" }, y: [1, 2] },
      { meta: { isDisclosureTrace: true }, y: [3] },
      { meta: { isGroupedHoverTrace: true, hoverGroupTicker: "005930.KS" }, y: [1, 2] },
    ],
  };
  const apply = visualFrame.createSeriesFrameApplier({
    getElement: () => element,
    getPlotly: () => ({
      restyle: async (_element, update, indexes) => restyles.push({ update, indexes }),
    }),
    resolveTraceIndex: () => 0,
    computeValues: () => [4, 5],
    collectMarkerUpdates: () => ({ traceIndexes: [1], yUpdates: [[6]] }),
    commitSeries: (series) => commits.push(series),
    groupedHoverUpdate: () => ({ traceIndex: 2, y: [4, 5] }),
    positionHandles: () => {},
    hasEventModel: () => true,
    appendEventUpdates: (_element, indexes, updates) => {
      rebuilds += 1;
      indexes.push(1);
      updates.push([7]);
      return { structureChanged: false, disclosureUpdated: true };
    },
  });

  await apply({
    series: [{ seriesKey: "005930.KS", traceIndex: 0 }],
    markers: true,
    handles: true,
  });
  assert.deepEqual(restyles.at(-1).indexes, [1, 0]);
  assert.deepEqual(commits, []);

  await apply({
    series: [{ seriesKey: "005930.KS", traceIndex: 0, commit: true }],
    markers: true,
    handles: true,
  });
  assert.deepEqual(restyles.at(-1).indexes, [1, 0, 2]);
  assert.deepEqual(commits, ["005930.KS"]);
  assert.equal(rebuilds, 0);
});

test("updates linked forecast overlays in the same live transform frame", async () => {
  const restyles = [];
  const element = {
    data: [
      { meta: { seriesKey: "005930.KS" }, y: [1, 2] },
      { meta: { overlayKind: "ai-scenario", seriesKey: "005930.KS" }, y: [2, 3] },
      { meta: { overlayKind: "ai-report", seriesKey: "005930.KS" }, y: [2.5] },
    ],
  };
  const apply = visualFrame.createSeriesFrameApplier({
    getElement: () => element,
    getPlotly: () => ({
      restyle: async (_element, update, indexes) => restyles.push({ update, indexes }),
    }),
    resolveTraceIndex: () => 0,
    computeValues: () => [4, 5],
    collectLinkedTraceUpdates: () => ({
      traceIndexes: [1, 2],
      yUpdates: [[5, 6], [5.5]],
    }),
  });

  await apply({ series: [{ seriesKey: "005930.KS", traceIndex: 0 }] });
  assert.deepEqual(restyles, [{
    update: { y: [[5, 6], [5.5], [4, 5]] },
    indexes: [1, 2, 0],
  }]);
});

test("compacts duplicate trace updates and keeps the final value", () => {
  assert.deepEqual(
    visualFrame.compactTraceYUpdates(
      [2, 1, 2, 0, 1],
      [[20], [10], [22], [0], [11]],
    ),
    {
      traceIndexes: [2, 1, 0],
      yUpdates: [[22], [11], [0]],
    },
  );
});

test("rebuilds event markers for an axis-only visual frame", async () => {
  const restyles = [];
  let rebuilds = 0;
  const element = {
    data: [{ meta: { isDisclosureTrace: true }, y: [3] }],
  };
  const apply = visualFrame.createSeriesFrameApplier({
    getElement: () => element,
    getPlotly: () => ({
      restyle: async (_element, update, indexes) => restyles.push({ update, indexes }),
    }),
    hasEventModel: () => true,
    appendEventUpdates: (_element, indexes, updates) => {
      rebuilds += 1;
      indexes.push(0);
      updates.push([8]);
      return { structureChanged: false, disclosureUpdated: true };
    },
    positionHandles: () => {},
  });

  await apply({ series: [], markers: true, handles: false });

  assert.equal(rebuilds, 1);
  assert.deepEqual(restyles, [{ update: { y: [[8]] }, indexes: [0] }]);
});

test("passes the resolved trace and chart element to pooled value transforms", async () => {
  const element = { data: [{ meta: { seriesKey: "A" }, y: [1] }] };
  const calls = [];
  const invalidated = [];
  const apply = visualFrame.createSeriesFrameApplier({
    getElement: () => element,
    getPlotly: () => ({ restyle: async () => {} }),
    resolveTraceIndex: () => 0,
    computeValues: (...args) => {
      calls.push(args);
      return [2];
    },
    invalidateRenderState: (target) => invalidated.push(target),
  });

  await apply({ series: [{ seriesKey: "A", traceIndex: 0 }] });
  assert.equal(calls[0][0], "A");
  assert.equal(calls[0][1], 0);
  assert.equal(calls[0][2], element);
  assert.deepEqual(invalidated, [element]);
});

test("positions handles after the Plotly restyle settles in the same visual frame", async () => {
  const element = { data: [{ meta: { seriesKey: "A" }, y: [1] }] };
  const events = [];
  const apply = visualFrame.createSeriesFrameApplier({
    getElement: () => element,
    restyle: async () => {
      events.push("restyle-start");
      await Promise.resolve();
      events.push("restyle-end");
    },
    resolveTraceIndex: () => 0,
    computeValues: () => [2],
    positionHandles: () => events.push("handles"),
  });

  await apply({ series: [{ seriesKey: "A", traceIndex: 0 }], handles: true });
  assert.deepEqual(events, ["restyle-start", "restyle-end", "handles"]);
});
