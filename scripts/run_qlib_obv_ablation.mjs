import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { compareQlibObvAblation } from "../shared/qlib-obv-ablation.mjs";
import {
  QLIB_ROOT as ROOT,
  qlibPythonExecutable,
  runQlibCommand,
} from "./qlib-process.mjs";

const QLIB_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest", "qlib");
const QUICK = process.argv.includes("--quick");
const PYTHON_SCRIPT = path.join(ROOT, "scripts", "run_qlib_krx_challenger.py");

async function runFeatureSet(python, featureSet, artifactLabel) {
  await runQlibCommand(python, [
    PYTHON_SCRIPT,
    "--feature-set", featureSet,
    "--artifact-label", artifactLabel,
    "--no-audit",
    ...(QUICK ? ["--quick"] : []),
  ]);
  const reportPath = path.join(QLIB_DIR, `challenger-report-${artifactLabel}.json`);
  return JSON.parse(await readFile(reportPath, "utf8"));
}

await mkdir(QLIB_DIR, { recursive: true });
await runQlibCommand(process.execPath, [path.join(ROOT, "scripts", "export_qlib_krx_manifest.mjs")]);
const python = await qlibPythonExecutable();
await runQlibCommand(python, ["-m", "unittest", "scripts.tests.test_qlib_obv_features"]);
const baseline = await runFeatureSet(python, "baseline", "obv-baseline");
const candidate = await runFeatureSet(python, "obv", "obv-enabled");
const comparison = compareQlibObvAblation(baseline, candidate, {
  minimumSamples: QUICK ? 30 : 100,
});
const outputPath = path.join(QLIB_DIR, "obv-ablation.json");
await writeFile(outputPath, `${JSON.stringify({
  ...comparison,
  generatedAt: new Date().toISOString(),
  quick: QUICK,
  baselineReport: "challenger-report-obv-baseline.json",
  candidateReport: "challenger-report-obv-enabled.json",
  auditOpened: false,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.relative(ROOT, outputPath),
  wins: comparison.wins,
  passed: comparison.passed,
  decision: comparison.decision,
  runtimeIntegrationEligible: false,
}, null, 2));
