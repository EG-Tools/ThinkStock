import { createProviderHttpError } from "./runtime-provider-resilience.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_VIX_URL = "https://query2.finance.yahoo.com/v8/finance/chart/%5EVIX";

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function marketDate(unixSeconds, offsetSeconds = 0) {
  const timestamp = Number(unixSeconds);
  const offset = Number(offsetSeconds);
  if (!Number.isFinite(timestamp)) return "";
  return new Date((timestamp + (Number.isFinite(offset) ? offset : 0)) * 1000)
    .toISOString()
    .slice(0, 10);
}

function normalizeVixPoint(row) {
  const date = String(row?.date || "").slice(0, 10);
  const vix = finite(row?.vix);
  if (!DATE_PATTERN.test(date) || vix === null || vix <= 0 || vix > 500) return null;
  return { date, vix };
}

export function yahooVixChartUrl(options = {}) {
  const url = new URL(options.baseUrl || DEFAULT_VIX_URL);
  url.searchParams.set("range", String(options.range || "10d"));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "true");
  url.searchParams.set("events", "div,splits");
  if (Number.isFinite(Number(options.cacheBust))) {
    url.searchParams.set("_ts", String(Math.trunc(Number(options.cacheBust))));
  }
  return url.toString();
}

export function normalizeYahooVixChart(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close
    : [];
  const offsetSeconds = finite(result?.meta?.gmtoffset) || 0;
  const byDate = new Map();
  timestamps.forEach((timestamp, index) => {
    const point = normalizeVixPoint({
      date: marketDate(timestamp, offsetSeconds),
      vix: closes[index],
    });
    if (point) byDate.set(point.date, point);
  });

  // Yahoo updates these fields during the current US session before the daily bar settles.
  const livePoint = normalizeVixPoint({
    date: marketDate(result?.meta?.regularMarketTime, offsetSeconds),
    vix: result?.meta?.regularMarketPrice,
  });
  if (livePoint) byDate.set(livePoint.date, livePoint);

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function decodeHtmlText(text) {
  return String(text || "")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function normalizeBrowserVixContent(body) {
  let content = String(body || "").trim();
  try {
    const wrapper = JSON.parse(content);
    if (wrapper?.success === true && typeof wrapper.result === "string") {
      content = wrapper.result.trim();
    } else {
      return normalizeYahooVixChart(wrapper);
    }
  } catch (_) {}
  const preMatch = content.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
  if (preMatch) content = decodeHtmlText(preMatch[1]).trim();
  try {
    return normalizeYahooVixChart(JSON.parse(content));
  } catch (_) {
    return [];
  }
}

export function mergeVixRows(baseRows, supplementalRows, options = {}) {
  const byDate = new Map();
  (Array.isArray(baseRows) ? baseRows : []).forEach((row) => {
    const point = normalizeVixPoint(row);
    if (point) byDate.set(point.date, point);
  });
  const afterDate = DATE_PATTERN.test(String(options.afterDate || "").slice(0, 10))
    ? String(options.afterDate).slice(0, 10)
    : (byDate.size ? [...byDate.keys()].sort().at(-1) : "");
  (Array.isArray(supplementalRows) ? supplementalRows : []).forEach((row) => {
    const point = normalizeVixPoint(row);
    if (point && (!afterDate || point.date > afterDate)) byDate.set(point.date, point);
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export async function fetchYahooVixRows(fetchImpl, options = {}) {
  const response = await fetchImpl(yahooVixChartUrl({
    cacheBust: options.cacheBust,
    range: options.range,
  }), {
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) throw createProviderHttpError("Yahoo VIX", response);
  const rows = normalizeYahooVixChart(await response.json());
  if (!rows.length) throw new Error("Yahoo VIX returned no usable rows");
  return rows;
}
