import macd from "../../docs/modules/macd-oscillator.mjs";
import timing from "../../docs/modules/market-timing.mjs";
import timingService from "../../docs/modules/market-timing-service.mjs";
import research from "../../docs/modules/stock-research.js";

if (!macd || !timing || !timingService || !research) {
  throw new Error("stock research worker dependencies are incomplete");
}

let shared = null;

globalThis.onmessage = (event) => {
  const id = Number(event.data?.id);
  if (!Number.isInteger(id)) return;
  try {
    if (event.data?.type === "init") {
      const incoming = event.data.shared || null;
      shared = incoming ? {
        ...incoming,
        koreanVolatilityRows: timing.buildKoreanVolatilityTimingRows(incoming.adrRows || []),
        externalVolatilityRows: timing.buildExternalVolatilityTimingRows(incoming.adrRows || []),
      } : null;
      if (shared) shared.timingFingerprint = timingService.sharedTimingFingerprint(shared);
      globalThis.postMessage({ id, ready: Boolean(shared) });
      return;
    }
    if (!shared) throw new Error("종목탐구 공통 데이터가 준비되지 않았습니다.");
    const item = event.data?.item || {};
    const ticker = String(item.ticker || "").trim().toUpperCase();
    const benchmarkRows = item.market === "KOSDAQ" ? shared.kosdaqRows : shared.kospiRows;
    const benchmarkByDate = new Map(benchmarkRows.map((row) => [row.date, row.close]));
    const rows = event.data?.rows || [];
    const dates = rows.map((row) => String(row?.date || "").slice(0, 10));
    const sources = {
      dates,
      pricesByTicker: {
        [ticker]: rows.map((row) => row?.close ?? null),
        [item.market === "KOSDAQ" ? "^KQ11" : "^KS11"]: dates.map(
          (date) => benchmarkByDate.get(date) ?? null,
        ),
      },
      volumesByTicker: {
        [ticker]: rows.map((row) => [row?.date, row?.volume ?? null]),
      },
      adrRows: shared.adrRows,
      macroRows: shared.macroRows,
      creditRows: shared.creditRows,
      crisisRows: shared.crisisRows,
      koreanVolatilityRows: shared.koreanVolatilityRows,
      externalVolatilityRows: shared.externalVolatilityRows,
    };
    const cachedRecord = event.data?.timingCacheRecord;
    const cachedModel = timingService.validTimingCacheRecord(
      cachedRecord,
      ticker,
      sources,
      shared.timingFingerprint,
    ) ? cachedRecord.model : null;
    let calculatedTimingModel = null;
    const candidate = research.assessTicker({
      item,
      rows,
      asOfDate: event.data?.asOfDate,
      minimumSignals: event.data?.minimumSignals,
      includeBuy: event.data?.includeBuy !== false,
      includeSell: event.data?.includeSell === true,
      todayOnly: event.data?.todayOnly === true,
      collectAllSignals: event.data?.collectAllSignals === true,
      benchmarkRows,
      adrRows: shared.adrRows,
      macroRows: shared.macroRows,
      creditRows: shared.creditRows,
      crisisRows: shared.crisisRows,
      koreanVolatilityRows: shared.koreanVolatilityRows,
      externalVolatilityRows: shared.externalVolatilityRows,
      koreanVolatilityPolicy: { enabled: true },
      externalVolatilityPolicy: { enabled: true },
      behaviorPolicy: timing.PROMOTED_RUNTIME_BEHAVIOR_POLICY,
      buildMacdOscillator: macd.buildMacdOscillator,
      buildMarketTimingSignals: timing.buildMarketTimingSignals,
      timingModel: cachedModel,
      onTimingModel: (model) => { calculatedTimingModel = model; },
    });
    globalThis.postMessage({
      id,
      candidate,
      timingCacheRecord: cachedModel
        ? null
        : timingService.createTimingCacheRecord(
          ticker,
          sources,
          calculatedTimingModel,
          shared.timingFingerprint,
        ),
    });
  } catch (error) {
    globalThis.postMessage({
      id,
      error: String(error?.message || error || "종목탐구 계산 실패"),
    });
  }
};
