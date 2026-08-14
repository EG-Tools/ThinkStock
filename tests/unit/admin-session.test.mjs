import assert from "node:assert/strict";
import test from "node:test";

import {
  issueAdminSession,
  normalizeAdminDeviceId,
  verifyAdminSession,
} from "../../worker/src/admin-session.mjs";

const SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
const DEVICE = "device-12345678";

test("admin sessions are signed, expire, and remain bound to one device", async () => {
  const now = Date.parse("2026-08-14T00:00:00Z");
  const session = await issueAdminSession(SECRET, DEVICE, { now, ttlSeconds: 3600 });
  assert.match(session.token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal((await verifyAdminSession(session.token, SECRET, { deviceId: DEVICE, now })).ok, true);
  assert.equal((await verifyAdminSession(session.token, SECRET, { deviceId: "another-device", now })).reason, "device");
  assert.equal((await verifyAdminSession(session.token, SECRET, { deviceId: DEVICE, now: now + 3600_000 })).reason, "expired");
  const tampered = `${session.token.slice(0, -1)}${session.token.endsWith("a") ? "b" : "a"}`;
  assert.equal((await verifyAdminSession(tampered, SECRET, { deviceId: DEVICE, now })).reason, "signature");
});

test("admin device identifiers accept stable browser-safe values only", () => {
  assert.equal(normalizeAdminDeviceId(DEVICE), DEVICE);
  assert.equal(normalizeAdminDeviceId("short"), "");
  assert.equal(normalizeAdminDeviceId("invalid device id"), "");
});
