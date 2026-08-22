import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "docs", "assets");
const indexFile = path.join(root, "docs", "index.html");
const outputFile = path.join(outputDir, "app.bundle.min.js");
const temporaryOutputFile = path.join(outputDir, "app.bundle.next.js");
const e2eOutputDir = path.join(root, ".thinkstock-cache", "e2e");
const e2eOutputFile = path.join(e2eOutputDir, "app.bundle.min.js");
const e2eTemporaryOutputFile = path.join(e2eOutputDir, "app.bundle.next.js");
const maxBundleBytes = 524_000;
const featureBundles = Object.freeze([
  Object.freeze({
    entry: "ai-feature.mjs",
    output: "ai-feature.bundle.min.js",
    maxBytes: 320_000,
  }),
  Object.freeze({
    entry: "market-timing-feature.mjs",
    output: "market-timing-feature.bundle.min.js",
    maxBytes: 180_000,
  }),
  Object.freeze({
    entry: "stock-research-feature.mjs",
    output: "stock-research-feature.bundle.min.js",
    maxBytes: 180_000,
  }),
  Object.freeze({
    entry: "settings-feature.mjs",
    output: "settings-feature.bundle.min.js",
    maxBytes: 100_000,
  }),
]);

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

async function buildFeatureBundle(definition) {
  const outputFilePath = path.join(outputDir, definition.output);
  const temporaryFile = `${outputFilePath}.next`;
  await rm(temporaryFile, { force: true });
  try {
    await build({
      entryPoints: [path.join(root, "scripts", "feature-entries", definition.entry)],
      outfile: temporaryFile,
      bundle: true,
      minify: true,
      format: "iife",
      platform: "browser",
      target: ["safari15"],
      legalComments: "none",
      charset: "utf8",
      treeShaking: true,
    });
    const outputStats = await stat(temporaryFile);
    if (outputStats.size > definition.maxBytes) {
      throw new Error(`${definition.output} exceeds ${definition.maxBytes} bytes: ${outputStats.size}`);
    }
    await rename(temporaryFile, outputFilePath);
    console.log(`Built ${path.relative(root, outputFilePath)} (${outputStats.size} bytes)`);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

async function stampLocalBundleFingerprint() {
  const bundle = await readFile(outputFile);
  const fingerprint = createHash("sha256").update(bundle).digest("hex").slice(0, 12);
  const html = await readFile(indexFile, "utf8");
  const nextHtml = html.replace(
    /(<script defer src="\.\/assets\/app\.bundle\.min\.js\?v=dev(?:&amp;build=[^"&]+)?)(?:&amp;asset=[^"]+)?("><\/script>)/,
    `$1&amp;asset=${fingerprint}$2`,
  );
  if (nextHtml === html && !html.includes(`asset=${fingerprint}`)) {
    throw new Error("Local app bundle fingerprint could not be stamped");
  }
  await writeFile(indexFile, nextHtml, "utf8");
  return fingerprint;
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
  const localFingerprint = await stampLocalBundleFingerprint();
  console.log(`Stamped local bundle fingerprint ${localFingerprint}`);

  await buildBundle(e2eTemporaryOutputFile, true);
  const e2eOutputStats = await stat(e2eTemporaryOutputFile);
  if (e2eOutputStats.size > maxBundleBytes) {
    throw new Error(`E2E app bundle exceeds ${maxBundleBytes} bytes: ${e2eOutputStats.size}`);
  }
  await rename(e2eTemporaryOutputFile, e2eOutputFile);
  console.log(`Built ${path.relative(root, e2eOutputFile)} (${e2eOutputStats.size} bytes, test only)`);
  for (const definition of featureBundles) await buildFeatureBundle(definition);
} finally {
  await rm(temporaryOutputFile, { force: true });
  await rm(e2eTemporaryOutputFile, { force: true });
}
