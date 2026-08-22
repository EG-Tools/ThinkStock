const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;
const REPORT_ID_PATTERN = /^\d{1,12}$/;
const REPORT_KEY_PATTERN = /^(?:\d{1,12}|naver-\d{1,12})$/;
const HANKYUNG_LIST_URL = "https://consensus.hankyung.com/analysis/list";
const HANKYUNG_PDF_URL = "https://consensus.hankyung.com/analysis/downpdf";
const NAVER_LIST_URL = "https://finance.naver.com/research/company_list.naver";
const NAVER_PDF_HOST = "stock.pstatic.net";
const NAVER_PDF_PATH_PATTERN = /^\/stock-research\/company\/\d{1,4}\/20\d{6}_company_\d{1,12}\.pdf$/i;

function isoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function shiftIsoDate(dateText, days) {
  if (!DATE_PATTERN.test(String(dateText || ""))) return "";
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return isoDate(date);
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, key) => named[key.toLowerCase()] ?? match);
}

function textFromHtml(value) {
  return decodeHtml(String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBrokerReportTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : "";
}

export function normalizeBrokerReportId(value) {
  const id = String(value || "").trim();
  return REPORT_ID_PATTERN.test(id) ? id : "";
}

export function normalizeBrokerReportKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return REPORT_KEY_PATTERN.test(key) ? key : "";
}

export function normalizeBrokerReportName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function buildHankyungReportListUrl(ticker, options = {}) {
  const normalizedTicker = normalizeBrokerReportTicker(ticker);
  if (!normalizedTicker) throw new Error("Broker report ticker is invalid");
  const asOf = DATE_PATTERN.test(String(options.asOf || ""))
    ? String(options.asOf)
    : isoDate();
  const requestedDays = Math.round(Number(options.days) || 90);
  const days = requestedDays <= 90 ? 90 : 180;
  const code = normalizedTicker.slice(0, 6);
  const name = normalizeBrokerReportName(options.name) || code;
  const query = new URLSearchParams({
    sdate: shiftIsoDate(asOf, -(days - 1)),
    edate: asOf,
    search_value: "REPORT_TITLE",
    search_text: name,
    business_code: code,
    pagenum: "80",
    now_page: "1",
  });
  return `${HANKYUNG_LIST_URL}?${query}`;
}

export function buildHankyungReportPdfUrl(reportId) {
  const id = normalizeBrokerReportId(reportId);
  if (!id) throw new Error("Broker report id is invalid");
  return `${HANKYUNG_PDF_URL}?report_idx=${encodeURIComponent(id)}`;
}

export function buildNaverReportListUrl(ticker, options = {}) {
  const normalizedTicker = normalizeBrokerReportTicker(ticker);
  if (!normalizedTicker) throw new Error("Broker report ticker is invalid");
  const query = new URLSearchParams({
    searchType: "itemCode",
    itemCode: normalizedTicker.slice(0, 6),
    page: String(Math.max(1, Math.min(3, Math.round(Number(options.page) || 1)))),
  });
  return `${NAVER_LIST_URL}?${query}`;
}

export function normalizeNaverReportPdfUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== NAVER_PDF_HOST || url.username || url.password) return "";
    if (!NAVER_PDF_PATH_PATTERN.test(url.pathname)) return "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

export function buildNaverReportPdfUrl(value) {
  const url = normalizeNaverReportPdfUrl(value);
  if (!url) throw new Error("Naver broker report URL is invalid");
  return url;
}

export function decodeNaverReportListBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  for (const encoding of ["euc-kr", "windows-949"]) {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch (_) {
      // Some runtimes expose only one alias for the same Korean encoding.
    }
  }
  return new TextDecoder().decode(bytes);
}

export function parseHankyungReportListHtml(html, expectedTicker = "", expectedName = "") {
  const expected = normalizeBrokerReportTicker(expectedTicker);
  const expectedCode = expected.slice(0, 6);
  const normalizedExpectedName = normalizeBrokerReportName(expectedName).toLowerCase();
  const records = [];
  const seen = new Set();
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of String(html || "").matchAll(rowPattern)) {
    const rowHtml = rowMatch[1];
    const idMatch = rowHtml.match(/\/analysis\/downpdf\?report_idx=(\d{1,12})/i);
    const reportId = normalizeBrokerReportId(idMatch?.[1]);
    if (!reportId || seen.has(reportId)) continue;
    const cellHtml = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => match[1]);
    const cells = cellHtml.map(textFromHtml);
    const publishedDate = String(cells[0] || "").slice(0, 10);
    if (!DATE_PATTERN.test(publishedDate)) continue;
    const titleMatch = rowHtml.match(/<a\b[^>]*href=["'][^"']*downpdf\?report_idx=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const isGeneralListRow = /^(?:기업|산업|시장|경제|파생|외환|채권|펀드|퀀트|해외|기타|상향|하향)$/u
      .test(String(cells[1] || "").trim());
    const title = textFromHtml(titleMatch?.[1] || cells[isGeneralListRow ? 2 : 1]);
    const titleCode = title.match(/\((\d{6})\)/)?.[1] || "";
    const attachmentCode = rowHtml.match(/(?:title|alt)=["'][^"']*_(\d{6})_[^"']*\.pdf["']/i)?.[1] || "";
    const nameMatches = Boolean(
      expectedCode
      && normalizedExpectedName
      && title.toLowerCase().includes(normalizedExpectedName),
    );
    const code = titleCode || attachmentCode || (nameMatches ? expectedCode : "");
    if (!/^\d{6}$/.test(code) || (expectedCode && code !== expectedCode)) continue;
    const targetPriceText = String(isGeneralListRow ? "" : cells[2] || "").replace(/[^\d.-]/g, "");
    const targetPrice = Number(targetPriceText);
    const broker = String(cells[isGeneralListRow ? 4 : 5] || "").trim();
    records.push(Object.freeze({
      id: reportId,
      source: "hankyung",
      ticker: expected || `${code}.KS`,
      code,
      publishedDate,
      title,
      targetPrice: Number.isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null,
      recommendation: isGeneralListRow ? "" : String(cells[3] || "").trim(),
      analyst: String(cells[isGeneralListRow ? 3 : 4] || "").trim(),
      broker,
      sourceUrl: buildHankyungReportPdfUrl(reportId),
    }));
    seen.add(reportId);
  }
  return records.sort((left, right) => (
    String(right.publishedDate).localeCompare(String(left.publishedDate))
    || Number(right.id) - Number(left.id)
  ));
}

function naverDate(value) {
  const match = String(value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  return match ? `20${match[1]}-${match[2]}-${match[3]}` : "";
}

export function parseNaverReportListHtml(html, expectedTicker = "") {
  const expected = normalizeBrokerReportTicker(expectedTicker);
  const expectedCode = expected.slice(0, 6);
  const records = [];
  const seen = new Set();
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of String(html || "").matchAll(rowPattern)) {
    const rowHtml = rowMatch[1];
    const code = rowHtml.match(/\/item\/main\.naver\?code=(\d{6})/i)?.[1] || "";
    if (!code || (expectedCode && code !== expectedCode)) continue;
    const nid = normalizeBrokerReportId(rowHtml.match(/company_read\.naver\?[^"']*\bnid=(\d{1,12})/i)?.[1]);
    const pdfUrl = normalizeNaverReportPdfUrl(rowHtml.match(/href=["'](https:\/\/stock\.pstatic\.net\/[^"']+\.pdf)["']/i)?.[1]);
    const id = nid ? `naver-${nid}` : "";
    if (!id || !pdfUrl || seen.has(id)) continue;
    const cellHtml = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const cells = cellHtml.map(textFromHtml);
    const titleMatch = rowHtml.match(/<a\b[^>]*href=["'][^"']*company_read\.naver\?[^"']*\bnid=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const publishedDate = cells.map(naverDate).find(Boolean) || "";
    const title = textFromHtml(titleMatch?.[1] || cells[1]);
    if (!publishedDate || !title) continue;
    const viewCountText = cells.length >= 6 ? String(cells.at(-1) || "") : "";
    const viewCount = Number(viewCountText.replace(/[^\d]/g, ""));
    records.push(Object.freeze({
      id,
      sourceReportId: nid,
      source: "naver",
      ticker: expected || `${code}.KS`,
      code,
      publishedDate,
      title,
      targetPrice: null,
      recommendation: "",
      analyst: "",
      broker: String(cells[2] || "").trim(),
      viewCount: Number.isSafeInteger(viewCount) && viewCount >= 0 ? viewCount : 0,
      sourceUrl: pdfUrl,
    }));
    seen.add(id);
  }
  return records.sort((left, right) => (
    String(right.publishedDate).localeCompare(String(left.publishedDate))
    || String(right.id).localeCompare(String(left.id))
  ));
}

export function selectLatestReportsByBroker(records, maxReports = 5) {
  const limit = Math.max(1, Math.min(10, Math.round(Number(maxReports) || 5)));
  const selected = [];
  const brokers = new Set();
  const ordered = [...(Array.isArray(records) ? records : [])].sort((left, right) => (
    String(right?.publishedDate || "").localeCompare(String(left?.publishedDate || ""))
    || String(right?.id || "").localeCompare(String(left?.id || ""))
  ));
  for (const report of ordered) {
    const id = normalizeBrokerReportKey(report?.id);
    if (!id) continue;
    const broker = String(report?.broker || "").replace(/\s+/g, "").toLowerCase() || `unknown:${id}`;
    if (brokers.has(broker)) continue;
    selected.push(report);
    brokers.add(broker);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function reportAgeDays(publishedDate, asOfDate) {
  if (!DATE_PATTERN.test(String(publishedDate || "")) || !DATE_PATTERN.test(String(asOfDate || ""))) {
    return Infinity;
  }
  const age = Math.round((
    Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${publishedDate}T00:00:00Z`)
  ) / DAY_MS);
  return age < 0 ? Infinity : age;
}

export const BROKER_REPORT_SOURCE = Object.freeze({
  HANKYUNG_LIST_URL,
  HANKYUNG_PDF_URL,
  NAVER_LIST_URL,
  NAVER_PDF_HOST,
});
