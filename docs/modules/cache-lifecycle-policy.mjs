import { RUNTIME_STORAGE_CONTRACT } from "../../shared/runtime-foundation.mjs";

  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const CACHE_METADATA_SCHEMA = 1;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const CORE_SERIES_CACHE_KEYS = Object.freeze([
    "leading_cycle",
    "^KS11",
    "^KQ11",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
  ]);
  const USER_TICKER_CACHE_LIMIT = 24;
  const TOTAL_SERIES_CACHE_LIMIT = CORE_SERIES_CACHE_KEYS.length + USER_TICKER_CACHE_LIMIT;
  const stores = RUNTIME_STORAGE_CONTRACT?.stores;
  if (!stores) throw new Error("runtime storage contract is required");
  const STORE_POLICIES = Object.freeze({
    [stores.snapshots]: Object.freeze({ maxRecords: 8, maxIdleDays: 14 }),
    [stores.tickerPrices]: Object.freeze({ maxRecords: USER_TICKER_CACHE_LIMIT, maxIdleDays: 240 }),
    [stores.tickerDisclosures]: Object.freeze({ maxRecords: 100, maxIdleDays: 365 }),
    [stores.tickerAiAnalysis]: Object.freeze({ maxRecords: 80, maxIdleDays: 45 }),
    [stores.tickerAiForecast]: Object.freeze({ maxRecords: 80, maxIdleDays: 60 }),
    [stores.tickerAiForecastJournal]: Object.freeze({ maxRecords: 140, maxIdleDays: 730 }),
    [stores.tickerResearchHistory]: Object.freeze({ maxRecords: 1020, maxIdleDays: 240 }),
    [stores.stockResearchResults]: Object.freeze({ maxRecords: 12, maxIdleDays: 240 }),
    [stores.tickerBrokerResearch]: Object.freeze({ maxRecords: 80, maxIdleDays: 365 }),
    [stores.tickerTimingModels]: Object.freeze({ maxRecords: 1020, maxIdleDays: 240 }),
  });

  function storePolicy(storeName, overrides = {}) {
    const configured = STORE_POLICIES[String(storeName || "")] || {};
    return Object.freeze({
      maxRecords: Math.max(1, Number(overrides.maxRecords ?? configured.maxRecords) || 60),
      maxIdleMs: Math.max(DAY_MS, Number(overrides.maxIdleMs)
        || (Number(overrides.maxIdleDays ?? configured.maxIdleDays) || 120) * DAY_MS),
    });
  }

  function normalizedDate(value) {
    const date = String(value || "").slice(0, 10);
    return DATE_PATTERN.test(date) ? date : "";
  }

  function stableValue(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object") {
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      return value;
    }
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => stableValue(entry, seen));
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      stableValue(value[key], seen),
    ]));
  }

  function contentFingerprint(value) {
    let text = "";
    try { text = JSON.stringify(stableValue(value)); } catch (_) { text = String(value ?? ""); }
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  function cacheMetadataIssue(record, options = {}) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return "invalid-record";
    const metadata = record.cacheMeta && typeof record.cacheMeta === "object" ? record.cacheMeta : {};
    if (metadata.schema != null && Number(metadata.schema) !== CACHE_METADATA_SCHEMA) {
      return "metadata-schema-mismatch";
    }
    const expectedSource = String(options.source || "");
    if (expectedSource && metadata.source && metadata.source !== expectedSource) return "source-mismatch";
    const expectedRevision = String(options.revision ?? "");
    if (expectedRevision && metadata.revision && metadata.revision !== expectedRevision) {
      return "revision-mismatch";
    }
    const expectedFingerprint = String(options.contentFingerprint || "");
    const storedFingerprint = String(metadata.contentFingerprint || record.contentFingerprint || "");
    if (expectedFingerprint && storedFingerprint && storedFingerprint !== expectedFingerprint) {
      return "content-mismatch";
    }
    const asOf = String(
      options.latestDate || metadata.asOf || record.asOfDate || record.latestDate || "",
    ).slice(0, 10);
    if (asOf && !DATE_PATTERN.test(asOf)) return "invalid-date";
    if (metadata.invalidatedBy) return "explicitly-invalidated";
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const savedAt = Number(record.savedAt || metadata.savedAt || 0);
    if (!Number.isFinite(savedAt) || savedAt <= 0) {
      if (options.allowMissingTimestamp !== true) return "invalid-timestamp";
    } else if (savedAt > now + DAY_MS) {
      return "invalid-timestamp";
    }
    const maximumAgeMs = Math.max(0, Number(options.maximumAgeMs) || 0);
    if (maximumAgeMs && now - savedAt > maximumAgeMs) return "expired";
    return "";
  }

  function withCacheMetadata(record, options = {}) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const current = record.cacheMeta && typeof record.cacheMeta === "object" ? record.cacheMeta : {};
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const suppliedSavedAt = Number(options.savedAt);
    const storedSavedAt = Number(record.savedAt || current.savedAt || 0);
    const savedAt = Number.isFinite(suppliedSavedAt) && suppliedSavedAt > 0
      ? suppliedSavedAt
      : (Number.isFinite(storedSavedAt) && storedSavedAt > 0 ? storedSavedAt : now);
    const storedLastAccessed = Number(record.lastAccessed || current.lastAccessed || 0);
    const lastAccessed = options.touch === true
      ? now
      : (Number.isFinite(storedLastAccessed) && storedLastAccessed > 0 ? storedLastAccessed : savedAt);
    const expectedFingerprint = String(options.contentFingerprint || "");
    const fingerprint = String(
      expectedFingerprint
      || current.contentFingerprint
      || record.contentFingerprint
      || (Object.prototype.hasOwnProperty.call(options, "content")
        ? contentFingerprint(options.content)
        : ""),
    );
    const cacheMeta = {
      schema: CACHE_METADATA_SCHEMA,
      source: String(options.source || current.source || "").slice(0, 80),
      asOf: normalizedDate(options.asOf || current.asOf || record.asOfDate || record.latestDate),
      revision: String(options.revision ?? current.revision ?? "").slice(0, 160),
      contentFingerprint: fingerprint.slice(0, 160),
      savedAt,
      lastAccessed,
    };
    return {
      ...record,
      savedAt,
      lastAccessed,
      ...(fingerprint ? { contentFingerprint: fingerprint } : {}),
      cacheMeta,
    };
  }

  function touchCacheRecord(record, now = Date.now()) {
    return withCacheMetadata(record, { now, touch: true });
  }

  function recordLifecycle(record, storeName, options = {}) {
    if (!record || typeof record !== "object") return "invalid";
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const accessedAt = Number(record.lastAccessed || record.savedAt || 0);
    if (!Number.isFinite(accessedAt) || accessedAt <= 0 || accessedAt > now + DAY_MS) return "invalid";
    return now - accessedAt > storePolicy(storeName, options).maxIdleMs ? "expired" : "active";
  }

  function granularRecordIssue(record, options = {}) {
    if (record == null) return "missing";
    if (!record || typeof record !== "object" || Array.isArray(record)) return "invalid-record";
    if (Number(record.schema) !== Number(options.schema)) return "schema-mismatch";
    const expectedKey = String(options.key || "").trim().toUpperCase();
    const recordKey = String(record[options.keyField || "ticker"] || "").trim().toUpperCase();
    if (expectedKey && recordKey !== expectedKey) return "key-mismatch";
    if (options.requireContent !== false && Math.max(0, Number(options.contentCount) || 0) === 0) {
      return "empty-content";
    }
    return cacheMetadataIssue(record, options);
  }

  function shouldInvalidatePriceBoundary(options = {}) {
    if (options.corporateAction === true) return true;
    const ratio = Math.abs(Number(options.ratio) || 0);
    const boundaryDays = Math.max(0, Number(options.boundaryDays) || 0);
    const ratioThreshold = Math.max(1, Number(options.ratioThreshold) || 1.8);
    const maximumBoundaryDays = Math.max(1, Number(options.maximumBoundaryDays) || 14);
    return ratio >= ratioThreshold && boundaryDays <= maximumBoundaryDays;
  }

  const cacheLifecyclePolicy = Object.freeze({
    CACHE_METADATA_SCHEMA,
    CORE_SERIES_CACHE_KEYS,
    STORE_POLICIES,
    TOTAL_SERIES_CACHE_LIMIT,
    USER_TICKER_CACHE_LIMIT,
    cacheMetadataIssue,
    contentFingerprint,
    granularRecordIssue,
    recordLifecycle,
    shouldInvalidatePriceBoundary,
    storePolicy,
    touchCacheRecord,
    withCacheMetadata,
  });
  const cacheRecordHealth = Object.freeze({ granularRecordIssue });

export {
  CACHE_METADATA_SCHEMA,
  CORE_SERIES_CACHE_KEYS,
  STORE_POLICIES,
  TOTAL_SERIES_CACHE_LIMIT,
  USER_TICKER_CACHE_LIMIT,
  cacheLifecyclePolicy,
  cacheMetadataIssue,
  cacheRecordHealth,
  contentFingerprint,
  granularRecordIssue,
  recordLifecycle,
  shouldInvalidatePriceBoundary,
  storePolicy,
  touchCacheRecord,
  withCacheMetadata,
};

export default cacheLifecyclePolicy;
