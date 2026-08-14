import {
  ADMIN_SESSION_TTL_SECONDS,
  issueAdminSession,
  normalizeAdminDeviceId,
  verifyAdminSession,
} from "./admin-session.mjs";

const BODY_LIMIT_BYTES = 4096;
const LOGIN_CODE_PATTERN = /^\d{10}$/;
const LEGACY_PROOF_PATTERN = /^[a-f0-9]{64}$/i;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RATE_LIMIT_MAX_FAILURES = 8;
const AUTH_ERROR = "접속코드가 틀렸습니다.";

async function readBoundedText(request, maximumBytes = BODY_LIMIT_BYTES) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maximumBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(bytes);
}

async function readPayload(request) {
  const text = await readBoundedText(request);
  try {
    const payload = JSON.parse(text || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    return payload;
  } catch (_) {
    throw Object.assign(new Error("Invalid admin session request"), { status: 400 });
  }
}

async function rateLimitKey(request, deviceId) {
  const address = String(
    request.headers.get("CF-Connecting-IP")
      || request.headers.get("X-Forwarded-For")
      || "unknown",
  ).split(",")[0].trim();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${address}|${deviceId}`),
  );
  const hash = [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `admin-auth-rate:${hash}`;
}

async function readFailureCount(cache, key) {
  if (!cache) return 0;
  try {
    const value = await cache.get(key, "json");
    return Math.max(0, Number(value?.failures) || 0);
  } catch (_) {
    return 0;
  }
}

async function recordFailure(cache, key, failures) {
  if (!cache) return;
  try {
    await cache.put(key, JSON.stringify({ failures }), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  } catch (_) {
    // Rate limiting is defense in depth; authentication still remains mandatory.
  }
}

async function clearFailures(cache, key) {
  if (!cache?.delete) return;
  try { await cache.delete(key); } catch (_) {}
}

function migrationIsOpen(env, now) {
  const deadline = Date.parse(String(env.THINKSTOCK_ADMIN_MIGRATION_UNTIL || ""));
  return Number.isFinite(deadline) && now < deadline;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value || "")),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loginCodeSource(payload, env, tokensMatch, now) {
  const code = String(payload.code || "");
  if (!LOGIN_CODE_PATTERN.test(code)) return "";
  if (await tokensMatch(code, env.THINKSTOCK_ADMIN_CODE)) return "current";
  if (!migrationIsOpen(env, now) || !env.THINKSTOCK_LEGACY_ADMIN_HASH) return "";
  const legacyProof = await sha256Hex(code);
  return await tokensMatch(legacyProof, env.THINKSTOCK_LEGACY_ADMIN_HASH) ? "legacy" : "";
}

function configured(env) {
  return Boolean(
    env.THINKSTOCK_ADMIN_CODE
      && env.THINKSTOCK_ADMIN_SESSION_SECRET
      && String(env.THINKSTOCK_ADMIN_SESSION_SECRET).length >= 32,
  );
}

export async function adminSessionResponse(request, env, origin, dependencies = {}) {
  const jsonResponse = dependencies.jsonResponse;
  const tokensMatch = dependencies.tokensMatch;
  const now = dependencies.now instanceof Date
    ? dependencies.now
    : new Date(dependencies.now || Date.now());
  if (typeof jsonResponse !== "function" || typeof tokensMatch !== "function") {
    throw new Error("Admin session dependencies are incomplete");
  }
  if (!configured(env)) {
    return jsonResponse({ ok: false, error: "관리자 인증을 준비하지 못했습니다." }, 503, origin);
  }

  try {
    const payload = await readPayload(request);
    const action = String(payload.action || "").trim().toLowerCase();
    const deviceId = normalizeAdminDeviceId(payload.deviceId);
    if (!deviceId || !["login", "migrate", "refresh"].includes(action)) {
      return jsonResponse({ ok: false, error: AUTH_ERROR }, 400, origin);
    }

    if (action === "refresh") {
      const verification = await verifyAdminSession(
        payload.sessionToken,
        env.THINKSTOCK_ADMIN_SESSION_SECRET,
        { deviceId, now },
      );
      if (!verification.ok) return jsonResponse({ ok: false, error: AUTH_ERROR }, 401, origin);
      const session = await issueAdminSession(env.THINKSTOCK_ADMIN_SESSION_SECRET, deviceId, {
        now,
        ttlSeconds: ADMIN_SESSION_TTL_SECONDS,
      });
      return jsonResponse({
        ok: true,
        sessionToken: session.token,
        expiresAt: session.expiresAt,
        migrated: false,
        renewed: true,
      }, 200, origin);
    }

    const limiterKey = await rateLimitKey(request, deviceId);
    const failures = await readFailureCount(env.DISCLOSURE_CACHE, limiterKey);
    if (failures >= RATE_LIMIT_MAX_FAILURES) {
      return jsonResponse({ ok: false, error: AUTH_ERROR }, 429, origin);
    }

    const loginSource = action === "login"
      ? await loginCodeSource(payload, env, tokensMatch, now)
      : "";
    const valid = action === "login"
      ? Boolean(loginSource)
      : migrationIsOpen(env, now)
        && LEGACY_PROOF_PATTERN.test(String(payload.legacyProof || ""))
        && Boolean(env.THINKSTOCK_LEGACY_ADMIN_HASH)
        && await tokensMatch(payload.legacyProof, env.THINKSTOCK_LEGACY_ADMIN_HASH);
    if (!valid) {
      await recordFailure(env.DISCLOSURE_CACHE, limiterKey, failures + 1);
      return jsonResponse({ ok: false, error: AUTH_ERROR }, 401, origin);
    }

    await clearFailures(env.DISCLOSURE_CACHE, limiterKey);
    const session = await issueAdminSession(env.THINKSTOCK_ADMIN_SESSION_SECRET, deviceId, {
      now,
      ttlSeconds: ADMIN_SESSION_TTL_SECONDS,
    });
    return jsonResponse({
      ok: true,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      migrated: action === "migrate" || loginSource === "legacy",
      renewed: false,
    }, 200, origin);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error?.status === 413 ? "요청이 너무 큽니다." : AUTH_ERROR },
      error?.status || 400,
      origin,
    );
  }
}

export const ADMIN_SESSION_AUTH_ERROR = AUTH_ERROR;
