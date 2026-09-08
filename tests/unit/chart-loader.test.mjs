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

test("chart loader removes a failed script and retries with a fresh request", async () => {
  const previousTestDocument = globalThis.document;
  const previousTestLocation = globalThis.location;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const scripts = [];
  const timers = new Map();
  let nextTimerId = 1;
  const createScript = () => {
    const listeners = new Map();
    const script = {
      dataset: {},
      isConnected: false,
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
      dispatch: (type) => listeners.get(type)?.(),
      remove: () => {
        script.isConnected = false;
        const index = scripts.indexOf(script);
        if (index >= 0) scripts.splice(index, 1);
      },
    };
    return script;
  };
  const document = {
    currentScript: null,
    querySelector: (selector) => (
      selector.startsWith("link") ? null : scripts.find((script) => script.isConnected) || null
    ),
    createElement: () => createScript(),
    head: {
      appendChild: (script) => {
        script.isConnected = true;
        scripts.push(script);
      },
    },
  };

  globalThis.document = document;
  globalThis.location = { href: "http://localhost/" };
  globalThis.setTimeout = (callback) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.set(timerId, callback);
    return timerId;
  };
  globalThis.clearTimeout = (timerId) => timers.delete(timerId);
  try {
    const firstAttempt = loader.ensurePlotlyLoaded();
    const failedScript = scripts[0];
    failedScript.dispatch("error");
    await assert.rejects(firstAttempt, /Plotly failed to load/);
    assert.equal(scripts.length, 0);

    const timedOutAttempt = loader.ensurePlotlyLoaded();
    const timedOutScript = scripts[0];
    [...timers.values()][0]();
    await assert.rejects(timedOutAttempt, /Plotly failed to load/);
    assert.equal(scripts.length, 0);

    const finalAttempt = loader.ensurePlotlyLoaded();
    const replacementScript = scripts[0];
    assert.notEqual(replacementScript, failedScript);
    assert.notEqual(replacementScript, timedOutScript);
    globalThis.Plotly = { version: "test" };
    replacementScript.dispatch("load");
    assert.equal(await finalAttempt, globalThis.Plotly);
  } finally {
    delete globalThis.Plotly;
    globalThis.document = previousTestDocument;
    globalThis.location = previousTestLocation;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});
