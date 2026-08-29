"use strict";

import {
  createIdleResourceLifecycle,
  createWorkerInstance,
} from "./browser-request-runtime.mjs";

  const MAX_REFERENCE_REPORTS = 3;

  function brokerKey(report) {
    const normalized = String(report?.broker || "")
      .normalize("NFKC")
      .replace(/[\s._-]+/g, "")
      .replace(/(?:증권|투자증권|금융투자)$/u, "")
      .toLowerCase();
    return normalized || `unknown:${String(report?.sourceUrl || report?.reportId || "")}`;
  }

  function mergeReferenceReports(current, nextReference) {
    const candidates = [
      ...(Array.isArray(current?.representativeReports?.references)
        ? current.representativeReports.references
        : []),
      current?.representativeReports?.reference,
      nextReference,
    ].filter((report) => report?.sourceUrl);
    const urls = new Set();
    const brokers = new Set();
    return Object.freeze(candidates
      .sort((left, right) => (
        String(right?.publishedDate || "").localeCompare(String(left?.publishedDate || ""))
        || String(right?.reportId || "").localeCompare(String(left?.reportId || ""))
      ))
      .filter((report) => {
        const key = String(report.sourceUrl);
        const broker = brokerKey(report);
        if (urls.has(key) || brokers.has(broker)) return false;
        urls.add(key);
        brokers.add(broker);
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

  function createBrokerResearchRuntime(scope = globalThis, options = {}) {
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

  function createBrokerReportWorkerClient(scope = globalThis, options = {}) {
    const workerUrl = String(options.workerUrl || "");
    const timeoutMs = Math.max(3000, Number(options.timeoutMs) || 30000);
    let worker = null;
    let sequence = 0;
    let disposed = false;
    const pending = new Map();

    function rejectAll(error) {
      pending.forEach((request) => {
        scope.clearTimeout(request.timer);
        request.reject(error);
      });
      pending.clear();
    }

    function reset(target = worker) {
      workerLifecycle.cancel();
      if (target === worker) worker = null;
      try { target?.terminate(); } catch (_) {}
    }

    const workerLifecycle = createIdleResourceLifecycle(scope, {
      idleMs: Math.max(10000, Number(options.idleMs) || 60000),
      onIdle: () => {
        if (!pending.size) reset();
      },
    });

    function ensureWorker() {
      workerLifecycle.markBusy();
      if (worker) return worker;
      if (disposed || typeof scope.Worker !== "function" || !workerUrl) {
        throw new Error("Broker report PDF worker is unavailable");
      }
      const next = createWorkerInstance(scope, workerUrl, {
        type: "module",
        name: options.workerName,
      });
      next.onmessage = (event) => {
        const id = Number(event.data?.id);
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        scope.clearTimeout(request.timer);
        if (event.data?.error) request.reject(new Error(event.data.error));
        else request.resolve(Array.isArray(event.data?.pages) ? event.data.pages : []);
        if (!pending.size) workerLifecycle.markIdle();
      };
      next.onerror = (event) => {
        if (worker !== next) return;
        rejectAll(new Error(event?.message || "Broker report PDF worker failed"));
        reset(next);
      };
      worker = next;
      return worker;
    }

    function extractPages(bytes, extractOptions = {}) {
      if (disposed) return Promise.reject(new Error("Broker report PDF worker is disposed"));
      const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      if (!source.byteLength) return Promise.resolve([]);
      const transferable = source.slice();
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        let target;
        try {
          target = ensureWorker();
        } catch (error) {
          reject(error);
          return;
        }
        const timer = scope.setTimeout(() => {
          if (!pending.has(id)) return;
          rejectAll(new Error("Broker report PDF worker timeout"));
          reset(target);
        }, Math.max(3000, Number(extractOptions.timeoutMs) || timeoutMs));
        pending.set(id, { reject, resolve, timer });
        try {
          target.postMessage({ id, bytes: transferable.buffer }, [transferable.buffer]);
        } catch (error) {
          rejectAll(error);
          reset(target);
        }
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      rejectAll(new Error("Broker report PDF worker is disposed"));
      workerLifecycle.dispose();
      reset();
    }

    return Object.freeze({
      dispose,
      extractPages,
      stats: () => Object.freeze({
        pending: pending.size,
        workerActive: Boolean(worker),
        lifecycle: workerLifecycle.stats(),
      }),
    });
  }

  function createBrokerResearchApp(scope = globalThis, options = {}) {
    const cacheModule = options.cacheModule;
    const parser = options.parser;
    const requestRegistry = options.requestRegistry;
    if (!cacheModule?.CACHE_SCHEMA || !parser?.PARSER_REVISION
      || !requestRegistry?.run || !requestRegistry?.has || !requestRegistry?.tag) {
      throw new Error("Broker research app dependencies are incomplete");
    }
    const summaries = new Map();
    const pendingTickers = new Set();
    const revision = `${cacheModule.CACHE_SCHEMA}:${parser.PARSER_REVISION}`;
    let service = null;

    const currentDate = () => String(options.getAsOfDate?.() || "").slice(0, 10);
    const notifyState = () => options.onStateChange?.({ summaries, pendingTickers });
    const commitSummary = (ticker, summary) => {
      summaries.set(ticker, summary || null);
      options.onSummaryChange?.(ticker, summary || null);
      return summary || null;
    };

    function getService() {
      if (service) return service;
      service = createBrokerResearchRuntime(scope, {
        cacheModule,
        parser,
        workerModule: options.workerModule,
        listEndpoint: options.listEndpoint,
        pdfEndpoint: options.pdfEndpoint,
        fetchWithTimeout: options.fetchWithTimeout,
        getAsOfDate: options.getAsOfDate,
        getTickerName: options.getTickerName,
        getHeaders: options.getHeaders,
        workerUrl: options.workerUrl,
        workerTimeoutMs: options.workerTimeoutMs,
        pdfModuleUrl: options.pdfModuleUrl,
        pdfWorkerUrl: options.pdfWorkerUrl,
        read: options.readRecord,
        write: (ticker, record) => options.writeRecord?.(ticker, record, {
          source: "broker-research",
          revision,
          asOf: record?.latestDate || record?.checkedDate,
          contentFingerprint: parser.reportSummaryFingerprint(record?.summary),
        }),
      });
      return service;
    }

    async function request(ticker, requestOptions = {}) {
      const target = String(ticker || "").trim().toUpperCase();
      if (!/^\d{6}\.(KS|KQ)$/.test(target)) return null;
      const requestKey = `broker-research:${target}`;
      const forceNetwork = requestOptions.forceNetwork === true;
      return requestRegistry.run(requestKey, async () => {
        pendingTickers.add(target);
        notifyState();
        try {
          const existingRecord = await Promise.resolve(options.readRecord?.(target)).catch(() => null);
          if (existingRecord?.summary && !summaries.has(target)) {
            commitSummary(
              target,
              toReferenceOnlySummary(existingRecord.summary, null, currentDate()),
            );
          }
          const record = await getService().loadTicker(target, {
            asOfDate: currentDate(),
            forceNetwork,
            referenceOnly: true,
            listRefreshAfterDays: 1,
            existingRecord,
            onProgress: requestOptions.onProgress,
            onReferenceReport: (referenceReport) => {
              if (!referenceReport?.sourceUrl) return;
              const current = summaries.get(target) || existingRecord?.summary || null;
              commitSummary(
                target,
                mergeReferenceSummary(current, referenceReport, currentDate()),
              );
            },
          });
          const currentReference = summaries.get(target)?.representativeReports?.reference || null;
          return commitSummary(
            target,
            mergeReferenceSummary(record?.summary || null, currentReference, currentDate()),
          );
        } catch (_) {
          if (!summaries.has(target)) commitSummary(target, null);
          return summaries.get(target) || null;
        } finally {
          pendingTickers.delete(target);
          notifyState();
        }
      }, {
        tag: forceNetwork ? "force" : "normal",
        afterCurrent: forceNetwork && requestRegistry.has(requestKey)
          && requestRegistry.tag(requestKey) !== "force",
      });
    }

    function dispose() {
      service?.dispose?.();
      service = null;
      pendingTickers.clear();
      summaries.clear();
    }

    return Object.freeze({
      dispose,
      getService,
      openReport: (report) => getService().openReport(report),
      pendingTickers,
      request,
      summaries,
    });
  }

const brokerReportWorkerClient = Object.freeze({ createBrokerReportWorkerClient });
const brokerResearchRuntime = Object.freeze({
  createBrokerResearchApp,
  createBrokerResearchRuntime,
  createInlineReportOpener,
  mergeReferenceSummary,
  renderReportLoadingPage,
  toReferenceOnlySummary,
});

export {
  brokerReportWorkerClient,
  brokerResearchRuntime,
  createBrokerResearchApp,
  createBrokerReportWorkerClient,
  createBrokerResearchRuntime,
  createInlineReportOpener,
  mergeReferenceSummary,
  renderReportLoadingPage,
  toReferenceOnlySummary,
};
