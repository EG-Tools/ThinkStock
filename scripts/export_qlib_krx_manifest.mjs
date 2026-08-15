import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildQlibKrxManifest } from "../shared/qlib-challenger-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "ai-backtest");
const QLIB_DIR = path.join(CACHE_DIR, "qlib");
const PRICE_PATH = path.join(CACHE_DIR, "walkforward-prices.json");
const CONTEXT_PATH = path.join(CACHE_DIR, "walkforward-context.json");
const OUTPUT_PATH = path.join(QLIB_DIR, "manifest.json");

function fingerprint(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const [priceBuffer, contextBuffer] = await Promise.all([
  readFile(PRICE_PATH),
  readFile(CONTEXT_PATH),
]);
const prices = JSON.parse(priceBuffer.toString("utf8"));
const context = JSON.parse(contextBuffer.toString("utf8"));
const manifest = buildQlibKrxManifest(prices, context, {
  pricePath: path.relative(ROOT, PRICE_PATH).replaceAll("\\", "/"),
  contextPath: path.relative(ROOT, CONTEXT_PATH).replaceAll("\\", "/"),
  priceFingerprint: fingerprint(priceBuffer),
  contextFingerprint: fingerprint(contextBuffer),
});

await mkdir(QLIB_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.relative(ROOT, OUTPUT_PATH),
  format: manifest.format,
  cohorts: manifest.validation.counts,
  horizons: manifest.validation.horizons,
}, null, 2));

