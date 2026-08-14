import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAiReleaseGate } from "../shared/ai-release-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeFiles = [
  "docs/modules/ai-context-profile.js",
  "docs/modules/ai-forecast-calibration.js",
  "docs/modules/ai-forecast-math.js",
  "docs/modules/ai-forecast-model.js",
  "docs/modules/ai-forecast-scenarios.js",
  "docs/modules/ai-forecast.js",
  "docs/modules/ai-scenario-paths.js",
];

function changedRuntimeFiles() {
  const result = spawnSync("git", ["diff", "--name-only", "HEAD", "--", ...runtimeFiles], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return String(result.stdout || "").split(/\r?\n/).filter(Boolean);
}

const [runtimeSource, summary, comparison] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "ai-forecast.js"), "utf8"),
  readFile(path.join(root, ".thinkstock-cache", "ai-backtest", "walkforward-validation-summary.json"), "utf8")
    .then(JSON.parse),
  readFile(path.join(root, ".thinkstock-cache", "ai-backtest", "walkforward-comparison.json"), "utf8")
    .then(JSON.parse),
]);
const runtimePathVersion = runtimeSource.match(/const FORECAST_PATH_VERSION = "([^"]+)";/)?.[1] || "";
const changed = changedRuntimeFiles();
const gate = evaluateAiReleaseGate({
  runtimePathVersion,
  summary,
  comparison,
  runtimeChanged: changed.length > 0,
});

if (!gate.ok) {
  console.error(`AI release gate failed: ${gate.errors.join(", ")}`);
  if (changed.length) console.error(`Changed AI runtime files: ${changed.join(", ")}`);
  process.exit(1);
}
console.log(`AI release gate passed: ${runtimePathVersion}${changed.length ? " (runtime changed)" : ""}`);
if (gate.warnings.length) console.warn(`AI validation notice: ${gate.warnings.join(", ")}`);
