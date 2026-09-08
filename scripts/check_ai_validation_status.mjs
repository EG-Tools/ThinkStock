import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAiReleaseGate } from "../shared/ai-release-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// path-v20 was already deployed in v2.88. It may stay in place unchanged,
// but every later runtime edit must win the normal challenger promotion gate.
const APPROVED_OPERATIONAL_INCUMBENT = "path-v20";
const runtimeFiles = [
  "docs/modules/ai-context-profile.js",
  "docs/modules/ai-forecast-calibration.mjs",
  "docs/modules/ai-forecast-math.js",
  "docs/modules/ai-forecast-model.js",
  "docs/modules/ai-forecast-scenarios.js",
  "docs/modules/ai-forecast.js",
  "docs/modules/ai-scenario-paths.js",
];

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

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
  readJsonIfPresent(path.join(root, ".thinkstock-cache", "ai-backtest", "walkforward-validation-summary.json")),
  readJsonIfPresent(path.join(root, ".thinkstock-cache", "ai-backtest", "walkforward-comparison.json")),
]);
const runtimePathVersion = runtimeSource.match(/const FORECAST_PATH_VERSION = "([^"]+)";/)?.[1] || "";
const changed = changedRuntimeFiles();

if (!summary || !comparison) {
  const approvedIncumbentUnchanged = changed.length === 0
    && (runtimePathVersion === APPROVED_OPERATIONAL_INCUMBENT
      || runtimePathVersion.endsWith(`|${APPROVED_OPERATIONAL_INCUMBENT}`));
  if (!approvedIncumbentUnchanged) {
    console.error("AI release gate failed: validation-artifacts-missing");
    if (changed.length) console.error(`Changed AI runtime files: ${changed.join(", ")}`);
    process.exit(1);
  }
  console.log(`AI release gate passed: ${runtimePathVersion} (unchanged approved incumbent)`);
  console.warn("AI validation notice: reproducible backtest artifacts are not retained locally");
  process.exit(0);
}

const gate = evaluateAiReleaseGate({
  runtimePathVersion,
  summary,
  comparison,
  runtimeChanged: changed.length > 0,
  approvedIncumbentPathVersion: APPROVED_OPERATIONAL_INCUMBENT,
});

if (!gate.ok) {
  console.error(`AI release gate failed: ${gate.errors.join(", ")}`);
  if (changed.length) console.error(`Changed AI runtime files: ${changed.join(", ")}`);
  process.exit(1);
}
console.log(`AI release gate passed: ${runtimePathVersion}${changed.length ? " (runtime changed)" : ""}`);
if (gate.warnings.length) console.warn(`AI validation notice: ${gate.warnings.join(", ")}`);
