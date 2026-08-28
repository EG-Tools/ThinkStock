import { finiteOrNull, normalizedIsoDate } from "./runtime-foundation.mjs";

export const BROKER_REPORT_POLICY_VERSION = "broker-policy-v1";

export const DEFAULT_BROKER_REPORT_POLICY = Object.freeze({
  epsWeight: 0.58,
  epsScale: 0.25,
  roeWeight: 0.30,
  roeScale: 5,
  targetCutWeight: 0.24,
  targetRaiseWeight: 0.12,
  targetNeutralWeight: 0.08,
  targetCutScale: 0.12,
  targetRaiseScale: 0.24,
  downsideAdjustmentScale: 0.024,
  upsideAdjustmentScale: 0.016,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finiteOrNull(value) || 0));
}

function nextWeekday(dateText) {
  const normalized = normalizedIsoDate(dateText);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00Z`);
  do date.setUTCDate(date.getUTCDate() + 1);
  while ([0, 6].includes(date.getUTCDay()));
  return date.toISOString().slice(0, 10);
}

export function reportAvailableDate(report, options = {}) {
  const explicit = normalizedIsoDate(report?.availableDate);
  const publishedDate = normalizedIsoDate(report?.publishedDate);
  if (!publishedDate) return "";
  const preciseAvailability = String(report?.availabilityPrecision || "") === "timestamped";
  if (explicit && (options.historicalMode !== true || preciseAvailability)) return explicit;
  return options.historicalMode === true ? nextWeekday(publishedDate) : publishedDate;
}

export function reportIsAvailableAt(report, asOfDate, options = {}) {
  const cutoff = normalizedIsoDate(asOfDate);
  const publishedDate = normalizedIsoDate(report?.publishedDate);
  const availableDate = reportAvailableDate(report, options);
  return Boolean(cutoff && publishedDate && availableDate
    && publishedDate <= cutoff
    && availableDate <= cutoff);
}

export function scoreBrokerReportEvidence(input = {}, policy = DEFAULT_BROKER_REPORT_POLICY) {
  const epsChange = finiteOrNull(input.epsChange);
  const roeChange = finiteOrNull(input.roeChange);
  const targetRevisionChange = finiteOrNull(input.targetRevisionChange);
  const targetRevisionSignal = targetRevisionChange === null
    ? 0
    : targetRevisionChange < 0
      ? clamp(targetRevisionChange / policy.targetCutScale, -1, 0)
      : clamp(targetRevisionChange / policy.targetRaiseScale, 0, 1);
  const targetWeight = targetRevisionSignal < 0
    ? policy.targetCutWeight
    : (targetRevisionSignal > 0 ? policy.targetRaiseWeight : policy.targetNeutralWeight);
  const weightedSignals = [
    [epsChange, policy.epsWeight, policy.epsScale],
    [roeChange, policy.roeWeight, policy.roeScale],
    [input.hasTargetRevision ? targetRevisionSignal : null, targetWeight, 1],
  ].filter(([value]) => finiteOrNull(value) !== null);
  const signalWeight = weightedSignals.reduce((sum, [, weight]) => sum + weight, 0);
  const earningsSignal = signalWeight
    ? weightedSignals.reduce((sum, [value, weight, scale]) => (
      sum + (clamp(value / scale, -1, 1) * weight)
    ), 0) / signalWeight
    : 0;
  const epsDirection = Math.abs(epsChange || 0) >= 0.02 ? Math.sign(epsChange) : 0;
  const roeDirection = Math.abs(roeChange || 0) >= 0.5 ? Math.sign(roeChange) : 0;
  const primaryConflict = epsDirection !== 0 && roeDirection !== 0 && epsDirection !== roeDirection;
  const downsideAgreement = targetRevisionSignal < 0 && (epsDirection < 0 || roeDirection < 0);
  const upsideAgreement = targetRevisionSignal > 0 && (epsDirection > 0 || roeDirection > 0);
  const targetCutBreadth = clamp(input.targetCutBreadth, 0, 1);
  const targetCutStreak = Math.max(0, Math.round(finiteOrNull(input.targetCutStreak) || 0));
  const targetCutPenalty = targetRevisionSignal < 0
    ? (0.05 * targetCutBreadth) + (targetCutStreak >= 2 ? 0.04 : 0)
    : 0;
  const signal = clamp(
    earningsSignal
      - targetCutPenalty
      - (downsideAgreement ? 0.08 : 0)
      + (upsideAgreement ? 0.025 : 0),
    -1,
    1,
  );
  const targetDeviation = finiteOrNull(input.targetDeviation);
  const dispersionPenalty = targetDeviation === null ? 0.12 : clamp(targetDeviation / 0.35, 0, 0.45);
  const confidence = clamp(
    (clamp(input.parserConfidence, 0, 1) * 0.45)
      + (clamp(input.coverageConfidence, 0, 1) * 0.25)
      + (clamp(input.primaryCoverage, 0, 1) * 0.3)
      - dispersionPenalty
      - (primaryConflict ? 0.15 : 0)
      + (downsideAgreement ? 0.05 : 0),
    0.1,
    0.92,
  );
  const adjustment = signal < 0
    ? clamp(signal * confidence * policy.downsideAdjustmentScale, -policy.downsideAdjustmentScale, 0)
    : clamp(signal * confidence * policy.upsideAdjustmentScale, 0, policy.upsideAdjustmentScale);
  return Object.freeze({
    adjustment,
    confidence,
    downsideAgreement,
    earningsSignal,
    epsDirection,
    policyVersion: BROKER_REPORT_POLICY_VERSION,
    primaryConflict,
    roeDirection,
    signal,
    targetRevisionSignal,
    upsideAgreement,
  });
}

export function brokerReportEvaluationEvent(tickerValue, report = {}) {
  const ticker = String(tickerValue || report?.ticker || "").trim().toUpperCase();
  const reportId = String(report?.reportId || report?.id || "").trim();
  const publishedDate = normalizedIsoDate(report?.publishedDate);
  const availableDate = reportAvailableDate(report, { historicalMode: true });
  if (!/^\d{6}\.(?:KS|KQ)$/.test(ticker) || !reportId || !publishedDate || !availableDate) return null;
  const epsChange = finiteOrNull(report?.metrics?.eps?.growth ?? report?.epsChange);
  const roeChange = finiteOrNull(report?.metrics?.roe?.growth ?? report?.roeChange);
  const targetRevisionChange = finiteOrNull(report?.targetPriceChange ?? report?.targetRevisionChange);
  const hasTargetRevision = targetRevisionChange !== null
    || finiteOrNull(report?.targetRevision) !== null;
  const primaryCoverage = [epsChange, roeChange].filter((value) => value !== null).length / 2;
  if (!primaryCoverage && !hasTargetRevision) return null;
  const evidence = Object.freeze({
    epsChange,
    roeChange,
    targetRevisionChange,
    hasTargetRevision,
    targetCutBreadth: targetRevisionChange !== null && targetRevisionChange < -0.015 ? 1 : 0,
    targetCutStreak: Math.max(0, Math.round(Number(report?.targetRevisionStreak) || 0)),
    parserConfidence: clamp(report?.confidence, 0, 1),
    coverageConfidence: 1,
    primaryCoverage,
    targetDeviation: 0,
  });
  const scored = scoreBrokerReportEvidence(evidence);
  return Object.freeze({
    ticker,
    reportId,
    publishedDate,
    availableDate,
    policyVersion: scored.policyVersion,
    signal: scored.signal,
    confidence: scored.confidence,
    adjustment: scored.adjustment,
    evidence,
  });
}

export function evaluateBrokerReportEvents(events, priceByTicker, options = {}) {
  const horizon = Math.max(1, Math.round(finiteOrNull(options.horizon) || 63));
  const observations = [];
  for (const event of Array.isArray(events) ? events : []) {
    const ticker = String(event?.ticker || "").trim().toUpperCase();
    const availableDate = reportAvailableDate(event, { historicalMode: true });
    const rows = Array.isArray(priceByTicker?.[ticker]) ? priceByTicker[ticker] : [];
    const startIndex = rows.findIndex((row) => normalizedIsoDate(row?.date) >= availableDate);
    const end = startIndex >= 0 ? rows[startIndex + horizon] : null;
    const startPrice = startIndex >= 0 ? finiteOrNull(rows[startIndex]?.close) : null;
    const endPrice = finiteOrNull(end?.close);
    const signal = finiteOrNull(event?.signal);
    if (!(startPrice > 0 && endPrice > 0) || signal === null) continue;
    const realizedReturn = (endPrice / startPrice) - 1;
    observations.push(Object.freeze({
      ticker,
      reportId: String(event?.reportId || event?.id || ""),
      availableDate,
      outcomeDate: normalizedIsoDate(end.date),
      signal,
      realizedReturn,
      directionCorrect: Math.abs(signal) < 0.05 ? null : Math.sign(signal) === Math.sign(realizedReturn),
    }));
  }
  const directional = observations.filter((item) => item.directionCorrect !== null);
  const directionAccuracy = directional.length
    ? directional.filter((item) => item.directionCorrect).length / directional.length
    : null;
  return Object.freeze({
    horizon,
    samples: observations.length,
    directionalSamples: directional.length,
    directionAccuracy,
    observations: Object.freeze(observations),
  });
}
