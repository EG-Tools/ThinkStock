import {
  RUNTIME_API_VERSION_HEADER,
  runtimeJsonHeaders,
} from "../../shared/runtime-api-contract.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_ORIGIN = "https://eg-tools.github.io";

function isPrivateHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  if (value === "localhost" || value === "::1") return true;
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.origin === PUBLIC_ORIGIN
      || (["http:", "https:"].includes(url.protocol) && isPrivateHostname(url.hostname));
  } catch (_) {
    return false;
  }
}

export function corsHeaders(origin) {
  return origin && isAllowedOrigin(origin)
    ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Expose-Headers": RUNTIME_API_VERSION_HEADER,
      Vary: "Origin",
    }
    : {};
}

export function jsonResponse(payload, status = 200, origin = "") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), ...runtimeJsonHeaders() },
  });
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function shiftDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function yearsBefore(dateText, years) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return isoDate(date);
}

export function apiDate(value) {
  return String(value || "").replaceAll("-", "");
}

export function isValidIsoDate(value) {
  const text = String(value || "");
  if (!DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && isoDate(date) === text;
}

export async function writeCachesBestEffort(label, operations) {
  const tasks = (Array.isArray(operations) ? operations : [])
    .filter((operation) => typeof operation === "function")
    .map((operation) => Promise.resolve().then(operation));
  if (!tasks.length) return 0;
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    console.warn(JSON.stringify({
      event: "cache-write-failed",
      label,
      failures: failures.length,
      error: String(failures[0].reason?.message || failures[0].reason || "unknown").slice(0, 160),
    }));
  }
  return failures.length;
}

export async function readCacheBestEffort(label, operation) {
  if (typeof operation !== "function") return null;
  try {
    return await operation();
  } catch (error) {
    console.warn(JSON.stringify({
      event: "cache-read-failed",
      label,
      error: String(error?.message || error || "unknown").slice(0, 160),
    }));
    return null;
  }
}

export async function readBoundedResponseText(response, maxBytes, label = "upstream") {
  const tooLarge = `${label} response is too large`;
  const declaredLength = Number(response.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(tooLarge);
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(tooLarge);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel(tooLarge);
      throw new Error(tooLarge);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
