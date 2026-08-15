const REPORT_PERIODS = Object.freeze({
  "11013": Object.freeze({ month: "03", frequency: "quarter" }),
  "11012": Object.freeze({ month: "06", frequency: "quarter" }),
  "11014": Object.freeze({ month: "09", frequency: "quarter" }),
  "11011": Object.freeze({ month: "12", frequency: "annual" }),
});

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

export const DART_FINANCIAL_REPORTS = REPORT_PERIODS;
