import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareWalkforwardReports,
  evaluateWalkforwardComparison,
} from "../shared/ai-walkforward-comparison.mjs";
import { auditWalkforwardPointInTime } from "../shared/ai-point-in-time-audit.mjs";
import { buildAiValidationSummary } from "../shared/ai-validation-summary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const REPORT_PATH = path.join(CACHE_DIR, "walkforward-report.json");
const BASELINE_PATH = path.join(CACHE_DIR, "walkforward-baseline.json");
const COMPARISON_PATH = path.join(CACHE_DIR, "walkforward-comparison.json");
const SUMMARY_PATH = path.join(CACHE_DIR, "walkforward-validation-summary.json");
const accept = process.argv.includes("--accept");
const summaryOnly = process.argv.includes("--summary-only");

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", script)], {
      cwd: ROOT,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

await mkdir(CACHE_DIR, { recursive: true });
if (!summaryOnly) {
  await run("backtest_ai_forecast_walkforward.mjs");
  await run("analyze_ai_walkforward_report.mjs");
}

const current = JSON.parse(await readFile(REPORT_PATH, "utf8"));
const pointInTimeAudit = auditWalkforwardPointInTime(current);
if (!pointInTimeAudit.passed) {
  const summary = buildAiValidationSummary({
    report: current,
    pointInTimeAudit,
    evaluation: {
      passed: false,
      decision: "keep-champion",
      promotionRecommended: false,
      benchmarkOutperformanceConfirmed: false,
      failures: ["point-in-time audit failed"],
    },
  });
  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.error(`AI point-in-time audit failed: ${Object.entries(pointInTimeAudit.issueCounts)
    .map(([key, count]) => `${key} ${count}`).join(", ")}`);
  process.exitCode = 1;
  process.exit();
}

let hasBaseline = true;
try { await access(BASELINE_PATH); } catch (_) { hasBaseline = false; }
if (!hasBaseline) {
  await copyFile(REPORT_PATH, BASELINE_PATH);
  const summary = buildAiValidationSummary({
    report: current,
    pointInTimeAudit,
    baselineCreated: true,
  });
  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`AI walk-forward baseline created: ${path.relative(ROOT, BASELINE_PATH)}`);
  process.exit(0);
}

const previous = await readFile(BASELINE_PATH, "utf8").then(JSON.parse);
const comparison = compareWalkforwardReports(previous, current);
const evaluation = evaluateWalkforwardComparison(comparison);
const summary = buildAiValidationSummary({
  report: current,
  comparison,
  evaluation,
  pointInTimeAudit,
});
await writeFile(COMPARISON_PATH, `${JSON.stringify({
  ...comparison,
  pointInTimeAudit,
  evaluation,
}, null, 2)}\n`, "utf8");
await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (!evaluation.passed) {
  console.error(`AI walk-forward regression: ${evaluation.failures.join(", ")}`);
  if (!summaryOnly) process.exitCode = 1;
} else if (accept && summary.promotionAllowed) {
  await copyFile(REPORT_PATH, BASELINE_PATH);
  console.log("AI challenger promoted to the walk-forward baseline.");
} else {
  console.log(`AI walk-forward guard passed: ${path.relative(ROOT, SUMMARY_PATH)}`);
  if (accept && !summary.promotionAllowed) {
    console.warn(`AI champion retained: ${summary.releaseDecision}.`);
  }
  if (!evaluation.benchmarkOutperformanceConfirmed) {
    console.warn(`AI remains experimental: ${evaluation.warnings.join(", ")}`);
  }
}
