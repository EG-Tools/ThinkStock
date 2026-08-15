(function initThinkStockRuntimeSeriesQualityGate(globalScope) {
  "use strict";

  const transaction = globalScope.ThinkStockRuntimeDataTransaction;
  const health = globalScope.ThinkStockDataHealth;
  const finite = globalScope.ThinkStockRuntimeFoundation?.values?.finiteOrNull;
  if (!transaction?.validateSeriesRows || !health?.DEFAULT_SERIES_POLICIES || typeof finite !== "function") {
    throw new Error("runtime series quality dependencies are required");
  }

  const INDEX_POLICIES = Object.freeze({
    "^KS11": Object.freeze({
      minValue: 100,
      maxValue: 15_000,
      rejectZero: true,
      maxRelativeChange: 0.18,
      maxAbsoluteChange: 500,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    "^KQ11": Object.freeze({
      minValue: 50,
      maxValue: 5_000,
      rejectZero: true,
      maxRelativeChange: 0.22,
      maxAbsoluteChange: 180,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
  });
  const STOCK_PRICE_POLICY = Object.freeze({
    minValue: 0.01,
    maxValue: 1_000_000_000,
    rejectZero: true,
    scanPoints: 120,
  });
  const COMPONENT_KEYS = Object.freeze({
    macro: Object.freeze(["leading_cycle", "news_sentiment"]),
    credit: Object.freeze(["customer_deposit", "kospi_credit", "kosdaq_credit"]),
    adr: Object.freeze(["adr_kospi", "adr_kosdaq", "fear_greed", "vkospi", "vix"]),
    crisis: Object.freeze(["score"]),
  });

  function normalizeTicker(ticker) {
    return String(ticker || "").trim().toUpperCase();
  }

  function policiesFor(keys) {
    return Object.fromEntries((Array.isArray(keys) ? keys : []).flatMap((key) => (
      health.DEFAULT_SERIES_POLICIES[key]
        ? [[key, health.DEFAULT_SERIES_POLICIES[key]]]
        : []
    )));
  }

  function gapPoliciesFor(keys) {
    return Object.fromEntries(Object.entries(policiesFor(keys)).filter(([, policy]) => (
      Number.isFinite(Number(policy?.maxMissingWeekdays))
    )));
  }

  function pricePolicyFor(ticker) {
    return INDEX_POLICIES[normalizeTicker(ticker)] || STOCK_PRICE_POLICY;
  }

  function priceRows(payload, ticker) {
    const key = normalizeTicker(ticker);
    return (Array.isArray(payload?.records) ? payload.records : []).flatMap((row) => {
      const value = finite(row?.[key]);
      return value === null ? [] : [{ date: String(row?.date || "").slice(0, 10), close: value }];
    });
  }

  function mergePriceRows(currentRows, incomingRows) {
    const byDate = new Map((Array.isArray(currentRows) ? currentRows : []).map((row) => [
      String(row?.date || "").slice(0, 10),
      { date: String(row?.date || "").slice(0, 10), close: finite(row?.close) },
    ]));
    (Array.isArray(incomingRows) ? incomingRows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const close = finite(row?.close);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && close !== null) byDate.set(date, { date, close });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function assertRows(options = {}) {
    const keys = [...new Set((options.keys || []).map(String).filter(Boolean))];
    const input = {
      ...options,
      keys,
      policies: options.policies || policiesFor(keys),
      gapPolicies: options.gapPolicies || gapPoliciesFor(keys),
    };
    const result = options.autoRepair === false
      ? transaction.validateSeriesRows(input)
      : transaction.repairSeriesRows(input);
    if (result.ok) return result;
    const issue = result.issues?.[0] || result.originalValidation?.issues?.[0];
    const detail = issue
      ? `${issue.key} ${issue.latestDate || issue.date || ""} ${issue.kind}`.trim()
      : result.reason;
    const error = new Error(`${options.label || "runtime data"} validation failed: ${detail}`);
    error.code = "RUNTIME_DATA_REJECTED";
    error.validation = result;
    throw error;
  }

  function validatePricePoints(options = {}) {
    const ticker = normalizeTicker(options.ticker);
    const incomingRows = (Array.isArray(options.incomingPoints) ? options.incomingPoints : []).map((point) => ({
      date: String(point?.date || "").slice(0, 10),
      close: finite(point?.close),
    }));
    const currentRows = priceRows(options.currentPayload, ticker);
    const candidateRows = mergePriceRows(currentRows, incomingRows);
    const policy = pricePolicyFor(ticker);
    const isIndex = Boolean(INDEX_POLICIES[ticker]);
    return transaction.validateSeriesRows({
      currentRows,
      candidateRows,
      incomingRows,
      keys: ["close"],
      policies: { close: policy },
      gapPolicies: isIndex && Array.isArray(options.referenceDates)
        ? { close: policy }
        : {},
      referenceDates: options.referenceDates,
      gapLookbackDays: 45,
      maximumGapDates: 3,
    });
  }

  function assertPricePoints(options = {}) {
    const result = validatePricePoints(options);
    if (result.ok) return result;
    const ticker = normalizeTicker(options.ticker) || "price";
    const issue = result.issues?.[0];
    const detail = issue
      ? `${issue.kind} ${issue.latestDate || issue.date || ""}`.trim()
      : result.reason;
    const error = new Error(`${ticker} price validation failed: ${detail}`);
    error.code = "RUNTIME_DATA_REJECTED";
    error.validation = result;
    throw error;
  }

  function validateSnapshotComponent(name, value) {
    const component = String(name || "").trim();
    if (component === "price") {
      const payload = value && typeof value === "object" ? value : null;
      if (!payload?.records?.length) return { ok: false, reason: "price-empty", issues: [] };
      const indexDates = [...new Set(payload.records.flatMap((row) => (
        ["^KS11", "^KQ11"].some((ticker) => finite(row?.[ticker]) !== null)
          ? [String(row?.date || "").slice(0, 10)]
          : []
      )))].sort();
      const tickers = [...new Set([
        ...(Array.isArray(payload.series) ? payload.series : []),
        "^KS11",
        "^KQ11",
      ].map(normalizeTicker).filter((ticker) => priceRows(payload, ticker).length))];
      for (const ticker of tickers) {
        const result = validatePricePoints({
          ticker,
          currentPayload: { records: [] },
          incomingPoints: priceRows(payload, ticker),
          referenceDates: INDEX_POLICIES[ticker] ? indexDates : undefined,
        });
        if (!result.ok) return { ...result, reason: `${ticker}:${result.reason}` };
      }
      return { ok: tickers.length > 0, reason: tickers.length ? "" : "price-series-empty", issues: [] };
    }

    const keys = COMPONENT_KEYS[component];
    if (!keys) return { ok: true, reason: "", issues: [] };
    const rows = Array.isArray(value) ? value : [];
    if (!rows.length) return { ok: true, reason: "", issues: [] };
    return transaction.validateSeriesRows({
      currentRows: [],
      candidateRows: rows,
      incomingRows: rows,
      keys,
      policies: policiesFor(keys),
      gapPolicies: gapPoliciesFor(keys),
    });
  }

  globalScope.ThinkStockRuntimeSeriesQualityGate = Object.freeze({
    COMPONENT_KEYS,
    INDEX_POLICIES,
    STOCK_PRICE_POLICY,
    assertPricePoints,
    assertRows,
    gapPoliciesFor,
    policiesFor,
    pricePolicyFor,
    priceRows,
    validatePricePoints,
    validateSnapshotComponent,
  });
}(typeof self !== "undefined" ? self : globalThis));
