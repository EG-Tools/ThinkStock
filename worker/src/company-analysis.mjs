const COMPANY_OVERVIEW_URL = "https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx";
const MAX_OVERVIEW_BYTES = 900_000;

function htmlText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromHtml(value) {
  const cleaned = htmlText(value).replaceAll(",", "").replace(/[^0-9.+-]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function attributeValue(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] || "";
}

async function boundedText(response, maxBytes) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Upstream response is too large");
  if (!response.body?.getReader) {
    const value = await response.text();
    if (new TextEncoder().encode(value).byteLength > maxBytes) throw new Error("Upstream response is too large");
    return value;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Upstream response is too large");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

export function parseConsensusHtml(html, ticker) {
  const table = String(html || "").match(/<table\b[^>]*\bid=["']cTB15["'][^>]*>[\s\S]*?<\/table>/i)?.[0] || "";
  if (!table) return null;
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRow = rows
    .map((match) => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]))
    .find((cells) => cells.length >= 5);
  if (!dataRow) return null;
  const [opinion, targetPrice, eps, per, institutions] = dataRow.slice(-5).map(numberFromHtml);
  if (!Number.isFinite(targetPrice) || targetPrice <= 0 || !Number.isFinite(institutions) || institutions < 1) return null;
  const code = String(ticker || "").slice(0, 6);
  return {
    ticker,
    opinion,
    targetPrice,
    eps,
    per,
    institutions,
    source: "Naver Finance / WiseReport",
    sourceUrl: `https://finance.naver.com/item/coinfo.naver?code=${encodeURIComponent(code)}`,
    fetchedAt: new Date().toISOString(),
  };
}

function seriesValue(series, index) {
  const key = String(index + 1);
  const value = Object.prototype.hasOwnProperty.call(series || {}, key)
    ? series[key]
    : series?.[index];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseEarningsTrendHtml(html, ticker) {
  const source = String(html || "");
  const start = source.indexOf("var EarnigList");
  if (start < 0) return [];
  const section = source.slice(start, start + 30_000);
  const jsonText = section.match(/var\s+res\s*=\s*(\{[\s\S]*?\})\s*;/)?.[1];
  if (!jsonText) return [];

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(payload?.yymm) || !Array.isArray(payload?.data)) return [];

  return payload.yymm.map((rawPeriod, index) => {
    const compactPeriod = String(rawPeriod || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(compactPeriod)) return null;
    const operatingProfitConsensus = seriesValue(payload.data[0], index);
    const operatingProfitActual = seriesValue(payload.data[1], index);
    const netIncomeConsensus = seriesValue(payload.data[5], index);
    const netIncomeActual = seriesValue(payload.data[6], index);
    const reportDateText = String(payload.yymmdd?.[index] || "");
    const reportDateMatch = reportDateText.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    const estimate = operatingProfitActual === null && netIncomeActual === null;
    const record = {
      ticker,
      period: `${compactPeriod.slice(0, 4)}-${compactPeriod.slice(4)}`,
      frequency: "quarter",
      estimate,
      revenue: null,
      operatingProfit: operatingProfitActual ?? operatingProfitConsensus,
      netIncome: netIncomeActual ?? netIncomeConsensus,
      eps: null,
      operatingProfitConsensus,
      netIncomeConsensus,
      operatingProfitSurprise: seriesValue(payload.data[2], index),
      netIncomeSurprise: seriesValue(payload.data[7], index),
      operatingProfitYoy: seriesValue(payload.data[3], index),
      netIncomeYoy: seriesValue(payload.data[8], index),
      reportDate: reportDateMatch
        ? `${reportDateMatch[1]}-${reportDateMatch[2]}-${reportDateMatch[3]}`
        : "",
    };
    return [
      record.operatingProfit,
      record.netIncome,
      record.operatingProfitConsensus,
      record.netIncomeConsensus,
    ].some(Number.isFinite) ? record : null;
  }).filter(Boolean);
}

function rowValuesByLabel(table) {
  const output = new Map();
  [...String(table || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].forEach((rowMatch) => {
    const row = rowMatch[1];
    const heading = row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i);
    if (!heading) return;
    const label = htmlText(heading[1]).replace(/\s+/g, "");
    if (!label) return;
    const values = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((cell) => {
      const title = attributeValue(cell[1], "title");
      return numberFromHtml(title || cell[2]);
    });
    if (values.length) output.set(label, values);
  });
  return output;
}

export function parseFinancialSummaryHtml(html, ticker) {
  const tables = [...String(html || "").matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((candidate) => (
    /r02c0[0-7]/i.test(candidate) && /매출액/.test(htmlText(candidate))
  ));
  if (!table) return [];

  const periods = [...table.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)]
    .map((match) => {
      const className = attributeValue(match[1], "class");
      const column = Number(className.match(/\br02c(\d{2})\b/i)?.[1]);
      const text = htmlText(match[2]);
      const period = text.match(/(\d{4})\/(\d{2})(?:\(E\))?/);
      if (!Number.isInteger(column) || !period) return null;
      return {
        column,
        period: `${period[1]}-${period[2]}`,
        frequency: column <= 3 ? "annual" : "quarter",
        estimate: /\(E\)/i.test(text),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.column - right.column);
  if (!periods.length) return [];

  const rows = rowValuesByLabel(table);
  const revenue = rows.get("매출액") || [];
  const operatingProfit = rows.get("영업이익(발표기준)") || rows.get("영업이익") || [];
  const netIncome = rows.get("당기순이익(지배)") || rows.get("당기순이익") || [];
  const eps = rows.get("EPS") || [];

  return periods.map((period, index) => ({
    ticker,
    period: period.period,
    frequency: period.frequency,
    estimate: period.estimate,
    revenue: revenue[index] ?? null,
    operatingProfit: operatingProfit[index] ?? null,
    netIncome: netIncome[index] ?? null,
    eps: eps[index] ?? null,
  })).filter((record) => (
    [record.revenue, record.operatingProfit, record.netIncome, record.eps].some(Number.isFinite)
  ));
}

export function mergeFinancialRecords(existing, incoming) {
  const merged = new Map();
  [...(existing || []), ...(incoming || [])].forEach((record) => {
    const ticker = String(record?.ticker || "").trim().toUpperCase();
    const frequency = ["annual", "quarter"].includes(record?.frequency) ? record.frequency : "";
    const period = String(record?.period || "").slice(0, 7);
    if (!ticker || !frequency || !/^\d{4}-\d{2}$/.test(period)) return;
    merged.set(`${frequency}:${period}`, {
      ticker,
      period,
      frequency,
      estimate: record?.estimate === true,
      revenue: finiteNumberOrNull(record?.revenue),
      operatingProfit: finiteNumberOrNull(record?.operatingProfit),
      netIncome: finiteNumberOrNull(record?.netIncome),
      eps: finiteNumberOrNull(record?.eps),
      operatingProfitConsensus: finiteNumberOrNull(record?.operatingProfitConsensus),
      netIncomeConsensus: finiteNumberOrNull(record?.netIncomeConsensus),
      operatingProfitSurprise: finiteNumberOrNull(record?.operatingProfitSurprise),
      netIncomeSurprise: finiteNumberOrNull(record?.netIncomeSurprise),
      operatingProfitYoy: finiteNumberOrNull(record?.operatingProfitYoy),
      netIncomeYoy: finiteNumberOrNull(record?.netIncomeYoy),
      reportDate: /^\d{4}-\d{2}-\d{2}$/.test(String(record?.reportDate || ""))
        ? String(record.reportDate) : "",
    });
  });
  return [...merged.values()].sort((left, right) => (
    left.period.localeCompare(right.period) || left.frequency.localeCompare(right.frequency)
  ));
}

export async function fetchCompanyAnalysis(ticker, fetchImpl = fetch) {
  const code = String(ticker || "").slice(0, 6);
  const overviewUrl = `${COMPANY_OVERVIEW_URL}?cmp_cd=${encodeURIComponent(code)}`;
  const overviewResponse = await fetchImpl(overviewUrl, {
    headers: { Accept: "text/html", "Accept-Language": "ko-KR,ko;q=0.9" },
    signal: AbortSignal.timeout(20000),
  });
  if (!overviewResponse.ok) throw new Error(`Company analysis HTTP ${overviewResponse.status}`);
  const overviewHtml = await boundedText(overviewResponse, MAX_OVERVIEW_BYTES);
  const consensus = parseConsensusHtml(overviewHtml, ticker);
  const financials = parseEarningsTrendHtml(overviewHtml, ticker);
  return {
    consensus,
    financials,
  };
}
