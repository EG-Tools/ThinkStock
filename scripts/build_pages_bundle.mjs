import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "docs", "assets");
const outputFile = path.join(outputDir, "app.bundle.min.js");
const temporaryOutputFile = path.join(outputDir, "app.bundle.next.js");
const e2eOutputDir = path.join(root, ".thinkstock-cache", "e2e");
const e2eOutputFile = path.join(e2eOutputDir, "app.bundle.min.js");
const e2eTemporaryOutputFile = path.join(e2eOutputDir, "app.bundle.next.js");
const maxBundleBytes = 524_000;

await mkdir(outputDir, { recursive: true });
await mkdir(e2eOutputDir, { recursive: true });
await rm(temporaryOutputFile, { force: true });
await rm(e2eTemporaryOutputFile, { force: true });

async function buildBundle(outfile, diagnosticsEnabled) {
  await build({
    entryPoints: [path.join(root, "scripts", "pages-entry.mjs")],
    outfile,
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["safari15"],
    legalComments: "none",
    charset: "utf8",
    treeShaking: true,
    define: {
      __THINKSTOCK_E2E_DIAGNOSTICS__: diagnosticsEnabled ? "true" : "false",
    },
  });
}

try {
  await buildBundle(temporaryOutputFile, false);

  const outputStats = await stat(temporaryOutputFile);
  if (outputStats.size > maxBundleBytes) {
    throw new Error(`Pages app bundle exceeds ${maxBundleBytes} bytes: ${outputStats.size}`);
  }
  // Replacing the completed file avoids Windows write failures while the local
  // server or browser still has the previous bundle mapped for reading.
  await rename(temporaryOutputFile, outputFile);
  console.log(`Built ${path.relative(root, outputFile)} (${outputStats.size} bytes)`);

  await buildBundle(e2eTemporaryOutputFile, true);
  const e2eOutputStats = await stat(e2eTemporaryOutputFile);
  if (e2eOutputStats.size > maxBundleBytes) {
    throw new Error(`E2E app bundle exceeds ${maxBundleBytes} bytes: ${e2eOutputStats.size}`);
  }
  await rename(e2eTemporaryOutputFile, e2eOutputFile);
  console.log(`Built ${path.relative(root, e2eOutputFile)} (${e2eOutputStats.size} bytes, test only)`);
} finally {
  await rm(temporaryOutputFile, { force: true });
  await rm(e2eTemporaryOutputFile, { force: true });
}
