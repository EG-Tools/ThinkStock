import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { stylesheetSourceNames } from "./pages-stylesheet-config.mjs";

import { build } from "esbuild";
import { createBundleReport, summarizeBundle } from "./bundle-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const outputDir = path.join(root, "docs", "assets");
const indexFile = path.join(root, "docs", "index.html");
const stylesheetFile = path.join(root, "docs", "styles.css");
const temporaryStylesheetFile = path.join(root, "docs", "styles.next.css");
const outputFile = path.join(outputDir, "app.bundle.min.js");
const temporaryOutputFile = path.join(outputDir, "app.bundle.next.js");
const releaseNotesSourceFile = path.join(root, "docs", "modules", "release-notes.mjs");
const appSourceFile = path.join(root, "docs", "app.js");
const e2eOutputDir = path.join(root, ".thinkstock-cache", "e2e");
const e2eOutputFile = path.join(e2eOutputDir, "app.bundle.min.js");
const e2eTemporaryOutputFile = path.join(e2eOutputDir, "app.bundle.next.js");
const bundleReportFile = path.join(root, ".thinkstock-cache", "build", "pages-bundles.json");
const maxBundleBytes = Number(packageJson.thinkstockBuild?.appBundleMaxBytes);
const maxE2eBundleBytes = Number(packageJson.thinkstockBuild?.e2eBundleMaxBytes);
const maxBundleGzipBytes = Number(packageJson.thinkstockBuild?.appBundleGzipMaxBytes);
const releaseNotesSourceBytes = (await stat(releaseNotesSourceFile)).size;
const appVersion = (await readFile(appSourceFile, "utf8"))
  .match(/const APP_VERSION = "([^"]+)";/)?.[1] || "";
const stylesheetSources = Object.freeze(stylesheetSourceNames.map((file) => (
  path.join(root, "docs", "styles-src", file)
)));
if (!Number.isFinite(maxBundleBytes)
  || !Number.isFinite(maxE2eBundleBytes)
  || !Number.isFinite(maxBundleGzipBytes)) {
  throw new Error("ThinkStock bundle limits are not configured in package.json");
}

async function replaceBuiltFile(temporaryFile, outputFilePath) {
  const retryableCodes = new Set(["EACCES", "EBUSY", "EPERM"]);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporaryFile, outputFilePath);
      return;
    } catch (error) {
      if (!retryableCodes.has(error?.code)) throw error;
      if (attempt >= 8) {
        // Windows can keep a served asset open for reads and reject replacing
        // its directory entry even though overwriting the file is allowed.
        await copyFile(temporaryFile, outputFilePath);
        await rm(temporaryFile, { force: true });
        return;
      }
      await delay(Math.min(1200, 50 * (2 ** attempt)));
    }
  }
}

const featureBundles = Object.freeze([
  Object.freeze({
    entry: "analytics-core-feature.mjs",
    output: "analytics-core-feature.bundle.min.js",
    maxBytes: 80_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "auxiliary-chart-feature.mjs",
    output: "auxiliary-chart-feature.bundle.min.js",
    maxBytes: 80_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "ai-feature.mjs",
    output: "ai-feature.bundle.min.js",
    maxBytes: 320_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "broker-research-feature.mjs",
    output: "broker-research-feature.bundle.min.js",
    maxBytes: 80_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "market-timing-feature.mjs",
    output: "market-timing-feature.bundle.min.js",
    maxBytes: 180_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "stock-research-feature.mjs",
    output: "stock-research-feature.bundle.min.js",
    maxBytes: 180_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "stock-research-worker.mjs",
    output: "stock-research-worker.bundle.min.js",
    maxBytes: 180_000,
  }),
  Object.freeze({
    entry: "market-timing-worker.mjs",
    output: "market-timing-worker.bundle.min.js",
    maxBytes: 260_000,
  }),
  Object.freeze({
    entry: "ai-forecast-worker.mjs",
    output: "ai-forecast-worker.bundle.min.js",
    maxBytes: 320_000,
  }),
  Object.freeze({
    entry: "settings-feature.mjs",
    output: "settings-feature.bundle.min.js",
    maxBytes: 100_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "eps-feature.mjs",
    output: "eps-feature.bundle.min.js",
    maxBytes: 50_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "dart-feature.mjs",
    output: "dart-feature.bundle.min.js",
    maxBytes: 60_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "diagnostics-runtime-feature.mjs",
    output: "diagnostics-runtime-feature.bundle.min.js",
    maxBytes: 24_000,
    format: "esm",
  }),
  Object.freeze({
    entry: "data-freshness-feature.mjs",
    output: "data-freshness-feature.bundle.min.js",
    maxBytes: 32_000,
    format: "esm",
  }),
]);

await mkdir(outputDir, { recursive: true });
await mkdir(e2eOutputDir, { recursive: true });
await mkdir(path.dirname(bundleReportFile), { recursive: true });
await rm(temporaryOutputFile, { force: true });
await rm(e2eTemporaryOutputFile, { force: true });
await rm(temporaryStylesheetFile, { force: true });

async function buildStylesheet() {
  const sections = await Promise.all(stylesheetSources.map(async (file) => (
    (await readFile(file, "utf8")).trimEnd()
  )));
  const stylesheet = `${sections.join("\n\n")}\n`;
  await writeFile(temporaryStylesheetFile, stylesheet, "utf8");
  await replaceBuiltFile(temporaryStylesheetFile, stylesheetFile);
  console.log(`Built ${path.relative(root, stylesheetFile)} (${Buffer.byteLength(stylesheet)} bytes)`);
}

async function buildBundle(outfile, diagnosticsEnabled) {
  const result = await build({
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
    metafile: true,
    define: {
      __THINKSTOCK_E2E_DIAGNOSTICS__: diagnosticsEnabled ? "true" : "false",
    },
  });
  return result.metafile;
}

async function buildFeatureBundle(definition) {
  const outputFilePath = path.join(outputDir, definition.output);
  const temporaryFile = `${outputFilePath}.next`;
  await rm(temporaryFile, { force: true });
  try {
    const result = await build({
      entryPoints: [path.join(root, "scripts", "feature-entries", definition.entry)],
      outfile: temporaryFile,
      bundle: true,
      minify: true,
      format: definition.format || "iife",
      platform: "browser",
      target: ["safari15"],
      legalComments: "none",
      charset: "utf8",
      treeShaking: true,
      metafile: true,
      define: {
        __THINKSTOCK_RELEASE_NOTES_BYTES__: String(releaseNotesSourceBytes),
      },
    });
    const outputStats = await stat(temporaryFile);
    if (outputStats.size > definition.maxBytes) {
      throw new Error(`${definition.output} exceeds ${definition.maxBytes} bytes: ${outputStats.size}`);
    }
    const gzipBytes = gzipSync(await readFile(temporaryFile), { level: 9 }).byteLength;
    await replaceBuiltFile(temporaryFile, outputFilePath);
    console.log(`Built ${path.relative(root, outputFilePath)} (${outputStats.size} bytes, ${gzipBytes} gzip)`);
    return summarizeBundle({
      root,
      name: definition.output.replace(/\.bundle\.min\.js$/, ""),
      file: outputFilePath,
      bytes: outputStats.size,
      gzipBytes,
      metafile: result.metafile,
    });
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
  await buildStylesheet();
  const mainMetafile = await buildBundle(temporaryOutputFile, false);

  const outputStats = await stat(temporaryOutputFile);
  if (outputStats.size > maxBundleBytes) {
    throw new Error(`Pages app bundle exceeds ${maxBundleBytes} bytes: ${outputStats.size}`);
  }
  const outputGzipBytes = gzipSync(await readFile(temporaryOutputFile), { level: 9 }).byteLength;
  if (outputGzipBytes > maxBundleGzipBytes) {
    throw new Error(`Pages app gzip bundle exceeds ${maxBundleGzipBytes} bytes: ${outputGzipBytes}`);
  }
  // Replacing the completed file avoids Windows write failures while the local
  // server or browser still has the previous bundle mapped for reading.
  await replaceBuiltFile(temporaryOutputFile, outputFile);
  console.log(`Built ${path.relative(root, outputFile)} (${outputStats.size} bytes, ${outputGzipBytes} gzip)`);
  const localFingerprint = await stampLocalBundleFingerprint();
  console.log(`Stamped local bundle fingerprint ${localFingerprint}`);

  await buildBundle(e2eTemporaryOutputFile, true);
  const e2eOutputStats = await stat(e2eTemporaryOutputFile);
  if (e2eOutputStats.size > maxE2eBundleBytes) {
    throw new Error(`E2E app bundle exceeds ${maxE2eBundleBytes} bytes: ${e2eOutputStats.size}`);
  }
  await replaceBuiltFile(e2eTemporaryOutputFile, e2eOutputFile);
  console.log(`Built ${path.relative(root, e2eOutputFile)} (${e2eOutputStats.size} bytes, test only)`);
  const featureReports = await Promise.all(
    featureBundles.map((definition) => buildFeatureBundle(definition)),
  );
  const report = createBundleReport({
    appVersion,
    bundles: [
      summarizeBundle({
        root,
        name: "app",
        file: outputFile,
        bytes: outputStats.size,
        gzipBytes: outputGzipBytes,
        metafile: mainMetafile,
      }),
      ...featureReports,
    ],
  });
  await writeFile(bundleReportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(root, bundleReportFile)} (${report.sharedInputs.length} shared inputs)`);
} finally {
  await rm(temporaryOutputFile, { force: true });
  await rm(e2eTemporaryOutputFile, { force: true });
  await rm(temporaryStylesheetFile, { force: true });
}
