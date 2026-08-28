import assert from "node:assert/strict";
import test from "node:test";

import { createAdminFeatureAccess } from "../../docs/modules/admin-feature-access.mjs";

function createButton(title = "original") {
  const classes = new Set();
  const attributes = new Map();
  return {
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
    },
    dataset: {},
    disabled: false,
    title,
    getAttribute: (name) => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
  };
}

function createStorage(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    records,
    getItem: (key) => records.get(key) ?? null,
    removeItem: (key) => records.delete(key),
    setItem: (key, value) => records.set(key, value),
  };
}

function sessionPayload(overrides = {}) {
  return {
    ok: true,
    status: 200,
    sessionToken: "v1.c2lnbmVkLXNlc3Npb24.signature",
    expiresAt: Date.now() + 86400_000,
    ...overrides,
  };
}

test("admin access persists only a signed session and gates controls until ready", async () => {
  const storage = createStorage();
  const button = createButton();
  let ready = false;
  let published = null;
  const access = createAdminFeatureAccess({}, {
    storage,
    sessionKey: "admin-session",
    deviceKey: "admin-device",
    createDeviceId: () => "device-12345678",
    requestSession: async ({ action }) => action === "login" ? sessionPayload() : { ok: false, status: 401 },
    buttonIds: ["ai"],
    controlsReady: () => ready,
    getElement: () => button,
    onStateChange: (value) => { published = value; },
  });

  assert.equal(access.load(), false);
  assert.equal((await access.authenticate("1234567890")).ok, true);
  assert.equal(published, true);
  const stored = JSON.parse(storage.records.get("admin-session"));
  assert.match(stored.sessionToken, /^v1\./);
  assert.equal(JSON.stringify(stored).includes("1234567890"), false);
  assert.equal(access.sync(), false);
  assert.equal(button.disabled, true);
  ready = true;
  assert.equal(access.sync(), true);
  assert.equal(button.disabled, false);
  access.clear();
  access.sync();
  assert.equal(storage.records.has("admin-session"), false);
  assert.equal(button.classList.contains("is-admin-locked"), true);
});

test("old browser grants are ignored after migration support is retired", async () => {
  const storage = createStorage({ "admin-legacy": "a".repeat(64) });
  const access = createAdminFeatureAccess({}, {
    storage,
    sessionKey: "admin-session",
    deviceKey: "admin-device",
    createDeviceId: () => "legacy-device-123",
    requestSession: async () => sessionPayload(),
  });

  assert.equal(access.load(), false);
  const result = await access.restore();
  assert.deepEqual(result, { ok: false, status: 0 });
  assert.equal(storage.records.has("admin-legacy"), true);
  assert.equal(access.isGranted(), false);
});

test("cached sessions remain usable during a temporary refresh outage", async () => {
  const expiresAt = Date.now() + 86400_000;
  const storage = createStorage({
    "admin-device": "device-12345678",
    "admin-session": JSON.stringify({
      sessionToken: "v1.Y2FjaGVkLXNlc3Npb24.signature",
      expiresAt,
      deviceId: "device-12345678",
    }),
  });
  const access = createAdminFeatureAccess({}, {
    storage,
    sessionKey: "admin-session",
    deviceKey: "admin-device",
    requestSession: async () => ({ ok: false, status: 503 }),
  });

  assert.equal(access.load(), true);
  const restored = await access.restore();
  assert.equal(restored.cached, true);
  assert.equal(access.isGranted(), true);
});
