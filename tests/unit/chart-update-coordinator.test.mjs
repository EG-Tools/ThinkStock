import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-update-coordinator.js");

const { createChartUpdateCoordinator } = globalThis.ThinkStockChartUpdateCoordinator;
const { shouldUpdateAuxiliary } = globalThis.ThinkStockChartUpdateCoordinator;


test("skips auxiliary rendering for main-only marker, transform, and forecast updates", () => {
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["markers"] }), false);
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["transform", "forecast"] }), false);
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["viewport"] }), true);
  assert.equal(shouldUpdateAuxiliary({ updateClasses: ["markers", "data"] }), true);
  assert.equal(shouldUpdateAuxiliary({}), true);
});

test("composition updates prepare state once before requesting a render", () => {
  const calls = [];
  const coordinator = createChartUpdateCoordinator({}, {
    requestFrame: () => 1,
    requestRender: (preserveZoom, options) => calls.push(["render", preserveZoom, options.reason, options.updateClass]),
    prepareComposition: (forceFit) => calls.push(["prepare", forceFit]),
    applyResetPolicy: (change) => calls.push(["reset", change]),
    persistState: () => calls.push(["persist"]),
  });

  coordinator.requestComposition({ forceFitFull: true });
  assert.deepEqual(calls, [
    ["prepare", true],
    ["reset", "composition"],
    ["persist"],
    ["render", true, "composition", "composition"],
  ]);
});

test("event revisions coalesce and retry after an active render settles", () => {
  const frames = [];
  const renders = [];
  let rendering = true;
  const coordinator = createChartUpdateCoordinator({}, {
    eventLayers: ["disclosure", "insider"],
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    isEventLayerEnabled: () => true,
    isRendering: () => rendering,
    requestRender: (...args) => renders.push(args),
  });

  coordinator.queueEvent("disclosure");
  coordinator.queueEvent("disclosure");
  assert.equal(frames.length, 1);
  assert.deepEqual(coordinator.eventRevisions(), { disclosure: 2, insider: 0 });
  frames.shift()();
  assert.equal(renders.length, 0);
  assert.equal(coordinator.hasPendingEvents(), true);

  rendering = false;
  coordinator.flush();
  frames.shift()();
  assert.equal(renders.length, 1);
  const revisions = coordinator.eventRevisions();
  coordinator.markEventsApplied(revisions);
  assert.equal(coordinator.hasPendingEvents(), false);
});

test("event data uses a marker-only visual frame when the trace structure is stable", () => {
  const frames = [];
  const fullRenders = [];
  const callbacks = [];
  const coordinator = createChartUpdateCoordinator({}, {
    eventLayers: ["disclosure"],
    requestFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
    cancelFrame: () => {},
    isEventLayerEnabled: () => true,
    isRendering: () => false,
    requestMarkerFrame: (options) => frames.push(options),
    requestRender: (...args) => fullRenders.push(args),
  });

  coordinator.queueEvent("disclosure");
  callbacks.shift()();

  assert.deepEqual(frames, [{ reason: "event-marker-data", updateClass: "markers" }]);
  assert.deepEqual(fullRenders, []);
});
