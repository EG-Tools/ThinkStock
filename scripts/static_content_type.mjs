import path from "node:path";

export const STATIC_CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
});

export function staticContentType(filePath) {
  return STATIC_CONTENT_TYPES[path.extname(String(filePath || "")).toLowerCase()]
    || "application/octet-stream";
}
