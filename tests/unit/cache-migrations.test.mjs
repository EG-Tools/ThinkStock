import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/cache-migrations.js");

const { createCacheMigrator } = globalThis.ThinkStockCacheMigrations;

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("cache migrations copy legacy state without deleting the source", () => {
  const storage = createStorage({ "thinkstock-v4": JSON.stringify({ activeMonths: 36 }) });
  const migrator = createCacheMigrator({}, {
    storage,
    markerKey: "marker",
    currentVersion: 1,
    migrations: [{
      version: 1,
      migrate: ({ copyFirstAvailable }) => copyFirstAvailable("thinkstock-v5", ["thinkstock-v4"]),
    }],
  });

  assert.equal(migrator.run().ok, true);
  assert.deepEqual(JSON.parse(storage.getItem("thinkstock-v5")), { activeMonths: 36 });
  assert.notEqual(storage.getItem("thinkstock-v4"), null);
  assert.equal(storage.getItem("marker"), "1");
});

test("cache migrations are idempotent and preserve an existing current value", () => {
  const storage = createStorage({
    current: JSON.stringify({ value: "new" }),
    legacy: JSON.stringify({ value: "old" }),
  });
  let calls = 0;
  const migrator = createCacheMigrator({}, {
    storage,
    markerKey: "marker",
    currentVersion: 1,
    migrations: [{
      version: 1,
      migrate: ({ copyFirstAvailable }) => {
        calls += 1;
        copyFirstAvailable("current", ["legacy"]);
      },
    }],
  });

  migrator.run();
  migrator.run();
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(storage.getItem("current")), { value: "new" });
});

test("cache migrations do not advance the marker after a failed step", () => {
  const storage = createStorage();
  const migrator = createCacheMigrator({}, {
    storage,
    markerKey: "marker",
    currentVersion: 2,
    migrations: [
      { version: 1, migrate() {} },
      { version: 2, migrate() { throw new Error("failed"); } },
    ],
  });

  const result = migrator.run();
  assert.equal(result.ok, false);
  assert.equal(storage.getItem("marker"), "1");
  assert.equal(result.version, 1);
});
