import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  buildHankyungReportListUrl,
  buildHankyungReportPdfUrl,
  parseHankyungReportListHtml,
} from "../shared/broker-report-source.mjs";

await import("../shared/runtime-foundation.mjs");
await import("../shared/broker-report-policy.mjs");
await import("../docs/modules/broker-report-parser.js");
await import("../docs/modules/broker-research-cache.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(ROOT, ".thinkstock-cache", "broker-report-validation-random-20.json");
const RESEARCH_CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "stock-research");
const UNIVERSE_PATH = path.join(ROOT, "docs", "data", "krx_universe.json");
const parser = globalThis.ThinkStockBrokerReportParser;
const {
  latestReportsByBroker,
  lineItemsFromTextContent,
  MAX_PDF_BYTES,
} = globalThis.ThinkStockBrokerResearchCache;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function seededRandom(seedText) {
  let state = [...String(seedText || "thinkstock")]
    .reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

async function latestResearchUniverse() {
  const files = await readdir(RESEARCH_CACHE_DIR).catch(() => []);
  const summaries = files.filter((name) => /^summary-.*\.json$/i.test(name));
  const records = [];
  for (const name of summaries) {
    const payload = JSON.parse(await readFile(path.join(RESEARCH_CACHE_DIR, name), "utf8").catch(() => "null"));
    const pool = Array.isArray(payload?.candidatePool) ? payload.candidatePool : [];
    if (pool.length > records.length) records.splice(0, records.length, ...pool);
  }
  if (records.length) return records;
  const payload = JSON.parse(await readFile(UNIVERSE_PATH, "utf8"));
  return payload.records || [];
}

async function boundedBytes(response, maximumBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error(`PDF exceeds ${maximumBytes} bytes`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error(`PDF exceeds ${maximumBytes} bytes`);
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("response is not a PDF");
  return bytes;
}

async function sourceText(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "ThinkStock/2 validation" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`list HTTP ${response.status}`);
  return response.text();
}

async function listReports(ticker, asOf, days) {
  const html = await sourceText(buildHankyungReportListUrl(ticker, { asOf, days }));
  return parseHankyungReportListHtml(html, ticker);
}

async function extractReport(report) {
  const response = await fetch(buildHankyungReportPdfUrl(report.id), {
    headers: { Accept: "application/pdf", "User-Agent": "ThinkStock/2 validation" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
  const bytes = await boundedBytes(response, MAX_PDF_BYTES);
  const byteLength = bytes.byteLength;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true });
  const pdf = await task.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(12, pdf.numPages); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({ disableNormalization: false });
      pages.push({ page: pageNumber, lines: lineItemsFromTextContent(textContent) });
      const parsed = parser.parseReport(pages, report);
      if (parsed.usable && Number(parsed.evidence?.coreMetricCount) >= 3) {
        return { parsed, byteLength, pagesRead: pageNumber };
      }
    }
    return { parsed: parser.parseReport(pages, report), byteLength, pagesRead: pages.length };
  } finally {
    if (typeof pdf.destroy === "function") await pdf.destroy().catch(() => {});
    else await task.destroy?.().catch(() => {});
  }
}

function consistencyIssues(parsed) {
  if (!parsed?.usable) return [];
  const issues = [];
  if (parsed.analysisMode === "forward-primary"
    && parsed.nextFiscalYear !== parsed.currentFiscalYear + 1) {
    issues.push("fiscal-year-alignment");
  }
  const metrics = parsed.metrics || {};
  if (parsed.analysisMode === "forward-primary" && !metrics.eps && !metrics.roe) {
    issues.push("primary-metric-missing");
  }
  Object.entries(metrics).forEach(([key, row]) => {
    if (!Number.isFinite(row?.current) || !Number.isFinite(row?.next)) issues.push(`${key}-non-finite`);
  });
  ["current", "next"].forEach((side) => {
    const revenue = Number(metrics.revenue?.[side]);
    const profit = Number(metrics.operatingProfit?.[side]);
    if (Number.isFinite(revenue) && Number.isFinite(profit) && revenue !== 0
      && Math.abs(profit / revenue) > 2) issues.push(`${side}-margin-outlier`);
  });
  return [...new Set(issues)];
}

const asOf = String(argument("as-of", new Date().toISOString().slice(0, 10)));
const count = Math.max(2, Math.min(40, Number(argument("count", "20")) || 20));
const seed = String(argument("seed", "thinkstock-2.87-broker-pilot"));
const random = seededRandom(seed);
const universe = await latestResearchUniverse();
const perMarket = Math.floor(count / 2);
const kospi = shuffled(universe.filter((item) => String(item.ticker).endsWith(".KS")), random).slice(0, perMarket);
const kosdaq = shuffled(universe.filter((item) => String(item.ticker).endsWith(".KQ")), random).slice(0, count - perMarket);
const sample = shuffled([...kospi, ...kosdaq], random);
const results = [];

for (let index = 0; index < sample.length; index += 1) {
  const stock = sample[index];
  const startedAt = performance.now();
  const result = {
    ticker: stock.ticker,
    name: stock.name,
    market: stock.market,
    rank: Number(stock.marketRank) || null,
    status: "no-report",
    windowDays: 90,
    report: null,
    elapsedMs: 0,
  };
  try {
    let reports = await listReports(stock.ticker, asOf, 90);
    if (!reports.length) {
      result.windowDays = 180;
      await delay(250);
      reports = await listReports(stock.ticker, asOf, 180);
    }
    const report = latestReportsByBroker(reports, 1)[0];
    if (report) {
      await delay(250);
      const extraction = await extractReport(report);
      const issues = consistencyIssues(extraction.parsed);
      result.status = extraction.parsed.usable
        ? issues.length
          ? "suspicious"
          : extraction.parsed.analysisMode === "target-revision-only"
            ? "target-only"
            : "usable"
        : "unsupported-layout";
      result.report = {
        id: report.id,
        publishedDate: report.publishedDate,
        broker: report.broker,
        title: report.title,
        targetPrice: report.targetPrice,
        previousTargetPrice: report.previousTargetPrice,
        targetPriceChange: report.targetPriceChange,
        targetRevisionStreak: report.targetRevisionStreak,
        pagesRead: extraction.pagesRead,
        byteLength: extraction.byteLength,
        currentFiscalYear: extraction.parsed.currentFiscalYear || null,
        nextFiscalYear: extraction.parsed.nextFiscalYear || null,
        metrics: extraction.parsed.metrics || {},
        analysisMode: extraction.parsed.analysisMode || "",
        evidence: extraction.parsed.evidence || null,
        targetRevision: extraction.parsed.targetRevision ?? null,
        confidence: extraction.parsed.confidence || 0,
        reason: extraction.parsed.reason || "",
        issues,
      };
    }
  } catch (error) {
    result.status = "error";
    result.error = String(error?.message || error).slice(0, 240);
  }
  result.elapsedMs = Math.round(performance.now() - startedAt);
  results.push(result);
  console.log(`[${index + 1}/${sample.length}] ${stock.ticker} ${stock.name}: ${result.status} (${result.elapsedMs}ms)`);
  await delay(350);
}

const reportResults = results.filter((result) => result.report);
const usableResults = results.filter((result) => result.status === "usable");
const targetOnlyResults = results.filter((result) => result.status === "target-only");
const acceptedResults = [...usableResults, ...targetOnlyResults];
const payload = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  asOf,
  seed,
  sampleCount: results.length,
  reportFound: reportResults.length,
  usable: usableResults.length,
  targetOnly: targetOnlyResults.length,
  unsupportedLayout: results.filter((result) => result.status === "unsupported-layout").length,
  suspicious: results.filter((result) => result.status === "suspicious").length,
  errors: results.filter((result) => result.status === "error").length,
  noReport: results.filter((result) => result.status === "no-report").length,
  extractionSuccessRate: reportResults.length ? acceptedResults.length / reportResults.length : null,
  primaryMetricCoverageRate: reportResults.length ? usableResults.length / reportResults.length : null,
  averageElapsedMs: Math.round(results.reduce((sum, result) => sum + result.elapsedMs, 0) / results.length),
  results,
};
await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: OUTPUT_PATH,
  sampleCount: payload.sampleCount,
  reportFound: payload.reportFound,
  usable: payload.usable,
  targetOnly: payload.targetOnly,
  unsupportedLayout: payload.unsupportedLayout,
  suspicious: payload.suspicious,
  errors: payload.errors,
  noReport: payload.noReport,
  extractionSuccessRate: payload.extractionSuccessRate,
  primaryMetricCoverageRate: payload.primaryMetricCoverageRate,
  averageElapsedMs: payload.averageElapsedMs,
}, null, 2));
