import assert from "node:assert/strict";
import test from "node:test";

const previousDocument = globalThis.document;
const previousLocation = globalThis.location;
globalThis.document = { currentScript: null };
globalThis.location = { href: "http://localhost/" };
await import("../../docs/modules/chart-loader.js");
globalThis.document = previousDocument;
globalThis.location = previousLocation;

const loader = globalThis.ThinkStockChartLoader;

test("chart loader owns the shared Plotly config and hover styles", () => {
  assert.equal(loader.PLOTLY_CONFIG.doubleClick, false);
  assert.equal(loader.PLOTLY_CONFIG.displayModeBar, false);
  assert.equal(loader.hoverLabel(true, 11).font.size, 11);
  assert.equal(loader.hoverLabel(false).font.size, 1);
});

test("chart loader returns an already initialized Plotly instance", async () => {
  const plotly = {};
  globalThis.Plotly = plotly;
  try {
    assert.equal(await loader.ensurePlotlyReady(), plotly);
  } finally {
    delete globalThis.Plotly;
  }
});
