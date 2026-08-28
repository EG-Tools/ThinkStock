import assert from "node:assert/strict";
import test from "node:test";

const previousDocument = globalThis.document;
const previousLocation = globalThis.location;
globalThis.document = { currentScript: null };
globalThis.location = { href: "http://localhost/" };
const { chartLoader: loader } = await import("../../docs/modules/chart-loader.mjs");
globalThis.document = previousDocument;
globalThis.location = previousLocation;

test("chart loader owns the shared Plotly config and hover styles", () => {
  assert.equal(loader.PLOTLY_CONFIG.doubleClick, false);
  assert.equal(loader.PLOTLY_CONFIG.displayModeBar, false);
  assert.equal(loader.PLOTLY_THEME.hoverDateFormat, "%Y.%-m.%-d");
  assert.equal(loader.visualTheme(), loader.visualTheme());
  assert.deepEqual(loader.layoutStyle(), {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    hoverdistance: 26,
    font: {
      color: "#ccc",
      family: "Apple SD Gothic Neo, Pretendard, sans-serif",
    },
  });
  assert.equal(loader.layoutStyle({ hoverDistance: 18 }).hoverdistance, 18);
  assert.deepEqual(loader.axisStyle({ tickFontSize: 9 }), {
    showgrid: true,
    gridcolor: "rgba(255,255,255,0.06)",
    gridwidth: 1,
    zeroline: false,
    color: "#666",
    tickfont: { size: 9 },
  });
  assert.equal(loader.hoverLabel(true, 11).font.size, 11);
  assert.equal(loader.hoverLabel(true).font.size, 12);
  assert.equal(
    loader.hoverLabel(true).font.family,
    "Apple SD Gothic Neo, Pretendard, sans-serif",
  );
  assert.equal(loader.hoverLabel(true).bgcolor, "rgba(34,34,34,0.45)");
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
