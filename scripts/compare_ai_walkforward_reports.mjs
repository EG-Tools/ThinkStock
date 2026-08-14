import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareWalkforwardReports,
  evaluateWalkforwardComparison,
} from "../shared/ai-walkforward-comparison.mjs";
import { auditWalkforwardPointInTime } from "../shared/ai-point-in-time-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const args = process.argv.slice(2);
const positional = [];
let outputPath = "";
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--output") {
    if (args[index + 1]) outputPath = path.resolve(args[++index]);
  } else if (!args[index].startsWith("--")) {
    positional.push(args[index]);
  }
}
const previousPath = path.resolve(positional[0] || path.join(DEFAULT_DIR, "walkforward-baseline.json"));
const currentPath = path.resolve(positional[1] || path.join(DEFAULT_DIR, "walkforward-report.json"));
const guard = args.includes("--guard");

const [previous, current] = await Promise.all([
  readFile(previousPath, "utf8").then(JSON.parse),
  readFile(currentPath, "utf8").then(JSON.parse),
]);
const comparison = compareWalkforwardReports(previous, current);
const evaluation = evaluateWalkforwardComparison(comparison);
const pointInTimeAudit = auditWalkforwardPointInTime(current);
const output = { ...comparison, pointInTimeAudit, evaluation: {
  ...evaluation,
  passed: evaluation.passed && pointInTimeAudit.passed,
  failures: [
    ...evaluation.failures,
    ...(!pointInTimeAudit.passed ? ["point-in-time audit failed"] : []),
  ],
} };

if (outputPath) await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
if (guard && !evaluation.passed) process.exitCode = 1;
