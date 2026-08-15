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
const PRICE_PATH = path.join(CACHE_DIR, "walkforward-prices.json");
const CONTEXT_PATH = path.join(CACHE_DIR, "walkforward-context.json");
const accept = process.argv.includes("--accept");
const summaryOnly = process.argv.includes("--summary-only");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

const championRef = argumentValue("--champion-ref");
if (championRef && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(championRef)) {
  throw new Error("AI champion ref is invalid");
}

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
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

function sourceCountsMatch(report, context) {
  const coverage = report?.sourceCoverage || {};
  return Number(coverage.macroRows) === (context?.macroRows?.length || 0)
    && Number(coverage.creditRows) === (context?.creditRows?.length || 0)
    && Number(coverage.auxiliaryRows) === (context?.auxiliaryRows?.length || 0)
    && Number(coverage.crisisRows) === (context?.crisisRows?.length || 0);
}

async function canReuseChampionBaseline() {
  try {
    const [baseline, prices, context] = await Promise.all([
      readFile(BASELINE_PATH, "utf8").then(JSON.parse),
      readFile(PRICE_PATH, "utf8").then(JSON.parse),
      readFile(CONTEXT_PATH, "utf8").then(JSON.parse),
    ]);
    const sameSelection = JSON.stringify(baseline.selection || {}) === JSON.stringify(prices.selection || {});
    const exactSnapshot = baseline.dataSnapshot
      ? baseline.dataSnapshot.priceFormat === prices.format
        && baseline.dataSnapshot.priceGeneratedAt === (prices.generatedAt || "")
        && baseline.dataSnapshot.contextFormat === context.format
        && baseline.dataSnapshot.contextGeneratedAt === (context.generatedAt || "")
      : sourceCountsMatch(baseline, context)
        && Date.parse(baseline.generatedAt || "") >= Date.parse(prices.generatedAt || "")
        && Date.parse(baseline.generatedAt || "") >= Date.parse(context.generatedAt || "");
    return sameSelection
      && exactSnapshot
      && Number(baseline.maxWindowsPerStock) === 12
      && Number(baseline.maxWindowsPerIndex) === 36;
  } catch (_) {
    return false;
  }
}

await mkdir(CACHE_DIR, { recursive: true });
if (!summaryOnly) {
  // The baseline is the accepted champion, not simply the current Git HEAD.
  // Replacing it before a challenger wins makes a regression look like progress.
  let hasChampion = true;
  try { await access(BASELINE_PATH); } catch (_) { hasChampion = false; }
  if (hasChampion && !await canReuseChampionBaseline()) {
    if (!championRef) {
      throw new Error(
        "AI champion baseline does not match the prepared sample. "
        + "Re-run with --champion-ref <accepted-commit> to evaluate the accepted engine on the same sample.",
      );
    }
    console.log(`Rebuilding the AI champion baseline from ${championRef} on the prepared sample.`);
    await run("backtest_ai_forecast_walkforward.mjs", [
      "--output", "walkforward-baseline.json",
      "--engine-ref", championRef,
    ]);
    if (!await canReuseChampionBaseline()) {
      throw new Error("The rebuilt AI champion baseline still does not match the prepared sample.");
    }
    hasChampion = true;
  }
  if (hasChampion) console.log("Reusing the accepted AI champion baseline.");
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
