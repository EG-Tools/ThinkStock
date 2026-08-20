const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const SERIES_IDS = Object.freeze([
  "T10Y2Y",
  "T10Y3M",
  "UNRATE",
  "ICSA",
  "BAA10Y",
  "SAHMREALTIME",
  "FEDFUNDS",
]);

const EXTERNAL_RISK_SERIES_IDS = Object.freeze([
  "VIXCLS",
  "DEXKOUS",
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function daysBetween(left, right) {
  const leftMs = Date.parse(`${left}T00:00:00Z`);
  const rightMs = Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs)
    ? Math.max(0, Math.round((rightMs - leftMs) / DAY_MS))
    : Infinity;
}

function stageForScore(score) {
  if (score >= 75) return "crisis";
  if (score >= 50) return "warning";
  if (score >= 25) return "caution";
  return "stable";
}

export function normalizeFredObservations(observations) {
  const byDate = new Map();
  (Array.isArray(observations) ? observations : []).forEach((observation) => {
    const date = String(observation?.date || "").slice(0, 10);
    const value = finite(observation?.value);
    if (DATE_PATTERN.test(date) && value !== null) byDate.set(date, { date, value });
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function fredSeriesUrl(seriesId, apiKey, startDate = "1986-01-01") {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", startDate);
  url.searchParams.set("sort_order", "asc");
  return url.toString();
}

export async function fetchFredSeries(fetchImpl, apiKey, seriesId, startDate = "1986-01-01") {
  const response = await fetchImpl(fredSeriesUrl(seriesId, apiKey, startDate));
  if (!response.ok) throw new Error(`FRED ${seriesId} HTTP ${response.status}`);
  const payload = await response.json();
  const rows = normalizeFredObservations(payload?.observations);
  if (!rows.length) throw new Error(`FRED ${seriesId} returned no observations`);
  return rows;
}

function claimsSignals(rows) {
  return rows.map((row, index) => {
    const recent = rows.slice(Math.max(0, index - 3), index + 1);
    const average4 = recent.reduce((sum, item) => sum + item.value, 0) / recent.length;
    const priorStart = Math.max(0, index - 52);
    const prior = rows.slice(priorStart, Math.max(priorStart + 1, index));
    const priorLow = prior.length ? Math.min(...prior.map((item) => item.value)) : row.value;
    return {
      ...row,
      average4,
      riseFrom52WeekLow: priorLow > 0 ? average4 / priorLow - 1 : 0,
    };
  });
}

function cursorFor(rows) {
  let index = -1;
  return {
    advance(date) {
      while (index + 1 < rows.length && rows[index + 1].date <= date) index += 1;
      return index >= 0 ? rows[index] : null;
    },
    lag(observations) {
      const target = index - observations;
      return target >= 0 ? rows[target] : null;
    },
  };
}

function componentScores(state) {
  const {
    curveActive,
    inversionDays,
    daysSinceUninversion,
    daysSinceInversion,
    curveSpeed,
    bothCurvesInverted,
    sahm,
    claimsRise,
    creditSpread,
    creditWidening,
  } = state;

  let curve = 0;
  if (curveActive) {
    curve = 12 + clamp(inversionDays / 30, 0, 12) + (bothCurvesInverted ? 4 : 0);
  } else if (daysSinceUninversion <= 365) {
    curve = 24
      + clamp(curveSpeed / 0.8, 0, 1) * 10
      + clamp(1 - daysSinceUninversion / 365, 0, 1) * 6;
  } else if (daysSinceInversion <= 548) {
    curve = 8 + clamp(1 - daysSinceInversion / 548, 0, 1) * 8;
  }
  curve = clamp(curve, 0, 40);

  const sahmScore = clamp((sahm - 0.1) / 0.65, 0, 1) * 20;
  const claimsScore = clamp((claimsRise - 0.05) / 0.25, 0, 1) * 10;
  const labor = clamp(sahmScore + claimsScore, 0, 30);

  const spreadLevelScore = clamp((creditSpread - 1.5) / 2.5, 0, 1) * 20;
  const spreadChangeScore = clamp((creditWidening - 0.1) / 1.0, 0, 1) * 10;
  const credit = clamp(spreadLevelScore + spreadChangeScore, 0, 30);

  let score = clamp(curve + labor + credit, 0, 100);
  const unInversionRisk = !curveActive && daysSinceUninversion <= 365;
  if (unInversionRisk && labor < 8 && credit < 8) score = Math.min(score, 49);
  if (score >= 75 && (labor < 12 || credit < 10)) score = 74;

  return {
    score: Math.round(score),
    curve: Math.round(curve),
    labor: Math.round(labor),
    credit: Math.round(credit),
  };
}

export function buildCrisisSignalRows(series = {}) {
  const t10y2y = normalizeFredObservations(series.T10Y2Y);
  const t10y3m = normalizeFredObservations(series.T10Y3M);
  const unemployment = normalizeFredObservations(series.UNRATE);
  const claims = claimsSignals(normalizeFredObservations(series.ICSA));
  const credit = normalizeFredObservations(series.BAA10Y);
  const sahm = normalizeFredObservations(series.SAHMREALTIME);
  const fedFunds = normalizeFredObservations(series.FEDFUNDS);
  const vix = normalizeFredObservations(series.VIXCLS);
  const krwUsd = normalizeFredObservations(series.DEXKOUS);
  const dates = [...new Set([
    ...t10y2y.map((row) => row.date),
    ...t10y3m.map((row) => row.date),
    ...credit.map((row) => row.date),
    ...vix.map((row) => row.date),
    ...krwUsd.map((row) => row.date),
  ])].sort();
  if (!dates.length) return [];

  const cursors = {
    t10y2y: cursorFor(t10y2y),
    t10y3m: cursorFor(t10y3m),
    unemployment: cursorFor(unemployment),
    claims: cursorFor(claims),
    credit: cursorFor(credit),
    sahm: cursorFor(sahm),
    fedFunds: cursorFor(fedFunds),
    vix: cursorFor(vix),
    krwUsd: cursorFor(krwUsd),
  };
  const output = [];
  let inversionStart = "";
  let lastInversionDate = "";
  let lastUninversionDate = "";
  let previouslyActive = false;
  let lastOutputDate = "";
  let lastStage = "";

  dates.forEach((date, dateIndex) => {
    const spread2y = cursors.t10y2y.advance(date);
    const spread3m = cursors.t10y3m.advance(date);
    const unemploymentRow = cursors.unemployment.advance(date);
    const claimsRow = cursors.claims.advance(date);
    const creditRow = cursors.credit.advance(date);
    const sahmRow = cursors.sahm.advance(date);
    const fedFundsRow = cursors.fedFunds.advance(date);
    const vixRow = cursors.vix.advance(date);
    const krwUsdRow = cursors.krwUsd.advance(date);
    if (!spread2y && !spread3m) return;

    const values = [spread2y?.value, spread3m?.value].filter(Number.isFinite);
    const curveActive = values.some((value) => value < 0);
    const bothCurvesInverted = values.length === 2 && values.every((value) => value < 0);
    if (curveActive) {
      if (!previouslyActive) inversionStart = date;
      lastInversionDate = date;
    } else if (previouslyActive) {
      lastUninversionDate = date;
    }
    previouslyActive = curveActive;

    const lag2y = cursors.t10y2y.lag(63)?.value;
    const lag3m = cursors.t10y3m.lag(63)?.value;
    const curveMoves = [
      Number.isFinite(spread2y?.value) && Number.isFinite(lag2y) ? spread2y.value - lag2y : null,
      Number.isFinite(spread3m?.value) && Number.isFinite(lag3m) ? spread3m.value - lag3m : null,
    ].filter(Number.isFinite);
    const creditLag = cursors.credit.lag(63)?.value;
    const fedFundsLag = cursors.fedFunds.lag(6)?.value;
    const vixLag = cursors.vix.lag(20)?.value;
    const krwUsdLag = cursors.krwUsd.lag(20)?.value;
    const components = componentScores({
      curveActive,
      inversionDays: curveActive && inversionStart ? daysBetween(inversionStart, date) : 0,
      daysSinceUninversion: lastUninversionDate ? daysBetween(lastUninversionDate, date) : Infinity,
      daysSinceInversion: lastInversionDate ? daysBetween(lastInversionDate, date) : Infinity,
      curveSpeed: curveMoves.length ? Math.max(...curveMoves) : 0,
      bothCurvesInverted,
      sahm: sahmRow?.value ?? 0,
      claimsRise: claimsRow?.riseFrom52WeekLow ?? 0,
      creditSpread: creditRow?.value ?? 0,
      creditWidening: Number.isFinite(creditRow?.value) && Number.isFinite(creditLag)
        ? creditRow.value - creditLag
        : 0,
    });
    const stage = stageForScore(components.score);
    const row = {
      date,
      score: components.score,
      stage,
      curve: components.curve,
      labor: components.labor,
      credit: components.credit,
      t10y2y: spread2y?.value ?? null,
      t10y3m: spread3m?.value ?? null,
      unemployment: unemploymentRow?.value ?? null,
      initialClaims4w: Number.isFinite(claimsRow?.average4) ? Math.round(claimsRow.average4) : null,
      creditSpread: creditRow?.value ?? null,
      sahm: sahmRow?.value ?? null,
      fedFunds: fedFundsRow?.value ?? null,
      fedFundsChange6m: Number.isFinite(fedFundsRow?.value) && Number.isFinite(fedFundsLag)
        ? fedFundsRow.value - fedFundsLag
        : null,
      vix: vixRow?.value ?? null,
      vixChange20: Number.isFinite(vixRow?.value) && Number.isFinite(vixLag) && vixLag > 0
        ? vixRow.value / vixLag - 1
        : null,
      krwUsd: krwUsdRow?.value ?? null,
      krwUsdChange20: Number.isFinite(krwUsdRow?.value) && Number.isFinite(krwUsdLag) && krwUsdLag > 0
        ? krwUsdRow.value / krwUsdLag - 1
        : null,
      uninversion: !curveActive && lastUninversionDate && daysBetween(lastUninversionDate, date) <= 365,
    };
    const weeklyBoundary = !lastOutputDate || daysBetween(lastOutputDate, date) >= 7;
    const keep = weeklyBoundary || stage !== lastStage || dateIndex === dates.length - 1;
    if (keep) {
      output.push(row);
      lastOutputDate = date;
      lastStage = stage;
    } else if (dateIndex === dates.length - 1) {
      output[output.length - 1] = row;
    }
  });

  return output;
}

export async function fetchCrisisSignalSeries(fetchImpl, apiKey, options = {}) {
  const seriesIds = options.includeExternalRisk === true
    ? [...SERIES_IDS, ...EXTERNAL_RISK_SERIES_IDS]
    : SERIES_IDS;
  const entries = await Promise.all(seriesIds.map(async (seriesId) => [
    seriesId,
    await fetchFredSeries(fetchImpl, apiKey, seriesId),
  ]));
  return Object.fromEntries(entries);
}

export async function fetchCrisisSignalSources(fetchImpl, apiKey) {
  const [core, vix, krwUsd] = await Promise.allSettled([
    fetchCrisisSignalSeries(fetchImpl, apiKey),
    fetchFredSeries(fetchImpl, apiKey, "VIXCLS", "1990-01-01"),
    fetchFredSeries(fetchImpl, apiKey, "DEXKOUS"),
  ]);
  const errorText = (result) => result.status === "rejected"
    ? String(result.reason?.message || result.reason || "FRED refresh failed")
    : "";
  return Object.freeze({
    core: core.status === "fulfilled" ? core.value : null,
    vix: vix.status === "fulfilled" ? vix.value : null,
    krwUsd: krwUsd.status === "fulfilled" ? krwUsd.value : null,
    errors: Object.freeze({
      core: errorText(core),
      vix: errorText(vix),
      krwUsd: errorText(krwUsd),
    }),
  });
}

export { EXTERNAL_RISK_SERIES_IDS, SERIES_IDS };
