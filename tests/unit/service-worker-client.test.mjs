import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const source = await readFile(path.resolve("docs/modules/service-worker-client.js"), "utf8");
const context = {};
vm.runInNewContext(source, context);
const { createServiceWorkerClient } = context.ThinkStockServiceWorkerClient;


test("registers the service worker once after window load", async () => {
  let loadHandler = null;
  let registrations = 0;
  const scope = {
    document: { readyState: "loading" },
    navigator: { serviceWorker: { register: async () => { registrations += 1; } } },
    addEventListener: (name, handler) => { if (name === "load") loadHandler = handler; },
  };
  const client = createServiceWorkerClient(scope);

  assert.equal(client.scheduleRegistration(), true);
  assert.equal(client.scheduleRegistration(), false);
  assert.equal(registrations, 0);
  await loadHandler();
  assert.equal(registrations, 1);
});

test("reloads once when a newly activated worker takes control", async () => {
  let controllerChange = null;
  let reloads = 0;
  let updates = 0;
  const scope = {
    document: { readyState: "complete" },
    location: { hostname: "eg-tools.github.io", reload: () => { reloads += 1; } },
    navigator: {
      serviceWorker: {
        addEventListener: (name, handler) => { if (name === "controllerchange") controllerChange = handler; },
        register: async (_url, options) => {
          assert.equal(options.updateViaCache, "none");
          return { update: async () => { updates += 1; } };
        },
      },
    },
  };

  createServiceWorkerClient(scope).scheduleRegistration();
  await new Promise((resolve) => setTimeout(resolve, 0));
  controllerChange();
  controllerChange();
  assert.equal(updates, 1);
  assert.equal(reloads, 1);
});


test("removes stale service worker caches instead of registering on localhost", async () => {
  let unregistered = 0;
  let registrations = 0;
  let reloads = 0;
  const deletedCaches = [];
  const session = new Map();
  const scope = {
    document: { readyState: "complete" },
    location: { hostname: "127.0.0.1", reload: () => { reloads += 1; } },
    navigator: {
      serviceWorker: {
        controller: {},
        getRegistrations: async () => [{ unregister: async () => { unregistered += 1; } }],
        register: async () => { registrations += 1; },
      },
    },
    caches: {
      keys: async () => ["thinkstock-dev-1.92", "unrelated-cache"],
      delete: async (name) => { deletedCaches.push(name); },
    },
    sessionStorage: {
      getItem: (key) => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
    },
  };

  const client = createServiceWorkerClient(scope);
  assert.equal(client.scheduleRegistration(), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registrations, 0);
  assert.equal(unregistered, 1);
  assert.deepEqual(deletedCaches, ["thinkstock-dev-1.92"]);
  assert.equal(reloads, 1);
});

test("allows the service worker on localhost only for the explicit e2e switch", async () => {
  let registrations = 0;
  const scope = {
    document: { readyState: "complete" },
    location: { hostname: "127.0.0.1", search: "?e2e=1&sw=1" },
    navigator: { serviceWorker: { register: async () => { registrations += 1; } } },
  };

  createServiceWorkerClient(scope).scheduleRegistration();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registrations, 1);
});


test("returns the atomic refresh result from the active controller", async () => {
  class FakeMessageChannel {
    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = { reply: (data) => this.port1.onmessage?.({ data }) };
    }
  }
  const scope = {
    navigator: {
      serviceWorker: {
        controller: {
          postMessage: (_message, ports) => ports[0].reply({ ok: true, refreshed: 5, failed: 0 }),
        },
      },
    },
    MessageChannel: FakeMessageChannel,
    setTimeout,
    clearTimeout,
  };

  assert.deepEqual(
    await createServiceWorkerClient(scope).requestDataRefresh(50),
    { ok: true, refreshed: 5, failed: 0 },
  );
});

test("allows atomic data refresh enough time to validate and swap all segments", async () => {
  let timeoutDelay = 0;
  class FakeMessageChannel {
    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = { reply: (data) => this.port1.onmessage?.({ data }) };
    }
  }
  const scope = {
    navigator: {
      serviceWorker: {
        controller: {
          postMessage: (_message, ports) => ports[0].reply({ ok: true }),
        },
      },
    },
    MessageChannel: FakeMessageChannel,
    setTimeout: (_handler, delay) => {
      timeoutDelay = delay;
      return 1;
    },
    clearTimeout: () => {},
  };

  assert.deepEqual(await createServiceWorkerClient(scope).requestDataRefresh(), { ok: true });
  assert.equal(timeoutDelay, 15000);
});


test("fails fast when no service worker controls the page", async () => {
  const scope = {
    navigator: { serviceWorker: { controller: null } },
    MessageChannel: class {},
    setTimeout,
    clearTimeout,
  };

  const result = await createServiceWorkerClient(scope).requestDataRefresh(50);
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
});
