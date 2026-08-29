"use strict";

function finiteCount(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function researchSummarySuccessfulCount(summary) {
  const scanned = finiteCount(summary?.scanned);
  const failed = Math.min(scanned, finiteCount(summary?.failed));
  if (scanned > 0) return scanned - failed;
  return Object.values(summary?.universeState || {})
    .filter((state) => String(state?.fingerprint || "").trim()).length;
}

function researchSummaryCoverage(summary) {
  const scanned = finiteCount(summary?.scanned);
  return scanned > 0 ? researchSummarySuccessfulCount(summary) / scanned : 0;
}

function researchSummaryIsPublishable(summary, minimumCoverage = 0.98) {
  if (summary?.partial === true || summary?.interrupted === true) return false;
  const threshold = Math.max(0, Math.min(1, Number(minimumCoverage) || 0.98));
  return researchSummarySuccessfulCount(summary) > 0
    && researchSummaryCoverage(summary) >= threshold;
}

function shouldPreferResearchSummary(incoming, current) {
  if (!incoming) return false;
  if (!current) return true;
  const incomingDate = String(incoming.analysisDate || incoming.baseDate || "").slice(0, 10);
  const currentDate = String(current.analysisDate || current.baseDate || "").slice(0, 10);
  const incomingSuccess = researchSummarySuccessfulCount(incoming);
  const currentSuccess = researchSummarySuccessfulCount(current);

  if (incomingDate !== currentDate) {
    if (incomingDate < currentDate) return false;
    if (researchSummaryIsPublishable(incoming)) return true;
    return !researchSummaryIsPublishable(current) && incomingSuccess > currentSuccess;
  }
  if (incomingSuccess !== currentSuccess) return incomingSuccess > currentSuccess;
  const incomingGeneratedAt = Date.parse(String(incoming.generatedAt || "")) || 0;
  const currentGeneratedAt = Date.parse(String(current.generatedAt || "")) || 0;
  return incomingGeneratedAt > currentGeneratedAt;
}

module.exports = Object.freeze({
  researchSummaryCoverage,
  researchSummaryIsPublishable,
  researchSummarySuccessfulCount,
  shouldPreferResearchSummary,
});
