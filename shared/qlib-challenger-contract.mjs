export const QLIB_KRX_MANIFEST_FORMAT = "thinkstock-qlib-krx-manifest-v2";
export const QLIB_CHALLENGER_REPORT_FORMAT = "thinkstock-qlib-challenger-report-v2";
export const QLIB_CHALLENGER_HORIZONS = Object.freeze([20, 63, 126]);

const REQUIRED_COHORTS = Object.freeze(["development", "holdout", "audit", "confirmationAudit"]);
const MARKETS = Object.freeze(["KOSPI", "KOSDAQ"]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function cohortTickers(source, cohort) {
  const value = source?.[cohort] || {};
  return uniqueStrings(MARKETS.flatMap((market) => value?.[market] || []));
}

function overlap(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function mergeMarketCohorts(...sources) {
  return Object.fromEntries(MARKETS.map((market) => [
    market,
    uniqueStrings(sources.flatMap((source) => source?.[market] || [])),
  ]));
}

function validateCohorts(cohorts) {
  const issues = [];
  const normalized = Object.fromEntries(REQUIRED_COHORTS.map((cohort) => [
    cohort,
    Object.fromEntries(MARKETS.map((market) => [
      market,
      uniqueStrings(cohorts?.[cohort]?.[market]),
    ])),
  ]));
  for (const cohort of REQUIRED_COHORTS) {
    for (const market of MARKETS) {
      if (!normalized[cohort][market].length) issues.push(`${cohort}-${market}-empty`);
    }
  }
  const flattened = Object.fromEntries(REQUIRED_COHORTS.map((cohort) => [
    cohort,
    cohortTickers(normalized, cohort),
  ]));
  for (let index = 0; index < REQUIRED_COHORTS.length; index += 1) {
    for (let other = index + 1; other < REQUIRED_COHORTS.length; other += 1) {
      const left = REQUIRED_COHORTS[index];
      const right = REQUIRED_COHORTS[other];
      if (overlap(flattened[left], flattened[right]).length) {
        issues.push(`${left}-${right}-overlap`);
      }
    }
  }
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    cohorts: Object.freeze(normalized),
    counts: Object.freeze(Object.fromEntries(REQUIRED_COHORTS.map((cohort) => [
      cohort,
      Object.freeze({
        total: flattened[cohort].length,
        ...Object.fromEntries(MARKETS.map((market) => [market, normalized[cohort][market].length])),
      }),
    ]))),
  });
}

export function buildQlibKrxManifest(prices, context, options = {}) {
  const cohorts = {
    development: mergeMarketCohorts(
      prices?.validationSplit?.development,
      prices?.breadthDevelopmentSelection,
    ),
    holdout: prices?.validationSplit?.holdout,
    audit: prices?.auditSelection,
    confirmationAudit: prices?.confirmationAuditSelection,
  };
  const cohortAudit = validateCohorts(cohorts);
  if (!cohortAudit.valid) {
    throw new Error(`Qlib cohort validation failed: ${cohortAudit.issues.join(", ")}`);
  }
  const series = prices?.series && typeof prices.series === "object" ? prices.series : {};
  const requiredTickers = REQUIRED_COHORTS.flatMap((cohort) => cohortTickers(cohorts, cohort));
  const missingSeries = uniqueStrings(requiredTickers).filter((ticker) => (
    !Array.isArray(series?.[ticker]?.dates)
    || !Array.isArray(series?.[ticker]?.prices)
    || series[ticker].dates.length !== series[ticker].prices.length
  ));
  if (missingSeries.length) {
    throw new Error(`Qlib source price series missing: ${missingSeries.slice(0, 10).join(", ")}`);
  }
  return Object.freeze({
    format: QLIB_KRX_MANIFEST_FORMAT,
    generatedAt: String(options.generatedAt || new Date().toISOString()),
    source: Object.freeze({
      prices: String(options.pricePath || ""),
      context: String(options.contextPath || ""),
      priceFormat: String(prices?.format || ""),
      contextFormat: String(context?.format || ""),
      priceFingerprint: String(options.priceFingerprint || ""),
      contextFingerprint: String(options.contextFingerprint || ""),
      priceEndDate: String(prices?.endDate || ""),
      contextGeneratedAt: String(context?.generatedAt || ""),
    }),
    market: Object.freeze({
      code: "KR",
      timezone: "Asia/Seoul",
      frequency: "day",
      tradeUnit: 1,
      dailyLimitThreshold: 0.30,
      adjustedClose: true,
      suspendedDayPolicy: "missing-observation",
      benchmarkByMarket: Object.freeze({ KOSPI: "^KS11", KOSDAQ: "^KQ11" }),
    }),
    validation: Object.freeze({
      sampleVersion: String(prices?.validationSampling?.version || ""),
      seed: Math.trunc(finite(prices?.seed, 20260815)),
      horizons: QLIB_CHALLENGER_HORIZONS,
      sampleStepTradingDays: 5,
      minimumHistoryTradingDays: 252,
      splitPolicy: "ticker-disjoint cohorts plus purged chronological development split",
      target: "forward-excess-log-return-versus-market-benchmark",
      task: "cross-sectional-ranking",
      auditPolicy: "audit cohort remains unread until holdout gate passes",
      confirmationAuditPolicy: "confirmation audit remains unread until the primary audit gate passes",
      repeatPassPolicy: "holdout, primary audit and confirmation audit must each pass at least two horizons",
      runtimePolicy: "research-only until matched-anchor comparison beats the ThinkStock champion",
      cohorts: cohortAudit.cohorts,
      counts: cohortAudit.counts,
      profiles: Object.freeze({ ...(prices?.validationSampling?.profiles || {}) }),
    }),
    dataQuality: Object.freeze({
      ...(prices?.dataQuality || {}),
      volumeCoverage: finite(prices?.dataQuality?.volumeSeries)
        / Math.max(1, finite(prices?.dataQuality?.requiredSeries, 1)),
      survivorshipBiasReduced: REQUIRED_COHORTS
        .flatMap((cohort) => cohortTickers(cohortAudit.cohorts, cohort)).length > 200,
      survivorshipBiasRemoved: finite(prices?.dataQuality?.delistedSeries) > 0
        && finite(prices?.dataQuality?.pointInTimeMarketCapSeries) > 0,
    }),
    featureFamilies: Object.freeze([
      "price-momentum",
      "price-reversal",
      "realized-volatility",
      "drawdown-position",
      "market-relative",
      "market-beta-correlation",
      "leading-cycle-policy-trade",
      "credit-deposit",
      "adr-sentiment",
      "fear-volatility",
      "rates-labor-credit-risk",
      "volume-turnover-liquidity",
      "industry-archetype-specialists",
    ]),
    limitations: Object.freeze([
      "The challenger predicts benchmark-relative excess return from adjusted price, volume, market and point-in-time macro data.",
      "Lower-ranked research-cache stocks reduce top-universe bias, but true delisted membership remains unavailable until historical KRX snapshots are populated.",
      "Latest market-cap snapshots are sampling metadata only and are excluded from historical model features.",
      "Passing the Qlib baseline gate does not publish or blend the model into the browser runtime.",
    ]),
  });
}

function metricsPass(metrics, options = {}) {
  const minimumSamples = Math.max(1, Math.trunc(finite(options.minimumSamples, 100)));
  const samples = Math.max(0, Math.trunc(finite(metrics?.samples)));
  const improvement = finite(metrics?.improvementVsNoChange, -Infinity);
  const direction = finite(metrics?.directionAccuracy, -Infinity);
  const rankIc = finite(metrics?.meanDailyRankIc, -Infinity);
  const issues = [];
  if (samples < minimumSamples) issues.push("insufficient-samples");
  if (!(improvement > 0)) issues.push("no-change-not-beaten");
  if (!(direction >= 0.5)) issues.push("direction-below-half");
  if (!(rankIc > 0)) issues.push("rank-ic-not-positive");
  return Object.freeze({ passed: issues.length === 0, issues: Object.freeze(issues) });
}

function rankingMetricsPass(metrics, options = {}) {
  const minimumSamples = Math.max(1, Math.trunc(finite(options.minimumSamples, 100)));
  const minimumRankIcDays = Math.max(1, Math.trunc(finite(options.minimumRankIcDays, 20)));
  const samples = Math.max(0, Math.trunc(finite(metrics?.samples)));
  const rankIc = finite(metrics?.meanDailyRankIc, -Infinity);
  const rankIcDays = Math.max(0, Math.trunc(finite(metrics?.rankIcDays)));
  const spread = finite(metrics?.topBottomActualSpread, -Infinity);
  const issues = [];
  if (samples < minimumSamples) issues.push("insufficient-samples");
  if (rankIcDays < minimumRankIcDays) issues.push("insufficient-rank-ic-days");
  if (!(rankIc >= 0.02)) issues.push("rank-ic-below-two-percent");
  if (!(spread > 0)) issues.push("top-bottom-spread-not-positive");
  return Object.freeze({ passed: issues.length === 0, issues: Object.freeze(issues) });
}

export function evaluateQlibChallengerReport(report, options = {}) {
  const errors = [];
  if (report?.format !== QLIB_CHALLENGER_REPORT_FORMAT) errors.push("report-format-invalid");
  if (report?.backend?.qlib !== true) errors.push("qlib-backend-not-confirmed");
  if (report?.market?.code !== "KR") errors.push("market-not-korea");
  if (finite(report?.market?.dailyLimitThreshold) !== 0.30) errors.push("korea-limit-rule-missing");
  const holdout = {};
  const task = String(report?.task || "absolute-return");
  const evaluateMetrics = task === "cross-sectional-ranking" ? rankingMetricsPass : metricsPass;
  for (const horizon of QLIB_CHALLENGER_HORIZONS) {
    holdout[horizon] = evaluateMetrics(report?.horizons?.[horizon]?.holdout, options);
  }
  const holdoutWins = Object.values(holdout).filter((value) => value.passed).length;
  const holdoutPassed = holdoutWins >= 2;
  const audit = {};
  let auditWins = 0;
  const auditCompleted = ["completed", "reused-sealed"].includes(report?.audit?.status);
  if (holdoutPassed && auditCompleted) {
    for (const horizon of QLIB_CHALLENGER_HORIZONS) {
      audit[horizon] = evaluateMetrics(report?.horizons?.[horizon]?.audit, options);
    }
    auditWins = Object.values(audit).filter((value) => value.passed).length;
  }
  const auditPassed = holdoutPassed
    && auditCompleted
    && auditWins >= 2;
  const confirmationAudit = {};
  let confirmationAuditWins = 0;
  const confirmationAuditCompleted = ["completed", "reused-sealed"].includes(
    report?.confirmationAudit?.status,
  );
  if (auditPassed && confirmationAuditCompleted) {
    for (const horizon of QLIB_CHALLENGER_HORIZONS) {
      confirmationAudit[horizon] = evaluateMetrics(
        report?.horizons?.[horizon]?.confirmationAudit,
        options,
      );
    }
    confirmationAuditWins = Object.values(confirmationAudit).filter((value) => value.passed).length;
  }
  const confirmationAuditPassed = auditPassed
    && confirmationAuditCompleted
    && confirmationAuditWins >= 2;
  const matchedAnchorPassed = report?.matchedAnchor?.passed === true;
  const dataQualityPassed = report?.dataQuality?.runtimeEligible === true;
  const runtimeIntegrationEligible = errors.length === 0
    && confirmationAuditPassed
    && matchedAnchorPassed
    && dataQualityPassed;
  let nextStep = "keep-thinkstock-champion";
  if (runtimeIntegrationEligible) {
    nextStep = "export-small-qlib-assist";
  } else if (confirmationAuditPassed) {
    nextStep = dataQualityPassed
      ? "matched-anchor-comparison-required"
      : "data-quality-required";
  } else if (auditPassed) {
    nextStep = confirmationAuditCompleted
      ? "keep-thinkstock-champion"
      : "confirmation-audit-required";
  } else if (holdoutPassed) {
    nextStep = auditCompleted
      ? "keep-thinkstock-champion"
      : "primary-audit-required";
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    holdoutPassed,
    holdoutWins,
    auditPassed,
    auditWins,
    holdout: Object.freeze(holdout),
    audit: Object.freeze(audit),
    confirmationAuditPassed,
    confirmationAuditWins,
    confirmationAudit: Object.freeze(confirmationAudit),
    matchedAnchorPassed,
    dataQualityPassed,
    researchCandidate: errors.length === 0 && confirmationAuditPassed,
    runtimeIntegrationEligible,
    nextStep,
  });
}
