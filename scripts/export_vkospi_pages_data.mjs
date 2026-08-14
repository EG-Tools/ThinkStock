import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeVkospiRows } from "../shared/krx-volatility-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_PATH = path.join(ROOT, ".thinkstock-cache", "ai-backtest", "vkospi-history.json");
const WALKFORWARD_CONTEXT_PATH = path.join(ROOT, ".thinkstock-cache", "ai-backtest", "walkforward-context.json");
const OUTPUT_PATH = path.join(ROOT, "docs", "data", "vkospi_data.json");

async function readJson(pathname) {
  try {
    return JSON.parse(await readFile(pathname, "utf8"));
  } catch (_) {
    return null;
  }
}

function normalizeVixRows(rows) {
  const byDate = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const vix = Number(row?.vix);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(vix) && vix > 0) {
      byDate.set(date, { date, vix });
    }
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

const [cache, walkforwardContext, existingOutput] = await Promise.all([
  readJson(CACHE_PATH),
  readJson(WALKFORWARD_CONTEXT_PATH),
  readJson(OUTPUT_PATH),
]);
const vkospiRows = normalizeVkospiRows(cache?.rows);
if (!vkospiRows.length) throw new Error("VKOSPI cache contains no usable rows");
const vixRows = normalizeVixRows([
  ...(Array.isArray(existingOutput?.records) ? existingOutput.records : []),
  ...(Array.isArray(walkforwardContext?.crisisRows) ? walkforwardContext.crisisRows : []),
]);
const byDate = new Map(vkospiRows.map((row) => [row.date, { ...row }]));
vixRows.forEach((row) => byDate.set(row.date, { ...(byDate.get(row.date) || { date: row.date }), ...row }));
const records = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));

const payload = {
  format: "records-v1",
  generated_at: new Date().toISOString(),
  sources: {
    vkospi: String(cache?.source || "KRX derivatives index"),
    vix: vixRows.length ? "FRED VIXCLS" : "",
  },
  source: String(cache?.source || "KRX 파생상품지수 시세정보"),
  first_date: records[0].date,
  latest_date: records.at(-1).date,
  records,
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
const temporary = `${OUTPUT_PATH}.tmp`;
await writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
await rename(temporary, OUTPUT_PATH);
console.log(JSON.stringify({
  output: path.relative(ROOT, OUTPUT_PATH),
  rows: records.length,
  vixRows: vixRows.length,
  firstDate: payload.first_date,
  latestDate: payload.latest_date,
}, null, 2));
