import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("../docs/modules/data-health.js");
const dataHealth = globalThis.ThinkStockDataHealth;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_DATA_DIR = path.join(ROOT, "docs", "data");
const RUNTIME_MIRROR_DIR = path.join(ROOT, ".thinkstock-cache", "pages-data");

const qualityKeysByDataset = Object.freeze({
  macro_data: ["leading_cycle", "news_sentiment"],
  credit_data: ["customer_deposit", "kospi_credit", "kosdaq_credit"],
  adr_data: ["adr_kospi", "adr_kosdaq", "fear_greed"],
});

async function validateDirectory(dataDir, label) {
  const manifestText = await readFile(path.join(dataDir, "data_manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest?.format, "segmented-data-v1", `${label} manifest format is invalid`);
  assert.ok(manifest?.datasets && typeof manifest.datasets === "object", `${label} manifest is empty`);

  const rowsByDataset = new Map();
  let checkedFiles = 0;

  for (const [datasetName, dataset] of Object.entries(manifest.datasets)) {
    for (const segmentName of ["history", "recent"]) {
      const descriptor = dataset?.[segmentName];
      const file = String(descriptor?.file || "");
      assert.match(file, /^[a-z0-9_-]+\.json$/i, `${label} ${datasetName}.${segmentName} file is invalid`);
      assert.ok(Number.isInteger(descriptor?.rows) && descriptor.rows >= 0, `${label} ${file} row count is invalid`);
      assert.match(String(descriptor?.sha256 || ""), /^[a-f0-9]{64}$/i, `${label} ${file} hash is invalid`);

      const text = await readFile(path.join(dataDir, file), "utf8");
      const digest = createHash("sha256").update(text, "utf8").digest("hex");
      assert.equal(digest, String(descriptor.sha256).toLowerCase(), `${label} ${file} hash mismatch`);
      const payload = JSON.parse(text);
      const dates = Array.isArray(payload?.dates)
        ? payload.dates
        : (Array.isArray(payload?.records) ? payload.records.map((row) => row?.date) : null);
      assert.ok(Array.isArray(dates), `${label} ${file} rows are missing`);
      assert.equal(dates.length, descriptor.rows, `${label} ${file} row count mismatch`);

      let previousDate = "";
      dates.forEach((rawDate, index) => {
        const date = String(rawDate || "").slice(0, 10);
        assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `${label} ${file} row ${index} date is invalid`);
        assert.ok(!previousDate || date > previousDate, `${label} ${file} dates are not strictly increasing near ${date}`);
        previousDate = date;
      });

      if (payload?.columns && typeof payload.columns === "object") {
        Object.entries(payload.columns).forEach(([key, values]) => {
          assert.ok(Array.isArray(values), `${label} ${file} ${key} column is invalid`);
          assert.equal(values.length, dates.length, `${label} ${file} ${key} column length mismatch`);
          values.forEach((value, index) => {
            assert.ok(value === null || (typeof value === "number" && Number.isFinite(value)),
              `${label} ${file} ${key} value is invalid at ${dates[index]}`);
          });
        });
      }

      const datasetRows = rowsByDataset.get(datasetName) || [];
      dates.forEach((date, index) => {
        const row = { date };
        if (payload?.columns && typeof payload.columns === "object") {
          Object.entries(payload.columns).forEach(([key, values]) => {
            row[key] = values[index] ?? null;
          });
        } else if (Array.isArray(payload?.records)) {
          Object.assign(row, payload.records[index]);
        }
        datasetRows.push(row);
      });
      rowsByDataset.set(datasetName, datasetRows);
      checkedFiles += 1;
    }
  }

  Object.entries(qualityKeysByDataset).forEach(([datasetName, keys]) => {
    const rows = (rowsByDataset.get(datasetName) || [])
      .sort((left, right) => String(left.date).localeCompare(String(right.date)));
    const policies = Object.fromEntries(keys.map((key) => [
      key,
      dataHealth.DEFAULT_SERIES_POLICIES[key],
    ]));
    const issues = dataHealth.detectRecentChanges(rows, policies);
    assert.deepEqual(issues, [], `${label} ${datasetName} contains suspicious recent values: ${JSON.stringify(issues)}`);
  });

  return { label, checkedFiles, revision: String(manifest.revision || manifest.generated_at || "unknown") };
}

const results = [await validateDirectory(BUNDLED_DATA_DIR, "bundled")];
const runtimeManifestExists = await readFile(path.join(RUNTIME_MIRROR_DIR, "data_manifest.json"), "utf8")
  .then(() => true)
  .catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
if (runtimeManifestExists) {
  results.push(await validateDirectory(RUNTIME_MIRROR_DIR, "runtime-mirror"));
}

console.log(`Local pages data validation passed: ${results
  .map((result) => `${result.label}=${result.checkedFiles} (${result.revision})`)
  .join(", ")}`);
