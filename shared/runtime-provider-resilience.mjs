const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function statusFromMessage(message) {
  const match = String(message || "").match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : 0;
}

export function retryAfterMs(value, now = Date.now()) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Number(now || Date.now())) : 0;
}

export function classifyProviderError(error) {
  const status = Number(error?.status) || statusFromMessage(error?.message);
  const explicitRetryable = typeof error?.retryable === "boolean" ? error.retryable : null;
  const aborted = error?.name === "AbortError";
  const timeout = error?.name === "TimeoutError" || /timed?\s*out|timeout/i.test(String(error?.message || ""));
  const rateLimited = status === 429;
  const auth = status === 401 || status === 403;
  const retryable = explicitRetryable ?? (!aborted && (
    timeout
    || rateLimited
    || RETRYABLE_HTTP_STATUS.has(status)
    || (!status && error instanceof Error)
  ));
  return Object.freeze({
    status,
    category: aborted
      ? "aborted"
      : (rateLimited ? "rate-limit" : (auth ? "auth" : (timeout ? "timeout" : (status >= 500 ? "upstream" : "network")))),
    retryable,
    retryAfterMs: Math.max(0, Number(error?.retryAfterMs) || 0),
  });
}

export function createProviderHttpError(label, response, detail = "", options = {}) {
  const status = Number(response?.status) || 0;
  const suffix = String(detail || "").trim();
  const error = new Error(`${String(label || "Provider")} HTTP ${status}${suffix ? `: ${suffix}` : ""}`);
  error.status = status;
  error.retryable = options.retryable ?? RETRYABLE_HTTP_STATUS.has(status);
  error.retryAfterMs = retryAfterMs(response?.headers?.get?.("Retry-After"));
  return error;
}

export function providerRetryDelayMs(error, fallbackMs = 0, options = {}) {
  const maximumMs = Math.max(0, Number(options.maximumMs) || 30_000);
  const requested = Math.max(
    0,
    Number(fallbackMs) || 0,
    classifyProviderError(error).retryAfterMs,
  );
  return Math.min(maximumMs, requested);
}

export const RUNTIME_PROVIDER_RESILIENCE = Object.freeze({
  classifyProviderError,
  createProviderHttpError,
  providerRetryDelayMs,
  retryAfterMs,
});

if (typeof globalThis !== "undefined") {
  globalThis.ThinkStockRuntimeProviderResilience = RUNTIME_PROVIDER_RESILIENCE;
}
