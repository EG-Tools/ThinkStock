"use strict";

  const UNIVERSE_SIZE_KEY = "thinkstock-stock-research-universe-size-v1";
  const UNIVERSE_SIZE_DEFAULT = 400;
  const UNIVERSE_SIZE_LOW = 100;
  const UNIVERSE_SIZE_HIGH = 1000;
  const UNIVERSE_SIZE_STEP = 100;
  const SIGNAL_WINDOW_VALUES = Object.freeze([0, 1, 15, 30]);
  const BLOCKED_KEY = "thinkstock-stock-research-blocked-v1";
  const BLOCKED_SCHEMA = 1;

  function normalizeSignalWindowDays(value, todayOnly = false) {
    if (todayOnly === true) return 1;
    const alias = String(value ?? "").trim().toLowerCase();
    if (alias === "today" || alias === "day") return 1;
    const number = Math.round(Number(value));
    return SIGNAL_WINDOW_VALUES.includes(number) ? number : 0;
  }

  function nextSignalWindowDays(value) {
    const normalized = normalizeSignalWindowDays(value);
    const index = SIGNAL_WINDOW_VALUES.indexOf(normalized);
    return SIGNAL_WINDOW_VALUES[(index + 1) % SIGNAL_WINDOW_VALUES.length];
  }

  function signalWindowLabel(value) {
    const normalized = normalizeSignalWindowDays(value);
    return normalized > 0 ? `${normalized}일` : "OFF";
  }

  function signalWindowSessionSpan(value) {
    const normalized = normalizeSignalWindowDays(value);
    return normalized === 1 ? 2 : normalized;
  }

  function loadBlockedCount(storage) {
    try {
      const payload = JSON.parse(storage?.getItem(BLOCKED_KEY) || "null");
      return payload?.schema === BLOCKED_SCHEMA && Array.isArray(payload.entries)
        ? payload.entries.length
        : 0;
    } catch (_) {
      return 0;
    }
  }

  function normalizeUniverseSize(value) {
    if (value == null || String(value).trim() === "") return UNIVERSE_SIZE_DEFAULT;
    const number = Number(value);
    if (!Number.isFinite(number)) return UNIVERSE_SIZE_DEFAULT;
    const stepped = Math.round(number / UNIVERSE_SIZE_STEP) * UNIVERSE_SIZE_STEP;
    return Math.max(UNIVERSE_SIZE_LOW, Math.min(UNIVERSE_SIZE_HIGH, stepped));
  }

  function loadUniverseSize(storage) {
    try { return normalizeUniverseSize(storage?.getItem(UNIVERSE_SIZE_KEY)); }
    catch (_) { return UNIVERSE_SIZE_DEFAULT; }
  }

  function saveUniverseSize(storage, value) {
    const normalized = normalizeUniverseSize(value);
    try { storage?.setItem(UNIVERSE_SIZE_KEY, String(normalized)); } catch (_) {}
    return normalized;
  }

  function researchUniverseDescription(value) {
    const perMarket = normalizeUniverseSize(value) / 2;
    return `시총 상위 ${perMarket}+${perMarket} 중 상대적 안정성 필터를 통과한 공부 후보입니다. 매수 추천이 아닙니다.`;
  }

  const SIGNAL_LOGIC_VERSION = "adaptive1000-recovery-v12";
  const contract = Object.freeze({
    SIGNAL_LOGIC_VERSION,
    CALCULATION_VERSION: SIGNAL_LOGIC_VERSION,
    HISTORY_QUALITY_VERSION: 2,
    CACHE_FORMAT_SCHEMA: 2,
    HISTORY_CACHE_SCHEMA: 2,
    CACHE_KEY: "thinkstock-stock-research-v1",
    CACHE_VARIANTS_KEY: "thinkstock-stock-research-variants-v1",
    CACHE_BYPASS_KEY: "thinkstock-stock-research-cache-bypass-v1",
    BLOCKED_KEY,
    BLOCKED_SCHEMA,
    MINIMUM_KEY: "thinkstock-stock-research-minimum-v1",
    MINIMUM_DEFAULT: 5,
    MINIMUM_LOW: 1,
    MINIMUM_HIGH: 10,
    UNIVERSE_SIZE_KEY,
    UNIVERSE_SIZE_DEFAULT,
    UNIVERSE_SIZE_LOW,
    UNIVERSE_SIZE_HIGH,
    UNIVERSE_SIZE_STEP,
    RECENT_SIGNAL_WINDOW: 252,
    ONE_MONTH_SIGNAL_WINDOW: 21,
    SIGNAL_WINDOW_VALUES,
    loadBlockedCount,
    loadUniverseSize,
    nextSignalWindowDays,
    normalizeSignalWindowDays,
    normalizeUniverseSize,
    researchUniverseDescription,
    saveUniverseSize,
    signalWindowLabel,
    signalWindowSessionSpan,
  });

module.exports = contract;
