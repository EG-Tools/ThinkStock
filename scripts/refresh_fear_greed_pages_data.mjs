import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(ROOT, "docs", "data", "adr_data.json");
const SOURCE_URL = "https://kospi.feargreedchart.com/api/?action=kospi-history";

function finite(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validSeriesValue(key, value) {
  const number = finite(value);
  if (number === null) return null;
  return ["adr_kospi", "adr_kosdaq", "fear_greed"].includes(key) && number <= 0
    ? null
    : number;
}

function payloadRows(payload) {
  const dates = Array.isArray(payload?.dates) ? payload.dates : [];
  const columns = payload?.columns && typeof payload.columns === "object" ? payload.columns : {};
  const series = Array.isArray(payload?.series) ? payload.series : Object.keys(columns);
  return dates.map((date, index) => {
    const row = { date: String(date || "").slice(0, 10) };
    series.forEach((key) => { row[key] = validSeriesValue(key, columns[key]?.[index]); });
    return row;
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

function columnarPayload(previous, rows) {
  const series = [...new Set([
    ...(Array.isArray(previous?.series) ? previous.series : []),
    "fear_greed",
  ])];
  return {
    ...previous,
    format: "columnar-v1",
    generated_at: new Date().toISOString(),
    series,
    display_names: { ...(previous?.display_names || {}), fear_greed: "공포탐욕" },
    dates: rows.map((row) => row.date),
    columns: Object.fromEntries(series.map((key) => [
      key,
      rows.map((row) => validSeriesValue(key, row[key])),
    ])),
  };
}

const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error(`Fear-greed history HTTP ${response.status}`);
const source = await response.json();
const incoming = (Array.isArray(source?.rows) ? source.rows : []).flatMap((row) => {
  const date = String(row?.date || "").slice(0, 10);
  const score = validSeriesValue("fear_greed", row?.score);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && score !== null && score <= 100
    ? [{ date, fear_greed: score }]
    : [];
});
if (!incoming.length) throw new Error("Fear-greed history contains no usable rows");

const previous = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
const byDate = new Map(payloadRows(previous).map((row) => [row.date, row]));
incoming.forEach((row) => byDate.set(row.date, { ...(byDate.get(row.date) || { date: row.date }), ...row }));
const rows = [...byDate.values()]
  .filter((row) => Object.entries(row).some(([key, value]) => (
    key !== "date" && validSeriesValue(key, value) !== null
  )))
  .sort((left, right) => left.date.localeCompare(right.date));
const payload = columnarPayload(previous, rows);

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
const temporary = `${OUTPUT_PATH}.tmp`;
await writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
await rename(temporary, OUTPUT_PATH);
console.log(JSON.stringify({
  output: path.relative(ROOT, OUTPUT_PATH),
  rows: incoming.length,
  firstDate: incoming[0].date,
  latestDate: incoming.at(-1).date,
}, null, 2));
