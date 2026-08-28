function normalizeKey(value) {
    return String(value || "").trim().toUpperCase();
  }

  function persistedAccessTime(record) {
    const value = Number(record?.lastAccessed || record?.savedAt || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function createSeriesCacheRetention(options = {}) {
    const capacity = Math.max(1, Math.trunc(Number(options.capacity) || 24));
    const now = typeof options.now === "function" ? options.now : Date.now;
    const recordsByKey = new Map();
    const sessionTouches = new Map();
    let initialized = false;
    let sequence = 0;
    let rankingRuns = 0;

    function initialize(records) {
      recordsByKey.clear();
      (Array.isArray(records) ? records : []).forEach((record) => {
        const key = normalizeKey(record?.ticker);
        if (key) recordsByKey.set(key, record);
      });
      initialized = true;
      return recordsByKey.size;
    }

    function noteAccess(key, accessedAt = now()) {
      const normalized = normalizeKey(key);
      if (!normalized) return false;
      const timestamp = Number(accessedAt);
      sequence += 1;
      sessionTouches.set(normalized, {
        sequence,
        accessedAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : now(),
      });
      return true;
    }

    function noteStored(key, record) {
      const normalized = normalizeKey(key || record?.ticker);
      if (!normalized) return false;
      recordsByKey.set(normalized, record || { ticker: normalized });
      return true;
    }

    function noteRemoved(key) {
      const normalized = normalizeKey(key);
      if (!normalized) return false;
      sessionTouches.delete(normalized);
      return recordsByKey.delete(normalized);
    }

    function reset() {
      recordsByKey.clear();
      sessionTouches.clear();
      initialized = true;
      sequence = 0;
    }

    function compareForEviction(left, right) {
      const leftTouch = sessionTouches.get(left.key);
      const rightTouch = sessionTouches.get(right.key);
      if (Boolean(leftTouch) !== Boolean(rightTouch)) return leftTouch ? 1 : -1;
      if (leftTouch && rightTouch && leftTouch.sequence !== rightTouch.sequence) {
        return leftTouch.sequence - rightTouch.sequence;
      }
      const persistedDifference = persistedAccessTime(left.record) - persistedAccessTime(right.record);
      if (persistedDifference) return persistedDifference;
      return left.key.localeCompare(right.key);
    }

    function noRankingPlan(key, existing) {
      return Object.freeze({
        incomingKey: key,
        existing,
        rankingRequired: false,
        evictKeys: Object.freeze([]),
        touchUpdates: Object.freeze([]),
      });
    }

    function planAdmission(key) {
      const incomingKey = normalizeKey(key);
      if (!incomingKey) return noRankingPlan("", false);
      const existing = recordsByKey.has(incomingKey);
      if (existing || recordsByKey.size < capacity) {
        return noRankingPlan(incomingKey, existing);
      }

      rankingRuns += 1;
      const candidates = [...recordsByKey.entries()]
        .map(([candidateKey, record]) => ({ key: candidateKey, record }))
        .sort(compareForEviction);
      const evictionCount = Math.max(1, recordsByKey.size - capacity + 1);
      const evictKeys = candidates.slice(0, evictionCount).map((candidate) => candidate.key);
      const evicted = new Set(evictKeys);
      const touchUpdates = candidates.flatMap(({ key: candidateKey, record }) => {
        const touch = sessionTouches.get(candidateKey);
        if (!touch || evicted.has(candidateKey)) return [];
        if (touch.accessedAt <= persistedAccessTime(record)) return [];
        return [{
          key: candidateKey,
          record: { ...record, lastAccessed: touch.accessedAt },
        }];
      });
      return Object.freeze({
        incomingKey,
        existing: false,
        rankingRequired: true,
        evictKeys: Object.freeze(evictKeys),
        touchUpdates: Object.freeze(touchUpdates),
      });
    }

    function commitAdmission(key, record, evictKeys = []) {
      (Array.isArray(evictKeys) ? evictKeys : []).forEach(noteRemoved);
      noteStored(key, record);
      noteAccess(key, record?.lastAccessed || record?.savedAt || now());
      return recordsByKey.size;
    }

    return Object.freeze({
      commitAdmission,
      initialize,
      isInitialized: () => initialized,
      noteAccess,
      noteRemoved,
      noteStored,
      planAdmission,
      reset,
      stats: () => Object.freeze({
        capacity,
        entries: recordsByKey.size,
        initialized,
        rankingRuns,
        sessionTouches: sessionTouches.size,
      }),
    });
  }

export { createSeriesCacheRetention, normalizeKey, persistedAccessTime };
