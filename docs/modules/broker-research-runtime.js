(function initThinkStockBrokerResearchRuntime(globalScope) {
  "use strict";

  function mergeReferenceSummary(current, referenceReport, asOfDate = "") {
    if (!referenceReport?.sourceUrl) return current || null;
    const currentReference = current?.representativeReports?.reference || null;
    if (currentReference?.publishedDate
      && String(currentReference.publishedDate) > String(referenceReport.publishedDate || "")) {
      return current;
    }
    if (currentReference?.sourceUrl === referenceReport.sourceUrl) return current;
    return Object.freeze({
      ...(current || {}),
      asOfDate: current?.asOfDate || String(asOfDate || "").slice(0, 10),
      latestDate: [current?.latestDate, referenceReport.publishedDate]
        .filter(Boolean).sort().at(-1) || "",
      latestAvailableDate: [current?.latestAvailableDate, referenceReport.availableDate]
        .filter(Boolean).sort().at(-1) || "",
      referenceReportCount: Math.max(1, Number(current?.referenceReportCount) || 0),
      representativeReports: Object.freeze({
        ...(current?.representativeReports || {}),
        reference: referenceReport,
      }),
    });
  }

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
    });
  }

  globalScope.ThinkStockBrokerResearchRuntime = Object.freeze({
    createBrokerResearchRuntime,
    mergeReferenceSummary,
  });
}(typeof self !== "undefined" ? self : globalThis));
