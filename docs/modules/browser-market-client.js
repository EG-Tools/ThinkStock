(function initBrowserMarketClient(globalScope) {
  "use strict";

  function createBrowserMarketClient(options = {}) {
    const fetchJson = options.fetchJson;
    const appendCacheBust = options.appendCacheBust || ((url) => url);
    const shiftDays = options.shiftDays;
    const toNumber = options.toNumber || ((value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    });
    const dayMs = Number(options.dayMs) || 86400000;
    const baseInfoEndpoints = options.baseInfoEndpoints || {};
    const indexEndpoints = options.indexEndpoints || {};
    if (typeof fetchJson !== "function") throw new TypeError("fetchJson is required");
    if (typeof shiftDays !== "function") throw new TypeError("shiftDays is required");

    function toYyyymmdd(dateObject) {
      const year = dateObject.getUTCFullYear();
      const month = `${dateObject.getUTCMonth() + 1}`.padStart(2, "0");
      const day = `${dateObject.getUTCDate()}`.padStart(2, "0");
      return `${year}${month}${day}`;
    }

    function getRecentKrxBaseDates(daysBack = 14, now = new Date()) {
      const dates = [];
      for (let offset = 0; offset <= daysBack; offset += 1) {
        const dateObject = new Date(now);
        dateObject.setUTCDate(dateObject.getUTCDate() - offset);
        dates.push(toYyyymmdd(dateObject));
      }
      return dates;
    }

    function normalizeKrxUniverseRows(rows, fallbackMarket) {
      const normalized = [];
      const seen = new Set();
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const rawCode = String(row?.ISU_SRT_CD || "").replace(/\D/g, "");
        if (!rawCode) return;
        const code = rawCode.padStart(6, "0").slice(-6);
        const rawMarket = String(row?.MKT_TP_NM || fallbackMarket || "").toUpperCase();
        const isKosdaq = rawMarket.includes("KOSDAQ");
        const isKospi = rawMarket.includes("KOSPI")
          || (!isKosdaq && String(fallbackMarket || "").toUpperCase() === "KOSPI");
        if (!isKospi && !isKosdaq) return;
        const market = isKosdaq ? "KOSDAQ" : "KOSPI";
        const ticker = `${code}.${isKosdaq ? "KQ" : "KS"}`;
        const name = String(row?.ISU_ABBRV || row?.ISU_NM || "").trim();
        if (!name || seen.has(ticker)) return;
        seen.add(ticker);
        normalized.push({ ticker, code, name, market });
      });
      return normalized;
    }

    async function fetchKrxUniverseRows(apiKey, baseDate, market) {
      const endpoint = baseInfoEndpoints[market];
      const key = String(apiKey || "").trim();
      if (!endpoint || !key) return [];
      const roots = [
        `https://data-dbg.krx.co.kr/svc/apis/sto/${endpoint}`,
        `https://data-dbg.krx.co.kr/svc/sample/apis/sto/${endpoint}`,
      ];
      for (const root of roots) {
        const url = `${root}?basDd=${encodeURIComponent(baseDate)}&AUTH_KEY=${encodeURIComponent(key)}`;
        try {
          const payload = await fetchJson(url, null, { allowProxy: false });
          const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
          if (rows.length) return rows;
        } catch (_) {
          // Try the sample endpoint when the production endpoint is unavailable.
        }
      }
      return [];
    }

    function buildYahooHistoryUrl(ticker, sinceDate = "", nowMs = Date.now()) {
      const baseUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d`;
      const safeSinceDate = String(sinceDate || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(safeSinceDate)) {
        const startDate = shiftDays(safeSinceDate, -7);
        const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
        const period2 = Math.floor((nowMs + dayMs) / 1000);
        if (Number.isFinite(period1) && Number.isFinite(period2) && period2 > period1) {
          return `${baseUrl}&period1=${period1}&period2=${period2}`;
        }
      }
      return `${baseUrl}&range=30y`;
    }

    async function fetchYahooHistorySeries(ticker, requestOptions = {}) {
      const baseUrl = buildYahooHistoryUrl(ticker, requestOptions.sinceDate || "");
      const payload = await fetchJson(
        appendCacheBust(baseUrl),
        { signal: requestOptions.signal },
      );
      const result = payload?.chart?.result?.[0];
      if (!result) throw new Error(`${ticker} price history is unavailable`);
      const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
      const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
        ? result.indicators.quote[0].close
        : [];
      const offsetSeconds = Number(result?.meta?.gmtoffset || 0);
      const byDate = new Map();
      timestamps.forEach((rawTimestamp, index) => {
        const timestamp = Number(rawTimestamp);
        const close = toNumber(closes[index]);
        if (!Number.isFinite(timestamp) || close === null) return;
        const date = new Date((timestamp + offsetSeconds) * 1000).toISOString().slice(0, 10);
        byDate.set(date, close);
      });
      return [...byDate.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([date, close]) => ({ date, close }));
    }

    function parseLooseNumber(raw) {
      const cleaned = String(raw ?? "").replace(/,/g, "").trim();
      if (!cleaned) return null;
      const number = Number(cleaned);
      return Number.isFinite(number) ? number : null;
    }

    function normalizeKrxDate(raw) {
      const text = String(raw ?? "").trim();
      if (!/^\d{8}$/.test(text)) return "";
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }

    function scoreKrxIndexName(name, market) {
      const text = String(name || "").toUpperCase().replace(/\s+/g, "");
      if (!text) return 0;
      if (market === "KOSPI") {
        if (text === "코스피" || text === "KOSPI") return 100;
        if (text.includes("코스피")) return 70;
        if (text.includes("KOSPI")) return 50;
      }
      if (market === "KOSDAQ") {
        if (text === "코스닥" || text === "KOSDAQ") return 100;
        if (text.includes("코스닥")) return 70;
        if (text.includes("KOSDAQ")) return 50;
      }
      return 0;
    }

    function pickKrxIndexSeriesPoint(rows, market) {
      const list = Array.isArray(rows) ? rows : ((rows && typeof rows === "object") ? [rows] : []);
      let best = null;
      list.forEach((row) => {
        const date = normalizeKrxDate(row?.BAS_DD ?? row?.basDd ?? row?.BASDD);
        const close = parseLooseNumber(row?.CLSPRC_IDX ?? row?.TDD_CLSPRC ?? row?.CLSPRC ?? row?.closePrice);
        if (!date || !Number.isFinite(close)) return;
        const score = scoreKrxIndexName(
          row?.IDX_NM ?? row?.IDX_NM_KOR ?? row?.IDX_NM_ENG ?? row?.IDX_NM_EN ?? "",
          market,
        );
        if (!best || score > best.score) best = { date, close, score };
      });
      return best ? { date: best.date, close: best.close } : null;
    }

    async function fetchKrxIndexPoint(apiKey, market, baseDate, signal = null) {
      const endpoint = indexEndpoints[market];
      const key = String(apiKey || "").trim();
      if (!endpoint || !key || !/^\d{8}$/.test(String(baseDate || ""))) return null;
      const roots = [
        `https://data-dbg.krx.co.kr/svc/apis/idx/${endpoint}`,
        `https://data-dbg.krx.co.kr/svc/sample/apis/idx/${endpoint}`,
      ];
      for (const root of roots) {
        const url = `${root}?basDd=${encodeURIComponent(baseDate)}&AUTH_KEY=${encodeURIComponent(key)}`;
        try {
          const payload = await fetchJson(url, { signal }, { allowProxy: false });
          const rows = payload?.OutBlock_1 ?? payload?.output ?? payload?.data ?? [];
          const point = pickKrxIndexSeriesPoint(rows, market);
          if (point) return point;
        } catch (error) {
          if (error?.name === "AbortError" || signal?.aborted) throw error;
        }
      }
      return null;
    }

    async function fetchLatestKrxCoreIndexRows(apiKey, daysBack = 20, signal = null) {
      const key = String(apiKey || "").trim();
      if (!key) return [];
      const targets = [
        { market: "KOSPI", ticker: "^KS11" },
        { market: "KOSDAQ", ticker: "^KQ11" },
      ];
      const dates = getRecentKrxBaseDates(daysBack);
      const found = await Promise.all(targets.map(async (target) => {
        let best = null;
        for (const baseDate of dates) {
          if (signal?.aborted) {
            const error = new Error("Request was superseded by a newer refresh");
            error.name = "AbortError";
            throw error;
          }
          const point = await fetchKrxIndexPoint(key, target.market, baseDate, signal);
          if (!point) continue;
          if (!best || point.date > best.date) {
            best = { ticker: target.ticker, date: point.date, close: point.close };
          }
          if (best && normalizeKrxDate(baseDate) <= best.date) break;
        }
        return best;
      }));
      return found.filter(Boolean);
    }

    return Object.freeze({
      toYyyymmdd,
      getRecentKrxBaseDates,
      normalizeKrxUniverseRows,
      fetchKrxUniverseRows,
      buildYahooHistoryUrl,
      fetchYahooHistorySeries,
      parseLooseNumber,
      normalizeKrxDate,
      scoreKrxIndexName,
      pickKrxIndexSeriesPoint,
      fetchKrxIndexPoint,
      fetchLatestKrxCoreIndexRows,
    });
  }

  globalScope.ThinkStockBrowserMarketClient = Object.freeze({
    createBrowserMarketClient,
  });
}(typeof self !== "undefined" ? self : globalThis));
