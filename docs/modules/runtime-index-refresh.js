(function initThinkStockRuntimeIndexRefresh(globalScope) {
  "use strict";

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function latestDatesByTicker(payload, tickers, toNumber = Number) {
    const latest = Object.fromEntries((tickers || []).map((ticker) => [ticker, ""]));
    (payload?.records || []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (!DATE_PATTERN.test(date)) return;
      Object.keys(latest).forEach((ticker) => {
        const value = toNumber(row?.[ticker]);
        if (!Number.isFinite(value)) return;
        if (!latest[ticker] || date > latest[ticker]) latest[ticker] = date;
      });
    });
    return latest;
  }

  function normalizeTickerPoints(records, ticker, toNumber = Number) {
    const byDate = new Map();
    (Array.isArray(records) ? records : []).forEach((row) => {
      if (row?.ticker !== ticker) return;
      const date = String(row?.date || "").slice(0, 10);
      const close = toNumber(row?.close);
      if (!DATE_PATTERN.test(date) || !Number.isFinite(close) || close <= 0) return;
      byDate.set(date, { date, close });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function createRuntimeIndexRefreshService(options = {}) {
    const tickers = Object.freeze(["^KS11", "^KQ11"]);
    const gatewayClient = options.gatewayClient;
    if (!gatewayClient?.fetchIndices || typeof options.getPricePayload !== "function") {
      throw new Error("runtime index refresh dependencies are incomplete");
    }

    async function readLocalHealth(signal) {
      if (!options.isLocalRuntime || typeof options.fetchWithTimeout !== "function") return null;
      try {
        const response = await options.fetchWithTimeout(options.healthEndpoint || "./api/health", {
          cache: "no-store",
          signal,
        }, options.timeoutMs);
        return response.ok ? response.json().catch(() => null) : null;
      } catch (error) {
        if (options.isAbortError?.(error) || signal?.aborted) throw error;
        return null;
      }
    }

    async function refresh(requestOptions = {}) {
      const signal = requestOptions.signal || null;
      options.throwIfAborted?.(signal);
      const applied = [];
      const warnings = [];
      if (!options.isLocalRuntime && !options.canUseGateway?.()) return { applied, warnings };
      const beforeLatest = latestDatesByTicker(options.getPricePayload(), tickers, options.toNumber);

      try {
        const health = await readLocalHealth(signal);
        const expectedAppVersion = String(options.appVersion || "").trim();
        const localServerVersion = String(health?.appVersion || "").trim();
        const versionMismatch = Boolean(
          expectedAppVersion
          && localServerVersion
          && expectedAppVersion !== localServerVersion,
        );
        if (health?.restartRequired === true || versionMismatch) {
          warnings.push("로컬 서버 업데이트 감지 · ThinkStock 로컬서버를 다시 실행해 주세요.");
        }
        const payload = requestOptions.payload || await gatewayClient.fetchIndices({
          signal,
          forceNetwork: requestOptions.forceNetwork,
          since: Object.values(beforeLatest).filter(Boolean).sort()[0] || "",
          timeoutMs: options.timeoutMs,
        });
        if (payload?.ok !== true) throw new Error(payload?.error || "KRX index response is invalid");
        const records = Array.isArray(payload.records) ? payload.records : [];
        const referenceDates = [...new Set(records.flatMap((row) => (
          tickers.includes(String(row?.ticker || "")) && DATE_PATTERN.test(String(row?.date || "").slice(0, 10))
            ? [String(row.date).slice(0, 10)]
            : []
        )))].sort();
        tickers.forEach((ticker) => {
          const points = normalizeTickerPoints(records, ticker, options.toNumber);
          if (!points.length) {
            warnings.push(`${options.labelName?.(ticker) || ticker} 갱신 오류: KRX index data is empty`);
            return;
          }
          try {
            options.validateTickerPoints?.(ticker, points, { referenceDates });
            options.mergeTickerSeries(ticker, points);
          } catch (error) {
            warnings.push(`${options.labelName?.(ticker) || ticker}은 이전 값 유지: ${error?.message || error}`);
            return;
          }
          const latestDate = points.at(-1).date;
          if (latestDate !== beforeLatest[ticker]) {
            applied.push(`${options.labelName?.(ticker) || ticker} 반영(${latestDate})`);
          }
        });
        if (payload.warning) warnings.push(String(payload.warning));
      } catch (error) {
        if (options.isAbortError?.(error) || signal?.aborted) throw error;
        if (options.isRetryableError?.(error)) throw error;
        warnings.push(`KRX 지수 갱신 오류: ${error?.message || error}`);
      }
      return { applied, warnings };
    }

    return Object.freeze({ refresh });
  }

  globalScope.ThinkStockRuntimeIndexRefresh = Object.freeze({
    createRuntimeIndexRefreshService,
    latestDatesByTicker,
    normalizeTickerPoints,
  });
}(typeof self !== "undefined" ? self : globalThis));
