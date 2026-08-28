const REPORT_PERIODS = Object.freeze({
  "11013": Object.freeze({ month: "03", frequency: "quarter" }),
  "11012": Object.freeze({ month: "06", frequency: "quarter" }),
  "11014": Object.freeze({ month: "09", frequency: "quarter" }),
  "11011": Object.freeze({ month: "12", frequency: "annual" }),
});

export const DART_EPS_HISTORY_VERSION = 1;
export const DART_EPS_HISTORY_YEARS = 10;
export const DART_FINANCIAL_ALL_URL = "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json";
const DART_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_DART_REDIRECTS = 2;

function parseFinancialNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text || text === "-") return null;
  const negative = /^\(.*\)$/.test(text);
  const numeric = Number(text.replace(/[(),\s]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return negative ? -Math.abs(numeric) : numeric;
}

function amountInHundredMillions(value) {
  const amount = parseFinancialNumber(value);
  return amount === null ? null : amount / 100_000_000;
}

function compactAccountName(value) {
  return String(value || "")
    .replace(/[\s·ㆍ,._\-()\[\]{}]/g, "")
    .replace(/손익/g, "이익")
    .trim();
}

function epsAccountPriority(item) {
  const id = String(item?.account_id || "").toLowerCase().replace(/[^a-z]/g, "");
  const name = compactAccountName(item?.account_nm);
  const basic = id.includes("basicearningslosspershare")
    || /^(기본주당이익|기본주당이익손실|기본주당순이익|기본주당순손실|기본주당손익)$/.test(name);
  if (basic) return 100;
  const diluted = id.includes("dilutedearningslosspershare")
    || /^(희석주당이익|희석주당이익손실|희석주당순이익|희석주당순손실|희석주당손익)$/.test(name);
  return diluted ? 50 : 0;
}

function accountKind(value) {
  const name = compactAccountName(value);
  if (!name) return "";
  if (/^(매출액|수익매출액|영업수익|매출및지분법손익)$/.test(name)) return "revenue";
  if (/^(영업이익|영업이익손실)$/.test(name)) return "operatingProfit";
  if (/^(당기순이익|당기순이익손실|분기순이익|분기순이익손실|반기순이익|반기순이익손실|연결당기순이익)$/.test(name)) {
    return "netIncome";
  }
  return "";
}

function accountPriority(value, kind) {
  const name = compactAccountName(value);
  if (kind === "revenue") {
    if (name === "매출액") return 40;
    if (name === "수익매출액") return 35;
    if (name === "영업수익") return 30;
    return 20;
  }
  if (kind === "operatingProfit") return name === "영업이익" ? 40 : 35;
  if (kind === "netIncome") {
    if (name === "당기순이익") return 40;
    if (/^(분기|반기)순이익$/.test(name)) return 35;
    return 30;
  }
  return 0;
}

function reportDateFromReceipt(value) {
  const compact = String(value || "").replace(/\D/g, "");
  if (compact.length < 8) return "";
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function percentageChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || Math.abs(previous) < 1e-9) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function financialVersionKey(row) {
  return `${row.ticker}:${row.frequency}:${row.period}:${row.reportDate}`;
}

function financialPeriodKey(row, year = row.period.slice(0, 4)) {
  return `${row.ticker}:${row.frequency}:${year}:${row.period.slice(5)}`;
}

function latestReportAsOf(rows, reportDate) {
  let low = 0;
  let high = rows.length - 1;
  let match = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle].reportDate <= reportDate) {
      match = rows[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

export function mergeDartFinancialRows(...groups) {
  const byVersion = new Map();
  groups.flatMap((rows) => (Array.isArray(rows) ? rows : [])).forEach((row) => {
    const ticker = String(row?.ticker || "").trim().toUpperCase();
    const period = String(row?.period || "").slice(0, 7);
    const reportDate = String(row?.reportDate || "").slice(0, 10);
    const frequency = REPORT_PERIODS[row?.reportCode]?.frequency || String(row?.frequency || "");
    if (!ticker || !/^\d{4}-\d{2}$/.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return;
    const normalized = { ...row, ticker, period, frequency, reportDate, estimate: false };
    const key = financialVersionKey(normalized);
    const previous = byVersion.get(key) || {};
    byVersion.set(key, {
      ...previous,
      ...normalized,
      revenue: Number.isFinite(normalized.revenue) ? normalized.revenue : (previous.revenue ?? null),
      operatingProfit: Number.isFinite(normalized.operatingProfit)
        ? normalized.operatingProfit : (previous.operatingProfit ?? null),
      netIncome: Number.isFinite(normalized.netIncome) ? normalized.netIncome : (previous.netIncome ?? null),
    });
  });

  const rows = [...byVersion.values()].sort((left, right) => (
    left.ticker.localeCompare(right.ticker)
      || left.reportDate.localeCompare(right.reportDate)
      || left.period.localeCompare(right.period)
      || left.frequency.localeCompare(right.frequency)
  ));
  const rowsByPeriod = new Map();
  rows.forEach((row) => {
    const key = financialPeriodKey(row);
    if (!rowsByPeriod.has(key)) rowsByPeriod.set(key, []);
    rowsByPeriod.get(key).push(row);
  });
  rowsByPeriod.forEach((versions) => versions.sort((left, right) => (
    left.reportDate.localeCompare(right.reportDate)
  )));
  rows.forEach((row) => {
    const priorYear = String(Number(row.period.slice(0, 4)) - 1);
    const prior = latestReportAsOf(rowsByPeriod.get(financialPeriodKey(row, priorYear)) || [], row.reportDate);
    row.revenueYoy = percentageChange(row.revenue, prior?.revenue);
    row.operatingProfitYoy = percentageChange(row.operatingProfit, prior?.operatingProfit);
    row.netIncomeYoy = percentageChange(row.netIncome, prior?.netIncome);
  });
  return rows;
}

export function parseDartMajorAccountPayload(payload, options = {}) {
  const list = Array.isArray(payload?.list) ? payload.list : [];
  const tickerByCorpCode = options.tickerByCorpCode || {};
  const groups = new Map();
  list.forEach((item) => {
    const reportCode = String(item?.reprt_code || options.reportCode || "");
    const report = REPORT_PERIODS[reportCode];
    const year = String(item?.bsns_year || options.businessYear || "");
    const corpCode = String(item?.corp_code || "").trim();
    const ticker = String(tickerByCorpCode[corpCode] || item?.stock_code || "").trim().toUpperCase();
    const reportDate = reportDateFromReceipt(item?.rcept_no);
    const statement = String(item?.sj_div || "").toUpperCase();
    if (!report || !/^\d{4}$/.test(year) || !ticker || !reportDate || !/^(IS|CIS)$/.test(statement)) return;
    const kind = accountKind(item?.account_nm);
    if (!kind) return;
    const amount = amountInHundredMillions(item?.thstrm_amount ?? item?.thstrm_add_amount);
    if (!Number.isFinite(amount)) return;
    const key = `${ticker}:${report.frequency}:${year}-${report.month}:${reportDate}`;
    const group = groups.get(key) || {
      ticker,
      corpCode,
      period: `${year}-${report.month}`,
      frequency: report.frequency,
      reportDate,
      reportCode,
      receiptNumber: String(item?.rcept_no || ""),
      estimate: false,
      source: "DART",
      values: { CFS: {}, OFS: {} },
    };
    const fsDivision = String(item?.fs_div || "OFS").toUpperCase() === "CFS" ? "CFS" : "OFS";
    const priority = accountPriority(item?.account_nm, kind);
    const previous = group.values[fsDivision][kind];
    if (!previous || priority > previous.priority) {
      group.values[fsDivision][kind] = { amount, priority };
    }
    groups.set(key, group);
  });

  const rows = [...groups.values()].flatMap((group) => {
    const preferred = Object.keys(group.values.CFS).length ? group.values.CFS : group.values.OFS;
    const row = {
      ticker: group.ticker,
      corpCode: group.corpCode,
      period: group.period,
      frequency: group.frequency,
      reportDate: group.reportDate,
      reportCode: group.reportCode,
      receiptNumber: group.receiptNumber,
      estimate: false,
      source: group.source,
      revenue: preferred.revenue?.amount ?? null,
      operatingProfit: preferred.operatingProfit?.amount ?? null,
      netIncome: preferred.netIncome?.amount ?? null,
      eps: null,
      operatingProfitConsensus: null,
      netIncomeConsensus: null,
      operatingProfitSurprise: null,
      netIncomeSurprise: null,
    };
    return [row.revenue, row.operatingProfit, row.netIncome].some(Number.isFinite) ? [row] : [];
  });
  return mergeDartFinancialRows(rows);
}

export function buildDartFinancialQueryPlan(options = {}) {
  const asOf = String(options.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const endYear = Math.trunc(Number(options.endYear) || Number(asOf.slice(0, 4)));
  const startYear = Math.min(endYear, Math.max(2015, Math.trunc(Number(options.startYear) || 2020)));
  const plans = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const availability = [
      ["11013", `${year}-05-16`],
      ["11012", `${year}-08-15`],
      ["11014", `${year}-11-15`],
      ["11011", `${year + 1}-04-01`],
    ];
    availability.forEach(([reportCode, availableOn]) => {
      if (availableOn <= asOf) plans.push({ businessYear: year, reportCode, availableOn });
    });
  }
  return plans;
}

export function completedDartEpsYearRange(options = {}) {
  const asOf = String(options.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const currentYear = Number(asOf.slice(0, 4));
  const endYear = currentYear - (asOf.slice(5) >= "04-01" ? 1 : 2);
  const years = Math.max(1, Math.trunc(Number(options.years) || DART_EPS_HISTORY_YEARS));
  const startYear = Math.max(2015, endYear - years + 1);
  return Number.isInteger(endYear) && endYear >= 2015
    ? { startYear, endYear, years: endYear - startYear + 1 }
    : { startYear: 0, endYear: 0, years: 0 };
}

export function parseDartEpsReportPayload(payload, options = {}) {
  const reportCode = String(options.reportCode || payload?.list?.[0]?.reprt_code || "");
  const report = REPORT_PERIODS[reportCode];
  const businessYear = Number(options.businessYear || payload?.list?.[0]?.bsns_year);
  const ticker = String(options.ticker || payload?.list?.[0]?.stock_code || "").trim().toUpperCase();
  if (!report || !Number.isInteger(businessYear) || businessYear < 2015 || !ticker) return null;

  let selected = null;
  (Array.isArray(payload?.list) ? payload.list : []).forEach((item) => {
    if (!/^(IS|CIS)$/i.test(String(item?.sj_div || ""))) return;
    const priority = epsAccountPriority(item);
    if (!priority || (selected && selected.priority >= priority)) return;
    const current = parseFinancialNumber(item?.thstrm_amount);
    const cumulative = parseFinancialNumber(item?.thstrm_add_amount);
    if (!Number.isFinite(current) && !Number.isFinite(cumulative)) return;
    selected = {
      priority,
      current,
      cumulative,
      reportDate: reportDateFromReceipt(item?.rcept_no),
      receiptNumber: String(item?.rcept_no || ""),
      fsDivision: String(item?.fs_div || options.fsDivision || "").toUpperCase(),
    };
  });
  if (!selected) return null;
  return {
    ticker,
    businessYear,
    reportCode,
    period: `${businessYear}-${report.month}`,
    frequency: report.frequency,
    current: selected.current,
    cumulative: selected.cumulative,
    reportDate: selected.reportDate,
    receiptNumber: selected.receiptNumber,
    fsDivision: selected.fsDivision,
  };
}

function quarterEps(report, previousCumulative = null) {
  if (!report) return { value: null, derived: false };
  if (Number.isFinite(report.current)) return { value: report.current, derived: false };
  if (Number.isFinite(report.cumulative) && Number.isFinite(previousCumulative)) {
    return { value: report.cumulative - previousCumulative, derived: true };
  }
  if (Number.isFinite(report.cumulative)) return { value: report.cumulative, derived: true };
  return { value: null, derived: false };
}

export function buildDartEpsYearRecords(reportRows, options = {}) {
  const reports = new Map((Array.isArray(reportRows) ? reportRows : [])
    .filter(Boolean)
    .map((row) => [String(row.reportCode || ""), row]));
  const sample = [...reports.values()][0];
  const ticker = String(options.ticker || sample?.ticker || "").trim().toUpperCase();
  const businessYear = Number(options.businessYear || sample?.businessYear);
  if (!ticker || !Number.isInteger(businessYear)) return [];

  const q1Report = reports.get("11013");
  const q2Report = reports.get("11012");
  const q3Report = reports.get("11014");
  const annualReport = reports.get("11011");
  const q1 = quarterEps(q1Report);
  const q2 = quarterEps(q2Report, q1Report?.cumulative ?? q1.value);
  const q3 = quarterEps(q3Report, q2Report?.cumulative);
  const annual = annualReport?.current ?? annualReport?.cumulative ?? null;
  const q4 = Number.isFinite(annual) && Number.isFinite(q3Report?.cumulative)
    ? { value: annual - q3Report.cumulative, derived: true }
    : { value: null, derived: false };
  const quarterValues = [
    ["03", q1Report, q1],
    ["06", q2Report, q2],
    ["09", q3Report, q3],
    ["12", annualReport, q4],
  ];
  const records = quarterValues.flatMap(([month, report, result]) => (
    Number.isFinite(result.value) ? [{
      ticker,
      period: `${businessYear}-${month}`,
      frequency: "quarter",
      estimate: false,
      eps: result.value,
      reportDate: report?.reportDate || "",
      reportCode: report?.reportCode || "",
      receiptNumber: report?.receiptNumber || "",
      source: "DART",
      epsDerived: result.derived,
    }] : []
  ));
  if (Number.isFinite(annual)) {
    records.push({
      ticker,
      period: `${businessYear}-12`,
      frequency: "annual",
      estimate: false,
      eps: annual,
      reportDate: annualReport?.reportDate || "",
      reportCode: "11011",
      receiptNumber: annualReport?.receiptNumber || "",
      source: "DART",
      epsDerived: false,
    });
  }
  return records;
}

async function fetchDartFinancialPayload(fetchImpl, endpoint, query, options = {}) {
  const signal = options.signal || (
    typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(options.timeoutMs || 30000) : undefined
  );
  const initialUrl = new URL(`${endpoint}?${new URLSearchParams(query)}`);
  const allowedOrigin = initialUrl.origin;
  const visited = new Set();
  const headers = new Headers(options.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "Mozilla/5.0 (compatible; ThinkStock/3.21; +https://eg-tools.github.io/ThinkStock/)");
  }

  let requestUrl = initialUrl;
  let response = null;
  for (let redirectCount = 0; redirectCount <= MAX_DART_REDIRECTS; redirectCount += 1) {
    if (visited.has(requestUrl.href)) throw new Error("DART redirect loop");
    visited.add(requestUrl.href);
    response = await fetchImpl(requestUrl.href, {
      headers,
      redirect: "manual",
      signal,
    });
    if (!DART_REDIRECT_STATUSES.has(response.status)) break;
    const location = response.headers.get("Location");
    if (!location) throw new Error(`DART redirect ${response.status} without location`);
    const redirectedUrl = new URL(location, requestUrl);
    if (redirectedUrl.origin !== allowedOrigin) throw new Error("DART redirected outside official origin");
    requestUrl = redirectedUrl;
    response = null;
  }
  if (!response) throw new Error("DART redirect limit exceeded");
  if (!response.ok) throw new Error(`DART HTTP ${response.status}`);
  const payload = await response.json();
  const status = String(payload?.status || "");
  if (status !== "000" && status !== "013") {
    const error = new Error(payload?.message || `DART 오류 ${status || "unknown"}`);
    error.code = status;
    throw error;
  }
  return payload;
}

export async function fetchDartEpsYear(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = String(options.apiKey || "").trim();
  const corpCode = String(options.corpCode || "").trim();
  const ticker = String(options.ticker || "").trim().toUpperCase();
  const businessYear = Math.trunc(Number(options.businessYear));
  if (typeof fetchImpl !== "function" || !apiKey || !/^\d{8}$/.test(corpCode)
    || !ticker || businessYear < 2015) {
    throw new Error("DART EPS 요청 정보가 올바르지 않습니다.");
  }
  const endpoint = String(options.endpoint || DART_FINANCIAL_ALL_URL);
  const reportCodes = Object.keys(REPORT_PERIODS);
  const results = await Promise.all(reportCodes.map(async (reportCode) => {
    const request = async (fsDivision) => fetchDartFinancialPayload(fetchImpl, endpoint, {
      crtfc_key: apiKey,
      corp_code: corpCode,
      bsns_year: String(businessYear),
      reprt_code: reportCode,
      fs_div: fsDivision,
    }, options);
    let payload = await request("CFS");
    let fsDivision = "CFS";
    if (String(payload?.status) === "013") {
      payload = await request("OFS");
      fsDivision = "OFS";
    }
    return {
      reportCode,
      payload,
      row: String(payload?.status) === "000"
        ? parseDartEpsReportPayload(payload, { businessYear, reportCode, ticker, fsDivision })
        : null,
    };
  }));
  return {
    ticker,
    businessYear,
    records: buildDartEpsYearRecords(results.map((result) => result.row), { ticker, businessYear }),
    emptyReports: results.filter((result) => String(result.payload?.status) === "013")
      .map((result) => result.reportCode),
  };
}

export const DART_FINANCIAL_REPORTS = REPORT_PERIODS;
