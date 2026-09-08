const DART_GATEWAY_URL = "https://thinkstock-api.keg0320.workers.dev";

function createAppRuntimeEnvironment(scope = globalThis) {
  const location = scope.location;
  const isE2eRuntime = Boolean(
    location && new URLSearchParams(location.search || "").has("e2e"),
  );
  const isLocalRuntime = Boolean(
    location
    && !isE2eRuntime
    && location.protocol === "http:"
    && (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      || /^10\./.test(location.hostname)
      || /^192\.168\./.test(location.hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(location.hostname)),
  );
  const gatewayEndpoint = (path) => `${DART_GATEWAY_URL}${path}`;

  return Object.freeze({
    endpoints: Object.freeze({
      adr: gatewayEndpoint("/api/adr"),
      adminSession: isLocalRuntime ? "/api/admin/session" : gatewayEndpoint("/api/admin/session"),
      aiAnalysis: isLocalRuntime ? "./api/analysis" : gatewayEndpoint("/api/analysis"),
      aiForecastJournal: gatewayEndpoint("/api/forecast-journal"),
      brokerReportList: isLocalRuntime ? "./api/broker-reports" : gatewayEndpoint("/api/broker-reports"),
      brokerReportPdf: isLocalRuntime ? "./api/broker-report-pdf" : gatewayEndpoint("/api/broker-report-pdf"),
      credit: gatewayEndpoint("/api/credit"),
      crisisSignal: gatewayEndpoint("/api/crisis-signal"),
      dartAuthCheck: gatewayEndpoint("/api/auth/check"),
      dartDisclosure: gatewayEndpoint("/api/dart/disclosures"),
      dartEps: gatewayEndpoint("/api/dart/eps-history"),
      dartInsider: gatewayEndpoint("/api/dart/insider-trades"),
      ecosMacro: gatewayEndpoint("/api/macro"),
      krxIndex: gatewayEndpoint("/api/indices"),
      krxPrice: gatewayEndpoint("/api/prices"),
      krxPriceBatch: gatewayEndpoint("/api/prices/batch"),
      runtimeBootstrap: gatewayEndpoint("/api/bootstrap"),
      tickerHistory: isLocalRuntime ? "./api/research/history" : gatewayEndpoint("/api/research/history"),
    }),
    gatewayUrl: DART_GATEWAY_URL,
    isE2eRuntime,
    isLocalRuntime,
    sources: Object.freeze({
      aiMarketModel: "./data/ai_market_model.json",
      fearGreedHistory: "https://kospi.feargreedchart.com/api/?action=kospi-history",
      fearGreedLatest: "https://kospi.feargreedchart.com/api/?action=kospi",
    }),
  });
}

export { createAppRuntimeEnvironment };
