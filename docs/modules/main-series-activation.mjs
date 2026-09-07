import {
  MARKET_INDEX_SERIES,
  STOCK_TICKER_PATTERN,
  mainSeriesActivationProfile,
  resolveSeriesFeatureActivationPlan,
} from "./app-control-config.mjs";
import tickerPriceRuntime from "./ticker-price-runtime.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeSeriesKey(value) {
  const key = String(value || "").trim();
  return /^\^|^\d{6}\.(KS|KQ)$/i.test(key) ? key.toUpperCase() : key;
}

function rangeStartMs(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const range = values.slice(0, 2).map((value) => (
    Number.isFinite(Number(value)) ? Number(value) : Date.parse(value)
  ));
  return range.every(Number.isFinite) ? Math.min(...range) : null;
}

export function resolveVisibleActivationSinceDate(options = {}) {
  const dayMs = Math.max(1, Number(options.dayMs) || DAY_MS);
  const requestedOverlapDays = Number(options.overlapDays);
  const overlapDays = Math.max(0, Number.isFinite(requestedOverlapDays) ? requestedOverlapDays : 7);
  const pinnedStart = rangeStartMs(options.pinnedRange);
  const currentStart = rangeStartMs(options.currentRange);
  let startMs = Number.isFinite(pinnedStart) ? pinnedStart : currentStart;
  if (!Number.isFinite(startMs)) {
    const activeMonths = Math.max(1, Number(options.activeMonths) || 12);
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    startMs = nowMs - (activeMonths * 30.4375 * dayMs);
  }
  return new Date(startMs - (overlapDays * dayMs)).toISOString().slice(0, 10);
}

export function createMainSeriesActivationCoordinator(options = {}) {
  if (typeof options.profileFor !== "function"
    || typeof options.hasVisiblePrice !== "function"
    || typeof options.reveal !== "function") {
    throw new Error("main series activation dependencies are incomplete");
  }
  const generations = new Map();

  function nextGeneration(key) {
    const generation = (generations.get(key) || 0) + 1;
    generations.set(key, generation);
    return generation;
  }

  function isCurrent(key, generation) {
    return generations.get(key) === generation;
  }

  function isStillActive(key, generation) {
    return isCurrent(key, generation) && options.isActive?.(key) !== false;
  }

  function startCompletion(key, profile, generation, context, visibleResult) {
    return Promise.resolve().then(async () => {
      if (!isStillActive(key, generation)) return false;
      const requiresCompletion = options.needsCompletion?.(
        key,
        profile,
        visibleResult,
        context,
      ) === true;
      let completionResult = null;
      if (requiresCompletion) {
        completionResult = await options.prepareCompletion?.(key, profile, {
          ...context,
          visibleResult,
        });
      }
      if (!isStillActive(key, generation)) return false;
      const featureResult = await options.prepareFeatures?.(key, profile, {
        ...context,
        completionResult,
        visibleResult,
      });
      if (!isStillActive(key, generation)) return false;
      options.onCompleted?.(key, profile, {
        ...context,
        completionResult,
        featureResult,
        visibleResult,
      });
      return true;
    }).catch((error) => {
      if (isCurrent(key, generation)) options.onBackgroundError?.(key, error, context);
      return false;
    });
  }

  function revealPrepared(key, profile, generation, context, visibleResult = null) {
    if (!isCurrent(key, generation)) return { revealed: false, completion: Promise.resolve(false) };
    if (profile.requiresPrice && options.hasVisiblePrice(key, context, visibleResult) !== true) {
      throw new Error(`${key} visible price window is unavailable`);
    }
    const revealed = options.reveal(key, profile, context) !== false;
    if (!revealed) return { revealed: false, completion: Promise.resolve(false) };
    options.onVisible?.(key, profile, { ...context, visibleResult });
    return {
      revealed: true,
      visibleResult,
      completion: startCompletion(key, profile, generation, context, visibleResult),
    };
  }

  function activate(seriesKey, context = {}) {
    const key = normalizeSeriesKey(seriesKey);
    const profile = options.profileFor(key);
    const generation = nextGeneration(key);
    if (!profile?.requiresPrice || options.hasVisiblePrice(key, context) === true) {
      try {
        return Promise.resolve(revealPrepared(key, profile, generation, context));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return Promise.resolve(options.prepareVisible?.(key, profile, context))
      .then((visibleResult) => revealPrepared(key, profile, generation, context, visibleResult));
  }

  function cancel(seriesKey) {
    const key = normalizeSeriesKey(seriesKey);
    if (!key) return false;
    nextGeneration(key);
    options.cancelBackground?.(key);
    return true;
  }

  return Object.freeze({ activate, cancel });
}

export function createMainSeriesActivationApp(options = {}) {
  const state = options.state || {};
  const prices = options.prices || {};
  const effects = options.effects || {};
  const marketIndices = new Set(MARKET_INDEX_SERIES);

  function visibleSinceDate() {
    const hasVisibleSeries = Number(state.visibleCount?.()) > 0;
    return resolveVisibleActivationSinceDate({
      activeMonths: state.activeMonths?.() || state.defaultActiveMonths?.(),
      currentRange: hasVisibleSeries ? state.currentRange?.() : null,
      dayMs: options.dayMs,
      pinnedRange: hasVisibleSeries ? state.pinnedRange?.() : null,
    });
  }

  function seriesPoints(seriesKey) {
    const key = String(seriesKey || "").trim();
    const tickerKey = key.toUpperCase();
    if (STOCK_TICKER_PATTERN.test(tickerKey) || marketIndices.has(tickerKey)) {
      return prices.points?.(tickerKey) || [];
    }
    return (state.dataRows?.() || []).flatMap((rows) => (Array.isArray(rows) ? rows : []))
      .filter((row) => state.toNumber?.(row?.[key]) != null)
      .map((row) => ({ date: row.date }));
  }

  function hasVisiblePrice(key, context = {}, visibleResult = null) {
    const points = seriesPoints(key);
    if (!points.length) return false;
    // Macro series have no per-toggle history loader. Reveal the available
    // observations instead of applying the stock/index coverage requirement.
    if (mainSeriesActivationProfile(key).kind === "macro") return true;
    if (visibleResult?.ready === true) return true;
    return tickerPriceRuntime.hasHistoryCoverageFromDate(points, context.visibleSinceDate);
  }

  const coordinator = createMainSeriesActivationCoordinator({
    profileFor: mainSeriesActivationProfile,
    hasVisiblePrice,
    isActive: (key) => state.isHidden?.(key) !== true,
    prepareVisible: async (key, profile, context) => {
      if (profile.kind === "stock") {
        return prices.load?.(key, {
          displayName: context.displayName,
          forceRefresh: context.forceRefresh === true,
          returnAfterCache: context.forceRefresh !== true,
          visibleSinceDate: context.visibleSinceDate,
        });
      }
      if (profile.kind === "market-index") {
        await prices.refreshIndex?.({
          forceNetwork: context.forceRefresh === true,
          requireVolumeHistory: false,
          tickers: [key],
        });
        return { ready: seriesPoints(key).length > 0 };
      }
      throw new Error(`${key} visible data is unavailable`);
    },
    reveal: (key) => effects.reveal?.(key) !== false,
    needsCompletion: (key, profile, visibleResult, context) => {
      if (profile.kind === "stock") {
        return prices.fullHistoryReady?.(key) !== true
          || visibleResult?.deferredRefresh === true
          || context.pricePlan?.shouldRefresh === true;
      }
      return profile.kind === "market-index"
        && profile.requiresVolume
        && prices.hasVolume?.(key) !== true;
    },
    prepareCompletion: (key, profile, context) => {
      if (profile.kind === "stock") {
        return effects.scheduleHistory?.(key, context.displayName, {
          forceRefresh: context.forceRefresh === true,
          latestOnly: prices.fullHistoryReady?.(key) === true
            && context.pricePlan?.shouldRefresh === true,
        });
      }
      return profile.kind === "market-index"
        ? prices.refreshIndex?.({
            forceNetwork: context.forceRefresh === true,
            requireVolumeHistory: true,
            tickers: [key],
          })
        : null;
    },
    prepareFeatures: async (key, profile, context) => {
      const featurePlan = state.featurePlan?.(key, profile)
        || resolveSeriesFeatureActivationPlan(key, state.featureState?.() || {});
      const tasks = [];
      if (profile.kind === "stock" && featurePlan.supplemental) {
        tasks.push(Promise.resolve(effects.scheduleFeatures?.(key, context.msgEl, {
          featurePlan,
          trackAiProgress: context.trackAiProgress === true,
        })));
      }
      if (featurePlan.signal) {
        tasks.push(Promise.resolve(effects.prepareTiming?.(key, context)));
      }
      if (profile.kind === "market-index" && featurePlan.ai) effects.startAi?.();
      const results = await Promise.allSettled(tasks);
      results.forEach((result) => {
        if (result.status === "rejected") effects.recordError?.(key, result.reason);
      });
      return Object.freeze({ featurePlan, requested: featurePlan.requested, results });
    },
    onCompleted: (_key, profile, context) => {
      if (!context.completionResult && context.featureResult?.requested !== true) return;
      effects.requestComposition?.(profile.kind === "market-index"
        ? "series-index-inputs-ready"
        : "series-features-ready");
    },
    cancelBackground: (key) => {
      const profile = mainSeriesActivationProfile(key);
      if (profile.supportsTiming) effects.cancelTiming?.(profile.key);
      if (profile.kind === "stock") effects.cancelStock?.(profile.key);
    },
    onBackgroundError: (key, error) => effects.recordError?.(key, error),
  });

  async function activate(seriesKey, activateOptions = {}) {
    const profile = mainSeriesActivationProfile(seriesKey);
    const key = profile.key;
    const sinceDate = activateOptions.visibleSinceDate || visibleSinceDate();
    const pricePlan = activateOptions.pricePlan || (profile.kind === "stock"
      ? prices.claimRefresh?.([key], { forceNetwork: activateOptions.forceRefresh === true })
      : { shouldRefresh: false });
    const context = {
      displayName: activateOptions.displayName || prices.displayName?.(key) || key,
      forceRefresh: activateOptions.forceRefresh === true,
      msgEl: activateOptions.msgEl || null,
      pricePlan,
      trackAiProgress: activateOptions.trackAiProgress === true,
      visibleSinceDate: sinceDate,
    };
    const needsVisibleLoad = profile.requiresPrice && !hasVisiblePrice(key, context);
    const button = activateOptions.button || null;
    if (button && needsVisibleLoad) {
      button.dataset.loading = "1";
      button.setAttribute("aria-busy", "true");
    }
    try {
      return await coordinator.activate(key, context);
    } catch (error) {
      if (profile.kind === "stock" && needsVisibleLoad) prices.forgetRefresh?.(key);
      throw error;
    } finally {
      if (button && needsVisibleLoad) {
        delete button.dataset.loading;
        button.removeAttribute("aria-busy");
      }
    }
  }

  return Object.freeze({ activate, cancel: coordinator.cancel, visibleSinceDate });
}

export default Object.freeze({
  createMainSeriesActivationApp,
  createMainSeriesActivationCoordinator,
  resolveVisibleActivationSinceDate,
});
