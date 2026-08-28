import { strFromU8, unzipSync } from "fflate";

import { koreanDateText } from "../../shared/market-calendar.mjs";
import { executeRuntimeSourcePlan } from "../../shared/runtime-freshness-policy.mjs";
import {
  mergeDartDisclosureRecords,
  recordFromDartItem,
} from "../../shared/dart-disclosure.mjs";
import {
  apiDate,
  isValidIsoDate,
  jsonResponse,
  shiftDate,
  writeCachesBestEffort,
  yearsBefore,
} from "./http-runtime.mjs";

const DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json";
const DART_ELESTOCK_URL = "https://opendart.fss.or.kr/api/elestock.json";
const DART_MAJORSTOCK_URL = "https://opendart.fss.or.kr/api/majorstock.json";
const DART_DOCUMENT_URL = "https://opendart.fss.or.kr/api/document.xml";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DISCLOSURE_CACHE_SCHEMA = 1;
const DISCLOSURE_CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const INSIDER_CACHE_SCHEMA = 3;
const INSIDER_CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const MAJOR_HOLDER_DOCUMENT_CONCURRENCY = 4;
const MAX_MAJOR_HOLDER_DOCUMENTS = 40;
const EXCHANGE_INSIDER_DOCUMENT_CONCURRENCY = 4;
const MAX_EXCHANGE_INSIDER_DOCUMENTS = 24;
const MAX_EXCHANGE_DISCLOSURE_PAGES = 3;
const EXCHANGE_DISCLOSURE_FALLBACK_DAYS = 400;
const MAX_DART_DOCUMENT_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_DART_DOCUMENT_XML_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const PROGRESSIVE_PAGE_BATCH_SIZE = 4;
const OVERLAP_DAYS = 7;
const LOOKBACK_YEARS = 3;

export const mergeRecords = mergeDartDisclosureRecords;

function dartFetch(env, url, init) {
  const fetchImpl = typeof env?.fetch === "function" ? env.fetch : globalThis.fetch;
  return fetchImpl(url, init);
}

function normalizeSince(value, today) {
  const lowerBound = yearsBefore(today, LOOKBACK_YEARS);
  const candidate = String(value || "").slice(0, 10);
  if (!DATE_PATTERN.test(candidate) || candidate > today) return lowerBound;
  return candidate < lowerBound ? lowerBound : candidate;
}

async function fetchDartPage(env, params) {
  const url = `${DART_LIST_URL}?${new URLSearchParams(params)}`;
  const result = await executeRuntimeSourcePlan("disclosure", {
    primary: async () => {
      const response = await dartFetch(env, url, {
        signal: AbortSignal.timeout(25000),
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "User-Agent": "ThinkStock/1.28 (+https://eg-tools.github.io/ThinkStock/)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = String(response.headers.get("Location") || "");
        const redirectHost = (() => {
          try { return new URL(location, DART_LIST_URL).host; } catch (_) { return "unknown"; }
        })();
        const error = new Error(`DART redirect ${response.status} to ${redirectHost}`);
        error.retryable = false;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`DART HTTP ${response.status}`);
        error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      return await response.json();
    },
  });
  return result.value;
}

function dartNumber(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!normalized || normalized === "-") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function dartReceiptDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidIsoDate(date) ? date : "";
}

function decodeDartText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function majorHolderRecordKey(record) {
  return [
    record.receiptNo,
    record.date,
    record.reporter,
    record.transactionMethod,
    record.securityType,
    record.sharesBefore,
    record.sharesChanged,
    record.sharesOwned,
  ].map((value) => String(value ?? "")).join("|");
}

export function parseMajorHolderDocument(ticker, xmlText, report = {}) {
  const xml = String(xmlText || "");
  if (!xml || xml.length > MAX_DART_DOCUMENT_XML_BYTES) return [];
  const receiptNo = String(report?.rcept_no || report?.receiptNo || "").replace(/\D/g, "").slice(0, 14);
  const reportOwnershipRate = dartNumber(report?.stkrt ?? report?.ownershipRate);
  const reportReporter = String(report?.repror || report?.reporter || "").trim().slice(0, 80);
  const records = [];
  const rowPattern = /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells = new Map();
    const cellPattern = /<(TU|TE)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const codeMatch = cellMatch[2].match(/\b(?:ACODE|AUNIT)\s*=\s*"([^"]+)"/i);
      const code = String(codeMatch?.[1] || "").trim().toUpperCase();
      if (code) cells.set(code, decodeDartText(cellMatch[3]));
    }

    const date = dartReceiptDate(cells.get("MDF_DT"));
    const transactionMethod = String(cells.get("HLD_MTH") || "").trim();
    const sharesChanged = dartNumber(cells.get("MDF_SDK_CNT"));
    const sharesBefore = dartNumber(cells.get("BFR_MDF_CNT"));
    const sharesOwned = dartNumber(cells.get("AFR_MDF_CNT"));
    if (!date || !sharesChanged || !transactionMethod || transactionMethod === "-") continue;

    const reporter = String(cells.get("SPC_NM") || reportReporter).trim().slice(0, 80);
    const record = {
      ticker,
      date,
      side: sharesChanged > 0 ? "buy" : "sell",
      reporter,
      role: "주요주주 · 대량보유",
      sharesBefore,
      sharesChanged,
      sharesOwned,
      ownershipRate: reportOwnershipRate,
      ownershipRateChanged: null,
      transactionMethod: transactionMethod.slice(0, 80),
      securityType: String(cells.get("STK_KND") || "").trim().slice(0, 80),
      unitPrice: dartNumber(cells.get("HLD_UNT_PRJ")),
      receiptNo,
      recordType: "major-holder-detail",
      url: receiptNo
        ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
        : "",
      source: "OpenDART",
    };
    record.recordId = majorHolderRecordKey(record);
    records.push(record);
  }
  return records;
}

function dartTableCells(rowXml) {
  const cells = [];
  const cellPattern = /<(TD|TH)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let cellMatch;
  while ((cellMatch = cellPattern.exec(String(rowXml || "")))) {
    cells.push(decodeDartText(cellMatch[2]));
  }
  return cells;
}

export function parseLargestShareholderDocument(ticker, xmlText, report = {}) {
  const xml = String(xmlText || "");
  if (!xml || xml.length > MAX_DART_DOCUMENT_XML_BYTES) return [];
  const receiptNo = String(report?.rcept_no || report?.receiptNo || "").replace(/\D/g, "").slice(0, 14);
  const records = [];
  const rowPattern = /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;
  let reporter = "";
  let role = "";
  let changeRowsActive = false;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells = dartTableCells(rowMatch[0]);
    if (!cells.length) continue;
    if (cells[0] === "성명" && cells[1]) {
      reporter = String(cells[1]).trim().slice(0, 80);
      role = "";
      changeRowsActive = false;
      continue;
    }
    if (cells[0].includes("최대주주 및 발행회사와의 관계")) {
      role = String(cells[1] || "").trim().slice(0, 80);
      continue;
    }
    if (cells[0] === "변경일" && cells.includes("증감주식수")) {
      changeRowsActive = true;
      continue;
    }
    if (!changeRowsActive || !reporter || cells.length < 6) continue;
    const date = dartReceiptDate(cells[0]);
    const transactionMethod = String(cells[1] || "").trim();
    const sharesBefore = dartNumber(cells[3]);
    const sharesChanged = dartNumber(cells[4]);
    const sharesOwned = dartNumber(cells[5]);
    if (!date || !sharesChanged || !transactionMethod || transactionMethod === "-") continue;
    const record = {
      ticker,
      date,
      side: sharesChanged > 0 ? "buy" : "sell",
      reporter,
      role: ["최대주주등", role].filter(Boolean).join(" · ").slice(0, 120),
      sharesBefore,
      sharesChanged,
      sharesOwned,
      ownershipRate: null,
      ownershipRateChanged: null,
      transactionMethod: transactionMethod.slice(0, 80),
      securityType: String(cells[2] || "").trim().slice(0, 80),
      unitPrice: null,
      receiptNo,
      recordType: "largest-shareholder-change",
      url: receiptNo
        ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
        : "",
      source: "OpenDART",
    };
    record.recordId = majorHolderRecordKey(record);
    records.push(record);
  }
  return records;
}

export function insiderRecordFromItem(ticker, item) {
  const date = dartReceiptDate(item?.rcept_dt);
  const sharesChanged = dartNumber(item?.sp_stock_lmp_irds_cnt);
  if (!date || !sharesChanged) return null;
  const receiptNo = String(item?.rcept_no || "").replace(/\D/g, "").slice(0, 14);
  const role = [
    item?.isu_exctv_rgist_at,
    item?.isu_exctv_ofcps,
    item?.isu_main_shrholdr,
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
  return {
    ticker,
    date,
    side: sharesChanged > 0 ? "buy" : "sell",
    reporter: String(item?.repror || "").trim().slice(0, 80),
    role: role.slice(0, 120),
    sharesOwned: dartNumber(item?.sp_stock_lmp_cnt),
    sharesChanged,
    ownershipRate: dartNumber(item?.sp_stock_lmp_rate),
    ownershipRateChanged: dartNumber(item?.sp_stock_lmp_irds_rate),
    receiptNo,
    recordType: "executive-ownership",
    url: receiptNo
      ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
      : "",
    source: "OpenDART",
  };
}

export function mergeInsiderRecords(existing, incoming) {
  const records = new Map();
  [...(existing || []), ...(incoming || [])].forEach((record) => {
    if (!record?.ticker || !record?.date || !["buy", "sell"].includes(record?.side)) return;
    const key = String(record.recordId || (record.recordType === "major-holder-detail"
      ? majorHolderRecordKey(record)
      : record.receiptNo) || [
      record.ticker,
      record.date,
      record.reporter,
      record.sharesChanged,
    ].join("|"));
    records.set(key, record);
  });
  return [...records.values()].sort((left, right) => (
    String(left.date).localeCompare(String(right.date))
    || String(left.reporter).localeCompare(String(right.reporter))
  ));
}

async function fetchDartExecutiveTrades(env, ticker, corpCode, today) {
  const url = `${DART_ELESTOCK_URL}?${new URLSearchParams({
    crtfc_key: env.DART_API_KEY,
    corp_code: corpCode,
  })}`;
  const result = await executeRuntimeSourcePlan("disclosure", {
    primary: async () => {
      const response = await dartFetch(env, url, {
        signal: AbortSignal.timeout(25000),
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "User-Agent": "ThinkStock/1.35 (+https://eg-tools.github.io/ThinkStock/)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const error = new Error(`DART ownership redirect ${response.status}`);
        error.retryable = false;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`DART ownership HTTP ${response.status}`);
        error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      const payload = await response.json();
      const status = String(payload?.status || "");
      if (status === "013") return [];
      if (status && status !== "000") {
        const error = new Error(String(payload?.message || `DART ownership status ${status}`));
        error.status = status === "020" ? 429 : 502;
        error.retryable = status !== "100";
        throw error;
      }
      const cutoff = yearsBefore(today, LOOKBACK_YEARS);
      return mergeInsiderRecords([], (payload?.list || [])
        .map((item) => insiderRecordFromItem(ticker, item))
        .filter((record) => record && record.date >= cutoff));
    },
  });
  return result.value;
}

async function fetchDartMajorHolderReports(env, corpCode, today) {
  const url = `${DART_MAJORSTOCK_URL}?${new URLSearchParams({
    crtfc_key: env.DART_API_KEY,
    corp_code: corpCode,
  })}`;
  const response = await dartFetch(env, url, {
    signal: AbortSignal.timeout(25000),
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "User-Agent": "ThinkStock/1.35 (+https://eg-tools.github.io/ThinkStock/)",
    },
  });
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new Error(`DART major ownership HTTP ${response.status}`);
  }
  const payload = await response.json();
  const status = String(payload?.status || "");
  if (status === "013") return [];
  if (status && status !== "000") {
    const error = new Error(String(payload?.message || `DART major ownership status ${status}`));
    error.status = status === "020" ? 429 : 502;
    throw error;
  }
  const cutoff = yearsBefore(today, LOOKBACK_YEARS);
  return (Array.isArray(payload?.list) ? payload.list : [])
    .filter((item) => dartReceiptDate(item?.rcept_dt) >= cutoff)
    .filter((item) => /^\d{14}$/.test(String(item?.rcept_no || "")))
    .sort((left, right) => String(right.rcept_dt).localeCompare(String(left.rcept_dt)))
    .slice(0, MAX_MAJOR_HOLDER_DOCUMENTS);
}

async function fetchDartDocumentXml(env, receiptNo) {
  const url = `${DART_DOCUMENT_URL}?${new URLSearchParams({
    crtfc_key: env.DART_API_KEY,
    rcept_no: receiptNo,
  })}`;
  const response = await dartFetch(env, url, {
    signal: AbortSignal.timeout(25000),
    redirect: "follow",
    headers: {
      Accept: "application/zip, application/octet-stream",
      "User-Agent": "ThinkStock/1.35 (+https://eg-tools.github.io/ThinkStock/)",
    },
  });
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new Error(`DART document HTTP ${response.status}`);
  }
  const announcedSize = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_DART_DOCUMENT_ARCHIVE_BYTES) {
    throw new Error("DART document archive is too large");
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  if (!archive.length || archive.length > MAX_DART_DOCUMENT_ARCHIVE_BYTES) {
    throw new Error("DART document archive is empty or too large");
  }
  const entries = unzipSync(archive);
  const xmlEntries = Object.entries(entries)
    .filter(([name]) => /\.xml$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right));
  let totalBytes = 0;
  const documents = [];
  for (const [, bytes] of xmlEntries) {
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_DART_DOCUMENT_XML_BYTES) throw new Error("DART document XML is too large");
    documents.push(strFromU8(bytes));
  }
  if (!documents.length) throw new Error("DART document XML was not found");
  return documents.join("\n");
}

async function fetchDartMajorHolderTrades(env, ticker, corpCode, today) {
  const reports = await fetchDartMajorHolderReports(env, corpCode, today);
  const records = [];
  const failures = [];
  let completedDocuments = 0;
  for (let offset = 0; offset < reports.length; offset += MAJOR_HOLDER_DOCUMENT_CONCURRENCY) {
    const batch = reports.slice(offset, offset + MAJOR_HOLDER_DOCUMENT_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (report) => {
      const xml = await fetchDartDocumentXml(env, String(report.rcept_no));
      return parseMajorHolderDocument(ticker, xml, report);
    }));
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        completedDocuments += 1;
        records.push(...result.value);
      } else {
        failures.push(result.reason);
      }
    });
  }
  if (reports.length && completedDocuments === 0) {
    const error = failures[0];
    throw new Error(`DART major-holder documents failed: ${error?.message || error || "unknown error"}`);
  }
  const cutoff = yearsBefore(today, LOOKBACK_YEARS);
  return mergeInsiderRecords([], records.filter((record) => record.date >= cutoff));
}

function isLargestShareholderChangeReport(report) {
  return decodeDartText(report?.report_nm).replace(/\s+/g, "")
    .includes("최대주주등소유주식변동신고서");
}

async function fetchLargestShareholderChangeReports(env, corpCode, since, today) {
  const reports = [];
  let pageNo = 1;
  let totalPages = 1;
  while (pageNo <= totalPages && pageNo <= MAX_EXCHANGE_DISCLOSURE_PAGES) {
    const payload = await fetchDartPage(env, {
      crtfc_key: env.DART_API_KEY,
      corp_code: corpCode,
      bgn_de: apiDate(since),
      end_de: apiDate(today),
      last_reprt_at: "Y",
      pblntf_ty: "I",
      sort: "date",
      sort_mth: "desc",
      page_no: String(pageNo),
      page_count: "100",
    });
    const status = String(payload?.status || "");
    if (status === "013") break;
    if (status && status !== "000") {
      const error = new Error(String(payload?.message || `DART exchange disclosure status ${status}`));
      error.status = status === "020" ? 429 : 502;
      throw error;
    }
    totalPages = Math.max(1, Number(payload?.total_page) || 1);
    reports.push(...(Array.isArray(payload?.list) ? payload.list : [])
      .filter(isLargestShareholderChangeReport));
    pageNo += 1;
  }
  const unique = new Map(reports.map((report) => [String(report?.rcept_no || ""), report]));
  return [...unique.values()]
    .filter((report) => /^\d{14}$/.test(String(report?.rcept_no || "")))
    .sort((left, right) => String(right.rcept_dt).localeCompare(String(left.rcept_dt)))
    .slice(0, MAX_EXCHANGE_INSIDER_DOCUMENTS);
}

async function fetchLargestShareholderTrades(env, ticker, corpCode, since, today) {
  const reports = await fetchLargestShareholderChangeReports(env, corpCode, since, today);
  const records = [];
  const failures = [];
  let completedDocuments = 0;
  for (let offset = 0; offset < reports.length; offset += EXCHANGE_INSIDER_DOCUMENT_CONCURRENCY) {
    const batch = reports.slice(offset, offset + EXCHANGE_INSIDER_DOCUMENT_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (report) => {
      const xml = await fetchDartDocumentXml(env, String(report.rcept_no));
      return parseLargestShareholderDocument(ticker, xml, report);
    }));
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        completedDocuments += 1;
        records.push(...result.value);
      } else {
        failures.push(result.reason);
      }
    });
  }
  if (reports.length && completedDocuments === 0) {
    const error = failures[0];
    throw new Error(`DART largest-shareholder documents failed: ${error?.message || error || "unknown error"}`);
  }
  const cutoff = yearsBefore(today, LOOKBACK_YEARS);
  return mergeInsiderRecords([], records.filter((record) => record.date >= cutoff));
}

function latestInsiderRecordDate(records) {
  return (Array.isArray(records) ? records : []).reduce((latest, record) => {
    const date = isValidIsoDate(record?.date) ? String(record.date) : "";
    return date > latest ? date : latest;
  }, "");
}

async function fetchDartInsiderTrades(env, ticker, corpCode, today, cachedRecords = []) {
  const sourceNames = ["executive", "major-holder"];
  const coreResults = await Promise.allSettled([
    fetchDartExecutiveTrades(env, ticker, corpCode, today),
    fetchDartMajorHolderTrades(env, ticker, corpCode, today),
  ]);
  const coreRecords = coreResults
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
  const retainedExchangeRecords = (Array.isArray(cachedRecords) ? cachedRecords : [])
    .filter((record) => record?.recordType === "largest-shareholder-change");
  const latestKnownDate = latestInsiderRecordDate([...coreRecords, ...retainedExchangeRecords]);
  const exchangeSince = latestKnownDate
    ? shiftDate(latestKnownDate, -OVERLAP_DAYS)
    : shiftDate(today, -EXCHANGE_DISCLOSURE_FALLBACK_DAYS);
  const [exchangeResult] = await Promise.allSettled([
    fetchLargestShareholderTrades(env, ticker, corpCode, exchangeSince, today),
  ]);
  const results = [...coreResults, exchangeResult];
  sourceNames.push("largest-shareholder");
  const freshRecords = [
    ...coreRecords,
    ...(exchangeResult.status === "fulfilled" ? exchangeResult.value : []),
  ];
  if (!freshRecords.length && !retainedExchangeRecords.length
    && coreResults.every((result) => result.status === "rejected")) {
    throw coreResults[0].reason;
  }
  const warnings = results.flatMap((result, index) => (
    result.status === "rejected"
      ? [`${sourceNames[index]}: ${result.reason?.message || result.reason || "unknown error"}`]
      : []
  ));
  return {
    records: mergeInsiderRecords([], [...coreRecords, ...retainedExchangeRecords,
      ...(exchangeResult.status === "fulfilled" ? exchangeResult.value : [])]),
    warnings,
  };
}

async function fetchDartDisclosurePage(env, ticker, corpCode, since, today, pageNo) {
  const baseParams = {
    crtfc_key: env.DART_API_KEY,
    corp_code: corpCode,
    bgn_de: apiDate(since),
    end_de: apiDate(today),
    last_reprt_at: "Y",
    sort: "date",
    sort_mth: "desc",
    page_count: String(PAGE_SIZE),
  };
  const payload = await fetchDartPage(env, { ...baseParams, page_no: String(pageNo) });
  const status = String(payload?.status || "");
  if (status === "013") return { records: [], totalPages: 1 };
  if (status && status !== "000") {
    const error = new Error(String(payload?.message || `DART status ${status}`));
    error.status = status === "020" ? 429 : 502;
    throw error;
  }
  const records = (payload?.list || [])
    .map((item) => recordFromDartItem(ticker, item))
    .filter(Boolean);
  return {
    records: mergeRecords([], records),
    totalPages: Math.min(MAX_PAGES, Math.max(1, Number(payload?.total_page) || 1)),
  };
}

async function fetchDartDisclosureBatch(env, ticker, corpCode, since, today, startPage) {
  const first = await fetchDartDisclosurePage(env, ticker, corpCode, since, today, startPage);
  const lastPage = Math.min(
    first.totalPages,
    startPage + PROGRESSIVE_PAGE_BATCH_SIZE - 1,
  );
  const remaining = await Promise.allSettled(
    Array.from({ length: Math.max(0, lastPage - startPage) }, (_, index) => (
      fetchDartDisclosurePage(env, ticker, corpCode, since, today, startPage + index + 1)
    )),
  );
  const contiguousPages = [];
  let warning = "";
  for (const result of remaining) {
    if (result.status === "rejected") {
      warning = `DART 다음 페이지 일부를 불러오지 못했습니다: ${result.reason?.message || result.reason}`;
      break;
    }
    contiguousPages.push(result.value);
  }
  return {
    records: mergeRecords([], [first, ...contiguousPages].flatMap((page) => page.records)),
    totalPages: first.totalPages,
    lastPage: startPage + contiguousPages.length,
    warning,
  };
}

async function fetchDartDisclosures(env, ticker, corpCode, since, today) {
  const records = [];
  let pageNo = 1;
  let totalPages = 1;
  while (pageNo <= totalPages) {
    const page = await fetchDartDisclosurePage(env, ticker, corpCode, since, today, pageNo);
    records.push(...page.records);
    totalPages = page.totalPages;
    pageNo += 1;
  }
  return mergeRecords([], records);
}

async function readDisclosureCache(env, ticker) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const value = await env.DISCLOSURE_CACHE.get(`ticker:${ticker}`, "json");
    return value?.schema === DISCLOSURE_CACHE_SCHEMA && value?.ticker === ticker ? value : null;
  } catch (_) {
    return null;
  }
}

async function writeDisclosureCache(env, ticker, corpCode, records, complete = true) {
  if (!env.DISCLOSURE_CACHE) return;
  const payload = {
    schema: DISCLOSURE_CACHE_SCHEMA,
    ticker,
    corpCode,
    savedAt: Date.now(),
    latestDate: records.at(-1)?.date || "",
    complete,
    records,
  };
  await env.DISCLOSURE_CACHE.put(`ticker:${ticker}`, JSON.stringify(payload));
}

async function readInsiderCache(env, ticker) {
  if (!env.DISCLOSURE_CACHE) return null;
  try {
    const value = await env.DISCLOSURE_CACHE.get(`insider:${ticker}`, "json");
    return value?.schema === INSIDER_CACHE_SCHEMA && value?.ticker === ticker ? value : null;
  } catch (_) {
    return null;
  }
}

async function writeInsiderCache(env, ticker, corpCode, records) {
  if (!env.DISCLOSURE_CACHE) return;
  await env.DISCLOSURE_CACHE.put(`insider:${ticker}`, JSON.stringify({
    schema: INSIDER_CACHE_SCHEMA,
    ticker,
    corpCode,
    savedAt: Date.now(),
    latestDate: records.at(-1)?.date || "",
    records,
  }));
}

export async function insiderTradeResponse(env, ctx, ticker, corpCode, origin, force = false) {
  const cached = await readInsiderCache(env, ticker);
  if (!force && cached && Date.now() - Number(cached.savedAt || 0) <= INSIDER_CACHE_FRESH_MS) {
    return jsonResponse({
      ok: true,
      ticker,
      cached: true,
      checkedFrom: yearsBefore(koreanDateText(), LOOKBACK_YEARS),
      latestDate: cached.latestDate || "",
      records: cached.records || [],
    }, 200, origin);
  }
  try {
    const today = koreanDateText();
    const { records, warnings } = await fetchDartInsiderTrades(
      env,
      ticker,
      corpCode,
      today,
      cached?.records || [],
    );
    const cacheWrite = writeCachesBestEffort("dart-insider", [
      () => writeInsiderCache(env, ticker, corpCode, records),
    ]);
    if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
    else await cacheWrite;
    return jsonResponse({
      ok: true,
      ticker,
      cached: false,
      checkedFrom: yearsBefore(today, LOOKBACK_YEARS),
      latestDate: records.at(-1)?.date || "",
      records,
      ...(warnings.length ? { warnings } : {}),
    }, 200, origin);
  } catch (error) {
    if (cached) {
      return jsonResponse({
        ok: true,
        ticker,
        cached: true,
        stale: true,
        warning: "DART 연결 실패로 마지막 내부거래 데이터를 사용했습니다.",
        latestDate: cached.latestDate || "",
        records: cached.records || [],
      }, 200, origin);
    }
    return jsonResponse({
      ok: false,
      error: `DART 내부거래 조회 실패: ${error?.message || error}`,
    }, error?.status || 503, origin);
  }
}

export async function dartDisclosureResponse({
  env,
  ctx,
  ticker,
  corpCode,
  origin,
  url,
  force = false,
  progressive = false,
}) {
  const requestedPage = Math.min(MAX_PAGES, Math.max(1, Number(url.searchParams.get("page")) || 1));
  const cached = await readDisclosureCache(env, ticker);
  if (!force && requestedPage === 1 && cached?.complete !== false
    && cached?.records?.length > 0
    && Date.now() - Number(cached.savedAt || 0) <= DISCLOSURE_CACHE_FRESH_MS) {
    return jsonResponse({
      ok: true,
      ticker,
      cached: true,
      latestDate: cached.latestDate || "",
      records: cached.records || [],
      nextPage: null,
      totalPages: 1,
      complete: true,
    }, 200, origin);
  }

  const today = koreanDateText();
  const rawSince = String(url.searchParams.get("since") || "").slice(0, 10);
  const requestedSince = normalizeSince(rawSince, today);
  const cacheSince = cached?.latestDate ? shiftDate(cached.latestDate, -OVERLAP_DAYS) : requestedSince;
  const since = normalizeSince(
    cached?.latestDate && !DATE_PATTERN.test(rawSince)
      ? cacheSince
      : (cacheSince < requestedSince ? cacheSince : requestedSince),
    today,
  );
  try {
    if (progressive) {
      const batch = await fetchDartDisclosureBatch(env, ticker, corpCode, since, today, requestedPage);
      const records = mergeRecords(cached?.records || [], batch.records);
      const complete = batch.lastPage >= batch.totalPages;
      const cacheWrite = writeCachesBestEffort("dart-disclosure", [
        () => writeDisclosureCache(env, ticker, corpCode, records, complete),
      ]);
      if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
      else await cacheWrite;
      return jsonResponse({
        ok: true,
        ticker,
        cached: false,
        checkedFrom: since,
        latestDate: records.at(-1)?.date || "",
        records: batch.records,
        accumulatedCount: records.length,
        page: batch.lastPage,
        totalPages: batch.totalPages,
        nextPage: complete ? null : batch.lastPage + 1,
        complete,
        ...(batch.warning ? { warning: batch.warning } : {}),
      }, 200, origin);
    }
    const incoming = await fetchDartDisclosures(env, ticker, corpCode, since, today);
    const records = mergeRecords(cached?.records || [], incoming);
    const cacheWrite = writeCachesBestEffort("dart-disclosure", [
      () => writeDisclosureCache(env, ticker, corpCode, records),
    ]);
    if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
    else await cacheWrite;
    return jsonResponse({
      ok: true,
      ticker,
      cached: false,
      checkedFrom: since,
      latestDate: records.at(-1)?.date || "",
      records,
    }, 200, origin);
  } catch (error) {
    if (cached?.records?.length) {
      return jsonResponse({
        ok: true,
        ticker,
        cached: true,
        stale: true,
        warning: "DART 연결 실패로 마지막 저장 공시를 사용했습니다.",
        latestDate: cached.latestDate || "",
        records: cached.records,
      }, 200, origin);
    }
    return jsonResponse({
      ok: false,
      error: `DART 조회 실패: ${error?.message || error}`,
    }, error?.status || 503, origin);
  }
}
