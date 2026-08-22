(function initThinkStockBrokerResearchRuntime(globalScope) {
  "use strict";

  const MAX_REFERENCE_REPORTS = 3;

  function mergeReferenceReports(current, nextReference) {
    const candidates = [
      ...(Array.isArray(current?.representativeReports?.references)
        ? current.representativeReports.references
        : []),
      current?.representativeReports?.reference,
      nextReference,
    ].filter((report) => report?.sourceUrl);
    const urls = new Set();
    return Object.freeze(candidates
      .sort((left, right) => (
        String(right?.publishedDate || "").localeCompare(String(left?.publishedDate || ""))
        || String(right?.reportId || "").localeCompare(String(left?.reportId || ""))
      ))
      .filter((report) => {
        const key = String(report.sourceUrl);
        if (urls.has(key)) return false;
        urls.add(key);
        return true;
      })
      .slice(0, MAX_REFERENCE_REPORTS));
  }

  function toReferenceOnlySummary(current, referenceReport, asOfDate = "") {
    const nextReference = referenceReport?.sourceUrl ? referenceReport : null;
    const references = mergeReferenceReports(current, nextReference);
    const reference = references[0] || null;
    if (!reference?.sourceUrl) return null;
    return Object.freeze({
      asOfDate: current?.asOfDate || String(asOfDate || "").slice(0, 10),
      latestDate: [current?.latestDate, reference.publishedDate]
        .filter(Boolean).sort().at(-1) || "",
      latestAvailableDate: [current?.latestAvailableDate, reference.availableDate]
        .filter(Boolean).sort().at(-1) || "",
      reportCount: 0,
      referenceReportCount: Math.max(references.length, Number(current?.referenceReportCount) || 0),
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
        references,
      }),
    });
  }

  const mergeReferenceSummary = toReferenceOnlySummary;

  function renderReportLoadingPage(popup) {
    const document = popup?.document;
    if (!document?.open || !document?.write || !document?.close) return false;
    try {
      document.open();
      document.write(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ThinkStock 리포트</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #090a09; color: #f1f3f2; font-family: sans-serif; }
    main { display: grid; justify-items: center; gap: 18px; padding: 32px; text-align: center; }
    i { width: 34px; height: 34px; border: 3px solid #294436; border-top-color: #48dc8d; border-radius: 50%; animation: spin .8s linear infinite; }
    b { font-size: 17px; }
    span { color: #9ba49f; font-size: 14px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body><main><i></i><b>리포트를 불러오고 있습니다.</b><span>잠시 기다려 주세요.</span></main></body>
</html>`);
      document.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  function createInlineReportOpener(scope, fetchPdf, options = {}) {
    const revokeDelayMs = Math.max(30000, Number(options.revokeDelayMs) || 5 * 60 * 1000);

    function navigate(popup, url) {
      if (!popup || !url) return false;
      try {
        if (typeof popup.location?.replace === "function") popup.location.replace(url);
        else popup.location.href = url;
        return true;
      } catch (_) {
        return false;
      }
    }

    return function openReport(report) {
      const fallbackUrl = String(report?.sourceUrl || "").trim();
      let popup = null;
      try {
        popup = scope.open?.("about:blank", "_blank") || null;
        if (popup) popup.opener = null;
      } catch (_) {
        popup = null;
      }
      // Let the anchor keep its normal source URL when a popup is blocked.
      if (!popup) return false;
      renderReportLoadingPage(popup);

      Promise.resolve(fetchPdf(report))
        .then((bytes) => {
          if (!bytes || !scope.Blob || !scope.URL?.createObjectURL) {
            throw new Error("PDF memory URL is unavailable");
          }
          const objectUrl = scope.URL.createObjectURL(new scope.Blob([bytes], {
            type: "application/pdf",
          }));
          if (!navigate(popup, objectUrl)) {
            scope.URL.revokeObjectURL?.(objectUrl);
            throw new Error("PDF tab navigation failed");
          }
          const schedule = typeof scope.setTimeout === "function" ? scope.setTimeout.bind(scope) : setTimeout;
          schedule(() => scope.URL.revokeObjectURL?.(objectUrl), revokeDelayMs);
        })
        .catch(() => navigate(popup, fallbackUrl));
      return true;
    };
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
      getTickerName: options.getTickerName,
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
    const openReport = createInlineReportOpener(scope, client.fetchPdf, options);
    return Object.freeze({
      ...cache,
      dispose: () => {
        workerClient?.dispose?.();
        client.clearPdfMemoryCache?.();
      },
      mergeReferenceSummary,
      openReport,
      pdfMemoryCacheStats: client.pdfMemoryCacheStats,
      toReferenceOnlySummary,
    });
  }

  globalScope.ThinkStockBrokerResearchRuntime = Object.freeze({
    createBrokerResearchRuntime,
    createInlineReportOpener,
    mergeReferenceSummary,
    renderReportLoadingPage,
    toReferenceOnlySummary,
  });
}(typeof self !== "undefined" ? self : globalThis));
