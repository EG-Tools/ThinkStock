import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "node_modules", "pdfjs-dist");
const TARGET_DIR = path.join(ROOT, "docs", "vendor");

await mkdir(TARGET_DIR, { recursive: true });
await Promise.all([
  ["legacy/build/pdf.min.mjs", "pdf.min.mjs"],
  ["legacy/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["LICENSE", "pdfjs-LICENSE.txt"],
].map(([source, target]) => copyFile(
  path.join(SOURCE_DIR, source),
  path.join(TARGET_DIR, target),
)));

console.log("Synced PDF.js browser runtime into docs/vendor");
