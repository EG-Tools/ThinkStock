const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateText(value) {
  const date = String(value || "").slice(0, 10);
  return DATE_PATTERN.test(date) ? date : "";
}

export function auditWalkforwardPointInTime(report, options = {}) {
  const maximumExamples = Math.max(1, Number(options.maximumExamples) || 20);
  const issueCounts = {};
  const examples = [];
  let auditedSourceDates = 0;

  function issue(kind, row, detail = "") {
    issueCounts[kind] = (issueCounts[kind] || 0) + 1;
    if (examples.length >= maximumExamples) return;
    examples.push({
      kind,
      series: String(row?.series || ""),
      cutoff: dateText(row?.cutoff),
      targetDate: dateText(row?.targetDate),
      detail: String(detail || "").slice(0, 160),
    });
  }

  const observations = Array.isArray(report?.observations) ? report.observations : [];
  observations.forEach((row) => {
    const cutoff = dateText(row?.cutoff);
    const targetDate = dateText(row?.targetDate);
    const asOfDate = dateText(row?.audit?.asOfDate);
    const priceAsOfDate = dateText(row?.audit?.priceAsOfDate) || asOfDate;
    if (!cutoff) issue("invalid-cutoff", row);
    if (!targetDate || (cutoff && targetDate <= cutoff)) issue("target-not-after-cutoff", row);
    if (!asOfDate || (cutoff && asOfDate !== cutoff)) {
      issue("audit-as-of-mismatch", row, `audit=${asOfDate || "missing"}`);
    }
    if (!priceAsOfDate || (cutoff && priceAsOfDate !== cutoff)) {
      issue("audit-price-as-of-mismatch", row, `price=${priceAsOfDate || "missing"}`);
    }
    Object.entries(row?.audit?.sourceDates || {}).forEach(([source, value]) => {
      if (!value) return;
      auditedSourceDates += 1;
      const sourceDate = dateText(value);
      if (!sourceDate) issue("invalid-source-date", row, `${source}=${value}`);
      else if (cutoff && sourceDate > cutoff) issue("future-source-date", row, `${source}=${sourceDate}`);
    });
    const families = row?.audit?.featureFamilies;
    if (families && typeof families === "object") {
      Object.entries(families).forEach(([family, value]) => {
        const available = Number(value?.count ?? value?.available ?? 0);
        const sourceDate = dateText(value?.latestDate);
        if (available > 0 && !sourceDate && !["price", "market"].includes(family)) {
          issue("feature-family-date-missing", row, family);
        } else if (sourceDate && cutoff && sourceDate > cutoff) {
          issue("future-feature-family", row, `${family}=${sourceDate}`);
        }
      });
    }
    if (!(Number(row?.basePrice) > 0) || !(Number(row?.predictedPrice) > 0)) {
      issue("invalid-price", row);
    }
  });

  if (report?.sourceCoverage?.currentTop400ArtifactUsed === true) {
    issue("future-trained-artifact", null, "current top-400 artifact used");
  }
  if (!observations.length) issue("empty-report", null);

  return Object.freeze({
    format: "thinkstock-ai-point-in-time-audit-v1",
    passed: Object.keys(issueCounts).length === 0,
    observations: observations.length,
    auditedSourceDates,
    issueCounts: Object.freeze({ ...issueCounts }),
    examples: Object.freeze(examples),
  });
}
