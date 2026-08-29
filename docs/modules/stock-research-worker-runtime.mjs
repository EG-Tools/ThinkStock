function requireDependency(value, label) {
  if (!value) throw new Error(`stock research worker ${label} dependency is incomplete`);
  return value;
}

function createStockResearchWorkerRuntime(options = {}) {
  const macd = requireDependency(options.macd, "MACD");
  const timing = requireDependency(options.timing, "timing");
  const timingService = requireDependency(options.timingService, "timing service");
  const research = requireDependency(options.research, "model");
  let shared = null;

  function initialize(incoming) {
    shared = incoming ? {
      ...incoming,
      koreanVolatilityRows: timing.buildKoreanVolatilityTimingRows(incoming.adrRows || []),
      externalVolatilityRows: timing.buildExternalVolatilityTimingRows(incoming.adrRows || []),
    } : null;
    if (shared) shared.timingFingerprint = timingService.sharedTimingFingerprint(shared);
    return Boolean(shared);
  }

  function analyze(message = {}) {
    if (!shared) throw new Error("종목탐구 공통 데이터가 준비되지 않았습니다.");
    const item = message.item || {};
    const ticker = String(item.ticker || "").trim().toUpperCase();
    const benchmarkRows = item.market === "KOSDAQ" ? shared.kosdaqRows : shared.kospiRows;
    const benchmarkByDate = new Map((benchmarkRows || []).map((row) => [row.date, row.close]));
    const rows = message.rows || [];
    const dates = rows.map((row) => String(row?.date || "").slice(0, 10));
    const sources = {
      dates,
      pricesByTicker: {
        [ticker]: rows.map((row) => row?.close ?? null),
        [item.market === "KOSDAQ" ? "^KQ11" : "^KS11"]: dates.map(
          (date) => benchmarkByDate.get(date) ?? null,
        ),
      },
      volumesByTicker: { [ticker]: rows.map((row) => [row?.date, row?.volume ?? null]) },
      adrRows: shared.adrRows,
      macroRows: shared.macroRows,
      creditRows: shared.creditRows,
      crisisRows: shared.crisisRows,
      koreanVolatilityRows: shared.koreanVolatilityRows,
      externalVolatilityRows: shared.externalVolatilityRows,
    };
    const cachedRecord = message.timingCacheRecord;
    const cachedModel = timingService.validTimingCacheRecord(
      cachedRecord, ticker, sources, shared.timingFingerprint,
    ) ? cachedRecord.model : null;
    let calculatedTimingModel = null;
    const candidate = research.assessTicker({
      item,
      rows,
      asOfDate: message.asOfDate,
      minimumSignals: message.minimumSignals,
      includeBuy: message.includeBuy !== false,
      includeSell: message.includeSell === true,
      signalWindowDays: message.signalWindowDays,
      todayOnly: message.todayOnly === true,
      collectAllSignals: message.collectAllSignals === true,
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
    return {
      candidate,
      timingCacheRecord: cachedModel ? null : timingService.createTimingCacheRecord(
        ticker, sources, calculatedTimingModel, shared.timingFingerprint,
      ),
    };
  }

  function handle(message = {}) {
    const id = Number(message?.id);
    if (!Number.isInteger(id)) return null;
    if (message.type === "init") return { id, ready: initialize(message.shared || null) };
    return { id, ...analyze(message) };
  }

  return Object.freeze({ analyze, handle, initialize, isReady: () => Boolean(shared) });
}

function bindStockResearchWorker(scope = globalThis, runtime) {
  if (!runtime?.handle || typeof scope?.postMessage !== "function") {
    throw new Error("stock research worker binding dependencies are incomplete");
  }
  const onMessage = (event) => {
    const id = Number(event.data?.id);
    if (!Number.isInteger(id)) return;
    try {
      const response = runtime.handle(event.data);
      if (response) scope.postMessage(response);
    } catch (error) {
      scope.postMessage({ id, error: String(error?.message || error || "종목탐구 계산 실패") });
    }
  };
  scope.onmessage = onMessage;
  return Object.freeze({
    dispose() { if (scope.onmessage === onMessage) scope.onmessage = null; },
  });
}

export { bindStockResearchWorker, createStockResearchWorkerRuntime };
