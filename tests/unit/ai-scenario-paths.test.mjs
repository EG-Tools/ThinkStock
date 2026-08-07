import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("docs/modules/ai-scenario-paths.js"), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

const {
  buildHistoricalPathLibrary,
  buildScenarioMorphologies,
  classifyHistoricalPath,
} = context.ThinkStockAiScenarioPaths;

function pathFromAnchors(values, horizon = 126) {
  const anchors = values.map((value, index) => ({
    day: Math.round((index / (values.length - 1)) * horizon),
    value,
  }));
  return Array.from({ length: horizon + 1 }, (_, day) => {
    const rightIndex = anchors.findIndex((anchor) => anchor.day >= day);
    if (rightIndex <= 0) return anchors[0].value;
    const left = anchors[rightIndex - 1];
    const right = anchors[rightIndex];
    const progress = (day - left.day) / Math.max(1, right.day - left.day);
    return left.value + ((right.value - left.value) * progress);
  });
}

test("classifies multi-stage six-month price paths independently from their endpoints", () => {
  const examples = [
    { key: "dip_then_rise", values: [0, -0.09, -0.05, 0.03, 0.13] },
    { key: "surge_then_hold", values: [0, 0.13, 0.16, 0.145, 0.135] },
    { key: "rise_then_fall", values: [0, 0.08, 0.11, 0.01, -0.1] },
    { key: "sideways_then_fall", values: [0, 0.004, 0.002, -0.025, -0.11] },
    { key: "drop_then_hold", values: [0, -0.13, -0.15, -0.14, -0.13] },
  ];

  examples.forEach(({ key, values }) => {
    const classified = classifyHistoricalPath(pathFromAnchors(values), 0.05);
    assert.equal(classified.key, key);
  });
});

test("builds role-specific paths from conditional historical analog groups", () => {
  const horizon = 126;
  const sourcePaths = [
    [0, -0.09, -0.05, 0.03, 0.13],
    [0, -0.07, -0.04, 0.04, 0.12],
    [0, 0.09, 0.11, 0.03, 0.01],
    [0, 0.08, 0.1, 0.02, 0],
    [0, 0.002, 0, -0.025, -0.11],
    [0, -0.002, 0.004, -0.03, -0.12],
  ].map((values) => pathFromAnchors(values, horizon));
  const prices = Array(1100).fill(100);
  const candidates = sourcePaths.map((pathValues, index) => {
    const anchor = 20 + (index * 160);
    pathValues.forEach((value, day) => {
      prices[anchor + day] = 100 * Math.exp(value);
    });
    return { sample: { anchor }, distance: 0.12 + (index * 0.02) };
  });
  const library = buildHistoricalPathLibrary({
    prices,
    candidates,
    horizon,
    projectedVolatility: 0.012,
  });
  const morphologies = buildScenarioMorphologies({
    library,
    endpoints: { upside: 0.14, sideways: 0.005, downside: -0.13 },
    horizon,
    projectedVolatility: 0.012,
    baseShape: Array(horizon + 1).fill(0),
    signals: { momentum: 0.01, support: 0.45, risk: 0.4, range: 0.35 },
  });

  assert.equal(library.sampleCount, 6);
  assert.equal(morphologies.upside.key, "dip_then_rise");
  assert.equal(morphologies.sideways.key, "rise_then_fall");
  assert.equal(morphologies.downside.key, "sideways_then_fall");
  assert.equal(new Set(Object.values(morphologies).map((item) => item.key)).size, 3);
  Object.entries(morphologies).forEach(([role, morphology]) => {
    assert.equal(morphology.source, "conditional-analogs", role);
    assert.equal(morphology.path.length, horizon + 1, role);
    assert.equal(morphology.path[0], 0, role);
    assert.ok(morphology.analogCount >= 2, role);
  });
  assert.ok(Math.min(...morphologies.upside.path.slice(1, 64)) < 0);
  assert.ok(Math.max(...morphologies.sideways.path.slice(1, 90)) > 0.04);
  assert.ok(Math.abs(morphologies.upside.path.at(-1) - 0.14) < 1e-12);
  assert.ok(Math.abs(morphologies.sideways.path.at(-1) - 0.005) < 1e-12);
  assert.ok(Math.abs(morphologies.downside.path.at(-1) + 0.13) < 1e-12);
});

test("uses deterministic regime templates when a role has too little history", () => {
  const horizon = 126;
  const morphologies = buildScenarioMorphologies({
    library: { groups: { upside: {}, sideways: {}, downside: {} }, sampleCount: 0, horizon },
    endpoints: { upside: 0.12, sideways: 0, downside: -0.12 },
    horizon,
    projectedVolatility: 0.013,
    signals: { momentum: -0.07, support: 0.7, risk: 0.25, range: 0.5 },
  });

  assert.equal(morphologies.upside.key, "dip_then_rise");
  assert.equal(morphologies.sideways.key, "drop_then_recover");
  assert.equal(morphologies.downside.key, "sideways_then_fall");
  assert.ok(Object.values(morphologies).every((item) => item.source === "regime-fallback"));
  assert.deepEqual(
    Object.values(morphologies).map((item) => Array.from(item.path)),
    Object.values(buildScenarioMorphologies({
      library: { groups: { upside: {}, sideways: {}, downside: {} }, sampleCount: 0, horizon },
      endpoints: { upside: 0.12, sideways: 0, downside: -0.12 },
      horizon,
      projectedVolatility: 0.013,
      signals: { momentum: -0.07, support: 0.7, risk: 0.25, range: 0.5 },
    })).map((item) => Array.from(item.path)),
  );
});
