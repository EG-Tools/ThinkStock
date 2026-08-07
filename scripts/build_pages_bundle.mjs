import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "docs", "assets");
const outputFile = path.join(outputDir, "app.bundle.min.js");
const temporaryOutputFile = path.join(outputDir, "app.bundle.next.js");
const maxBundleBytes = 524_000;

await mkdir(outputDir, { recursive: true });
await rm(temporaryOutputFile, { force: true });
try {
  await build({
    entryPoints: [path.join(root, "scripts", "pages-entry.mjs")],
    outfile: temporaryOutputFile,
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["safari15"],
    legalComments: "none",
    charset: "utf8",
    treeShaking: true,
  });

  const outputStats = await stat(temporaryOutputFile);
  if (outputStats.size > maxBundleBytes) {
    throw new Error(`Pages app bundle exceeds ${maxBundleBytes} bytes: ${outputStats.size}`);
  }
  // Replacing the completed file avoids Windows write failures while the local
  // server or browser still has the previous bundle mapped for reading.
  await rename(temporaryOutputFile, outputFile);
  console.log(`Built ${path.relative(root, outputFile)} (${outputStats.size} bytes)`);
} finally {
  await rm(temporaryOutputFile, { force: true });
}
