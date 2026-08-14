import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parsePagesAppVersion(html) {
  return String(html || "").match(/id=["']appVersionText["'][^>]*>\s*([^<\s]+)/i)?.[1] || "";
}

export function parsePagesBundleSource(html) {
  const encoded = String(html || "").match(/<script\b[^>]*\bsrc=["']([^"']*app\.bundle\.min\.js[^"']*)["']/i)?.[1] || "";
  return encoded.replaceAll("&amp;", "&");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function inspectNewsSentimentCoverage(...payloads) {
  const points = payloads.flatMap((payload) => {
    const dates = Array.isArray(payload?.dates) ? payload.dates : [];
    const values = Array.isArray(payload?.columns?.news_sentiment)
      ? payload.columns.news_sentiment
      : [];
    return dates.flatMap((date, index) => {
      const value = Number(values[index]);
      return /^\d{4}-\d{2}-\d{2}$/.test(String(date))
        && Number.isFinite(value) && value > 0
        ? [{ date: String(date), value }]
        : [];
    });
  }).sort((left, right) => left.date.localeCompare(right.date));
  return {
    count: points.length,
    firstDate: points[0]?.date || "",
    latestDate: points.at(-1)?.date || "",
  };
}

function cacheBustedUrl(url, attempt) {
  const target = new URL(url);
  target.searchParams.set("verify", `${Date.now()}-${attempt}`);
  return target.href;
}

async function wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function verifyPagesDeployment(options = {}) {
  const pageUrl = new URL(String(options.pageUrl || "https://eg-tools.github.io/ThinkStock/"));
  const expectedVersion = String(options.expectedVersion || "").trim();
  const expectedBuild = String(options.expectedBuild || "").trim();
  const expectedBundleHash = String(options.expectedBundleHash || "").trim().toLowerCase();
  const expectedDataManifest = options.expectedDataManifest || null;
  const attempts = Math.max(1, Number(options.attempts) || 12);
  const requestedRetryDelay = Number(options.retryDelayMs);
  const retryDelayMs = Number.isFinite(requestedRetryDelay)
    ? Math.max(0, requestedRetryDelay)
    : 10000;
  const fetchImpl = options.fetchImpl || fetch;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const indexResponse = await fetchImpl(cacheBustedUrl(pageUrl, attempt), {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      assert.equal(indexResponse.ok, true, `public index HTTP ${indexResponse.status}`);
      const html = await indexResponse.text();
      const deployedVersion = parsePagesAppVersion(html);
      const bundleSource = parsePagesBundleSource(html);
      assert.ok(bundleSource, "public app bundle reference is missing");
      if (expectedVersion) assert.equal(deployedVersion, expectedVersion, "public app version is stale");
      const bundleUrl = new URL(bundleSource, pageUrl);
      if (expectedBuild) assert.equal(bundleUrl.searchParams.get("v"), expectedBuild, "public build stamp is stale");

      const bundleResponse = await fetchImpl(cacheBustedUrl(bundleUrl, attempt), {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      assert.equal(bundleResponse.ok, true, `public app bundle HTTP ${bundleResponse.status}`);
      const deployedHash = sha256(Buffer.from(await bundleResponse.arrayBuffer()));
      if (expectedBundleHash) assert.equal(deployedHash, expectedBundleHash, "public app bundle does not match the release");

      let dataRevision = "";
      let newsSentimentCoverage = null;
      if (expectedDataManifest) {
        const manifestUrl = new URL("data/data_manifest.json", pageUrl);
        const manifestResponse = await fetchImpl(cacheBustedUrl(manifestUrl, attempt), {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        assert.equal(manifestResponse.ok, true, `public data manifest HTTP ${manifestResponse.status}`);
        const deployedManifest = await manifestResponse.json();
        assert.equal(deployedManifest?.format, "segmented-data-v1", "public data manifest format is invalid");
        assert.equal(
          deployedManifest?.revision,
          expectedDataManifest?.revision,
          "public data manifest is stale",
        );
        dataRevision = String(deployedManifest.revision || "");

        const expectedMacro = expectedDataManifest?.datasets?.macro_data;
        const deployedMacro = deployedManifest?.datasets?.macro_data;
        assert.ok(expectedMacro?.history && expectedMacro?.recent, "local macro data manifest is incomplete");
        assert.ok(deployedMacro?.history && deployedMacro?.recent, "public macro data manifest is incomplete");

        const segmentPayloads = [];
        for (const segment of ["history", "recent"]) {
          const expected = expectedMacro[segment];
          const deployed = deployedMacro[segment];
          assert.equal(deployed.file, expected.file, `public macro ${segment} filename is stale`);
          assert.equal(deployed.rows, expected.rows, `public macro ${segment} row count is stale`);
          assert.equal(deployed.sha256, expected.sha256, `public macro ${segment} hash is stale`);
          const segmentUrl = new URL(`data/${deployed.file}`, pageUrl);
          const segmentResponse = await fetchImpl(cacheBustedUrl(segmentUrl, attempt), {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" },
          });
          assert.equal(segmentResponse.ok, true, `public macro ${segment} HTTP ${segmentResponse.status}`);
          const bytes = Buffer.from(await segmentResponse.arrayBuffer());
          assert.equal(sha256(bytes), expected.sha256, `public macro ${segment} file is stale`);
          segmentPayloads.push(JSON.parse(bytes.toString("utf8")));
        }

        newsSentimentCoverage = inspectNewsSentimentCoverage(...segmentPayloads);
        assert.ok(newsSentimentCoverage.count >= 5000, "public news sentiment history is incomplete");
        assert.ok(
          newsSentimentCoverage.firstDate && newsSentimentCoverage.firstDate <= "2005-01-10",
          "public news sentiment does not reach 2005",
        );
      }
      return {
        attempts: attempt,
        bundleUrl: bundleUrl.href,
        dataRevision,
        deployedHash,
        deployedVersion,
        newsSentimentCoverage,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(retryDelayMs);
    }
  }
  throw lastError || new Error("public Pages verification failed");
}

async function main() {
  const pageUrl = process.env.PAGES_URL || process.argv[2] || "https://eg-tools.github.io/ThinkStock/";
  const runId = String(process.env.GITHUB_RUN_ID || process.argv[3] || "").trim();
  const sha = String(process.env.GITHUB_SHA || process.argv[4] || "").trim();
  const expectedBuild = runId ? `${runId}${sha ? `-${sha.slice(0, 12)}` : ""}` : "";
  const [html, bundle, dataManifestText] = await Promise.all([
    readFile(path.join(root, "docs", "index.html"), "utf8"),
    readFile(path.join(root, "docs", "assets", "app.bundle.min.js")),
    readFile(path.join(root, "docs", "data", "data_manifest.json"), "utf8"),
  ]);
  const result = await verifyPagesDeployment({
    pageUrl,
    expectedVersion: parsePagesAppVersion(html),
    expectedBuild,
    expectedBundleHash: sha256(bundle),
    expectedDataManifest: JSON.parse(dataManifestText),
  });
  console.log(`Public Pages verified: v${result.deployedVersion}, ${result.deployedHash.slice(0, 12)}, data ${result.dataRevision}, news ${result.newsSentimentCoverage?.firstDate}-${result.newsSentimentCoverage?.latestDate}, attempt ${result.attempts}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Public Pages verification failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
