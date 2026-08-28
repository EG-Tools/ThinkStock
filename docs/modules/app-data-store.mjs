const APP_DATA_KEYS = Object.freeze([
  "pricePayload",
  "macroRows",
  "creditRows",
  "crisisRows",
  "adrRows",
  "disclosureRows",
  "insiderTradeRows",
]);

const APP_DATA_COMPONENT_BY_KEY = Object.freeze({
  pricePayload: "price",
  macroRows: "macro",
  creditRows: "credit",
  crisisRows: "crisis",
  adrRows: "adr",
  disclosureRows: "disclosure",
});

/** @typedef {typeof APP_DATA_KEYS[number]} AppDataKey */
/**
 * @typedef {object} AppDataChangeEvent
 * @property {readonly AppDataKey[]} changed
 * @property {number} revision
 * @property {Readonly<Record<string, number>>} revisions
 */

const defaultValue = (key) => (key === "pricePayload" ? null : []);

/**
 * @param {Partial<Record<AppDataKey, unknown>>} [initial]
 */
function createAppDataStore(initial = {}) {
  const values = Object.create(null);
  const revisions = Object.create(null);
  const listeners = new Set();
  let revision = 0;

  APP_DATA_KEYS.forEach((key) => {
    values[key] = Object.hasOwn(initial, key) ? initial[key] : defaultValue(key);
    revisions[key] = 0;
  });

  /** @param {AppDataKey[]} changed */
  function emit(changed) {
    if (!changed.length) return;
    const event = Object.freeze({
      changed: Object.freeze([...changed]),
      revision,
      revisions: Object.freeze(Object.fromEntries(changed.map((key) => [key, revisions[key]]))),
    });
    listeners.forEach((listener) => listener(event));
  }

  /** @param {AppDataKey} key */
  function set(key, value, options = {}) {
    if (!APP_DATA_KEYS.includes(key)) throw new Error(`Unknown app data key: ${key}`);
    if (Object.is(values[key], value)) return false;
    values[key] = value;
    revision += 1;
    revisions[key] += 1;
    if (options.silent !== true) emit([key]);
    return true;
  }

  function patch(next = {}, options = {}) {
    const unknown = Object.keys(next).find((key) => !APP_DATA_KEYS.includes(key));
    if (unknown) throw new Error(`Unknown app data key: ${unknown}`);
    const changed = [];
    APP_DATA_KEYS.forEach((key) => {
      if (!Object.hasOwn(next, key) || Object.is(values[key], next[key])) return;
      values[key] = next[key];
      revision += 1;
      revisions[key] += 1;
      changed.push(key);
    });
    if (options.silent !== true) emit(changed);
    return changed;
  }

  /**
   * Records a real in-place mutation. Prefer set/patch for immutable values;
   * this exists for the large price payload that is updated without cloning.
   * @param {AppDataKey} key
   */
  function touch(key, options = {}) {
    if (!APP_DATA_KEYS.includes(key)) throw new Error(`Unknown app data key: ${key}`);
    revision += 1;
    revisions[key] += 1;
    if (options.silent !== true) emit([key]);
    return revisions[key];
  }

  function snapshot(keys = APP_DATA_KEYS) {
    return Object.fromEntries(
      [...keys].filter((key) => APP_DATA_KEYS.includes(key)).map((key) => [key, values[key]]),
    );
  }

  const api = {
    keys: APP_DATA_KEYS,
    patch,
    revision: (key = "") => (key ? Number(revisions[key]) || 0 : revision),
    snapshot,
    touch,
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  APP_DATA_KEYS.forEach((key) => {
    Object.defineProperty(api, key, {
      enumerable: true,
      configurable: false,
      get: () => values[key],
      set: (value) => { set(key, value); },
    });
  });

  return Object.seal(api);
}

/**
 * Keeps persisted component revisions synchronized with the authoritative data
 * store. Consumers no longer need to remember a second manual invalidation.
 */
function createAppDataRevisionBridge(store, options = {}) {
  if (!store || typeof store.subscribe !== "function") {
    throw new Error("app data revision bridge requires a subscribable store");
  }
  const componentByKey = {
    ...APP_DATA_COMPONENT_BY_KEY,
    ...(options.componentByKey || {}),
  };
  const unsubscribe = store.subscribe((event) => {
    const components = [...new Set((event?.changed || [])
      .map((key) => componentByKey[key])
      .filter(Boolean))];
    if (!components.length) return;
    options.markChanged?.(components, event);
    options.onChanged?.(components, event);
  });
  return Object.freeze({
    dispose: unsubscribe,
    componentsFor: (keys) => [...new Set((keys || [])
      .map((key) => componentByKey[key])
      .filter(Boolean))],
  });
}

export {
  APP_DATA_COMPONENT_BY_KEY,
  APP_DATA_KEYS,
  createAppDataRevisionBridge,
  createAppDataStore,
};
