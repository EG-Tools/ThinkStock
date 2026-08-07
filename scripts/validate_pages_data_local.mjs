import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("../docs/modules/data-health.js");
const dataHealth = globalThis.ThinkStockDataHealth;


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "docs", "data");
const manifestText = await readFile(path.join(DATA_DIR, "data_manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);

assert.equal(manifest?.format, "segmented-data-v1", "segmented data manifest format is invalid");
assert.ok(manifest?.datasets && typeof manifest.datasets === "object", "segmented data manifest is empty");

const rowsByDataset = new Map();
let checkedFiles = 0;

for (const [datasetName, dataset] of Object.entries(manifest.datasets)) {
  for (const segmentName of ["history", "recent"]) {
    const descriptor = dataset?.[segmentName];
    const file = String(descriptor?.file || "");
    assert.match(file, /^[a-z0-9_-]+\.json$/i, `${datasetName}.${segmentName} file is invalid`);
    assert.ok(Number.isInteger(descriptor?.rows) && descriptor.rows >= 0, `${file} row count is invalid`);
    assert.match(String(descriptor?.sha256 || ""), /^[a-f0-9]{64}$/i, `${file} hash is invalid`);

    const text = await readFile(path.join(DATA_DIR, file), "utf8");
    const digest = createHash("sha256").update(text, "utf8").digest("hex");
    assert.equal(digest, String(descriptor.sha256).toLowerCase(), `${file} hash mismatch`);
    const payload = JSON.parse(text);
    const dates = Array.isArray(payload?.dates)
      ? payload.dates
      : (Array.isArray(payload?.records) ? payload.records.map((row) => row?.date) : null);
    assert.ok(Array.isArray(dates), `${file} rows are missing`);
    assert.equal(dates.length, descriptor.rows, `${file} row count mismatch`);

    let previousDate = "";
    dates.forEach((rawDate, index) => {
      const date = String(rawDate || "").slice(0, 10);
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `${file} row ${index} date is invalid`);
      assert.ok(!previousDate || date > previousDate, `${file} dates are not strictly increasing near ${date}`);
      previousDate = date;
    });

    if (payload?.columns && typeof payload.columns === "object") {
      Object.entries(payload.columns).forEach(([key, values]) => {
        assert.ok(Array.isArray(values), `${file} ${key} column is invalid`);
        assert.equal(values.length, dates.length, `${file} ${key} column length mismatch`);
        values.forEach((value, index) => {
          assert.ok(value === null || (typeof value === "number" && Number.isFinite(value)),
            `${file} ${key} value is invalid at ${dates[index]}`);
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

const qualityKeysByDataset = Object.freeze({
  macro_data: ["leading_cycle", "news_sentiment"],
  credit_data: ["customer_deposit", "kospi_credit", "kosdaq_credit"],
  adr_data: ["adr_kospi", "adr_kosdaq", "fear_greed"],
});

Object.entries(qualityKeysByDataset).forEach(([datasetName, keys]) => {
  const rows = (rowsByDataset.get(datasetName) || [])
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const policies = Object.fromEntries(keys.map((key) => [
    key,
    dataHealth.DEFAULT_SERIES_POLICIES[key],
  ]));
  const issues = dataHealth.detectRecentChanges(rows, policies);
  assert.deepEqual(issues, [], `${datasetName} contains suspicious recent values: ${JSON.stringify(issues)}`);
});

console.log(`Local pages data validation passed: ${checkedFiles} segmented files`);
