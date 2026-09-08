import { RUNTIME_STORAGE_CONTRACT } from "../../shared/runtime-foundation.mjs";

function createJsonStore(scope = globalThis, options = {}) {
    const storage = options.storage || scope.localStorage;
    const key = String(options.key || "");
    const sanitize = typeof options.sanitize === "function" ? options.sanitize : (value) => value;
    if (!key) throw new Error("JSON storage key is required");

    function read(fallback = null) {
      try {
        const raw = storage?.getItem(key);
        return raw ? sanitize(JSON.parse(raw)) : fallback;
      } catch (_) {
        return fallback;
      }
    }

    function write(value) {
      const sanitized = sanitize(value);
      storage?.setItem(key, JSON.stringify(sanitized));
      return sanitized;
    }

    function remove() {
      try { storage?.removeItem(key); } catch (_) {}
    }

    return Object.freeze({ read, write, remove, key });
  }

  function createApiSettingsStore(scope = globalThis, options = {}) {
    const defaults = Object.freeze({ ...(options.defaults || {}) });
    const localKey = String(options.localKey || "thinkstock-api-v1");
    const sessionKey = String(options.sessionKey || "thinkstock-api-session-v1");

    function sanitize(raw) {
      const source = raw && typeof raw === "object" ? raw : {};
      return Object.fromEntries(Object.keys(defaults).map((key) => {
        const value = source[key];
        return [key, typeof defaults[key] === "boolean"
          ? value === true
          : (typeof value === "string" ? value.trim() : "")];
      }));
    }

    function write(storage, key, value) {
      try { storage?.setItem(key, JSON.stringify(value)); } catch (_) {}
    }

    function read(storage, key) {
      try {
        const raw = storage?.getItem(key);
        return raw ? sanitize(JSON.parse(raw)) : null;
      } catch (_) {
        return null;
      }
    }

    function save(settings) {
      const sanitized = sanitize(settings);
      write(scope.sessionStorage, sessionKey, sanitized);
      write(scope.localStorage, localKey, sanitized);
      return sanitized;
    }

    function load() {
      const loaded = read(scope.localStorage, localKey)
        || read(scope.sessionStorage, sessionKey)
        || { ...defaults };
      return save(loaded);
    }

    function clear() {
      try { scope.sessionStorage?.removeItem(sessionKey); } catch (_) {}
      try { scope.localStorage?.removeItem(localKey); } catch (_) {}
    }

    return Object.freeze({ sanitize, save, load, clear });
  }

  function planPruneKeys(records, options = {}) {
    const maxRecords = Math.max(0, Number(options.maxRecords) || 0);
    const maxIdleMs = Math.max(0, Number(options.maxIdleMs) || 0);
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const list = Array.isArray(records) ? records : [];
    const tickerOf = (record) => String(record?.ticker || "").trim().toUpperCase();
    const expired = new Set(list.filter((record) => {
      const lastAccessed = Number(record?.lastAccessed || record?.savedAt || 0);
      return !Number.isFinite(lastAccessed) || now - lastAccessed > maxIdleMs;
    }).map(tickerOf).filter(Boolean));
    const survivors = list
      .filter((record) => !expired.has(tickerOf(record)))
      .sort((left, right) => (
        Number(right?.lastAccessed || right?.savedAt || 0)
        - Number(left?.lastAccessed || left?.savedAt || 0)
      ));
    const overflow = survivors.slice(maxRecords).map(tickerOf).filter(Boolean);
    return [...new Set([...expired, ...overflow])];
  }

  function createIndexedCacheStore(scope = globalThis, options = {}) {
    const storageContract = options.storageContract || RUNTIME_STORAGE_CONTRACT;
    const dbName = String(options.dbName || storageContract.dbName || "");
    const dbVersion = Math.max(1, Number(options.dbVersion) || Number(storageContract.dbVersion) || 0);
    if (!dbName) throw new Error("IndexedDB storage contract is required");
    const storeNames = [...new Set((options.storeNames || []).map(String).filter(Boolean))];
    const indexedStoreNames = new Set(
      (options.indexedStoreNames || []).map(String).filter((name) => storeNames.includes(name)),
    );
    const retentionIndexName = String(
      options.retentionIndexName || storageContract.retentionIndexName || "retentionAt",
    );
    let database = null;
    let databasePromise = null;

    function retentionTimestamp(value, fallback = Date.now()) {
      const supplied = Number(value?.lastAccessed || value?.savedAt || value?.[retentionIndexName]);
      return Number.isFinite(supplied) && supplied >= 0 ? supplied : fallback;
    }

    function withRetentionIndex(storeName, value, fallback = Date.now()) {
      if (!indexedStoreNames.has(storeName) || !value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      const timestamp = retentionTimestamp(value, fallback);
      return Number(value[retentionIndexName]) === timestamp
        ? value
        : { ...value, [retentionIndexName]: timestamp };
    }

    function close() {
      const current = database;
      database = null;
      databasePromise = null;
      try { current?.close(); } catch (_) {}
    }

    function open() {
      if (database) return Promise.resolve(database);
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        if (!scope.indexedDB) {
          reject(new Error("IndexedDB unavailable"));
          return;
        }
        let settled = false;
        const request = scope.indexedDB.open(dbName, dbVersion);
        request.onupgradeneeded = () => {
          const db = request.result;
          storeNames.forEach((storeName) => {
            const store = db.objectStoreNames.contains(storeName)
              ? request.transaction?.objectStore(storeName)
              : db.createObjectStore(storeName);
            if (!store || !indexedStoreNames.has(storeName)) return;
            if (!store.indexNames?.contains?.(retentionIndexName)) {
              store.createIndex(retentionIndexName, retentionIndexName, { unique: false });
            }
            const cursorRequest = store.openCursor();
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (!cursor) return;
              const value = withRetentionIndex(storeName, cursor.value, 0);
              if (value !== cursor.value) cursor.update(value);
              cursor.continue();
            };
          });
        };
        request.onsuccess = () => {
          if (settled) {
            try { request.result?.close(); } catch (_) {}
            return;
          }
          settled = true;
          database = request.result;
          database.onversionchange = close;
          resolve(database);
        };
        request.onerror = () => {
          if (settled) return;
          settled = true;
          reject(request.error || new Error("IndexedDB open failed"));
        };
        request.onblocked = () => {
          if (settled) return;
          settled = true;
          reject(new Error("IndexedDB blocked"));
        };
      }).catch((error) => {
        databasePromise = null;
        throw error;
      });
      return databasePromise;
    }

    async function withDatabase(operation) {
      try {
        const db = await open();
        return await operation(db);
      } catch (error) {
        if (error?.name === "InvalidStateError" || error?.name === "VersionError") close();
        throw error;
      }
    }

    function requestResult(request, errorMessage) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error || new Error(errorMessage));
      });
    }

    function transactionDone(transaction, errorMessages) {
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(
          transaction.error || new Error(errorMessages.error),
        );
        transaction.onabort = () => reject(
          transaction.error || new Error(errorMessages.abort),
        );
      });
    }

    async function readRecord(storeName, key) {
      return withDatabase((db) => {
        const transaction = db.transaction(storeName, "readonly");
        return requestResult(
          transaction.objectStore(storeName).get(key),
          "IndexedDB record read failed",
        );
      });
    }

    async function readAllRecords(storeName) {
      return withDatabase((db) => {
        const transaction = db.transaction(storeName, "readonly");
        return requestResult(
          transaction.objectStore(storeName).getAll(),
          "IndexedDB records read failed",
        ).then((records) => (Array.isArray(records) ? records : []));
      });
    }

    async function readRecordMetadata(storeName, fields = []) {
      const fieldNames = [...new Set((Array.isArray(fields) ? fields : [])
        .map(String)
        .filter(Boolean))];
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const records = [];
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const source = cursor.value && typeof cursor.value === "object" ? cursor.value : {};
          const key = cursor.primaryKey ?? cursor.key;
          const record = { key };
          fieldNames.forEach((field) => {
            if (Object.hasOwn(source, field)) record[field] = source[field];
          });
          records.push(record);
          cursor.continue();
        };
        request.onerror = () => transaction.abort();
        await transactionDone(transaction, {
          error: "IndexedDB metadata read failed",
          abort: "IndexedDB metadata read aborted",
        });
        return records;
      });
    }

    async function readRecords(storeName, keys) {
      const normalizedKeys = [...new Set((keys || []).filter((key) => key !== null && key !== undefined))];
      if (!normalizedKeys.length) return new Map();
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const entries = await Promise.all(normalizedKeys.map(async (key) => [
          key,
          await requestResult(store.get(key), "IndexedDB records read failed"),
        ]));
        return new Map(entries);
      });
    }

    async function writeRecord(storeName, key, value) {
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(withRetentionIndex(storeName, value), key);
        await transactionDone(transaction, {
          error: "IndexedDB record write failed",
          abort: "IndexedDB record write aborted",
        });
        return true;
      });
    }

    async function writeRecords(storeName, entries) {
      const normalizedEntries = entries && typeof entries.entries === "function" && !Array.isArray(entries)
        ? [...entries.entries()]
        : (Array.isArray(entries) ? entries : Object.entries(entries || {}));
      if (!normalizedEntries.length) return true;
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        normalizedEntries.forEach(([key, value]) => (
          store.put(withRetentionIndex(storeName, value), key)
        ));
        await transactionDone(transaction, {
          error: "IndexedDB records write failed",
          abort: "IndexedDB records write aborted",
        });
        return true;
      });
    }

    async function deleteRecord(storeName, key) {
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(key);
        await transactionDone(transaction, {
          error: "IndexedDB record delete failed",
          abort: "IndexedDB record delete aborted",
        });
      });
    }

    async function clearStore(storeName) {
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).clear();
        await transactionDone(transaction, {
          error: "IndexedDB store clear failed",
          abort: "IndexedDB store clear aborted",
        });
      });
    }

    async function readSnapshot(config) {
      const { storeName, manifestKey, format, componentKeys } = config;
      return withDatabase(async (db) => {
        const manifestTransaction = db.transaction(storeName, "readonly");
        const manifest = await requestResult(
          manifestTransaction.objectStore(storeName).get(manifestKey),
          "IndexedDB read failed",
        );
        if (!manifest || manifest.format !== format) return manifest;

        const componentTransaction = db.transaction(storeName, "readonly");
        const componentStore = componentTransaction.objectStore(storeName);
        const entries = await Promise.all(Object.entries(componentKeys).map(async ([name, key]) => [
          name,
          await requestResult(componentStore.get(key), "IndexedDB component read failed"),
        ]));
        return {
          ...manifest,
          ...Object.fromEntries(entries),
          _persistedRevisions: manifest.revisions || {},
        };
      });
    }

    async function writeSnapshot(snapshotBundle, config) {
      const { storeName, manifestKey, componentKeys } = config;
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        Object.entries(snapshotBundle?.components || {}).forEach(([name, value]) => {
          const key = componentKeys[name];
          if (key) store.put(value, key);
        });
        store.put(snapshotBundle.manifest, manifestKey);
        await transactionDone(transaction, {
          error: "IndexedDB write failed",
          abort: "IndexedDB write aborted",
        });
      });
    }

    async function deleteSnapshot(config) {
      const { storeName, manifestKey, componentKeys } = config;
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        store.delete(manifestKey);
        Object.values(componentKeys).forEach((key) => store.delete(key));
        await transactionDone(transaction, {
          error: "IndexedDB delete failed",
          abort: "IndexedDB delete aborted",
        });
      });
    }

    async function pruneStore(storeName, pruneOptions = {}) {
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        const retentionIndex = indexedStoreNames.has(storeName)
          && store.indexNames?.contains?.(retentionIndexName)
          ? store.index(retentionIndexName)
          : null;
        const keyRange = scope.IDBKeyRange || globalThis.IDBKeyRange;
        if (retentionIndex && keyRange) {
          const now = Number.isFinite(pruneOptions.now) ? pruneOptions.now : Date.now();
          const maxIdleMs = Math.max(0, Number(pruneOptions.maxIdleMs) || 0);
          const maxRecords = Math.max(0, Number(pruneOptions.maxRecords) || 0);
          const deleteKeys = new Set();
          const activeKeys = [];
          const expiresBefore = now - maxIdleMs;
          const done = transactionDone(transaction, {
            error: "IndexedDB cache cleanup failed",
            abort: "IndexedDB cache cleanup aborted",
          });
          const totalRequest = store.count();
          const indexedRequest = retentionIndex.count();
          await new Promise((resolve, reject) => {
            let totalCount = null;
            let indexedCount = null;
            const fail = (request, message) => {
              try { transaction.abort(); } catch (_) {}
              reject(request.error || new Error(message));
            };
            const scanIndex = () => {
              const scanRequest = retentionIndex.openKeyCursor(null, "next");
              scanRequest.onsuccess = () => {
                const cursor = scanRequest.result;
                if (cursor) {
                  if (Number(cursor.key) < expiresBefore) deleteKeys.add(cursor.primaryKey);
                  else activeKeys.push(cursor.primaryKey);
                  cursor.continue();
                  return;
                }
                const overflow = Math.max(0, activeKeys.length - maxRecords);
                activeKeys.slice(0, overflow).forEach((key) => deleteKeys.add(key));
                deleteKeys.forEach((key) => store.delete(key));
                resolve();
              };
              scanRequest.onerror = () => fail(
                scanRequest,
                "IndexedDB cache retention scan failed",
              );
            };
            const backfillOrScan = () => {
              if (totalCount === null || indexedCount === null) return;
              if (indexedCount >= totalCount) {
                scanIndex();
                return;
              }
              const backfillRequest = store.openCursor();
              backfillRequest.onsuccess = () => {
                const cursor = backfillRequest.result;
                if (cursor) {
                  const value = withRetentionIndex(storeName, cursor.value, 0);
                  if (value !== cursor.value) cursor.update(value);
                  cursor.continue();
                  return;
                }
                scanIndex();
              };
              backfillRequest.onerror = () => fail(
                backfillRequest,
                "IndexedDB cache index backfill failed",
              );
            };
            totalRequest.onsuccess = () => {
              totalCount = Math.max(0, Number(totalRequest.result) || 0);
              backfillOrScan();
            };
            totalRequest.onerror = () => fail(totalRequest, "IndexedDB cache count failed");
            indexedRequest.onsuccess = () => {
              indexedCount = Math.max(0, Number(indexedRequest.result) || 0);
              backfillOrScan();
            };
            indexedRequest.onerror = () => fail(indexedRequest, "IndexedDB cache index count failed");
          });
          await done;
          return deleteKeys.size;
        }

        let deleteKeys = [];
        const metadata = [];
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const value = cursor.value || {};
            metadata.push({
              ticker: String(value.ticker || cursor.primaryKey || cursor.key || ""),
              lastAccessed: Number(value.lastAccessed || 0),
              savedAt: Number(value.savedAt || 0),
            });
            cursor.continue();
            return;
          }
          deleteKeys = planPruneKeys(metadata, pruneOptions);
          deleteKeys.forEach((key) => store.delete(key));
        };
        request.onerror = () => transaction.abort();
        await transactionDone(transaction, {
          error: "IndexedDB cache cleanup failed",
          abort: "IndexedDB cache cleanup aborted",
        });
        return deleteKeys.length;
      });
    }

    async function repairStore(storeName, validate) {
      if (typeof validate !== "function") return 0;
      return withDatabase(async (db) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        let deleted = 0;
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          let valid = false;
          try { valid = validate(cursor.value, cursor.key) !== false; } catch (_) { valid = false; }
          if (!valid) {
            cursor.delete();
            deleted += 1;
          }
          cursor.continue();
        };
        request.onerror = () => transaction.abort();
        await transactionDone(transaction, {
          error: "IndexedDB cache repair failed",
          abort: "IndexedDB cache repair aborted",
        });
        return deleted;
      });
    }

    return Object.freeze({
      close,
      open,
      readRecord,
      readRecords,
      readAllRecords,
      readRecordMetadata,
      writeRecord,
      writeRecords,
      deleteRecord,
      clearStore,
      readSnapshot,
      writeSnapshot,
      deleteSnapshot,
      pruneStore,
      repairStore,
    });
  }

export {
  createApiSettingsStore,
  createIndexedCacheStore,
  createJsonStore,
  planPruneKeys,
};
