import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";


const source = await readFile(new URL("../../docs/modules/app-storage.js", import.meta.url), "utf8");

function loadModule(scope = {}) {
  const context = vm.createContext({
    ...scope,
    self: scope,
    globalThis: scope,
    Object,
    String,
    Number,
    Date,
    JSON,
    Set,
    Promise,
    Error,
  });
  vm.runInContext(source, context);
  return scope.ThinkStockAppStorage;
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("API settings are sanitized, mirrored, and loaded from persistent storage first", () => {
  const localStorage = createStorage({
    local: JSON.stringify({ token: " local-value ", enabled: true }),
  });
  const sessionStorage = createStorage({
    session: JSON.stringify({ token: "session-value", enabled: false }),
  });
  const module = loadModule({ localStorage, sessionStorage });
  const store = module.createApiSettingsStore(
    { localStorage, sessionStorage },
    {
      defaults: { token: "", enabled: false },
      localKey: "local",
      sessionKey: "session",
    },
  );

  assert.deepEqual({ ...store.load() }, { token: "local-value", enabled: true });
  assert.deepEqual(
    JSON.parse(sessionStorage.values.get("session")),
    { token: "local-value", enabled: true },
  );

  store.clear();
  assert.equal(localStorage.values.has("local"), false);
  assert.equal(sessionStorage.values.has("session"), false);
});

test("API settings fall back to session storage when persistent data is invalid", () => {
  const localStorage = createStorage({ local: "not-json" });
  const sessionStorage = createStorage({
    session: JSON.stringify({ token: " fallback ", enabled: "yes" }),
  });
  const module = loadModule({ localStorage, sessionStorage });
  const store = module.createApiSettingsStore(
    { localStorage, sessionStorage },
    {
      defaults: { token: "", enabled: false },
      localKey: "local",
      sessionKey: "session",
    },
  );

  assert.deepEqual({ ...store.load() }, { token: "fallback", enabled: false });
});

test("cache pruning removes idle records before least-recent overflow", () => {
  const module = loadModule();
  const deleteKeys = module.planPruneKeys([
    { ticker: "OLD", lastAccessed: 1000 },
    { ticker: "A", lastAccessed: 9000 },
    { ticker: "B", lastAccessed: 8000 },
    { ticker: "C", lastAccessed: 7000 },
  ], {
    now: 10000,
    maxIdleMs: 5000,
    maxRecords: 2,
  });

  assert.deepEqual([...deleteKeys], ["OLD", "C"]);
});
