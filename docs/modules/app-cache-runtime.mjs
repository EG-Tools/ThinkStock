import * as appStorage from "./app-storage.mjs";
import * as cacheMaintenance from "./cache-maintenance-runtime.mjs";
import * as cacheLifecycle from "./cache-lifecycle-policy.mjs";
import * as seriesCacheRetention from "./series-cache-retention.mjs";
import { RUNTIME_STORAGE_CONTRACT } from "../../shared/runtime-foundation.mjs";

const STATE_KEY = "thinkstock-v5";
const API_SETTINGS_KEY = "thinkstock-api-v1";
const API_SETTINGS_SESSION_KEY = "thinkstock-api-session-v1";
const DART_GATEWAY_SETTINGS_KEY = "thinkstock-dart-gateway-v1";
const DART_GATEWAY_SETTINGS_SESSION_KEY = "thinkstock-dart-gateway-session-v1";
const DART_DISCLOSURE_CACHE_KEY = "thinkstock-dart-disclosure-cache-v1";
const GRANULAR_CACHE_MAINTENANCE_KEY = "thinkstock-cache-maintenance-v1";
const GRANULAR_CACHE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createAppCacheRuntime(scope = globalThis, options = {}) {
  const scheduler = options.scheduler;
  const stockResearch = options.stockResearchContract;
  const tickerPriceRuntime = options.tickerPriceRuntime;
  const snapshotComponentKeys = options.snapshotComponentKeys;
  if (!scheduler || !stockResearch || !tickerPriceRuntime || !snapshotComponentKeys) {
    throw new Error("app cache runtime dependencies are incomplete");
  }

  const storageContract = RUNTIME_STORAGE_CONTRACT;
  if (!storageContract) throw new Error("runtime storage contract failed to load");
  const names = Object.freeze({
    snapshots: storageContract.stores.snapshots,
    tickerPrices: storageContract.stores.tickerPrices,
    tickerDisclosures: storageContract.stores.tickerDisclosures,
    tickerAiAnalysis: storageContract.stores.tickerAiAnalysis,
    tickerAiForecast: storageContract.stores.tickerAiForecast,
    tickerAiForecastJournal: storageContract.stores.tickerAiForecastJournal,
    tickerResearchHistory: storageContract.stores.tickerResearchHistory,
    stockResearchResults: storageContract.stores.stockResearchResults,
    tickerBrokerResearch: storageContract.stores.tickerBrokerResearch,
    tickerTimingModels: storageContract.stores.tickerTimingModels,
  });
  const granularCacheSchemaVersion = Math.max(1, Number(options.granularCacheSchemaVersion) || 1);

  const indexedStore = appStorage.createIndexedCacheStore(scope, {
    dbName: storageContract.dbName,
    dbVersion: storageContract.dbVersion,
    storeNames: storageContract.storeNames,
    indexedStoreNames: storageContract.storeNames.filter((name) => name !== names.snapshots),
  });
  const tickerRetention = seriesCacheRetention.createSeriesCacheRetention({
    capacity: cacheLifecycle.USER_TICKER_CACHE_LIMIT,
  });
  const maintenance = cacheMaintenance.createCacheMaintenanceRuntime(scope, {
    store: indexedStore,
    lifecyclePolicy: cacheLifecycle,
    pruneIntervalMs: GRANULAR_CACHE_PRUNE_INTERVAL_MS,
    scheduler,
    stateStore: appStorage.createJsonStore(scope, { key: GRANULAR_CACHE_MAINTENANCE_KEY }),
    repairVersions: {
      [names.tickerPrices]: `price-${granularCacheSchemaVersion}`,
      [names.tickerTimingModels]: "timing-3",
    },
    validators: {
      [names.tickerPrices]: (record, key) => (
        Number(record?.schema) === granularCacheSchemaVersion
        && String(record?.ticker || "").toUpperCase() === String(key || "").toUpperCase()
        && tickerPriceRuntime.inspectPriceHistoryIntegrity(record?.points).clean
      ),
      [names.tickerTimingModels]: (record, key) => (
        Number(record?.schema) === 1
        && String(record?.ticker || "").toUpperCase() === String(key || "").toUpperCase()
        && record?.model && typeof record.model === "object"
        && typeof record?.fingerprint === "string"
      ),
    },
    storeNames: storageContract.storeNames.filter((name) => name !== names.snapshots),
  });
  const migrator = cacheMaintenance.createCacheMigrator(scope, {
    markerKey: "thinkstock-cache-migrations-v1",
    currentVersion: 4,
    migrations: [
      {
        version: 1,
        migrate: ({ copyFirstAvailable }) => {
          copyFirstAvailable(STATE_KEY, ["thinkstock-v4", "thinkstock-v3", "thinkstock-v2", "thinkstock-v1"]);
        },
      },
      {
        version: 2,
        migrate: ({ updateJson }) => {
          updateJson(stockResearch.CACHE_KEY, (payload) => {
            const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
            return {
              ...payload,
              candidatePool: Array.isArray(payload.candidatePool) ? payload.candidatePool : candidates,
              candidateOrder: Array.isArray(payload.candidateOrder)
                ? payload.candidateOrder
                : candidates.map((candidate) => candidate?.ticker).filter(Boolean),
              candidatePageIndex: Math.max(0, Math.round(Number(payload.candidatePageIndex) || 0)),
              refreshCursor: Math.max(0, Math.round(Number(payload.refreshCursor) || 0)),
              incrementalDate: String(payload.incrementalDate || ""),
            };
          });
        },
      },
      {
        version: 3,
        migrate: ({ storage }) => {
          storage?.removeItem(API_SETTINGS_KEY);
          try { scope.sessionStorage?.removeItem(API_SETTINGS_SESSION_KEY); } catch (_) {}
        },
      },
      {
        version: 4,
        migrate: ({ storage }) => {
          ["thinkstock-v1", "thinkstock-v2", "thinkstock-v3", "thinkstock-v4"]
            .forEach((key) => storage?.removeItem(key));
        },
      },
    ],
  });

  return Object.freeze({
    cacheMigrator: migrator,
    dartGatewaySettingsStore: appStorage.createApiSettingsStore(scope, {
      defaults: { accessToken: "" },
      localKey: DART_GATEWAY_SETTINGS_KEY,
      sessionKey: DART_GATEWAY_SETTINGS_SESSION_KEY,
    }),
    disclosureRefreshStore: appStorage.createJsonStore(scope, { key: DART_DISCLOSURE_CACHE_KEY }),
    granularCacheMaintenance: maintenance,
    indexedCacheStore: indexedStore,
    runtimeSnapshotCacheConfig: Object.freeze({
      storeName: names.snapshots,
      manifestKey: storageContract.snapshotRecordKey,
      format: "component-v1",
      componentKeys: snapshotComponentKeys,
    }),
    runtimeSnapshotLocalStore: appStorage.createJsonStore(scope, {
      key: storageContract.localSnapshotKey,
    }),
    stateStore: appStorage.createJsonStore(scope, { key: STATE_KEY }),
    storageContract,
    storageKeys: Object.freeze({
      appCacheIndexedStoreNames: storageContract.storeNames,
      appCacheLocalStorageKeys: Object.freeze([
        storageContract.localSnapshotKey,
        DART_DISCLOSURE_CACHE_KEY,
        GRANULAR_CACHE_MAINTENANCE_KEY,
        stockResearch.CACHE_KEY,
        stockResearch.CACHE_VARIANTS_KEY,
        stockResearch.CACHE_BYPASS_KEY,
      ]),
      appStateResetStorageKeys: Object.freeze([
        STATE_KEY,
        stockResearch.BLOCKED_KEY,
        stockResearch.MINIMUM_KEY,
        stockResearch.UNIVERSE_SIZE_KEY,
        "thinkstock-perf-debug",
      ]),
      dartDisclosureCacheKey: DART_DISCLOSURE_CACHE_KEY,
      stateKey: STATE_KEY,
    }),
    storeNames: names,
    tickerSeriesCacheRetention: tickerRetention,
  });
}

export { createAppCacheRuntime };
