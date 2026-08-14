(function initThinkStockTickerCacheInvalidation(globalScope) {
  "use strict";

  const lifecycle = globalScope.ThinkStockCacheLifecyclePolicy;
  if (!lifecycle?.shouldInvalidatePriceBoundary) {
    throw new Error("cache lifecycle policy is required");
  }

  const DERIVED_STORES = Object.freeze([
    "tickerResearchHistory",
    "tickerAiForecast",
  ]);
  const PRICE_STORE = "tickerPrices";
  const DEPENDENT_STORES_BY_SOURCE = Object.freeze({
    price: DERIVED_STORES,
    analysis: Object.freeze(["tickerAiForecast"]),
    disclosure: Object.freeze(["tickerAiForecast"]),
    macro: Object.freeze(["tickerAiForecast"]),
  });

  function normalizeTicker(ticker) {
    return String(ticker || "").trim().toUpperCase();
  }

  function normalizedPoints(points) {
    const byDate = new Map();
    (Array.isArray(points) ? points : []).forEach((point) => {
      const date = String(point?.date || "").slice(0, 10);
      const close = Number(point?.close);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) {
        byDate.set(date, { date, close });
      }
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function findHistoricalRevision(existingPoints, incomingPoints, options = {}) {
    const existing = normalizedPoints(existingPoints);
    const incoming = normalizedPoints(incomingPoints);
    if (!existing.length || !incoming.length) return null;
    const existingByDate = new Map(existing.map((point) => [point.date, point.close]));
    const latestObservedDate = [existing.at(-1)?.date, incoming.at(-1)?.date].filter(Boolean).sort().at(-1) || "";
    const threshold = Math.max(0.0001, Number(options.revisionThreshold) || 0.005);
    for (const point of incoming) {
      const previous = existingByDate.get(point.date);
      if (!Number.isFinite(previous) || point.date >= latestObservedDate) continue;
      const ratio = Math.max(previous, point.close) / Math.min(previous, point.close);
      if (ratio - 1 >= threshold) return { date: point.date, ratio };
    }
    return null;
  }

  function assessPriceUpdate(existingPoints, incomingPoints, options = {}) {
    const rebaseSignal = options.rebaseSignal || null;
    const boundaryInvalid = options.corporateAction === true
      || (Boolean(rebaseSignal) && lifecycle.shouldInvalidatePriceBoundary({
        ratio: rebaseSignal?.ratio,
        boundaryDays: rebaseSignal?.type === "overlap" ? 0 : Number(options.boundaryDays) || 14,
        ratioThreshold: options.ratioThreshold,
        maximumBoundaryDays: options.maximumBoundaryDays,
      }));
    if (boundaryInvalid) {
      return Object.freeze({
        invalidateDerived: true,
        invalidatePrice: true,
        fullHistoryRequired: true,
        reason: "corporate-action-boundary",
        detail: rebaseSignal,
        changedSources: Object.freeze(["price"]),
      });
    }
    const revision = findHistoricalRevision(existingPoints, incomingPoints, options);
    if (revision) {
      return Object.freeze({
        invalidateDerived: true,
        invalidatePrice: false,
        fullHistoryRequired: false,
        reason: "historical-price-revision",
        detail: revision,
        changedSources: Object.freeze(["price"]),
      });
    }
    return Object.freeze({
      invalidateDerived: false,
      invalidatePrice: false,
      fullHistoryRequired: false,
      reason: "append-only",
      detail: null,
      changedSources: Object.freeze([]),
    });
  }

  function storesForSources(sources, options = {}) {
    const stores = new Set(options.includePrice === true ? [PRICE_STORE] : []);
    (Array.isArray(sources) ? sources : []).forEach((source) => {
      (DEPENDENT_STORES_BY_SOURCE[String(source || "").trim()] || []).forEach((store) => stores.add(store));
    });
    return Object.freeze([...stores]);
  }

  function createTickerCacheInvalidator(options = {}) {
    const remove = options.remove;
    if (typeof remove !== "function") throw new Error("cache remove callback is required");

    async function invalidateSources(ticker, sources, invalidateOptions = {}) {
      const target = normalizeTicker(ticker);
      if (!target) return { ticker: target, stores: [], reason: "" };
      const changedSources = Object.freeze([...(Array.isArray(sources) ? sources : [])]
        .map((source) => String(source || "").trim())
        .filter(Boolean));
      const stores = storesForSources(changedSources, invalidateOptions);
      if (!stores.length) return { ticker: target, stores, reason: "" };
      await Promise.allSettled(stores.map((storeName) => remove(storeName, target)));
      const context = Object.freeze({
        ...invalidateOptions,
        changedSources,
        stores,
      });
      try { options.clearMemory?.(target, context); } catch (_) {}
      return Object.freeze({
        ticker: target,
        stores,
        reason: String(invalidateOptions.reason || "source-revision"),
      });
    }

    async function invalidate(ticker, assessment = {}) {
      const target = normalizeTicker(ticker);
      if (!target || assessment.invalidateDerived !== true) return { ticker: target, stores: [], reason: "" };
      return invalidateSources(target, assessment.changedSources?.length ? assessment.changedSources : ["price"], {
        ...assessment,
        includePrice: assessment.invalidatePrice === true,
        reason: assessment.reason || "price-revision",
      });
    }

    return Object.freeze({ invalidate, invalidateSources });
  }

  globalScope.ThinkStockTickerCacheInvalidation = Object.freeze({
    DERIVED_STORES,
    DEPENDENT_STORES_BY_SOURCE,
    PRICE_STORE,
    assessPriceUpdate,
    createTickerCacheInvalidator,
    findHistoricalRevision,
    storesForSources,
  });
}(typeof self !== "undefined" ? self : globalThis));
