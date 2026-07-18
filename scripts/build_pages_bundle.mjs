import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "docs", "assets");
const outputFile = path.join(outputDir, "app.bundle.min.js");
const maxBundleBytes = 260_000;

await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts", "pages-entry.mjs")],
  outfile: outputFile,
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["safari15"],
  legalComments: "none",
  charset: "utf8",
  treeShaking: true,
});

const outputStats = await stat(outputFile);
if (outputStats.size > maxBundleBytes) {
  throw new Error(`Pages app bundle exceeds ${maxBundleBytes} bytes: ${outputStats.size}`);
}
console.log(`Built ${path.relative(root, outputFile)} (${outputStats.size} bytes)`);
