(function initThinkStockBrokerResearchRuntime(globalScope) {
  "use strict";

  function toReferenceOnlySummary(current, referenceReport, asOfDate = "") {
    const currentReference = current?.representativeReports?.reference || null;
    const nextReference = referenceReport?.sourceUrl ? referenceReport : null;
    const reference = currentReference?.publishedDate
      && String(currentReference.publishedDate) > String(nextReference?.publishedDate || "")
      ? currentReference
      : (nextReference || currentReference);
    if (!reference?.sourceUrl) return null;
    return Object.freeze({
      asOfDate: current?.asOfDate || String(asOfDate || "").slice(0, 10),
      latestDate: [current?.latestDate, reference.publishedDate]
        .filter(Boolean).sort().at(-1) || "",
      latestAvailableDate: [current?.latestAvailableDate, reference.availableDate]
        .filter(Boolean).sort().at(-1) || "",
      reportCount: 0,
      referenceReportCount: Math.max(1, Number(current?.referenceReportCount) || 0),
      brokerCount: Math.max(1, Number(current?.brokerCount) || 0),
      usedReportIds: Object.freeze([]),
      signal: 0,
      confidence: 0,
      adjustment: 0,
      primaryCoverage: 0,
      primaryConflict: false,
      targetRevisionChange: null,
      representativeReports: Object.freeze({
        reference,
      }),
    });
  }

  const mergeReferenceSummary = toReferenceOnlySummary;

  function createBrokerResearchRuntime(scope = globalScope, options = {}) {
    const cacheModule = options.cacheModule;
    const parser = options.parser;
    if (!cacheModule?.createBrokerReportClient || !cacheModule?.createBrokerResearchCache || !parser) {
      throw new Error("Broker research runtime dependencies are incomplete");
    }
    const client = cacheModule.createBrokerReportClient(scope, {
      listEndpoint: options.listEndpoint,
      pdfEndpoint: options.pdfEndpoint,
      fetchWithTimeout: options.fetchWithTimeout,
      getAsOfDate: options.getAsOfDate,
      getHeaders: options.getHeaders,
    });
    let workerClient = null;
    if (options.workerModule?.createBrokerReportWorkerClient && options.workerUrl) {
      try {
        workerClient = options.workerModule.createBrokerReportWorkerClient(scope, {
          workerUrl: options.workerUrl,
          timeoutMs: options.workerTimeoutMs,
        });
      } catch (_) {}
    }
    const cache = cacheModule.createBrokerResearchCache(scope, {
      parser,
      pdfModuleUrl: options.pdfModuleUrl,
      pdfWorkerUrl: options.pdfWorkerUrl,
      extractPdfPages: workerClient ? (bytes) => workerClient.extractPages(bytes) : null,
      read: options.read,
      write: options.write,
      fetchList: client.fetchList,
      fetchPdf: client.fetchPdf,
    });
    return Object.freeze({
      ...cache,
      dispose: () => workerClient?.dispose?.(),
      mergeReferenceSummary,
      toReferenceOnlySummary,
    });
  }

  globalScope.ThinkStockBrokerResearchRuntime = Object.freeze({
    createBrokerResearchRuntime,
    mergeReferenceSummary,
    toReferenceOnlySummary,
  });
}(typeof self !== "undefined" ? self : globalThis));
