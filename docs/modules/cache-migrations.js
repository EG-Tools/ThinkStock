(function initThinkStockCacheMigrations(globalScope) {
  "use strict";

  function parseJson(value) {
    try { return JSON.parse(String(value || "null")); } catch (_) { return null; }
  }

  function createCacheMigrator(scope = globalScope, options = {}) {
    const storage = options.storage || scope.localStorage;
    const markerKey = String(options.markerKey || "thinkstock-cache-migrations-v1");
    const migrations = [...(Array.isArray(options.migrations) ? options.migrations : [])]
      .filter((entry) => Number.isInteger(Number(entry?.version)) && typeof entry?.migrate === "function")
      .sort((left, right) => Number(left.version) - Number(right.version));
    const currentVersion = Math.max(0, Math.round(Number(options.currentVersion) || 0));

    function readJson(key) {
      try { return parseJson(storage?.getItem(key)); } catch (_) { return null; }
    }

    function writeJson(key, value) {
      storage?.setItem(key, JSON.stringify(value));
      return value;
    }

    function copyFirstAvailable(targetKey, sourceKeys, transform = (value) => value) {
      if (storage?.getItem(targetKey) != null) return false;
      for (const sourceKey of Array.isArray(sourceKeys) ? sourceKeys : []) {
        const source = readJson(sourceKey);
        if (!source || typeof source !== "object") continue;
        const next = transform(source, sourceKey);
        if (!next || typeof next !== "object") continue;
        writeJson(targetKey, next);
        return true;
      }
      return false;
    }

    function updateJson(key, updater) {
      const current = readJson(key);
      if (!current || typeof current !== "object") return false;
      const next = updater(current);
      if (!next || typeof next !== "object") return false;
      writeJson(key, next);
      return true;
    }

    function storedVersion() {
      try {
        return Math.max(0, Math.min(currentVersion, Math.round(Number(storage?.getItem(markerKey)) || 0)));
      } catch (_) {
        return 0;
      }
    }

    function run() {
      const fromVersion = storedVersion();
      let version = fromVersion;
      const applied = [];
      try {
        for (const entry of migrations) {
          const targetVersion = Number(entry.version);
          if (targetVersion <= version || targetVersion > currentVersion) continue;
          entry.migrate({ copyFirstAvailable, readJson, storage, updateJson, writeJson });
          storage?.setItem(markerKey, String(targetVersion));
          version = targetVersion;
          applied.push(targetVersion);
        }
        if (version < currentVersion && migrations.every((entry) => Number(entry.version) <= version)) {
          storage?.setItem(markerKey, String(currentVersion));
          version = currentVersion;
        }
        return { ok: true, fromVersion, version, applied };
      } catch (error) {
        return { ok: false, fromVersion, version, applied, error };
      }
    }

    return Object.freeze({ run, storedVersion });
  }

  globalScope.ThinkStockCacheMigrations = Object.freeze({ createCacheMigrator, parseJson });
}(typeof self !== "undefined" ? self : globalThis));
