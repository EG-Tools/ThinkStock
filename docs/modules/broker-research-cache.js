(function initThinkStockBrokerResearchCache(globalScope) {
  "use strict";

  const valueContract = globalScope.ThinkStockRuntimeFoundation?.values;
  const reportPolicy = globalScope.ThinkStockBrokerReportPolicy;
  const freshnessPolicy = globalScope.ThinkStockRuntimeFreshnessPolicy;
  if (!valueContract || !reportPolicy || !freshnessPolicy?.cacheRefreshDecision) {
    throw new Error("broker research contracts failed to load");
  }

  const CACHE_SCHEMA = 5;
  const MAX_PDF_BYTES = 12 * 1024 * 1024;
  const MAX_PDF_PAGES = 12;
  const MAX_REPORTS_PER_TICKER = 40;
  const MAX_ACTIVE_REPORTS = 3;
  const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const REPORT_KEY_PATTERN = /^(?:\d{1,12}|naver-\d{1,12})$/;

  function normalizeTicker(value) {
    const ticker = String(value || "").trim().toUpperCase();
    return TICKER_PATTERN.test(ticker) ? ticker : "";
  }

  const normalizedDate = valueContract.normalizedIsoDate;

  function safeSourceUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const allowed = url.protocol === "https:" && (
        url.hostname === "consensus.hankyung.com"
        || (url.hostname === "stock.pstatic.net"
          && /^\/stock-research\/company\/\d{1,4}\/20\d{6}_company_\d{1,12}\.pdf$/i.test(url.pathname))
      );
      return allowed
        ? url.toString().slice(0, 500)
        : "";
    } catch (_) {
      return "";
    }
  }

  function dateAgeDays(dateText, asOfDate) {
    const start = Date.parse(`${normalizedDate(dateText)}T00:00:00Z`);
    const end = Date.parse(`${normalizedDate(asOfDate)}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
    return Math.max(0, Math.round((end - start) / 86400000));
  }

  function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new Error("Broker report PDF response is invalid");
  }

  function fallbackHash(bytes) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < bytes.length; index += 1) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${bytes.length}`;
  }

  async function sha256Hex(scope, value) {
    const bytes = toUint8Array(value);
    if (!scope.crypto?.subtle?.digest) return fallbackHash(bytes);
    const digest = await scope.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((entry) => entry.toString(16).padStart(2, "0"))
      .join("");
  }

  function normalizeReportMetadata(report, ticker) {
    const id = String(report?.id || report?.reportId || "").trim();
    const publishedDate = normalizedDate(report?.publishedDate);
    if (!REPORT_KEY_PATTERN.test(id) || !publishedDate) return null;
    const sourceUrl = safeSourceUrl(report?.sourceUrl);
    const source = String(report?.source || "").toLowerCase() === "naver"
      || sourceUrl.includes("stock.pstatic.net")
      ? "naver"
      : "hankyung";
    return {
      id,
      source,
      sourceReportId: String(report?.sourceReportId || id.replace(/^naver-/, "")).slice(0, 12),
      ticker,
      publishedDate,
      availableDate: reportPolicy.reportAvailableDate(report),
      availabilityPrecision: String(report?.availabilityPrecision || "date-only"),
      title: String(report?.title || "").trim().slice(0, 300),
      sourceUrl,
      targetPrice: valueContract.positiveOrNull(report?.targetPrice),
      previousTargetPrice: valueContract.positiveOrNull(report?.previousTargetPrice),
      targetPriceChange: valueContract.finiteOrNull(report?.targetPriceChange),
      targetRevisionStreak: Math.max(0, Math.min(12, Math.round(Number(report?.targetRevisionStreak) || 0))),
      recommendation: String(report?.recommendation || "").trim().slice(0, 80),
      analyst: String(report?.analyst || "").trim().slice(0, 120),
      broker: String(report?.broker || "").trim().slice(0, 120),
      viewCount: Math.max(0, Math.min(100000000, Math.round(Number(report?.viewCount) || 0))),
    };
  }

  function normalizedBrokerKey(value, fallback = "") {
    let key = String(value || "")
      .normalize("NFKC")
      .replace(/[\s._-]+/g, "")
      .toLowerCase();
    key = key
      .replace(/(?:투자)?증권(?:주식회사)?$/u, "")
      .replace(/(?:investment)?securities(?:co(?:ltd)?)?$/i, "");
    return key || fallback;
  }

  function reportSelectionUtility(report) {
    let score = 0;
    if (Number(report?.targetPrice) > 0) score += 8;
    if (String(report?.recommendation || "").trim()) score += 3;
    if (String(report?.analyst || "").trim()) score += 2;
    if (Number(report?.previousTargetPrice) > 0) score += 1;
    const views = Math.max(0, Number(report?.viewCount) || 0);
    if (views) score += Math.min(1, Math.log10(views + 1) / 5);
    const isHankyung = report?.source === "hankyung"
      || String(report?.sourceUrl || "").includes("consensus.hankyung.com");
    if (isHankyung) score += 0.1;
    return score;
  }

  function compareReportPriority(left, right) {
    return String(right?.publishedDate || "").localeCompare(String(left?.publishedDate || ""))
      || reportSelectionUtility(right) - reportSelectionUtility(left)
      || String(right?.id || "").localeCompare(String(left?.id || ""));
  }

  function latestReportsByBroker(reports, maximum = MAX_ACTIVE_REPORTS) {
    const limit = Math.max(1, Math.min(10, Math.round(Number(maximum) || MAX_ACTIVE_REPORTS)));
    const brokers = new Set();
    const ordered = [...(Array.isArray(reports) ? reports : [])]
      .sort(compareReportPriority);
    const brokerCandidates = ordered.filter((report) => {
      const broker = normalizedBrokerKey(report?.broker, `unknown:${report?.id}`);
      if (brokers.has(broker)) return false;
      brokers.add(broker);
      return true;
    });
    const dates = new Set();
    const dateDiverse = [];
    const sameDateRemainder = [];
    brokerCandidates.forEach((report) => {
      const date = String(report?.publishedDate || "");
      if (date && !dates.has(date)) {
        dates.add(date);
        dateDiverse.push(report);
      } else {
        sameDateRemainder.push(report);
      }
    });
    const chosen = [...dateDiverse.slice(0, limit)];
    if (chosen.length < limit) {
      const chosenIds = new Set(chosen.map((report) => report?.id));
      sameDateRemainder.forEach((report) => {
        if (chosen.length >= limit || chosenIds.has(report?.id)) return;
        chosen.push(report);
        chosenIds.add(report?.id);
      });
    }
    return chosen.sort(compareReportPriority).map((report) => {
        const broker = normalizedBrokerKey(report?.broker, `unknown:${report?.id}`);
        const history = ordered.filter((candidate) => (
          candidate !== report
          && normalizedBrokerKey(candidate?.broker, `unknown:${candidate?.id}`) === broker
          && String(candidate?.publishedDate || "") < String(report?.publishedDate || "")
          && Number(candidate?.targetPrice) > 0
        ));
        const previous = history[0];
        const previousTargetPrice = Number(previous?.targetPrice) > 0 ? Number(previous.targetPrice) : null;
        const targetPriceChange = previousTargetPrice && Number(report?.targetPrice) > 0
          ? (Number(report.targetPrice) / previousTargetPrice) - 1
          : null;
        const direction = Math.abs(Number(targetPriceChange) || 0) >= 0.015
          ? Math.sign(targetPriceChange)
          : 0;
        let targetRevisionStreak = direction ? 1 : 0;
        if (direction) {
          const targetHistory = [report, ...history];
          for (let historyIndex = 1; historyIndex < targetHistory.length - 1; historyIndex += 1) {
            const newer = Number(targetHistory[historyIndex]?.targetPrice);
            const older = Number(targetHistory[historyIndex + 1]?.targetPrice);
            if (!(newer > 0 && older > 0)) break;
            const historicalChange = (newer / older) - 1;
            if (Math.abs(historicalChange) < 0.015 || Math.sign(historicalChange) !== direction) break;
            targetRevisionStreak += 1;
          }
        }
        return {
          ...report,
          previousTargetPrice,
          targetPriceChange,
          targetRevisionStreak,
        };
      });
  }

  function normalizeStoredReport(report, ticker) {
    const metadata = normalizeReportMetadata(report, ticker);
    if (!metadata) return null;
    return {
      ...metadata,
      reportId: metadata.id,
      parserRevision: String(report?.parserRevision || ""),
      contentHash: String(report?.contentHash || "").slice(0, 128),
      byteLength: Math.max(0, Number(report?.byteLength) || 0),
      usable: report?.usable === true,
      reason: String(report?.reason || "").slice(0, 160),
      parsed: report?.parsed && typeof report.parsed === "object" ? report.parsed : null,
      processedAt: Math.max(0, Number(report?.processedAt) || 0),
    };
  }

  function refreshedStoredReport(stored, metadata) {
    const parsed = stored?.parsed && typeof stored.parsed === "object"
      ? {
        ...stored.parsed,
        reportId: metadata.id,
        publishedDate: metadata.publishedDate,
        availableDate: metadata.availableDate,
        availabilityPrecision: metadata.availabilityPrecision,
        broker: metadata.broker,
        analyst: metadata.analyst,
        title: metadata.title,
        sourceUrl: metadata.sourceUrl,
        source: metadata.source,
        sourceReportId: metadata.sourceReportId,
        targetPrice: metadata.targetPrice,
        previousTargetPrice: metadata.previousTargetPrice,
        targetPriceChange: metadata.targetPriceChange,
        targetRevisionStreak: metadata.targetRevisionStreak,
      }
      : null;
    return { ...stored, ...metadata, parsed };
  }

  function normalizeCacheRecord(record, ticker) {
    if (!record || Number(record.schema) !== CACHE_SCHEMA || normalizeTicker(record.ticker) !== ticker) {
      return null;
    }
    const reports = (Array.isArray(record.reports) ? record.reports : [])
      .map((report) => normalizeStoredReport(report, ticker))
      .filter(Boolean)
      .sort((left, right) => String(right.publishedDate).localeCompare(String(left.publishedDate)))
      .slice(0, MAX_REPORTS_PER_TICKER);
    return {
      ...record,
      schema: CACHE_SCHEMA,
      ticker,
      checkedDate: normalizedDate(record.checkedDate),
      checkedAt: Number(record.checkedAt) || Number(record.savedAt) || 0,
      checkedWindowDays: [90, 180].includes(Number(record.checkedWindowDays))
        ? Number(record.checkedWindowDays)
        : 0,
      complete: record.complete === true,
      resultState: ["ready", "empty", "error"].includes(record.resultState)
        ? record.resultState
        : (record.complete === false ? "error" : (reports.length ? "ready" : "empty")),
      failureCount: Math.max(0, Math.min(20, Number(record.failureCount) || 0)),
      lastFailureAt: Number(record.lastFailureAt) || 0,
      latestDate: normalizedDate(record.latestDate),
      activeReportIds: (Array.isArray(record.activeReportIds) ? record.activeReportIds : [])
        .map(String)
        .filter((id) => REPORT_KEY_PATTERN.test(id)),
      reports,
      summary: record.summary && typeof record.summary === "object" ? record.summary : null,
    };
  }

  function lineItemsFromTextContent(textContent) {
    const rows = [];
    (Array.isArray(textContent?.items) ? textContent.items : []).forEach((item) => {
      const text = String(item?.str || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const x = Number(item?.transform?.[4]) || 0;
      const y = Number(item?.transform?.[5]) || 0;
      let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 1.8);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, text });
    });
    return rows
      .sort((left, right) => right.y - left.y)
      .map((row) => row.items
        .sort((left, right) => left.x - right.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim())
      .filter(Boolean);
  }

  function createDefaultPdfExtractor(scope, options, parser) {
    let pdfModuleTask = null;
    async function loadPdfModule() {
      if (!pdfModuleTask) {
        pdfModuleTask = import(String(options.pdfModuleUrl || "./vendor/pdf.min.mjs"))
          .then((module) => {
            if (module.GlobalWorkerOptions && options.pdfWorkerUrl) {
              module.GlobalWorkerOptions.workerSrc = String(options.pdfWorkerUrl);
            }
            return module;
          })
          .catch((error) => {
            pdfModuleTask = null;
            throw error;
          });
      }
      return pdfModuleTask;
    }
    return async (bytes, metadata) => {
      if (typeof options.extractPdfPages === "function") {
        try {
          const workerPages = await options.extractPdfPages(bytes, metadata);
          if (Array.isArray(workerPages) && workerPages.length) {
            return parser.parseReport(workerPages, metadata);
          }
        } catch (_) {
          // Fall back to the main thread when a browser cannot create module workers.
        }
      }
      const pdfjs = await loadPdfModule();
      const loadingTask = pdfjs.getDocument({
        data: toUint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      const pdf = await loadingTask.promise;
      const pages = [];
      try {
        const maximum = Math.min(MAX_PDF_PAGES, pdf.numPages);
        for (let pageNumber = 1; pageNumber <= maximum; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const textContent = await page.getTextContent({ disableNormalization: false });
          pages.push({ page: pageNumber, lines: lineItemsFromTextContent(textContent) });
          const candidate = parser.parseReport(pages, metadata);
          if (candidate?.usable && Number(candidate?.evidence?.coreMetricCount) >= 3) return candidate;
        }
        return parser.parseReport(pages, metadata);
      } finally {
        if (typeof pdf.destroy === "function") await pdf.destroy().catch(() => {});
        else await loadingTask.destroy?.().catch(() => {});
      }
    };
  }

  function createBrokerReportClient(scope = globalScope, options = {}) {
    const fetchWithTimeout = options.fetchWithTimeout;
    if (typeof fetchWithTimeout !== "function") {
      throw new Error("Broker report fetch transport is required");
    }
    const listEndpoint = String(options.listEndpoint || "").trim();
    const pdfEndpoint = String(options.pdfEndpoint || "").trim();
    if (!listEndpoint || !pdfEndpoint) {
      throw new Error("Broker report endpoints are required");
    }
    const baseUrl = String(options.baseUrl || scope.location?.href || "http://localhost/");
    const getHeaders = typeof options.getHeaders === "function"
      ? options.getHeaders
      : () => ({});
    const getAsOfDate = typeof options.getAsOfDate === "function"
      ? options.getAsOfDate
      : () => normalizedDate(new Date().toISOString());

    async function fetchList(ticker, days, source = "hankyung") {
      const url = new URL(listEndpoint, baseUrl);
      url.searchParams.set("ticker", normalizeTicker(ticker));
      url.searchParams.set("days", String(Math.max(1, Math.round(Number(days) || 90))));
      url.searchParams.set("asOf", normalizedDate(getAsOfDate()));
      if (source === "naver") url.searchParams.set("source", "naver");
      const response = await fetchWithTimeout(url.toString(), {
        cache: "no-store",
        headers: getHeaders(),
      }, Math.max(1000, Number(options.listTimeoutMs) || 25000));
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false || !Array.isArray(payload?.reports)) {
        throw new Error(payload?.error || `Broker report list HTTP ${response.status}`);
      }
      return payload.reports;
    }

    async function fetchPdf(report) {
      const reportId = typeof report === "object" ? report?.id || report?.reportId : report;
      const source = typeof report === "object" && report?.source === "naver" ? "naver" : "hankyung";
      const url = new URL(pdfEndpoint, baseUrl);
      url.searchParams.set("reportId", String(reportId || ""));
      if (source === "naver") {
        url.searchParams.set("source", "naver");
        url.searchParams.set("sourceUrl", safeSourceUrl(report?.sourceUrl));
      }
      const response = await fetchWithTimeout(url.toString(), {
        cache: "no-store",
        headers: getHeaders(),
      }, Math.max(1000, Number(options.pdfTimeoutMs) || 35000));
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Broker report PDF HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    }

    return Object.freeze({ fetchList, fetchPdf });
  }

  function createBrokerResearchCache(scope = globalScope, options = {}) {
    const parser = options.parser;
    if (!parser?.parseReport || !parser?.summarizeReports || !parser?.PARSER_REVISION) {
      throw new Error("Broker report parser is required");
    }
    const read = typeof options.read === "function" ? options.read : async () => null;
    const write = typeof options.write === "function" ? options.write : async () => false;
    const fetchList = options.fetchList;
    const fetchPdf = options.fetchPdf;
    if (typeof fetchList !== "function" || typeof fetchPdf !== "function") {
      throw new Error("Broker report endpoints are required");
    }
    const now = typeof options.now === "function" ? options.now : () => new Date();
    const extractReport = typeof options.extractReport === "function"
      ? options.extractReport
      : createDefaultPdfExtractor(scope, options, parser);
    const pending = new Map();

    async function loadTicker(rawTicker, loadOptions = {}) {
      const ticker = normalizeTicker(rawTicker);
      if (!ticker) return null;
      if (pending.has(ticker)) return pending.get(ticker);
      const task = (async () => {
        const currentNow = now();
        const nowDate = currentNow instanceof Date ? currentNow : new Date(currentNow || Date.now());
        const nowMs = nowDate.getTime();
        const asOfDate = normalizedDate(loadOptions.asOfDate)
          || normalizedDate(nowDate.toISOString());
        const forceNetwork = loadOptions.forceNetwork === true;
        const listRefreshAfterDays = Math.max(1, Math.min(90,
          Number(loadOptions.listRefreshAfterDays ?? loadOptions.refreshAfterDays) || 1));
        const onProgress = typeof loadOptions.onProgress === "function"
          ? loadOptions.onProgress
          : () => {};
        const onReferenceReport = typeof loadOptions.onReferenceReport === "function"
          ? loadOptions.onReferenceReport
          : () => {};
        const suppliedExisting = normalizeCacheRecord(loadOptions.existingRecord, ticker);
        const existing = suppliedExisting
          || normalizeCacheRecord(await read(ticker).catch(() => null), ticker);
        const existingHasReports = Boolean(
          existing?.reports?.length
          || existing?.summary?.representativeReports?.reference?.sourceUrl,
        );
        const cacheDecision = freshnessPolicy.cacheRefreshDecision("brokerResearch", existing, {
          force: forceNetwork,
          now: nowMs,
          empty: Boolean(existing && !existingHasReports),
          maximumAgeMs: listRefreshAfterDays * 24 * 60 * 60 * 1000,
        });
        if (existing
          && cacheDecision.reuse
          && dateAgeDays(existing.checkedDate, asOfDate) < listRefreshAfterDays) {
          return { ...existing, cached: true };
        }

        const staleExistingAfterFailure = async (error) => {
          if (!existing) throw error;
          const failed = {
            ...existing,
            checkedAt: nowMs,
            lastFailureAt: nowMs,
            failureCount: Math.min(20, (Number(existing.failureCount) || 0) + 1),
            resultState: "error",
          };
          await write(ticker, failed).catch(() => false);
          return { ...failed, cached: true, stale: true, warning: String(error?.message || error) };
        };

        onProgress(5, "최근 리포트 확인");
        let windowDays = 90;
        const listSources = async (days) => Promise.all(["hankyung", "naver"].map(async (source) => {
          try {
            const payload = await fetchList(ticker, days, source);
            return {
              source,
              reports: Array.isArray(payload)
                ? payload
                : (Array.isArray(payload?.reports) ? payload.reports : []),
              error: null,
            };
          } catch (error) {
            return { source, reports: [], error };
          }
        }));
        let sourceLists = await listSources(windowDays);
        let listed = sourceLists.flatMap((entry) => entry.reports);
        if (!listed.length) {
          windowDays = 180;
          onProgress(12, "6개월 범위 확인");
          sourceLists = await listSources(windowDays);
          listed = sourceLists.flatMap((entry) => entry.reports);
        }
        const listErrors = sourceLists.map((entry) => entry.error).filter(Boolean);
        if (!listed.length && listErrors.length === sourceLists.length) {
          return staleExistingAfterFailure(listErrors[0]);
        }
        let selected = latestReportsByBroker(
          listed.map((report) => normalizeReportMetadata(report, ticker)).filter(Boolean),
          MAX_ACTIVE_REPORTS,
        );
        let publishedReferenceKey = "";
        const publishReferenceReport = (candidates) => {
          const reference = [...(Array.isArray(candidates) ? candidates : [])]
            .filter((report) => report?.sourceUrl && report?.publishedDate)
            .sort((left, right) => (
              String(right.publishedDate).localeCompare(String(left.publishedDate))
              || String(right.id).localeCompare(String(left.id))
            ))[0];
          if (!reference) return;
          const key = `${reference.id}|${reference.publishedDate}|${reference.sourceUrl}`;
          if (key === publishedReferenceKey) return;
          publishedReferenceKey = key;
          onReferenceReport(Object.freeze({
            reportId: reference.id,
            publishedDate: reference.publishedDate,
            availableDate: reference.availableDate,
            broker: reference.broker,
            title: reference.title,
            sourceUrl: reference.sourceUrl,
            signal: null,
            confidence: 0,
            quantitative: false,
          }));
        };
        publishReferenceReport(selected);
        const byId = new Map((existing?.reports || []).map((report) => [report.id, report]));
        const nextReports = [...(existing?.reports || [])];
        let complete = listErrors.length === 0;
        let downloadedPdfCount = 0;
        let reusedReportCount = 0;
        const processSelectedReports = async (reportsToProcess) => {
          for (let index = 0; index < reportsToProcess.length; index += 1) {
          const metadata = reportsToProcess[index];
          const stored = byId.get(metadata.id);
          const reusable = stored?.parserRevision === parser.PARSER_REVISION
            && (stored.usable || (stored.reason && !stored.reason.startsWith("transient:")));
          if (reusable) {
            const refreshed = refreshedStoredReport(stored, metadata);
            const previousIndex = nextReports.findIndex((report) => report.id === metadata.id);
            if (previousIndex >= 0) nextReports.splice(previousIndex, 1, refreshed);
            byId.set(metadata.id, refreshed);
            reusedReportCount += 1;
            onProgress(20 + Math.round(((index + 1) / Math.max(1, reportsToProcess.length)) * 55), "저장된 리포트 사용");
            continue;
          }
          try {
            onProgress(20 + Math.round((index / Math.max(1, reportsToProcess.length)) * 55), `${metadata.broker || "증권사"} 리포트 분석`);
            const bytes = toUint8Array(await fetchPdf(metadata));
            downloadedPdfCount += 1;
            if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) {
              throw new Error("Broker report PDF size is outside the allowed range");
            }
            const byteLength = bytes.byteLength;
            const contentHash = await sha256Hex(scope, bytes);
            const duplicate = nextReports.find((report) => (
              report.contentHash === contentHash
              && report.parserRevision === parser.PARSER_REVISION
              && (report.usable || report.reason)
            ));
            const parsed = duplicate?.parsed
              ? {
                ...duplicate.parsed,
                reportId: metadata.id,
                publishedDate: metadata.publishedDate,
                availableDate: metadata.availableDate,
                availabilityPrecision: metadata.availabilityPrecision,
                broker: metadata.broker,
                analyst: metadata.analyst,
                title: metadata.title,
                sourceUrl: metadata.sourceUrl,
                targetPrice: metadata.targetPrice,
                previousTargetPrice: metadata.previousTargetPrice,
                targetPriceChange: metadata.targetPriceChange,
                targetRevisionStreak: metadata.targetRevisionStreak,
              }
              : await extractReport(bytes, metadata);
            const record = {
              ...metadata,
              reportId: metadata.id,
              parserRevision: parser.PARSER_REVISION,
              contentHash,
              byteLength,
              usable: parsed?.usable === true,
              reason: parsed?.usable ? "" : String(parsed?.reason || "verified-forward-table-not-found"),
              parsed,
              processedAt: nowMs,
            };
            const previousIndex = nextReports.findIndex((report) => report.id === metadata.id);
            if (previousIndex >= 0) nextReports.splice(previousIndex, 1, record);
            else nextReports.push(record);
            byId.set(metadata.id, record);
          } catch (error) {
            complete = false;
            const record = {
              ...metadata,
              reportId: metadata.id,
              parserRevision: parser.PARSER_REVISION,
              contentHash: "",
              byteLength: 0,
              usable: false,
              reason: `transient:${String(error?.message || error).slice(0, 120)}`,
              parsed: null,
              processedAt: nowMs,
            };
            const previousIndex = nextReports.findIndex((report) => report.id === metadata.id);
            if (previousIndex >= 0) nextReports.splice(previousIndex, 1, record);
            else nextReports.push(record);
          }
          }
        };
        await processSelectedReports(selected);
        let activeReportIds = selected.map((report) => report.id);
        let reports = nextReports
          .sort((left, right) => String(right.publishedDate).localeCompare(String(left.publishedDate)))
          .slice(0, MAX_REPORTS_PER_TICKER);
        const reportEvidence = () => reports.map((report) => ({
          ...report,
          ...(report.parsed || {}),
          source: report.source,
          sourceReportId: report.sourceReportId,
          usable: report.usable === true || report.parsed?.usable === true,
        }));
        let summary = parser.summarizeReports(reportEvidence(), asOfDate, { activeReportIds });
        const savedAt = nowMs;
        const resultState = complete ? (reports.length ? "ready" : "empty") : "error";
        const record = {
          schema: CACHE_SCHEMA,
          ticker,
          savedAt,
          checkedAt: savedAt,
          lastAccessed: savedAt,
          checkedDate: asOfDate,
          checkedWindowDays: windowDays,
          complete,
          resultState,
          failureCount: complete ? 0 : Math.min(20, (Number(existing?.failureCount) || 0) + 1),
          lastFailureAt: complete ? 0 : savedAt,
          latestDate: reports[0]?.publishedDate || existing?.latestDate || "",
          activeReportIds,
          reports,
          summary,
          refreshStats: {
            downloadedPdfCount,
            reusedReportCount,
            sourceListCount: sourceLists.filter((entry) => !entry.error).length,
            candidateReportCount: listed.length,
            listedReportCount: selected.length,
          },
        };
        await write(ticker, record);
        onProgress(82, summary ? "리포트 숫자 반영" : "사용 가능한 정량표 없음");
        return { ...record, cached: false };
      })().finally(() => pending.delete(ticker));
      pending.set(ticker, task);
      return task;
    }

    return Object.freeze({
      CACHE_SCHEMA,
      MAX_ACTIVE_REPORTS,
      MAX_PDF_BYTES,
      loadTicker,
      normalizeCacheRecord,
      pendingTickers: () => new Set(pending.keys()),
    });
  }

  globalScope.ThinkStockBrokerResearchCache = Object.freeze({
    CACHE_SCHEMA,
    MAX_ACTIVE_REPORTS,
    MAX_PDF_BYTES,
    createBrokerReportClient,
    createBrokerResearchCache,
    latestReportsByBroker,
    lineItemsFromTextContent,
    normalizedBrokerKey,
    reportSelectionUtility,
  });
}(typeof self !== "undefined" ? self : globalThis));
