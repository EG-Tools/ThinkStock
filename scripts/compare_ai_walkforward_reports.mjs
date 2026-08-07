import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const OLD_PATH = path.resolve(process.argv[2] || path.join(DEFAULT_DIR, "walkforward-report-path-v8-40stocks.json"));
const NEW_PATH = path.resolve(process.argv[3] || path.join(DEFAULT_DIR, "walkforward-report-path-v9-40stocks.json"));
const HORIZONS = [20, 63, 126];
const CLASSES = ["upside", "sideways", "downside"];

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rounded(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function cohortSets(selection) {
  const development = new Set();
  const holdout = new Set();
  for (const series of Object.values(selection || {})) {
    const middle = Math.floor(series.length / 2);
    series.slice(0, middle).forEach((item) => development.add(item));
    series.slice(middle).forEach((item) => holdout.add(item));
  }
  return {
    all: new Set([...development, ...holdout]),
    development,
    holdout,
  };
}

function summarize(report, series, horizon) {
  const rows = (report.observations || []).filter((row) => (
    row.targetType === "stock" && row.horizon === horizon && series.has(row.series)
  ));
  const scenarioRows = rows.filter((row) => typeof row.scenarioCorrect === "boolean");
  const mae = mean(rows.map((row) => row.absoluteError));
  const noChangeMae = mean(rows.map((row) => row.noChangeError));
  const brier = mean(scenarioRows.map((row) => CLASSES.reduce((sum, key) => {
    const probability = Number(row.scenarioWeights?.[key] || 0) / 100;
    return sum + ((probability - Number(row.actualClass === key)) ** 2);
  }, 0)));
  return {
    samples: rows.length,
    directionAccuracy: rounded(mean(rows.map((row) => Number(row.directionCorrect))), 4),
    meanAbsoluteLogError: rounded(mae),
    noChangeMae: rounded(noChangeMae),
    improvementVsNoChange: rounded(noChangeMae > 0 ? 1 - (mae / noChangeMae) : null, 4),
    scenarioSamples: scenarioRows.length,
    scenarioAccuracy: rounded(mean(scenarioRows.map((row) => Number(row.scenarioCorrect))), 4),
    scenarioBrierScore: rounded(brier),
  };
}

function delta(previous, current) {
  return {
    directionAccuracyPoints: rounded((current.directionAccuracy - previous.directionAccuracy) * 100, 2),
    errorReduction: rounded(1 - (current.meanAbsoluteLogError / previous.meanAbsoluteLogError), 4),
    scenarioAccuracyPoints: previous.scenarioAccuracy === null || current.scenarioAccuracy === null
      ? null
      : rounded((current.scenarioAccuracy - previous.scenarioAccuracy) * 100, 2),
    scenarioBrierReduction: previous.scenarioBrierScore === null || current.scenarioBrierScore === null
      ? null
      : rounded(1 - (current.scenarioBrierScore / previous.scenarioBrierScore), 4),
  };
}

const [previous, current] = await Promise.all([
  readFile(OLD_PATH, "utf8").then(JSON.parse),
  readFile(NEW_PATH, "utf8").then(JSON.parse),
]);

if (JSON.stringify(previous.selection) !== JSON.stringify(current.selection)) {
  throw new Error("Backtest selections differ; the reports are not directly comparable.");
}

const cohorts = cohortSets(current.selection);
const comparison = {
  format: "thinkstock-ai-walkforward-comparison-v1",
  previousVersion: previous.enginePathVersion,
  currentVersion: current.enginePathVersion,
  cohorts: {},
};

for (const [cohort, series] of Object.entries(cohorts)) {
  comparison.cohorts[cohort] = Object.fromEntries(HORIZONS.map((horizon) => {
    const before = summarize(previous, series, horizon);
    const after = summarize(current, series, horizon);
    return [horizon, { before, after, delta: delta(before, after) }];
  }));
}

console.log(JSON.stringify(comparison, null, 2));
