import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateQlibChallengerReport } from "../shared/qlib-challenger-contract.mjs";
import {
  evaluateQlibMatchedAssist,
  matchQlibAndThinkStockAnchors,
} from "../shared/qlib-matched-anchor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QLIB_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest", "qlib");
const REPORT_PATH = path.join(QLIB_DIR, "challenger-report.json");
const GATE_PATH = path.join(QLIB_DIR, "challenger-gate.json");
const PREDICTION_PATH = path.join(QLIB_DIR, "challenger-predictions.jsonl");
const RUNTIME_ASSIST_PATH = path.join(QLIB_DIR, "runtime-assist.json");
const PRIMARY_CHAMPION_PATH = path.join(
  ROOT,
  ".thinkstock-cache",
  "ai-backtest",
  "walkforward-qlib-primary-champion.json",
);
const CONFIRMATION_CHAMPION_PATH = path.join(
  ROOT,
  ".thinkstock-cache",
  "ai-backtest",
  "walkforward-qlib-confirmation-champion.json",
);
const VENV_PYTHON = process.platform === "win32"
  ? path.join(ROOT, ".thinkstock-cache", "qlib-venv", "Scripts", "python.exe")
  : path.join(ROOT, ".thinkstock-cache", "qlib-venv", "bin", "python");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

async function pythonExecutable() {
  const configured = String(process.env.THINKSTOCK_QLIB_PYTHON || "").trim();
  if (configured) return configured;
  try {
    await access(VENV_PYTHON);
    return VENV_PYTHON;
  } catch (_) {
    throw new Error(
      "Qlib environment is missing. Create .thinkstock-cache/qlib-venv and install requirements-qlib.txt.",
    );
  }
}

async function readJsonLines(file) {
  const source = await readFile(file, "utf8");
  return source.split(/\r?\n/).flatMap((line) => {
    const value = line.trim();
    return value ? [JSON.parse(value)] : [];
  });
}

async function matchedAnchorEvaluation(report) {
  const preGate = evaluateQlibChallengerReport(report, { minimumSamples: 100 });
  if (!preGate.confirmationAuditPassed) {
    return {
      status: "blocked-repeated-audits-not-passed",
      passed: false,
      reason: "holdout and both sealed audit cohorts must pass first",
    };
  }
  const backtest = path.join(ROOT, "scripts", "backtest_ai_forecast_walkforward.mjs");
  await run(process.execPath, [
    backtest,
    "--sample", "audit",
    "--stock-windows", "12",
    "--without-indexes",
    "--output", path.basename(PRIMARY_CHAMPION_PATH),
  ]);
  await run(process.execPath, [
    backtest,
    "--sample", "confirmation-audit",
    "--stock-windows", "12",
    "--without-indexes",
    "--output", path.basename(CONFIRMATION_CHAMPION_PATH),
  ]);
  const [qlibRows, primaryChampion, confirmationChampion] = await Promise.all([
    readJsonLines(PREDICTION_PATH),
    readFile(PRIMARY_CHAMPION_PATH, "utf8").then(JSON.parse),
    readFile(CONFIRMATION_CHAMPION_PATH, "utf8").then(JSON.parse),
  ]);
  const primaryMatch = matchQlibAndThinkStockAnchors(qlibRows, primaryChampion, "audit");
  const confirmationMatch = matchQlibAndThinkStockAnchors(
    qlibRows,
    confirmationChampion,
    "confirmationAudit",
  );
  const result = evaluateQlibMatchedAssist({
    primary: primaryMatch,
    confirmation: confirmationMatch,
  });
  return {
    generatedAt: new Date().toISOString(),
    ...result,
    primaryMatch: {
      qlibRows: primaryMatch.qlibRows,
      championRows: primaryMatch.championRows,
      matchedRows: primaryMatch.matchedRows,
      actualMismatch: primaryMatch.actualMismatch,
    },
    confirmationMatch: {
      qlibRows: confirmationMatch.qlibRows,
      championRows: confirmationMatch.championRows,
      matchedRows: confirmationMatch.matchedRows,
      actualMismatch: confirmationMatch.actualMismatch,
    },
  };
}

await mkdir(QLIB_DIR, { recursive: true });
await run(process.execPath, [path.join(ROOT, "scripts", "export_qlib_krx_manifest.mjs")]);
const python = await pythonExecutable();
await run(python, [
  path.join(ROOT, "scripts", "run_qlib_krx_challenger.py"),
  ...process.argv.slice(2),
]);
const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
if (!process.argv.includes("--quick")) {
  report.matchedAnchor = await matchedAnchorEvaluation(report);
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
const gate = evaluateQlibChallengerReport(report, {
  minimumSamples: process.argv.includes("--quick") ? 30 : 100,
});
await writeFile(GATE_PATH, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  reportGeneratedAt: report.generatedAt,
  ...gate,
}, null, 2)}\n`, "utf8");
if (gate.runtimeIntegrationEligible && report.matchedAnchor?.runtimeAssist) {
  await writeFile(RUNTIME_ASSIST_PATH, `${JSON.stringify({
    ...report.matchedAnchor.runtimeAssist,
    generatedAt: new Date().toISOString(),
    reportGeneratedAt: report.generatedAt,
    priceFingerprint: report.manifest?.priceFingerprint || "",
    contextFingerprint: report.manifest?.contextFingerprint || "",
    activation: "offline-Qlib-scoring-required",
  }, null, 2)}\n`, "utf8");
} else {
  await unlink(RUNTIME_ASSIST_PATH).catch(() => {});
}
console.log(JSON.stringify({
  gate: path.relative(ROOT, GATE_PATH),
  holdoutPassed: gate.holdoutPassed,
  auditPassed: gate.auditPassed,
  researchCandidate: gate.researchCandidate,
  runtimeIntegrationEligible: gate.runtimeIntegrationEligible,
  matchedAnchorStatus: report.matchedAnchor?.status || "not-run",
  nextStep: gate.nextStep,
}, null, 2));
