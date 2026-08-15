export const AI_VALIDATION_SAMPLE_VERSION = "stratified-v8";

export const AI_VALIDATION_BALANCE_TAGS = Object.freeze([
  "size-large",
  "size-mid",
  "size-small",
  "volatility-low",
  "volatility-high",
  "trend-up",
  "trend-down",
  "range",
  "cyclical",
  "defensive",
  "index-independent",
  "range-dividend",
  "bank",
  "holding",
  "pharma-biotech",
  "export-cyclical",
]);

const TRADING_DAYS = 252;
const MAX_PROFILE_ROWS = 5 * TRADING_DAYS;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function quantile(values, probability) {
  const source = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!source.length) return 0;
  const position = clamp(probability, 0, 1) * (source.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return source[lower];
  return source[lower] + ((source[upper] - source[lower]) * (position - lower));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function validationIssuerKey(name, ticker = "") {
  const compact = String(name || "")
    .replace(/\s+/g, "")
    .replace(/(?:\d+)?우(?:B|C)?$/i, "")
    .replace(/우선주$/i, "")
    .trim();
  return compact || String(ticker || "").trim().toUpperCase();
}

function normalizePricePoints(series) {
  const byDate = new Map();
  if (Array.isArray(series?.rows)) {
    series.rows.forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const price = finite(row?.close ?? row?.price);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && price > 0) byDate.set(date, price);
    });
  } else {
    const dates = Array.isArray(series?.dates) ? series.dates : [];
    const prices = Array.isArray(series?.prices) ? series.prices : [];
    const limit = Math.min(dates.length, prices.length);
    for (let index = 0; index < limit; index += 1) {
      const date = String(dates[index] || "").slice(0, 10);
      const price = finite(prices[index]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && price > 0) byDate.set(date, price);
    }
  }
  return [...byDate.entries()]
    .map(([date, price]) => ({ date, price }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_PROFILE_ROWS);
}

function logarithmicReturns(points) {
  const output = [];
  for (let index = 1; index < points.length; index += 1) {
    output.push({
      date: points[index].date,
      value: Math.log(points[index].price / points[index - 1].price),
    });
  }
  return output;
}

function linearTrend(points) {
  if (points.length < 3) return { annualizedReturn: 0, rSquared: 0 };
  const values = points.map((point) => Math.log(point.price));
  const count = values.length;
  const xMean = (count - 1) / 2;
  const yMean = mean(values);
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  values.forEach((value, index) => {
    const xDelta = index - xMean;
    const yDelta = value - yMean;
    covariance += xDelta * yDelta;
    xVariance += xDelta ** 2;
    yVariance += yDelta ** 2;
  });
  const slope = xVariance > 0 ? covariance / xVariance : 0;
  const rSquared = xVariance > 0 && yVariance > 0
    ? clamp((covariance ** 2) / (xVariance * yVariance), 0, 1)
    : 0;
  return {
    annualizedReturn: Math.expm1(slope * TRADING_DAYS),
    rSquared,
  };
}

function maximumDrawdown(points) {
  let peak = 0;
  let drawdown = 0;
  points.forEach(({ price }) => {
    peak = Math.max(peak, price);
    if (peak > 0) drawdown = Math.min(drawdown, (price / peak) - 1);
  });
  return Math.abs(drawdown);
}

function benchmarkCorrelation(points, benchmarkSeries) {
  const left = new Map(logarithmicReturns(points).map((row) => [row.date, row.value]));
  const right = new Map(logarithmicReturns(normalizePricePoints(benchmarkSeries)).map((row) => [row.date, row.value]));
  const dates = [...left.keys()].filter((date) => right.has(date));
  if (dates.length < 60) return 0;
  const leftValues = dates.map((date) => left.get(date));
  const rightValues = dates.map((date) => right.get(date));
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < dates.length; index += 1) {
    const leftDelta = leftValues[index] - leftMean;
    const rightDelta = rightValues[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? clamp(covariance / denominator, -1, 1) : 0;
}

function cycleScore(points) {
  const byMonth = new Map();
  points.forEach((point) => byMonth.set(point.date.slice(0, 7), point.price));
  const prices = [...byMonth.values()];
  if (prices.length < 24) return 0;
  const changes = [];
  for (let index = 3; index < prices.length; index += 1) {
    changes.push(Math.sign(Math.log(prices[index] / prices[index - 3])));
  }
  let turns = 0;
  for (let index = 1; index < changes.length; index += 1) {
    if (changes[index] && changes[index - 1] && changes[index] !== changes[index - 1]) turns += 1;
  }
  const turnsPerYear = turns / Math.max(1, prices.length / 12);
  return clamp(turnsPerYear / 4, 0, 1);
}

function semanticFlags(candidate) {
  const text = [
    candidate?.name,
    candidate?.industry,
    candidate?.category,
    ...(Array.isArray(candidate?.themes) ? candidate.themes : []),
  ].filter(Boolean).join(" ");
  const bank = /금융지주|(?:KB|신한|하나|우리|BNK|JB|iM|DGB)금융|기업은행|제주은행|카카오뱅크|은행/i.test(text);
  const holding = /지주|홀딩스|홀딩|holding/i.test(text);
  const dividendDefensive = bank || /배당|리츠|보험|통신|KT&G|가스|전력/i.test(text);
  return {
    bank,
    holding,
    dividendDefensive,
    pharmaBiotech: /제약|바이오|의약|헬스케어/i.test(text),
    exportCyclical: /반도체|자동차|조선|화학|철강|기계|전기전자|수출/i.test(text),
  };
}

export function buildValidationCandidateProfile(candidate, options = {}) {
  const points = normalizePricePoints(candidate?.series);
  const returns = logarithmicReturns(points).map((row) => row.value);
  const trend = linearTrend(points);
  const annualizedVolatility = standardDeviation(returns) * Math.sqrt(TRADING_DAYS);
  const rangeScore = clamp(
    ((1 - trend.rSquared) * 0.55)
      + (clamp((0.12 - Math.abs(trend.annualizedReturn)) / 0.12, 0, 1) * 0.45),
    0,
    1,
  );
  return {
    ticker: String(candidate?.ticker || "").trim().toUpperCase(),
    name: String(candidate?.name || "").trim(),
    issuerKey: String(candidate?.issuerKey || validationIssuerKey(candidate?.name, candidate?.ticker)),
    market: String(candidate?.market || "").trim().toUpperCase(),
    marketRank: Math.max(1, Math.trunc(finite(candidate?.marketRank, 1))),
    marketUniverseSize: Math.max(1, Math.trunc(finite(candidate?.marketUniverseSize, 200))),
    marketCap: Math.max(0, finite(candidate?.marketCap, 0)),
    industry: String(candidate?.industry || candidate?.category || "").trim(),
    category: String(candidate?.category || candidate?.industry || "").trim(),
    rows: points.length,
    firstDate: points[0]?.date || "",
    lastDate: points.at(-1)?.date || "",
    annualizedVolatility,
    annualizedReturn: trend.annualizedReturn,
    trendRSquared: trend.rSquared,
    rangeScore,
    cycleScore: cycleScore(points),
    maximumDrawdown: maximumDrawdown(points),
    benchmarkCorrelation: benchmarkCorrelation(points, options.benchmarkSeries),
    semantic: semanticFlags(candidate),
    tags: [],
  };
}

export function assignValidationArchetypes(candidates) {
  const profiles = candidates.filter((candidate) => candidate?.ticker && candidate?.market);
  const thresholds = Object.fromEntries([...new Set(profiles.map((candidate) => candidate.market))].map((market) => {
    const marketProfiles = profiles.filter((candidate) => candidate.market === market);
    return [market, {
      lowVolatility: quantile(marketProfiles.map((candidate) => candidate.annualizedVolatility), 0.3),
      highVolatility: quantile(marketProfiles.map((candidate) => candidate.annualizedVolatility), 0.7),
      range: quantile(marketProfiles.map((candidate) => candidate.rangeScore), 0.7),
      cycle: quantile(marketProfiles.map((candidate) => candidate.cycleScore), 0.7),
      independent: quantile(marketProfiles.map((candidate) => Math.abs(candidate.benchmarkCorrelation)), 0.3),
    }];
  }));
  return profiles.map((profile) => {
    const marketThresholds = thresholds[profile.market];
    const rankRatio = profile.marketRank / Math.max(1, profile.marketUniverseSize);
    const tags = new Set();
    tags.add(rankRatio <= 1 / 3 ? "size-large" : (rankRatio <= 2 / 3 ? "size-mid" : "size-small"));
    if (profile.annualizedVolatility <= marketThresholds.lowVolatility) tags.add("volatility-low");
    else if (profile.annualizedVolatility >= marketThresholds.highVolatility) tags.add("volatility-high");
    else tags.add("volatility-mid");
    if (profile.rangeScore >= marketThresholds.range) tags.add("range");
    if (profile.annualizedReturn >= 0.06 && profile.trendRSquared >= 0.12) tags.add("trend-up");
    if (profile.annualizedReturn <= -0.04 && profile.trendRSquared >= 0.12) tags.add("trend-down");
    if (profile.cycleScore >= marketThresholds.cycle && profile.rangeScore >= 0.35) tags.add("cyclical");
    if (Math.abs(profile.benchmarkCorrelation) <= marketThresholds.independent) tags.add("index-independent");
    if (tags.has("volatility-low") && profile.maximumDrawdown <= 0.45) tags.add("defensive");
    if (profile.semantic.bank) tags.add("bank");
    if (profile.semantic.holding) tags.add("holding");
    if (profile.semantic.pharmaBiotech) tags.add("pharma-biotech");
    if (profile.semantic.exportCyclical) tags.add("export-cyclical");
    if (profile.semantic.dividendDefensive && (tags.has("range") || tags.has("volatility-low"))) {
      tags.add("range-dividend");
    }
    return { ...profile, tags: [...tags].sort() };
  });
}

function tagCoverage(candidates, tags = AI_VALIDATION_BALANCE_TAGS) {
  return Object.fromEntries(tags.map((tag) => [
    tag,
    candidates.filter((candidate) => candidate.tags.includes(tag)).length,
  ]));
}

function selectBalanced(candidates, marketTargets, tagTargets, seed) {
  const selected = [];
  const selectedTickers = new Set();
  const selectedIssuers = new Set();
  const marketCounts = Object.fromEntries(Object.keys(marketTargets).map((market) => [market, 0]));
  const tagCounts = Object.fromEntries(Object.keys(tagTargets).map((tag) => [tag, 0]));
  const total = Object.values(marketTargets).reduce((sum, value) => sum + value, 0);
  while (selected.length < total) {
    const available = candidates.filter((candidate) => (
      !selectedTickers.has(candidate.ticker)
      && !selectedIssuers.has(candidate.issuerKey || candidate.ticker)
      && marketCounts[candidate.market] < (marketTargets[candidate.market] || 0)
    ));
    if (!available.length) break;
    const ranked = available.map((candidate) => {
      const coverageGain = candidate.tags.reduce((sum, tag) => {
        const target = tagTargets[tag] || 0;
        if (!target || tagCounts[tag] >= target) return sum;
        return sum + (1 + ((target - tagCounts[tag]) / target));
      }, 0);
      const marketTarget = marketTargets[candidate.market] || 1;
      const marketNeed = (marketTarget - marketCounts[candidate.market]) / marketTarget;
      return {
        candidate,
        score: coverageGain + (marketNeed * 0.5),
        tie: stableHash(`${seed}|${candidate.ticker}`),
      };
    }).sort((left, right) => right.score - left.score || left.tie - right.tie);
    const winner = ranked[0].candidate;
    selected.push(winner);
    selectedTickers.add(winner.ticker);
    selectedIssuers.add(winner.issuerKey || winner.ticker);
    marketCounts[winner.market] += 1;
    winner.tags.forEach((tag) => {
      if (Object.prototype.hasOwnProperty.call(tagCounts, tag)) tagCounts[tag] += 1;
    });
  }
  return selected;
}

function marketSelection(candidates) {
  return Object.fromEntries([...new Set(candidates.map((candidate) => candidate.market))].sort().map((market) => [
    market,
    candidates.filter((candidate) => candidate.market === market).map((candidate) => candidate.ticker),
  ]));
}

function orderedCombinedSelection(development, holdout) {
  const markets = [...new Set([...development, ...holdout].map((candidate) => candidate.market))].sort();
  return Object.fromEntries(markets.map((market) => [market, [
    ...development.filter((candidate) => candidate.market === market).map((candidate) => candidate.ticker),
    ...holdout.filter((candidate) => candidate.market === market).map((candidate) => candidate.ticker),
  ]]));
}

export function buildStratifiedValidationDesign(candidates, options = {}) {
  const byIssuer = new Map();
  assignValidationArchetypes(candidates)
    .sort((left, right) => left.marketRank - right.marketRank || left.ticker.localeCompare(right.ticker))
    .forEach((profile) => {
      const key = `${profile.market}:${profile.issuerKey || profile.ticker}`;
      if (!byIssuer.has(key)) byIssuer.set(key, profile);
    });
  const profiles = [...byIssuer.values()];
  const markets = [...new Set(profiles.map((candidate) => candidate.market))].sort();
  const targetPerMarket = clamp(Math.trunc(finite(options.targetPerMarket, 100)), 20, 160);
  const minimumPerTag = clamp(Math.trunc(finite(options.minimumPerTag, 24)), 1, 60);
  const holdoutFraction = clamp(finite(options.holdoutFraction, 0.3), 0.15, 0.4);
  const seed = Math.trunc(finite(options.seed, 20260815));
  const availableCoverage = tagCoverage(profiles);
  const requestedAuditPerMarket = clamp(Math.trunc(finite(options.auditPerMarket, 25)), 5, 40);
  const requestedConfirmationAuditPerMarket = clamp(
    Math.trunc(finite(options.confirmationAuditPerMarket, requestedAuditPerMarket)),
    5,
    40,
  );
  const requestedBreadthPerMarket = clamp(Math.trunc(finite(options.breadthPerMarket, 30)), 0, 60);
  const confirmationTargets = Object.fromEntries(markets.map((market) => [
    market,
    Math.min(requestedConfirmationAuditPerMarket, profiles.filter((candidate) => candidate.market === market).length),
  ]));
  const confirmationTagTargets = Object.fromEntries(AI_VALIDATION_BALANCE_TAGS.map((tag) => {
    const available = availableCoverage[tag];
    const reserved = available >= 3
      ? Math.min(5, Math.max(1, Math.round(available * 0.20)))
      : 0;
    return [tag, reserved];
  }));
  const confirmationAudit = selectBalanced(
    profiles,
    confirmationTargets,
    confirmationTagTargets,
    seed ^ 0x165667B1,
  );
  const confirmationIssuers = new Set(
    confirmationAudit.map((candidate) => candidate.issuerKey || candidate.ticker),
  );
  const primaryAuditPool = profiles.filter(
    (candidate) => !confirmationIssuers.has(candidate.issuerKey || candidate.ticker),
  );
  const auditTargets = Object.fromEntries(markets.map((market) => [
    market,
    Math.min(requestedAuditPerMarket, primaryAuditPool.filter((candidate) => candidate.market === market).length),
  ]));
  const auditTagTargets = Object.fromEntries(AI_VALIDATION_BALANCE_TAGS.map((tag) => {
    const available = availableCoverage[tag];
    const reserved = available >= 2
      ? Math.min(5, Math.max(1, Math.round(available * 0.25)))
      : 0;
    return [tag, reserved];
  }));
  const audit = selectBalanced(primaryAuditPool, auditTargets, auditTagTargets, seed ^ 0x27D4EB2F);
  const auditIssuers = new Set(audit.map((candidate) => candidate.issuerKey || candidate.ticker));
  const selectionPool = profiles.filter((candidate) => (
    !auditIssuers.has(candidate.issuerKey || candidate.ticker)
    && !confirmationIssuers.has(candidate.issuerKey || candidate.ticker)
  ));
  const marketTargets = Object.fromEntries(markets.map((market) => [
    market,
    Math.min(targetPerMarket, selectionPool.filter((candidate) => candidate.market === market).length),
  ]));
  const selectionAvailableCoverage = tagCoverage(selectionPool);
  const tagTargets = Object.fromEntries(AI_VALIDATION_BALANCE_TAGS.map((tag) => [
    tag,
    Math.min(minimumPerTag, selectionAvailableCoverage[tag]),
  ]));
  const selected = selectBalanced(selectionPool, marketTargets, tagTargets, seed);
  const holdoutTargets = Object.fromEntries(markets.map((market) => [
    market,
    Math.max(1, Math.round((marketTargets[market] || 0) * holdoutFraction)),
  ]));
  const selectedCoverage = tagCoverage(selected);
  const holdoutTagTargets = Object.fromEntries(AI_VALIDATION_BALANCE_TAGS.map((tag) => [
    tag,
    Math.min(selectedCoverage[tag], Math.max(selectedCoverage[tag] > 0 ? 1 : 0, Math.round(selectedCoverage[tag] * holdoutFraction))),
  ]));
  const holdout = selectBalanced(selected, holdoutTargets, holdoutTagTargets, seed ^ 0x9E3779B9);
  const holdoutTickers = new Set(holdout.map((candidate) => candidate.ticker));
  const development = selected.filter((candidate) => !holdoutTickers.has(candidate.ticker));
  const occupiedIssuers = new Set([
    ...selected,
    ...audit,
    ...confirmationAudit,
  ].map((candidate) => candidate.issuerKey || candidate.ticker));
  const breadthPool = profiles.filter((candidate) => (
    !occupiedIssuers.has(candidate.issuerKey || candidate.ticker)
  ));
  const breadthTargets = Object.fromEntries(markets.map((market) => [
    market,
    Math.min(requestedBreadthPerMarket, breadthPool.filter((candidate) => candidate.market === market).length),
  ]));
  const breadthTagTargets = Object.fromEntries(AI_VALIDATION_BALANCE_TAGS.map((tag) => [
    tag,
    Math.min(5, breadthPool.filter((candidate) => candidate.tags.includes(tag)).length),
  ]));
  const breadthDevelopment = selectBalanced(
    breadthPool,
    breadthTargets,
    breadthTagTargets,
    seed ^ 0xD3A2646C,
  );
  const requestedFastPerMarket = clamp(Math.trunc(finite(options.fastPerMarket, 20)), 5, 50);
  const fastPerMarket = Math.min(requestedFastPerMarket, ...markets.map((market) => marketTargets[market] || 0));
  const fastDevelopmentTargets = Object.fromEntries(markets.map((market) => [market, Math.ceil(fastPerMarket / 2)]));
  const fastHoldoutTargets = Object.fromEntries(markets.map((market) => [market, Math.floor(fastPerMarket / 2)]));
  const fastTagTargets = Object.fromEntries(AI_VALIDATION_BALANCE_TAGS.map((tag) => [
    tag,
    Math.min(5, selectedCoverage[tag]),
  ]));
  const fastDevelopment = selectBalanced(development, fastDevelopmentTargets, fastTagTargets, seed ^ 0x85EBCA6B);
  const fastHoldout = selectBalanced(holdout, fastHoldoutTargets, fastTagTargets, seed ^ 0xC2B2AE35);
  const auditCoverage = tagCoverage(audit);
  const confirmationAuditCoverage = tagCoverage(confirmationAudit);
  const coverage = {
    available: availableCoverage,
    selected: selectedCoverage,
    development: tagCoverage(development),
    holdout: tagCoverage(holdout),
    audit: auditCoverage,
    confirmationAudit: confirmationAuditCoverage,
    breadthDevelopment: tagCoverage(breadthDevelopment),
    fast: tagCoverage([...fastDevelopment, ...fastHoldout]),
  };
  return {
    version: AI_VALIDATION_SAMPLE_VERSION,
    seed,
    targetPerMarket,
    minimumPerTag,
    holdoutFraction,
    selection: orderedCombinedSelection(development, holdout),
    development: marketSelection(development),
    holdout: marketSelection(holdout),
    audit: marketSelection(audit),
    confirmationAudit: marketSelection(confirmationAudit),
    breadthDevelopment: marketSelection(breadthDevelopment),
    fastSelection: orderedCombinedSelection(fastDevelopment, fastHoldout),
    profiles: Object.fromEntries([
      ...selected,
      ...audit,
      ...confirmationAudit,
      ...breadthDevelopment,
    ].map((candidate) => [candidate.ticker, {
      name: candidate.name,
      issuerKey: candidate.issuerKey,
      market: candidate.market,
      marketRank: candidate.marketRank,
      marketUniverseSize: candidate.marketUniverseSize,
      marketCap: candidate.marketCap,
      industry: candidate.industry,
      category: candidate.category,
      rows: candidate.rows,
      firstDate: candidate.firstDate,
      lastDate: candidate.lastDate,
      annualizedVolatility: candidate.annualizedVolatility,
      annualizedReturn: candidate.annualizedReturn,
      trendRSquared: candidate.trendRSquared,
      rangeScore: candidate.rangeScore,
      cycleScore: candidate.cycleScore,
      maximumDrawdown: candidate.maximumDrawdown,
      benchmarkCorrelation: candidate.benchmarkCorrelation,
      tags: candidate.tags,
    }])),
    coverage,
    deficits: AI_VALIDATION_BALANCE_TAGS.flatMap((tag) => (
      selectedCoverage[tag] < tagTargets[tag]
        ? [{ tag, target: tagTargets[tag], actual: selectedCoverage[tag] }]
        : []
    )),
    auditDeficits: AI_VALIDATION_BALANCE_TAGS.flatMap((tag) => (
      auditCoverage[tag] < auditTagTargets[tag]
        ? [{ tag, target: auditTagTargets[tag], actual: auditCoverage[tag] }]
        : []
    )),
    confirmationAuditDeficits: AI_VALIDATION_BALANCE_TAGS.flatMap((tag) => (
      confirmationAuditCoverage[tag] < confirmationTagTargets[tag]
        ? [{ tag, target: confirmationTagTargets[tag], actual: confirmationAuditCoverage[tag] }]
        : []
    )),
  };
}
