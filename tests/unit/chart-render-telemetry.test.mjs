import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-render-telemetry.js");

test("records render modes, causes, duration, and fallback paths", () => {
  let timestamp = 10;
  const telemetry = globalThis.ThinkStockChartRenderTelemetry.createChartRenderTelemetry({
    performance: { now: () => timestamp },
  });
  const token = telemetry.begin({ updateClasses: ["viewport", "marker"] });
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
    partial: 0,
    structural: 0,
    full: 1,
    total: 1,
  });
  assert.deepEqual(snapshot.recent[0], {
    mode: "full",
    durationMs: 8.4,
    updateClasses: ["viewport", "marker"],
    fallbacks: ["partial"],
  });
});

test("keeps only a bounded recent render trail and classifies unknown updates", () => {
  let timestamp = 0;
  const telemetry = globalThis.ThinkStockChartRenderTelemetry.createChartRenderTelemetry({
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
  const telemetry = globalThis.ThinkStockChartRenderTelemetry.createChartRenderTelemetry({
    performance: { now: () => 1 },
  });
  telemetry.complete(telemetry.begin({ updateClasses: ["markers"] }), {
    mode: "partial",
    updateScope: "markers",
  });

  assert.deepEqual(telemetry.snapshot().updateScopes, { markers: 1 });
  assert.equal(telemetry.snapshot().recent[0].updateScope, "markers");
});
