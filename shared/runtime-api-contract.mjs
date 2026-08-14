export const RUNTIME_API_VERSION = 2;
export const MINIMUM_RUNTIME_API_VERSION = 2;
export const RUNTIME_API_VERSION_HEADER = "X-ThinkStock-API-Version";

export function runtimeJsonHeaders(options = {}) {
  return Object.freeze({
    "Cache-Control": String(options.cacheControl || "no-store"),
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": String(options.referrerPolicy || "no-referrer"),
    [RUNTIME_API_VERSION_HEADER]: String(RUNTIME_API_VERSION),
    "X-Content-Type-Options": "nosniff",
  });
}

export function parseRuntimeApiVersion(value) {
  const version = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(version) && version > 0 ? version : null;
}

export function runtimeApiCompatibility(value, options = {}) {
  const version = parseRuntimeApiVersion(value);
  const minimum = Math.max(1, Number(options.minimum) || MINIMUM_RUNTIME_API_VERSION);
  if (version === null) {
    return Object.freeze({
      compatible: options.allowMissing !== false,
      legacy: true,
      minimum,
      version: null,
    });
  }
  return Object.freeze({
    compatible: version >= minimum,
    legacy: false,
    minimum,
    version,
  });
}

const api = Object.freeze({
  MINIMUM_RUNTIME_API_VERSION,
  RUNTIME_API_VERSION,
  RUNTIME_API_VERSION_HEADER,
  runtimeJsonHeaders,
  parseRuntimeApiVersion,
  runtimeApiCompatibility,
});

if (typeof globalThis !== "undefined") globalThis.ThinkStockRuntimeApiContract = api;
