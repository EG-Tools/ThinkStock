import assert from "node:assert/strict";
import test from "node:test";

import { createChartRenderTelemetry } from "../../docs/modules/performance-monitor.mjs";

test("records render modes, causes, duration, and fallback paths", () => {
  let timestamp = 10;
  const telemetry = createChartRenderTelemetry({
    performance: { now: () => timestamp },
  });
  const token = telemetry.begin({
    updateClasses: ["viewport", "marker"],
    traceCount: 4,
    seriesCount: 1,
    overlayCount: 3,
    pointCount: 4200,
  });
  timestamp = 18.4;
  telemetry.complete(token, { mode: "full", fallbacks: ["partial"] });
  const snapshot = telemetry.snapshot();

  assert.equal(snapshot.counts.full, 1);
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.averageMs.full, 8.4);
  assert.equal(snapshot.fallbacks.partial, 1);
  assert.equal(snapshot.fallbackRate, 1);
  assert.equal(snapshot.fullRenderRate, 1);
  assert.equal(snapshot.partialReuseRate, 0);
  assert.equal(snapshot.updateClasses.viewport, 1);
  assert.equal(snapshot.updateClasses.marker, 1);
  assert.deepEqual(snapshot.byUpdateClass.viewport, {
    skipped: 0,
    partial: 0,
    structural: 0,
    full: 1,
    total: 1,
  });
  assert.deepEqual(snapshot.byTraceBand["2-5"], {
    renders: 1,
    full: 1,
    averageMs: 8.4,
    maximumMs: 8.4,
    maximumPoints: 4200,
  });
  assert.deepEqual(snapshot.bySeriesBand["1"], {
    renders: 1,
    full: 1,
    averageMs: 8.4,
    maximumMs: 8.4,
    maximumOverlays: 3,
    maximumPoints: 4200,
  });
  assert.deepEqual(snapshot.recent[0], {
    transactionId: 0,
    requestCount: 1,
    mode: "full",
    durationMs: 8.4,
    traceCount: 4,
    seriesCount: 1,
    overlayCount: 3,
    pointCount: 4200,
    updateClasses: ["viewport", "marker"],
    fallbacks: ["partial"],
  });
});

test("keeps only a bounded recent render trail and classifies unknown updates", () => {
  let timestamp = 0;
  const telemetry = createChartRenderTelemetry({
    performance: { now: () => timestamp },
  }, { recentLimit: 2 });

  ["partial", "structural", "partial"].forEach((mode) => {
    const token = telemetry.begin();
    timestamp += 2;
    telemetry.complete(token, { mode });
  });
  const snapshot = telemetry.snapshot();

  assert.equal(snapshot.total, 3);
  assert.equal(snapshot.recent.length, 2);
  assert.equal(snapshot.updateClasses.unknown, 3);
  assert.equal(snapshot.byUpdateClass.unknown.partial, 2);
  assert.equal(snapshot.partialReuseRate, 1);
});

test("counts selective marker-only updates separately", () => {
  const telemetry = createChartRenderTelemetry({
    performance: { now: () => 1 },
  });
  telemetry.complete(telemetry.begin({ updateClasses: ["markers"] }), {
    mode: "partial",
    updateScope: "markers",
  });

  assert.deepEqual(telemetry.snapshot().updateScopes, { markers: 1 });
  assert.equal(telemetry.snapshot().recent[0].updateScope, "markers");
});

test("records unchanged render skips as successful reuse", () => {
  const telemetry = createChartRenderTelemetry({
    performance: { now: () => 1 },
  });
  telemetry.complete(telemetry.begin({ updateClasses: ["viewport"] }), {
    mode: "skipped",
    updateScope: "unchanged",
  });

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.counts.skipped, 1);
  assert.equal(snapshot.partialReuseRate, 1);
  assert.deepEqual(snapshot.updateScopes, { unchanged: 1 });
  assert.equal(snapshot.byUpdateClass.viewport.skipped, 1);
});
