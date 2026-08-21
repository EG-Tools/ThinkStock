const moduleVersion = new URL(self.location.href).searchParams.get("v") || "dev";
const versionQuery = `?v=${encodeURIComponent(moduleVersion)}`;
importScripts(
  `./macd-oscillator.js${versionQuery}`,
  `./market-timing.js${versionQuery}`,
  `./stock-research-contract.js${versionQuery}`,
  `./stock-research.js${versionQuery}`,
);

const macd = self.ThinkStockMacdOscillator;
const timing = self.ThinkStockMarketTiming;
const research = self.ThinkStockStockResearch;
let shared = null;

self.onmessage = (event) => {
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
      self.postMessage({ id, ready: Boolean(shared) });
      return;
    }
    if (!shared) throw new Error("종목탐구 공통 데이터가 준비되지 않았습니다.");
    const item = event.data?.item || {};
    const candidate = research.assessTicker({
      item,
      rows: event.data?.rows || [],
      asOfDate: event.data?.asOfDate,
      minimumSignals: event.data?.minimumSignals,
      includeBuy: event.data?.includeBuy !== false,
      includeSell: event.data?.includeSell === true,
      todayOnly: event.data?.todayOnly === true,
      collectAllSignals: event.data?.collectAllSignals === true,
      benchmarkRows: item.market === "KOSDAQ" ? shared.kosdaqRows : shared.kospiRows,
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
    });
    self.postMessage({ id, candidate });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error || "종목탐구 계산 실패") });
  }
};
