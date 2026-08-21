import { number } from "./market-timing-evaluation.mjs";

export function buildTimingSignalOutcome({
  signal,
  type,
  series,
  ticker,
  startDate = "2011-01-01",
}) {
  const actionDate = String(signal?.confirmationDate || signal?.date || "").slice(0, 10);
  const markerDate = String(signal?.date || "").slice(0, 10);
  const actionIndex = series?.dateIndexes?.get(actionDate);
  const markerIndex = series?.dateIndexes?.get(markerDate);
  if (!Number.isInteger(actionIndex) || !Number.isInteger(markerIndex)) return null;
  if (actionDate < startDate || actionIndex + 63 >= series.prices.length) return null;
  const actionPrice = number(series.prices[actionIndex]);
  const markerPrice = number(series.prices[markerIndex]);
  if (!(actionPrice > 0 && markerPrice > 0)) return null;
  const future20 = series.prices
    .slice(actionIndex + 1, actionIndex + 21)
    .filter((value) => number(value) > 0);
  const future63 = series.prices
    .slice(actionIndex + 1, actionIndex + 64)
    .filter((value) => number(value) > 0);
  if (future20.length < 15 || future63.length < 45) return null;
  const end5 = number(series.prices[actionIndex + 5]);
  const end10 = number(series.prices[actionIndex + 10]);
  const end20 = number(series.prices[actionIndex + 20]);
  const end63 = number(series.prices[actionIndex + 63]);
  if (!(end5 > 0 && end10 > 0 && end20 > 0 && end63 > 0)) return null;
  const local = series.prices
    .slice(Math.max(0, markerIndex - 4), Math.min(series.prices.length, markerIndex + 5))
    .filter((value) => number(value) > 0);
  const isStock = /^\d{6}\.(KS|KQ)$/.test(ticker);
  const excursionThreshold = isStock ? 0.07 : 0.04;
  const excursionTolerance = 1e-10;
  const return5 = (end5 / actionPrice) - 1;
  const return10 = (end10 / actionPrice) - 1;
  const return20 = (end20 / actionPrice) - 1;
  const return63 = (end63 / actionPrice) - 1;
  const future10 = future20.slice(0, 10);
  const maximum10 = (Math.max(...future10) / actionPrice) - 1;
  const minimum10 = (Math.min(...future10) / actionPrice) - 1;
  const maximum20 = (Math.max(...future20) / actionPrice) - 1;
  const minimum20 = (Math.min(...future20) / actionPrice) - 1;
  const directionSign = type === "buy" ? 1 : -1;
  const turningDistance = type === "buy"
    ? (markerPrice / Math.min(...local)) - 1
    : 1 - (markerPrice / Math.max(...local));
  const direction5 = type === "buy" ? return5 > 0 : return5 < 0;
  const direction10 = type === "buy" ? return10 > 0 : return10 < 0;
  const direction20 = type === "buy" ? return20 > 0 : return20 < 0;
  const direction63 = type === "buy" ? return63 > 0 : return63 < 0;
  const excursion10Hit = type === "buy"
    ? maximum10 >= excursionThreshold - excursionTolerance
    : minimum10 <= -excursionThreshold + excursionTolerance;
  const excursionHit = type === "buy"
    ? maximum20 >= excursionThreshold - excursionTolerance
    : minimum20 <= -excursionThreshold + excursionTolerance;
  const daysToExcursion20 = future20.findIndex((price) => (
    type === "buy"
      ? (price / actionPrice) - 1 >= excursionThreshold - excursionTolerance
      : (price / actionPrice) - 1 <= -excursionThreshold + excursionTolerance
  ));
  return {
    ticker,
    market: ticker === "^KS11" || ticker.endsWith(".KS") ? "KOSPI" : "KOSDAQ",
    kind: isStock ? "stock" : "index",
    type,
    date: markerDate,
    actionDate,
    return5,
    return10,
    return20,
    return63,
    directional5: return5 * directionSign,
    directional10: return10 * directionSign,
    directional20: return20 * directionSign,
    directional63: return63 * directionSign,
    adverse20: type === "buy" ? Math.min(0, minimum20) : Math.min(0, -maximum20),
    favorable20: type === "buy" ? Math.max(0, maximum20) : Math.max(0, -minimum20),
    maximum10,
    minimum10,
    maximum20,
    minimum20,
    turningDistance,
    direction5,
    direction10,
    direction20,
    direction63,
    persistentDirection: direction20 && direction63,
    excursion10Hit,
    excursionHit,
    daysToExcursion20: daysToExcursion20 >= 0 ? daysToExcursion20 + 1 : null,
    vkospi: number(signal?.vkospi),
    vkospiPercentile: number(signal?.vkospiPercentile),
    vkospiChange5: number(signal?.vkospiChange5),
    vkospiChange20: number(signal?.vkospiChange20),
    behavior: String(signal?.behaviorProfile?.dominant || "unclassified"),
    marketRegime: String(signal?.marketRegime || "unclassified"),
    signalFamily: String(signal?.signalFamily || "legacy"),
    signalRole: String(signal?.signalRole || "predictive"),
    calibrationObjective: String(signal?.calibration?.objective || "terminal"),
    calibration: signal?.calibration ? {
      samples: number(signal.calibration.samples),
      hitRate: number(signal.calibration.hitRate),
      smoothedHitRate: number(signal.calibration.smoothedHitRate),
      meanDirectionalReturn: number(signal.calibration.meanDirectionalReturn),
      meanFavorableReturn: number(signal.calibration.meanFavorableReturn),
      meanObjectiveReturn: number(signal.calibration.meanObjectiveReturn),
      cohort: String(signal.calibration.cohort || ""),
      status: String(signal.calibration.status || ""),
    } : null,
    score: number(signal?.score),
    evidenceCount: number(signal?.evidenceCount),
    signalGrade: String(signal?.signalGrade || ""),
    setupReasons: Array.isArray(signal?.setupReasons) ? signal.setupReasons : [],
    triggerReasons: Array.isArray(signal?.triggerReasons) ? signal.triggerReasons : [],
    price20d: number(signal?.price20d),
    price60d: number(signal?.price60d),
    price120d: number(signal?.price120d),
    price252d: number(signal?.price252d),
    price756d: number(signal?.price756d),
    price1260d: number(signal?.price1260d),
    structuralDirection: String(signal?.behaviorProfile?.structural?.trendDirection || ""),
    structuralAnnualReturn: number(signal?.behaviorProfile?.structural?.annualReturn),
    structuralDirectionConsistency: number(
      signal?.behaviorProfile?.structural?.directionConsistency,
    ),
    volatilityScale: number(signal?.volatilityScale),
    tags: Array.isArray(series.tags) ? series.tags : [],
  };
}
