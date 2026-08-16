import { koreanDateText } from "../../shared/market-calendar.mjs";

const KOFIA_CREDIT_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo";
const KOFIA_MARKET_FUNDS_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getSecuritiesMarketTotalCapitalInfo";
const FREESIS_CREDIT_URL = "https://freesis.kofia.or.kr/meta/getMetaDataList.do";
const FREESIS_CREDIT_OBJECT = "STATSCU0100000070BO";
const FREESIS_CUSTOMER_DEPOSIT_OBJECT = "STATSCU0100000060BO";
const INDEXERGO_SERIES_URL = "https://www.indexergo.com/series/";
const INDEXERGO_CUSTOMER_DEPOSIT_ID = "20111";
const INDEXERGO_KOSPI_CREDIT_ID = "20215";
const INDEXERGO_KOSDAQ_CREDIT_ID = "20315";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_WARNINGS = Symbol("kofiaSourceWarnings");

function shiftDate(dateText, days) {
  const parsed = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function isValidIsoDate(value) {
  return DATE_PATTERN.test(String(value || ""));
}

function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function compactDate(rawValue) {
  const value = String(rawValue || "");
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : "";
}

function creditAmountToTrillion(value) {
  const amount = finiteNumber(String(value ?? "").replaceAll(",", ""), { min: 0 });
  return amount === null ? null : Math.round((amount / 1e12) * 10000) / 10000;
}

export function mergeCreditRows(existing, incoming) {
  const byDate = new Map();
  [...(existing || []), ...(incoming || [])].forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!isValidIsoDate(date)) return;
    const previous = byDate.get(date) || { date };
    const next = { ...previous };
    ["customer_deposit", "kospi_credit", "kosdaq_credit"].forEach((key) => {
      const value = finiteNumber(row?.[key], { min: 0 });
      if (value !== null && value > 0) next[key] = value;
    });
    if (Object.keys(next).length > 1) byDate.set(date, next);
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function parseFreesisPayload(text) {
  const source = String(text || "").trim();
  if (source.includes("#")) throw new Error("KOFIA Freesis response masked numeric values");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`KOFIA JSON parsing failed: ${error?.message || error}`);
  }
}

export function parseIndexergoLatestPoint(html) {
  const source = String(html || "");
  const match = source.match(
    /(\d{4})[./-](\d{2})[./-](\d{2})\s*마감\s*기준[^:<]*:\s*([\d,.]+)\s*조원/i,
  );
  if (!match) throw new Error("INDEXerGO latest point was not found");
  const value = finiteNumber(match[4].replaceAll(",", ""), { min: 0.01, max: 1000 });
  if (value === null) throw new Error("INDEXerGO latest value is invalid");
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    value,
  };
}

function parseOpenApiPayload(text) {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`KOFIA Open API JSON parsing failed: ${error?.message || error}`);
  }
}

function errorMessage(error) {
  return error?.message || String(error || "Unknown error");
}

export function createKofiaClient(options = {}) {
  const fetchFn = options.fetch || ((...args) => globalThis.fetch(...args));
  const wait = options.wait || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const timeoutSignal = options.timeoutSignal || ((timeoutMs) => AbortSignal.timeout(timeoutMs));
  const indexergoEnabled = options.enableIndexergo === true;

  async function fetchOpenApiItems(apiKey, endpoint) {
    const cleanKey = String(apiKey || "").trim();
    if (!cleanKey) throw new Error("KOFIA_API_KEY is not configured");
    let decodedKey = cleanKey;
    try { decodedKey = decodeURIComponent(cleanKey); } catch (_) {}
    const keyCandidates = [...new Set([cleanKey, decodedKey].filter(Boolean))];
    let lastError = null;
    for (const serviceKey of keyCandidates) {
      try {
        const url = new URL(endpoint);
        url.searchParams.set("serviceKey", serviceKey);
        url.searchParams.set("numOfRows", "1000");
        url.searchParams.set("pageNo", "1");
        url.searchParams.set("resultType", "json");
        url.searchParams.set("beginBasDt", shiftDate(koreanDateText(), -180).replaceAll("-", ""));
        // KOFIA can publish a newer business day while an edge still holds the
        // previous response. Always reach the origin before updating our KV.
        const response = await fetchFn(url, {
          cache: "no-store",
          signal: timeoutSignal(30000),
        });
        if (!response.ok) throw new Error(`KOFIA Open API HTTP ${response.status}`);
        const payload = parseOpenApiPayload(await response.text());
        const header = payload?.response?.header;
        if (String(header?.resultCode || "") !== "00") {
          throw new Error(header?.resultMsg || "KOFIA Open API error");
        }
        const rawItems = payload?.response?.body?.items?.item;
        const items = Array.isArray(rawItems)
          ? rawItems
          : (rawItems && typeof rawItems === "object" ? [rawItems] : []);
        if (!items.length) throw new Error("KOFIA Open API returned no rows");
        return items;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("KOFIA Open API request failed");
  }

  async function fetchFreesisRows(objectName) {
    const end = koreanDateText().replaceAll("-", "");
    const start = shiftDate(koreanDateText(), -180).replaceAll("-", "");
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const url = new URL(FREESIS_CREDIT_URL);
        url.searchParams.set("_", `${Date.now()}-${attempt}`);
        const response = await fetchFn(url, {
          method: "POST",
          cache: "no-store",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json; charset=UTF-8",
            Origin: "https://freesis.kofia.or.kr",
            Referer: "https://freesis.kofia.or.kr/",
            "User-Agent": "Mozilla/5.0 ThinkStock/2",
          },
          body: JSON.stringify({
            dmSearch: {
              OBJ_NM: objectName,
              tmpV1: "D",
              tmpV40: "01",
              tmpV45: start,
              tmpV46: end,
            },
          }),
        });
        if (!response.ok) throw new Error(`KOFIA HTTP ${response.status}`);
        const payload = parseFreesisPayload(await response.text());
        const rows = Array.isArray(payload?.ds1) ? payload.ds1 : [];
        if (rows.length) return rows;
        throw new Error("KOFIA returned no rows");
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(350);
      }
    }
    throw lastError || new Error("KOFIA request failed");
  }

  async function fetchIndexergoPoint(detailId) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const url = new URL(INDEXERGO_SERIES_URL);
        url.searchParams.set("detailId", detailId);
        url.searchParams.set("frq", "D");
        url.searchParams.set("_", `${Date.now()}-${attempt}`);
        const response = await fetchFn(url, {
          cache: "no-store",
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            Referer: "https://www.indexergo.com/",
            "User-Agent": "Mozilla/5.0 ThinkStock/2",
          },
          signal: timeoutSignal(15000),
        });
        if (!response.ok) throw new Error(`INDEXerGO HTTP ${response.status}`);
        return parseIndexergoLatestPoint(await response.text());
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(350);
      }
    }
    throw lastError || new Error("INDEXerGO request failed");
  }

  async function fetchOpenApiCreditRows(apiKey) {
    const rows = await fetchOpenApiItems(apiKey, KOFIA_CREDIT_URL);
    return rows.map((row) => ({
      date: compactDate(row?.basDt),
      kospi_credit: creditAmountToTrillion(row?.crdTrFingScrs),
      kosdaq_credit: creditAmountToTrillion(row?.crdTrFingKosdaq),
    })).filter((row) => (
      isValidIsoDate(row.date) && row.kospi_credit > 0 && row.kosdaq_credit > 0
    ));
  }

  async function fetchOpenApiDepositRows(apiKey) {
    const rows = await fetchOpenApiItems(apiKey, KOFIA_MARKET_FUNDS_URL);
    return rows.map((row) => ({
      date: compactDate(row?.basDt),
      customer_deposit: creditAmountToTrillion(row?.invrDpsgAmt),
    })).filter((row) => isValidIsoDate(row.date) && row.customer_deposit > 0);
  }

  async function fetchFreesisCreditRows() {
    const rows = await fetchFreesisRows(FREESIS_CREDIT_OBJECT);
    return rows.map((row) => ({
      date: compactDate(row?.TMPV1),
      kospi_credit: creditAmountToTrillion(row?.TMPV3),
      kosdaq_credit: creditAmountToTrillion(row?.TMPV4),
    })).filter((row) => (
      isValidIsoDate(row.date)
      && (row.kospi_credit !== null || row.kosdaq_credit !== null)
    ));
  }

  async function fetchFreesisDepositRows() {
    const rows = await fetchFreesisRows(FREESIS_CUSTOMER_DEPOSIT_OBJECT);
    return rows.map((row) => ({
      date: compactDate(row?.TMPV1),
      customer_deposit: creditAmountToTrillion(row?.TMPV2),
    })).filter((row) => isValidIsoDate(row.date) && row.customer_deposit !== null);
  }

  async function fetchIndexergoCreditRows() {
    const [kospi, kosdaq] = await Promise.all([
      fetchIndexergoPoint(INDEXERGO_KOSPI_CREDIT_ID),
      fetchIndexergoPoint(INDEXERGO_KOSDAQ_CREDIT_ID),
    ]);
    if (kospi.date !== kosdaq.date) {
      throw new Error(`INDEXerGO credit dates differ: ${kospi.date} / ${kosdaq.date}`);
    }
    return [{
      date: kospi.date,
      kospi_credit: kospi.value,
      kosdaq_credit: kosdaq.value,
    }];
  }

  async function fetchIndexergoDepositRows() {
    const deposit = await fetchIndexergoPoint(INDEXERGO_CUSTOMER_DEPOSIT_ID);
    return [{ date: deposit.date, customer_deposit: deposit.value }];
  }

  async function mergeAvailableSources(openApiRequest, freesisRequest, indexergoRequest, label) {
    const [openApiResult, freesisResult, indexergoResult] = await Promise.allSettled([
      openApiRequest ? openApiRequest() : Promise.reject(new Error("KOFIA_API_KEY is not configured")),
      freesisRequest(),
      indexergoRequest
        ? indexergoRequest()
        : Promise.reject(new Error("INDEXerGO is disabled in this environment")),
    ]);
    // The mirror is intentionally merged first so official values retain
    // their higher precision whenever sources publish the same date.
    const rows = mergeCreditRows(
      indexergoResult.status === "fulfilled" ? indexergoResult.value : [],
      mergeCreditRows(
        openApiResult.status === "fulfilled" ? openApiResult.value : [],
        freesisResult.status === "fulfilled" ? freesisResult.value : [],
      ),
    );
    if (rows.length) {
      const warnings = [
        openApiRequest && openApiResult.status === "rejected"
          ? `${label} Open API 지연: ${errorMessage(openApiResult.reason)}`
          : "",
        freesisResult.status === "rejected"
          ? `${label} Freesis 지연: ${errorMessage(freesisResult.reason)}`
          : "",
        indexergoRequest && indexergoResult.status === "rejected"
          ? `${label} INDEXerGO 지연: ${errorMessage(indexergoResult.reason)}`
          : "",
      ].filter(Boolean);
      Object.defineProperty(rows, SOURCE_WARNINGS, { value: warnings });
      return rows;
    }
    throw new Error(
      `${label} 조회 실패: ${errorMessage(openApiResult.reason)} / ${errorMessage(freesisResult.reason)} / ${errorMessage(indexergoResult.reason)}`,
    );
  }

  function fetchCreditRows(apiKey = "") {
    return mergeAvailableSources(
      apiKey ? () => fetchOpenApiCreditRows(apiKey) : null,
      fetchFreesisCreditRows,
      indexergoEnabled ? fetchIndexergoCreditRows : null,
      "신용 잔고",
    );
  }

  function fetchDepositRows(apiKey = "") {
    return mergeAvailableSources(
      apiKey ? () => fetchOpenApiDepositRows(apiKey) : null,
      fetchFreesisDepositRows,
      indexergoEnabled ? fetchIndexergoDepositRows : null,
      "고객예탁금",
    );
  }

  return Object.freeze({
    fetchCreditRows,
    fetchDepositRows,
  });
}

export async function fetchKofiaCreditAndDepositRows(client, apiKey = "") {
  const [creditResult, depositResult] = await Promise.allSettled([
    client.fetchCreditRows(apiKey),
    client.fetchDepositRows(apiKey),
  ]);
  const rows = mergeCreditRows(
    creditResult.status === "fulfilled" ? creditResult.value : [],
    depositResult.status === "fulfilled" ? depositResult.value : [],
  );
  if (!rows.length) {
    const errors = [creditResult, depositResult]
      .filter((result) => result.status === "rejected")
      .map((result) => errorMessage(result.reason));
    throw new Error(errors.join(" / ") || "KOFIA returned no usable rows");
  }
  return {
    rows,
    creditFailed: creditResult.status === "rejected",
    depositFailed: depositResult.status === "rejected",
    componentWarnings: [...new Set([
      ...(creditResult.status === "fulfilled" ? creditResult.value[SOURCE_WARNINGS] || [] : []),
      ...(depositResult.status === "fulfilled" ? depositResult.value[SOURCE_WARNINGS] || [] : []),
    ])],
  };
}

export function creditRefreshWindowDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).reduce((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});
  if (!new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]).has(parts.weekday)) return "";
  if (Number(parts.hour) * 60 + Number(parts.minute) < 9 * 60 + 31) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}
