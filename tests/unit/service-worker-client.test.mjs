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

  assert.equal(await createServiceWorkerClient(scope).requestDataRefresh(50), true);
});


test("fails fast when no service worker controls the page", async () => {
  const scope = {
    navigator: { serviceWorker: { controller: null } },
    MessageChannel: class {},
    setTimeout,
    clearTimeout,
  };

  assert.equal(await createServiceWorkerClient(scope).requestDataRefresh(50), false);
});
