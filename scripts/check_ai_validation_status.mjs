import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const APPROVED_RUNTIME_SHA256 = Object.freeze({
  "docs/modules/ai-context-profile.js": "139772a548dd5ef0bc5104ab1bea2ac6a9ecd6ebb5be1ee69bf7a4840fb1f25d",
  "docs/modules/ai-forecast-calibration.mjs": "46cc200439b03f33766b8cb6d55e142b7ccb71691cbaafe95f9028503834dd5c",
  "docs/modules/ai-forecast-math.js": "1d891c0a210dc99de0dc73b03721e31ab76d34f09f7e53ed201d0bd452dcff8a",
  "docs/modules/ai-forecast-model.js": "774abcf64c28303384b083628a83ddbee520f88cf90b74fc3e97b045041cc1af",
  "docs/modules/ai-forecast-scenarios.js": "ce9bcb8325bbdc01b97189fa8513ca1cb912d66dae8dbcaae6ddbb13bb3ef78f",
  "docs/modules/ai-forecast.js": "55eb58cde7f15782aefd38a4303a4510bde132952a1a60a766a73b4b471d11cf",
  "docs/modules/ai-scenario-paths.js": "0db9e99ae98384500a5a6e941f6831212f8c093066af50248581d520c12768f6",
});

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function changedRuntimeFiles() {
  const checks = await Promise.all(runtimeFiles.map(async (file) => {
    const source = (await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n");
    const hash = createHash("sha256").update(source).digest("hex");
    return hash === APPROVED_RUNTIME_SHA256[file] ? "" : file;
  }));
  return checks.filter(Boolean);
}

const [runtimeSource, summary, comparison, changed] = await Promise.all([
  readFile(path.join(root, "docs", "modules", "ai-forecast.js"), "utf8"),
  readJsonIfPresent(path.join(root, ".thinkstock-cache", "ai-backtest", "walkforward-validation-summary.json")),
  readJsonIfPresent(path.join(root, ".thinkstock-cache", "ai-backtest", "walkforward-comparison.json")),
  changedRuntimeFiles(),
]);
const runtimePathVersion = runtimeSource.match(/const FORECAST_PATH_VERSION = "([^"]+)";/)?.[1] || "";

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
