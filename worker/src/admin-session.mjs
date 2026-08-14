const TOKEN_VERSION = "v1";
const SESSION_SUBJECT = "thinkstock-admin";
const MINIMUM_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function cryptoScope() {
  const value = globalThis.crypto;
  if (!value?.subtle) throw new Error("Web Crypto is unavailable");
  return value;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const text = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = text.padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizedSecret(secret) {
  const value = String(secret || "");
  if (value.length < MINIMUM_SECRET_LENGTH) {
    throw new Error("Admin session secret is not configured safely");
  }
  return value;
}

export function normalizeAdminDeviceId(value) {
  const deviceId = String(value || "").trim();
  return DEVICE_ID_PATTERN.test(deviceId) ? deviceId : "";
}

async function importHmacKey(secret, usages) {
  return cryptoScope().subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizedSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function signText(text, secret) {
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await cryptoScope().subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(text || "")),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyText(text, encodedSignature, secret) {
  try {
    const key = await importHmacKey(secret, ["verify"]);
    return await cryptoScope().subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(String(text || "")),
    );
  } catch (_) {
    return false;
  }
}

function nowSeconds(value = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  return Math.floor((Number.isFinite(timestamp) ? timestamp : Date.now()) / 1000);
}

function encodePayload(payload) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodePayload(encoded) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
  } catch (_) {
    return null;
  }
}

export async function issueAdminSession(secret, deviceId, options = {}) {
  const normalizedDeviceId = normalizeAdminDeviceId(deviceId);
  if (!normalizedDeviceId) throw new Error("Admin device identifier is invalid");
  const issuedAt = nowSeconds(options.now);
  const ttlSeconds = Math.max(60, Math.round(Number(options.ttlSeconds) || DEFAULT_TTL_SECONDS));
  const payload = Object.freeze({
    v: 1,
    sub: SESSION_SUBJECT,
    d: normalizedDeviceId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  });
  const encodedPayload = encodePayload(payload);
  const unsignedToken = `${TOKEN_VERSION}.${encodedPayload}`;
  const signature = await signText(unsignedToken, secret);
  return Object.freeze({
    token: `${unsignedToken}.${signature}`,
    expiresAt: payload.exp * 1000,
    payload,
  });
}

export async function verifyAdminSession(token, secret, options = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return Object.freeze({ ok: false, reason: "format" });
  }
  const payload = decodePayload(parts[1]);
  const deviceId = normalizeAdminDeviceId(options.deviceId);
  const current = nowSeconds(options.now);
  if (!payload || payload.v !== 1 || payload.sub !== SESSION_SUBJECT
    || !normalizeAdminDeviceId(payload.d) || !Number.isInteger(payload.iat)
    || !Number.isInteger(payload.exp) || payload.exp <= payload.iat) {
    return Object.freeze({ ok: false, reason: "payload" });
  }
  if (deviceId && payload.d !== deviceId) {
    return Object.freeze({ ok: false, reason: "device" });
  }
  if (payload.exp <= current) {
    return Object.freeze({ ok: false, reason: "expired", expiresAt: payload.exp * 1000 });
  }
  const verified = await verifyText(`${parts[0]}.${parts[1]}`, parts[2], secret);
  if (!verified) return Object.freeze({ ok: false, reason: "signature" });
  return Object.freeze({ ok: true, payload, expiresAt: payload.exp * 1000 });
}

export const ADMIN_SESSION_TTL_SECONDS = DEFAULT_TTL_SECONDS;
