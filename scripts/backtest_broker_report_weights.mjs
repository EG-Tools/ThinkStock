import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BROKER_REPORT_POLICY,
  evaluateBrokerReportEvents,
  scoreBrokerReportEvidence,
} from "../shared/broker-report-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const BROKER_REPORT_POLICY_CANDIDATES = Object.freeze({
  baseline: DEFAULT_BROKER_REPORT_POLICY,
  earningsFocused: Object.freeze({
    ...DEFAULT_BROKER_REPORT_POLICY,
    epsWeight: 0.64,
    roeWeight: 0.34,
    targetCutWeight: 0.18,
    targetRaiseWeight: 0.08,
  }),
  targetSensitive: Object.freeze({
    ...DEFAULT_BROKER_REPORT_POLICY,
    epsWeight: 0.52,
    roeWeight: 0.27,
    targetCutWeight: 0.30,
    targetRaiseWeight: 0.14,
  }),
});

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function scoredEvents(events, policy) {
  return (Array.isArray(events) ? events : []).map((event) => ({
    ...event,
    signal: scoreBrokerReportEvidence(event.evidence || event, policy).signal,
  }));
}

function summarizeEvaluation(evaluation) {
  const signedReturns = evaluation.observations.map((row) => (
    Math.sign(row.signal) * row.realizedReturn
  ));
  return Object.freeze({
    samples: evaluation.samples,
    directionalSamples: evaluation.directionalSamples,
    directionAccuracy: evaluation.directionAccuracy,
    meanSignedReturn: mean(signedReturns),
  });
}

export function evaluatePolicyCandidates(dataset, options = {}) {
  const events = Array.isArray(dataset?.events) ? dataset.events : [];
  const priceByTicker = dataset?.priceByTicker || {};
  const horizons = Array.isArray(options.horizons) ? options.horizons : [20, 63, 126];
  const minimumSamples = Math.max(10, Number(options.minimumSamples) || 30);
  const policies = options.policies || BROKER_REPORT_POLICY_CANDIDATES;
  const results = Object.fromEntries(Object.entries(policies).map(([name, policy]) => [
    name,
    Object.fromEntries(horizons.map((horizon) => [
      horizon,
      summarizeEvaluation(evaluateBrokerReportEvents(
        scoredEvents(events, policy),
        priceByTicker,
        { horizon },
      )),
    ])),
  ]));
  const baseline = results.baseline || {};
  const eligible = Object.entries(results).filter(([name]) => name !== "baseline").map(([name, result]) => {
    const comparable = horizons.filter((horizon) => (
      Number(result[horizon]?.directionalSamples) >= minimumSamples
      && Number(baseline[horizon]?.directionalSamples) >= minimumSamples
      && Number.isFinite(result[horizon]?.directionAccuracy)
      && Number.isFinite(baseline[horizon]?.directionAccuracy)
    ));
    const accuracyImprovement = mean(comparable.map((horizon) => (
      result[horizon].directionAccuracy - baseline[horizon].directionAccuracy
    )));
    const returnImprovement = mean(comparable.map((horizon) => (
      Number(result[horizon].meanSignedReturn || 0) - Number(baseline[horizon].meanSignedReturn || 0)
    )));
    return {
      name,
      comparableHorizons: comparable,
      accuracyImprovement,
      returnImprovement,
      eligible: comparable.length >= 2
        && accuracyImprovement >= 0.02
        && returnImprovement >= 0,
    };
  }).sort((left, right) => Number(right.accuracyImprovement || -Infinity)
    - Number(left.accuracyImprovement || -Infinity));
  const promoted = eligible.find((candidate) => candidate.eligible) || null;
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    minimumSamples,
    horizons,
    results,
    recommendation: promoted
      ? { status: "candidate", policy: promoted.name, evidence: promoted }
      : { status: "keep-baseline", reason: "insufficient-or-no-improvement" },
  });
}

function argumentValue(name, fallback) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const inputPath = path.resolve(ROOT, argumentValue(
    "--input",
    ".thinkstock-cache/broker-report-backtest-input.json",
  ));
  const outputPath = path.resolve(ROOT, argumentValue(
    "--output",
    ".thinkstock-cache/broker-report-backtest-result.json",
  ));
  let inputAvailable = true;
  let dataset;
  try {
    dataset = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    inputAvailable = false;
    dataset = { events: [], priceByTicker: {} };
  }
  const report = evaluatePolicyCandidates(dataset);
  const output = Object.freeze({
    ...report,
    inputAvailable,
    recommendation: inputAvailable
      ? report.recommendation
      : { status: "keep-baseline", reason: "historical-report-events-not-ready" },
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output: path.relative(ROOT, outputPath),
    inputAvailable,
    events: output.eventCount,
    recommendation: output.recommendation,
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
