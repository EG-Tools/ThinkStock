"use strict";

const stockResearchContract = require("./stock-research-contract.js");

  const DISPLAY_LIMIT = 5;
  const MAX_UNIVERSE_STATE = Math.max(
    400,
    Number(stockResearchContract?.UNIVERSE_SIZE_HIGH) || 1000,
  );

  function tickerOf(value) {
    return String(value || "").trim().toUpperCase();
  }

  function diffUniverse(previousTickers, records) {
    const previous = new Set((Array.isArray(previousTickers) ? previousTickers : [])
      .map(tickerOf)
      .filter(Boolean));
    const current = new Set((Array.isArray(records) ? records : [])
      .map((item) => tickerOf(item?.ticker))
      .filter(Boolean));
    return {
      added: (Array.isArray(records) ? records : []).filter((item) => !previous.has(tickerOf(item?.ticker))),
      removed: [...previous].filter((ticker) => !current.has(ticker)),
    };
  }

  function finiteToken(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : "";
  }

  function universeFingerprint(item) {
    return [
      tickerOf(item?.ticker),
      String(item?.market || "").trim().toUpperCase(),
      String(item?.name || "").trim(),
      String(item?.baseDate || "").slice(0, 10),
      String(item?.priceMode || "settled").trim().toLowerCase(),
      finiteToken(item?.close),
      finiteToken(item?.volume),
    ].join("|");
  }

  function universeMetadataFingerprint(item) {
    return [
      tickerOf(item?.ticker),
      String(item?.name || "").trim(),
      finiteToken(item?.rank),
      finiteToken(item?.marketCap),
    ].join("|");
  }

  function hashText(value) {
    let hash = 2166136261;
    const source = String(value || "");
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${(hash >>> 0).toString(16).padStart(8, "0")}:${source.length}`;
  }

  function sharedResearchFingerprint(shared, market = "") {
    const marketKey = String(market || "").trim().toUpperCase();
    const sourceNames = marketKey === "KOSPI"
      ? ["kospiRows", "adrRows", "macroRows", "creditRows", "crisisRows"]
      : (marketKey === "KOSDAQ"
        ? ["kosdaqRows", "adrRows", "macroRows", "creditRows", "crisisRows"]
        : ["kospiRows", "kosdaqRows", "adrRows", "macroRows", "creditRows", "crisisRows"]);
    const marketKeys = marketKey === "KOSPI"
      ? new Set(["date", "adr_kospi", "fear_greed", "customer_deposit", "kospi_credit"])
      : (marketKey === "KOSDAQ"
        ? new Set(["date", "adr_kosdaq", "fear_greed", "customer_deposit", "kosdaq_credit"])
        : null);
    const snapshot = sourceNames.map((name) => {
      const rows = Array.isArray(shared?.[name]) ? shared[name].slice(-8) : [];
      const normalized = rows.map((row) => Object.keys(row || {})
        .filter((key) => !marketKeys || !["adrRows", "creditRows"].includes(name) || marketKeys.has(key))
        .sort()
        .flatMap((key) => {
          const value = row?.[key];
          if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
            return [[key, Number.isFinite(value) ? Number(value) : String(value ?? "")]];
          }
          return [];
        }));
      return [name, normalized];
    });
    return hashText(JSON.stringify(snapshot));
  }

  function sharedResearchFingerprints(shared) {
    return Object.freeze({
      KOSPI: sharedResearchFingerprint(shared, "KOSPI"),
      KOSDAQ: sharedResearchFingerprint(shared, "KOSDAQ"),
    });
  }

  function normalizeUniverseState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([tickerValue, state]) => {
      const ticker = tickerOf(tickerValue);
      if (!/^\d{6}\.(KS|KQ)$/.test(ticker) || !state || typeof state !== "object") return [];
      return [[ticker, {
        fingerprint: String(state.fingerprint || "").slice(0, 240),
        metadataFingerprint: String(state.metadataFingerprint || "").slice(0, 240),
        signalFingerprint: String(state.signalFingerprint || "").slice(0, 240),
      }]];
    }).slice(0, MAX_UNIVERSE_STATE));
  }

  function candidateSignalFingerprint(candidate) {
    if (!candidate) return "none";
    return [
      String(candidate.signalMode || "buy").slice(0, 8),
      Math.max(0, Math.round(Number(candidate.buyCount) || 0)),
      Math.max(0, Math.round(Number(candidate.sellCount) || 0)),
      Math.max(0, Math.round(Number(candidate.recentMonthBuyCount) || 0)),
      Math.max(0, Math.round(Number(candidate.recentMonthSellCount) || 0)),
      String(candidate.firstBuyDate || "").slice(0, 10),
      String(candidate.lastBuyDate || "").slice(0, 10),
      String(candidate.firstBuyConfirmationDate || "").slice(0, 10),
      String(candidate.lastBuyConfirmationDate || "").slice(0, 10),
      String(candidate.firstSellDate || "").slice(0, 10),
      String(candidate.lastSellDate || "").slice(0, 10),
      String(candidate.firstSellConfirmationDate || "").slice(0, 10),
      String(candidate.lastSellConfirmationDate || "").slice(0, 10),
      String(candidate.sellDate || "").slice(0, 10),
      String(candidate.bottomDate || "").slice(0, 10),
      String(candidate.priceMode || "settled").slice(0, 12),
      String(candidate.signalState || "confirmed").slice(0, 12),
      String(candidate.status || "").slice(0, 40),
    ].join("|");
  }

  function diffUniverseState(previousState, records, previousTickers = []) {
    const prior = normalizeUniverseState(previousState);
    const composition = diffUniverse(
      Object.keys(prior).length ? Object.keys(prior) : previousTickers,
      records,
    );
    const addedTickers = new Set(composition.added.map((item) => tickerOf(item?.ticker)));
    const state = {};
    const changed = [];
    const metadataChanged = [];
    const unchanged = [];
    (Array.isArray(records) ? records : []).forEach((item) => {
      const ticker = tickerOf(item?.ticker);
      if (!ticker) return;
      const fingerprint = universeFingerprint(item);
      const metadataFingerprint = universeMetadataFingerprint(item);
      state[ticker] = {
        fingerprint,
        metadataFingerprint,
        signalFingerprint: prior[ticker]?.signalFingerprint || "",
      };
      if (addedTickers.has(ticker)) return;
      if (!prior[ticker]?.fingerprint || prior[ticker].fingerprint !== fingerprint) changed.push(item);
      else {
        unchanged.push(item);
        if (prior[ticker]?.metadataFingerprint !== metadataFingerprint) metadataChanged.push(item);
      }
    });
    return { ...composition, changed, metadataChanged, unchanged, state };
  }

  function selectRandomBatch(pool, seenTickers = [], options = {}) {
    const limit = Math.max(1, Math.round(Number(options.limit) || DISPLAY_LIMIT));
    const random = typeof options.random === "function" ? options.random : Math.random;
    const uniquePool = new Map();
    (Array.isArray(pool) ? pool : []).forEach((candidate) => {
      const ticker = tickerOf(candidate?.ticker);
      if (ticker && !uniquePool.has(ticker)) uniquePool.set(ticker, candidate);
    });
    let seen = new Set((Array.isArray(seenTickers) ? seenTickers : []).map(tickerOf));
    let remaining = [...uniquePool.entries()].filter(([ticker]) => !seen.has(ticker));
    const cycleReset = remaining.length === 0 && uniquePool.size > 0;
    if (cycleReset) {
      seen = new Set();
      remaining = [...uniquePool.entries()];
    }
    for (let index = remaining.length - 1; index > 0; index -= 1) {
      const sample = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
      const swapIndex = Math.floor(sample * (index + 1));
      [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
    }
    const candidates = remaining.slice(0, limit).map(([, candidate]) => candidate);
    candidates.forEach((candidate) => seen.add(tickerOf(candidate.ticker)));
    return { candidates, seenTickers: [...seen], cycleReset };
  }

  function mergeCandidateProfiles(pool, enrichedCandidates) {
    const enrichedByTicker = new Map((Array.isArray(enrichedCandidates) ? enrichedCandidates : [])
      .map((candidate) => [tickerOf(candidate?.ticker), candidate]));
    return (Array.isArray(pool) ? pool : []).map((candidate) => {
      const enriched = enrichedByTicker.get(tickerOf(candidate?.ticker));
      if (!enriched?.category) return candidate;
      return {
        ...candidate,
        category: enriched.category,
        industry: enriched.industry || "",
        categoryType: enriched.categoryType || "업종",
      };
    });
  }

  function normalizeCandidateOrder(pool, preferredTickers = [], random = Math.random) {
    const poolByTicker = new Map((Array.isArray(pool) ? pool : []).map((candidate) => [
      tickerOf(candidate?.ticker),
      candidate,
    ]).filter(([ticker]) => ticker));
    const order = [];
    const used = new Set();
    (Array.isArray(preferredTickers) ? preferredTickers : []).forEach((tickerValue) => {
      const ticker = tickerOf(tickerValue);
      if (poolByTicker.has(ticker) && !used.has(ticker)) {
        used.add(ticker);
        order.push(ticker);
      }
    });
    const remaining = [...poolByTicker.values()].filter((candidate) => !used.has(tickerOf(candidate.ticker)));
    const randomized = selectRandomBatch(remaining, [], { limit: Math.max(1, remaining.length), random }).candidates;
    randomized.forEach((candidate) => order.push(tickerOf(candidate.ticker)));
    return order;
  }

  function selectCandidatePage(pool, order, pageIndex, limit = DISPLAY_LIMIT) {
    const poolByTicker = new Map((Array.isArray(pool) ? pool : []).map((candidate) => [
      tickerOf(candidate?.ticker),
      candidate,
    ]));
    const start = Math.max(0, Math.round(Number(pageIndex) || 0)) * limit;
    return (Array.isArray(order) ? order : [])
      .slice(start, start + limit)
      .map((ticker) => poolByTicker.get(tickerOf(ticker)))
      .filter(Boolean);
  }

  const stockResearchNavigation = Object.freeze({
    MAX_UNIVERSE_STATE,
    DISPLAY_LIMIT,
    candidateSignalFingerprint,
    diffUniverse,
    diffUniverseState,
    mergeCandidateProfiles,
    normalizeUniverseState,
    normalizeCandidateOrder,
    sharedResearchFingerprint,
    sharedResearchFingerprints,
    selectCandidatePage,
    selectRandomBatch,
    universeFingerprint,
    universeMetadataFingerprint,
  });

module.exports = stockResearchNavigation;
