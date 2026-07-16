(function (globalScope) {
  const TICKER_PATTERN = /^[0-9]{6}\.(KS|KQ)$/;
  const CODE_PATTERN = /^\d{6}$/;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function shiftDate(dateText, days) {
    const date = new Date(`${String(dateText || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return String(dateText || "");
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function shiftYears(dateText, years) {
    const date = new Date(`${String(dateText || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return String(dateText || "");
    const originalMonth = date.getUTCMonth();
    date.setUTCFullYear(date.getUTCFullYear() + Number(years || 0));
    if (date.getUTCMonth() !== originalMonth) date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
  }

  function toApiDate(dateText) {
    return String(dateText || "").slice(0, 10).replace(/-/g, "");
  }

  function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error("Request was superseded by a newer refresh");
    error.name = "AbortError";
    throw error;
  }

  function createDartDisclosureService(options = {}) {
    const classifyType = options.classifyType || (() => "");
    const shouldDisplay = options.shouldDisplay || (() => true);
    const labelName = options.labelName || ((value) => String(value || ""));
    const fetchJson = options.fetchJson;
    const explainError = options.explainError || ((error) => String(error?.message || error || "unknown error"));
    const baseUrl = String(options.baseUrl || "");
    const runtimeLookbackDays = Math.max(1, Number(options.runtimeLookbackDays) || 92);
    const stockLookbackYears = Math.max(1, Number(options.stockLookbackYears) || 3);
    const runtimeMaxPages = Math.max(1, Number(options.runtimeMaxPages) || 60);
    const runtimePageBatch = Math.max(1, Number(options.runtimePageBatch) || 6);
    const stockPageBatch = Math.max(1, Number(options.stockPageBatch) || 4);
    const refreshCacheKey = String(options.refreshCacheKey || "");
    const refreshCacheTtlMs = Math.max(1, Number(options.refreshCacheTtlMs) || 86400000);
    const getStorage = options.getStorage || (() => null);
    const now = options.now || (() => Date.now());
    const today = options.today || (() => new Date().toISOString().slice(0, 10));

    function sanitizeRows(records) {
      if (!Array.isArray(records)) return [];
      const output = [];
      const seen = new Set();
      records.forEach((record) => {
        if (!record || typeof record !== "object") return;
        const ticker = String(record.ticker || "").trim().toUpperCase();
        const code = String(record.code || ticker.split(".")[0] || "").trim();
        const date = String(record.date || "").slice(0, 10);
        const title = String(record.title || record.report_nm || "").trim();
        if (!TICKER_PATTERN.test(ticker) || !DATE_PATTERN.test(date) || !title) return;
        const classifiedType = classifyType(title);
        const rawType = String(record.type || "").trim();
        const type = !rawType || rawType === "공시" ? classifiedType : rawType;
        if (!shouldDisplay(title, type)) return;
        const url = String(record.url || "").trim();
        const key = `${ticker}|${date}|${title}|${url}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push({
          ticker,
          code,
          name: String(record.name || record.corp_name || labelName(ticker)).trim() || labelName(ticker),
          date,
          type,
          title,
          summary: String(record.summary || "").trim(),
          url,
          source: String(record.source || "DART").trim(),
          receiptNo: String(record.receiptNo || record.rcept_no || "").trim(),
        });
      });
      return output.sort((left, right) => (
        left.date.localeCompare(right.date) || left.ticker.localeCompare(right.ticker)
      ));
    }

    function mergeRows(existingRows, incomingRows) {
      const rows = new Map();
      sanitizeRows(existingRows).forEach((row) => {
        rows.set(`${row.ticker}|${row.date}|${row.title}`, row);
      });
      sanitizeRows(incomingRows).forEach((row) => {
        rows.set(`${row.ticker}|${row.date}|${row.title}`, row);
      });
      return [...rows.values()].sort((left, right) => (
        left.date.localeCompare(right.date) || left.ticker.localeCompare(right.ticker)
      ));
    }

    function itemToRecord(item, targetByCode) {
      const code = String(item?.stock_code || "").trim();
      if (!CODE_PATTERN.test(code) || !targetByCode?.has(code)) return null;
      const title = String(item?.report_nm || "").trim();
      const type = classifyType(title);
      if (!title || !shouldDisplay(title, type)) return null;
      const rawDate = String(item?.rcept_dt || "").trim();
      if (!/^\d{8}$/.test(rawDate)) return null;
      const ticker = targetByCode.get(code);
      const receiptNo = String(item?.rcept_no || "").trim();
      return {
        ticker,
        code,
        name: String(item?.corp_name || labelName(ticker)).trim(),
        date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
        type,
        title,
        summary: "",
        source: "OpenDART",
        receiptNo,
        url: receiptNo
          ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
          : "",
      };
    }

    function appendPayloadRecords(payload, targetByCode, records) {
      (payload?.list || []).forEach((item) => {
        const record = itemToRecord(item, targetByCode);
        if (record) records.push(record);
      });
    }

    async function requestPage(params, requestOptions = {}) {
      if (typeof fetchJson !== "function" || !baseUrl) throw new Error("DART client is not configured");
      const signal = requestOptions?.signal || null;
      throwIfAborted(signal);
      const query = new URLSearchParams(params);
      try {
        return await fetchJson(`${baseUrl}?${query.toString()}`, { signal });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw error;
        throw new Error(explainError(error));
      }
    }

    async function fetchMarketPage(apiKey, market, pageNo, requestOptions = {}) {
      const endDate = today();
      return requestPage({
        crtfc_key: String(apiKey || "").trim(),
        bgn_de: toApiDate(shiftDate(endDate, -runtimeLookbackDays)),
        end_de: toApiDate(endDate),
        last_reprt_at: "Y",
        corp_cls: market,
        sort: "date",
        sort_mth: "desc",
        page_no: String(pageNo),
        page_count: "100",
      }, requestOptions);
    }

    async function fetchCorpPage(apiKey, corpCode, pageNo, requestOptions = {}) {
      const endDate = today();
      return requestPage({
        crtfc_key: String(apiKey || "").trim(),
        corp_code: String(corpCode || "").trim(),
        bgn_de: toApiDate(shiftYears(endDate, -stockLookbackYears)),
        end_de: toApiDate(endDate),
        last_reprt_at: "Y",
        sort: "date",
        sort_mth: "asc",
        page_no: String(pageNo),
        page_count: "100",
      }, requestOptions);
    }

    async function fetchForMarkets(apiKey, targetByCode, markets, requestOptions = {}) {
      const cleanKey = String(apiKey || "").trim();
      const marketList = Array.isArray(markets) ? markets : [];
      if (!cleanKey || !targetByCode?.size || !marketList.length) return [];
      const records = [];
      for (const market of marketList) {
        throwIfAborted(requestOptions?.signal);
        const firstPayload = await fetchMarketPage(cleanKey, market, 1, requestOptions);
        const firstStatus = String(firstPayload?.status || "");
        if (firstStatus === "013") continue;
        if (firstStatus && firstStatus !== "000") {
          throw new Error(firstPayload?.message || `DART status ${firstStatus}`);
        }
        appendPayloadRecords(firstPayload, targetByCode, records);

        const totalPage = Math.min(runtimeMaxPages, Math.max(1, Number(firstPayload?.total_page) || 1));
        for (let pageStart = 2; pageStart <= totalPage; pageStart += runtimePageBatch) {
          throwIfAborted(requestOptions?.signal);
          const pageNos = [];
          for (let pageNo = pageStart; pageNo < pageStart + runtimePageBatch && pageNo <= totalPage; pageNo += 1) {
            pageNos.push(pageNo);
          }
          const pages = await Promise.allSettled(
            pageNos.map((pageNo) => fetchMarketPage(cleanKey, market, pageNo, requestOptions)),
          );
          pages.forEach((result) => {
            if (result.status !== "fulfilled") return;
            const status = String(result.value?.status || "");
            if (status && status !== "000" && status !== "013") return;
            appendPayloadRecords(result.value, targetByCode, records);
          });
          throwIfAborted(requestOptions?.signal);
        }
      }
      throwIfAborted(requestOptions?.signal);
      return sanitizeRows(records);
    }

    async function fetchForTicker(apiKey, ticker, corpCode, requestOptions = {}) {
      const cleanKey = String(apiKey || "").trim();
      const targetTicker = String(ticker || "").trim().toUpperCase();
      const code = targetTicker.slice(0, 6);
      if (!cleanKey || !TICKER_PATTERN.test(targetTicker) || !corpCode) return [];
      const targetByCode = new Map([[code, targetTicker]]);
      const records = [];
      throwIfAborted(requestOptions?.signal);
      const firstPayload = await fetchCorpPage(cleanKey, corpCode, 1, requestOptions);
      const firstStatus = String(firstPayload?.status || "");
      if (firstStatus === "013") return [];
      if (firstStatus && firstStatus !== "000") {
        throw new Error(firstPayload?.message || `DART status ${firstStatus}`);
      }
      appendPayloadRecords(firstPayload, targetByCode, records);

      const totalPage = Math.max(1, Number(firstPayload?.total_page) || 1);
      for (let pageStart = 2; pageStart <= totalPage; pageStart += stockPageBatch) {
        throwIfAborted(requestOptions?.signal);
        const pageNos = [];
        for (let pageNo = pageStart; pageNo < pageStart + stockPageBatch && pageNo <= totalPage; pageNo += 1) {
          pageNos.push(pageNo);
        }
        const pages = await Promise.allSettled(
          pageNos.map((pageNo) => fetchCorpPage(cleanKey, corpCode, pageNo, requestOptions)),
        );
        pages.forEach((result) => {
          if (result.status !== "fulfilled") return;
          const status = String(result.value?.status || "");
          if (status && status !== "000" && status !== "013") return;
          appendPayloadRecords(result.value, targetByCode, records);
        });
        throwIfAborted(requestOptions?.signal);
      }
      throwIfAborted(requestOptions?.signal);
      return sanitizeRows(records);
    }

    function readRefreshCache() {
      try {
        const raw = getStorage()?.getItem(refreshCacheKey);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (_) {
        return {};
      }
    }

    function writeRefreshCache(cache) {
      try {
        getStorage()?.setItem(refreshCacheKey, JSON.stringify(cache));
      } catch (_) {
        // Storage may be full or unavailable in private browsing.
      }
    }

    function getRefreshCacheEntry(ticker) {
      const target = String(ticker || "").trim().toUpperCase();
      if (!target) return null;
      const entry = readRefreshCache()[target];
      if (!entry || typeof entry !== "object") return null;
      const savedAt = Number(entry.savedAt || 0);
      if (!Number.isFinite(savedAt) || now() - savedAt > refreshCacheTtlMs) return null;
      return entry;
    }

    function rememberRefresh(ticker, info) {
      const target = String(ticker || "").trim().toUpperCase();
      if (!target) return;
      const cache = readRefreshCache();
      cache[target] = {
        savedAt: now(),
        fetched: Number(info?.fetched || 0),
        added: Number(info?.added || 0),
        latestDate: String(info?.latestDate || ""),
      };
      writeRefreshCache(cache);
    }

    return Object.freeze({
      sanitizeRows,
      mergeRows,
      itemToRecord,
      fetchForMarkets,
      fetchForTicker,
      getRefreshCacheEntry,
      rememberRefresh,
      hasFreshRefresh: (ticker) => Boolean(getRefreshCacheEntry(ticker)),
    });
  }

  globalScope.ThinkStockDartDisclosure = Object.freeze({ createDartDisclosureService });
})(typeof self !== "undefined" ? self : globalThis);
