const DISPLAY_NAMES = {
  leading_cycle: "\uC120\uD589\uC9C0\uC218 \uC21C\uD658\uBCC0\uB3D9\uCE58",
  kospi_credit: "\uCF54\uC2A4\uD53C \uC2E0\uC6A9",
  kosdaq_credit: "\uCF54\uC2A4\uB2E5 \uC2E0\uC6A9",
  "^KS11": "\uCF54\uC2A4\uD53C",
  "^KQ11": "\uCF54\uC2A4\uB2E5",
  adr_kospi: "ADR K",
  adr_kosdaq: "ADR KQ",
};

const ADR_SERIES = ["adr_kospi", "adr_kosdaq"];
const CORE_SERIES = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit"];
const BASE_SERIES_PRIORITY = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "adr_kospi", "adr_kosdaq"];
const SERIES_COLORS = {
  leading_cycle: "#999999",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#a78bfa",
  adr_kospi: "#facc15",
  adr_kosdaq: "#f472b6",
};
const CUSTOM_COLOR_PALETTE = [
  "#2dd4bf", "#fb923c", "#22d3ee", "#facc15", "#f472b6",
  "#84cc16", "#c084fc", "#38bdf8", "#f59e0b", "#10b981",
];
const MAX_CUSTOM_STOCKS = 10;
const KRX_LOOKBACK_DAYS = 14;
const KRX_BASE_INFO_ENDPOINTS = {
  KOSPI: "stk_isu_base_info",
  KOSDAQ: "ksq_isu_base_info",
};
const KRX_INDEX_ENDPOINTS = {
  KOSPI: "kospi_dd_trd",
  KOSDAQ: "kosdaq_dd_trd",
};

const STATE_KEY = "thinkstock-v5";
const API_SETTINGS_KEY = "thinkstock-api-v1";
const API_SETTINGS_SESSION_KEY = "thinkstock-api-session-v1";
const DATA_CACHE_DB_NAME = "thinkstock-runtime-cache-v1";
const DATA_CACHE_STORE_NAME = "snapshots";
const DATA_CACHE_RECORD_KEY = "latest";
const DATA_CACHE_LOCAL_KEY = "thinkstock-runtime-cache-v1";
const DATA_CACHE_SCHEMA_VERSION = 1;
const DATA_CACHE_MAX_AGE_DAYS = 7;
function getAppBuildVersion() {
  try {
    const script = document.currentScript
      || [...document.scripts].find((node) => String(node?.src || "").includes("/app.js"));
    const src = String(script?.src || "");
    return src ? (new URL(src, window.location.href).searchParams.get("v") || "dev") : "dev";
  } catch (_) {
    return "dev";
  }
}
const APP_BUILD_VERSION = getAppBuildVersion();
const API_SETTINGS_DEFAULT = Object.freeze({
  ecosApiKey: "",
  kofiaApiKey: "",
  kosisApiKey: "",
  krxApiKey: "",
  dartApiKey: "",
  dartProxyEnabled: false,
});
const ECOS_STAT_CODE = "901Y067";
const ECOS_ITEM_CODE = "I16E";
const ECOS_START = "199601";
const KOSIS_START = "199601";
const KOFIA_CREDIT_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo";
const FREESIS_CREDIT_META_URL = "https://freesis.kofia.or.kr/meta/getMetaDataList.do";
const FREESIS_CREDIT_OBJ_NM = "STATSCU0100000070BO";
const FREESIS_CREDIT_LOOKBACK_DAYS = 120;
const FREESIS_CREDIT_UNIT_CODE = "06";
const DART_DISCLOSURE_URL = "https://opendart.fss.or.kr/api/list.json";
const DART_RUNTIME_LOOKBACK_DAYS = 92;
const DART_STOCK_LOOKBACK_YEARS = 3;
const DART_RUNTIME_MAX_PAGES_PER_MARKET = 60;
const DART_RUNTIME_PAGE_BATCH = 6;
const DART_STOCK_PAGE_BATCH = 4;
const DART_VISIBLE_REFRESH_CONCURRENCY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
function appendCacheBust(url) {
  const stamp = `_=${Date.now()}`;
  return url.includes("?") ? `${url}&${stamp}` : `${url}?${stamp}`;
}
function requestServiceWorkerDataRefresh(timeoutMs = 1200) {
  return new Promise((resolve) => {
    try {
      const controller = navigator?.serviceWorker?.controller;
      if (!controller || typeof MessageChannel === "undefined") {
        resolve(false);
        return;
      }
      const channel = new MessageChannel();
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      channel.port1.onmessage = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      controller.postMessage("REFRESH_DATA", [channel.port2]);
    } catch (_) {
      resolve(false);
    }
  });
}

const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const POPUP_NUMBER_FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
const formatActualValue = (v) => (Number.isFinite(v) ? POPUP_NUMBER_FORMAT.format(v) : "N/A");
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const labelName = (key) => DISPLAY_NAMES[key] || key;
function customColorForTicker(key) {
  const idx = customStocks.findIndex((item) => item.ticker === key);
  if (idx < 0) return null;
  return CUSTOM_COLOR_PALETTE[idx % CUSTOM_COLOR_PALETTE.length];
}
const seriesColor = (key) => SERIES_COLORS[key] || customColorForTicker(key) || "#888";
const toUtcMs = (d) => Date.parse(`${d}T00:00:00Z`);
const isTouchDevice = () => typeof window !== "undefined"
  && (("ontouchstart" in window) || ((navigator && navigator.maxTouchPoints) > 0));
const PLOTLY_CONFIG = {
  responsive: true,
  displayModeBar: false,
  displaylogo: false,
  scrollZoom: true,
  doubleClick: false,
};
const LINE_DRAG_TOLERANCE_PX = 14;
const LINE_DRAG_TOUCH_TOLERANCE_PX = 24;
const LINE_HIGHLIGHT_EXTRA_WIDTH = 2;
const DISCLOSURE_TRACE_NAME = "공시";
const DISCLOSURE_MARKER_COLOR = "#fde047";
const DISCLOSURE_MARKER_LINE_COLOR = "rgba(10,10,10,0.96)";
const DISCLOSURE_MARKER_SIZE = 15;
const DISCLOSURE_MARKER_LINE_WIDTH = 2.25;
const DISCLOSURE_MARKER_HOVER_COLOR = "#111827";
const DISCLOSURE_MARKER_HOVER_LINE_COLOR = "#fef3c7";
const DISCLOSURE_MARKER_HOVER_SIZE = 22;
const DISCLOSURE_MARKER_HOVER_LINE_WIDTH = 3.5;
const DISCLOSURE_TEXT_SIZE = 16;
const DISCLOSURE_TEXT_HOVER_SIZE = 21;

let pricePayload = null;
let macroRows = [];
let creditRows = [];   // KOFIA credit balance seed data (credit_data.json)
let disclosureRows = [];
let dartCorpCodeMap = new Map();
let activeMonths = 120;
let hiddenSeries = new Set(["kospi_credit", "^KQ11", "kosdaq_credit"]);
let customStocks = [];
let krxUniverse = [];
let krxUniverseLoaded = false;
let krxUniverseLoading = false;
let stockSuggestItems = [];
let stockSuggestActiveIndex = -1;
let loadingCustomStocks = new Set();
let seriesOffsets = {};
let seriesScales = {};
let currentSelected = [];
let currentDisclosureHighlight = null;
let lastDisclosureTraceStats = { total: 0, candidates: 0, markers: 0 };
let baseTraceValues = {};
let legendHandlerSet = false;
let adrHandlerSet = false;
let dragRafId = null;
let cursorRafId = 0;
let pendingCursorState = null;
let hoverSyncRafId = 0;
let pendingHoverSync = null;
let lastHoverSyncKey = "";
let currentRows = [];
let currentStart = "";
let chartSyncing = false;   // relayout sync loop guard
let hoverShowPopup = false;
let showDisclosures = true;
let isHandleDragging = false;
let pinnedXRange = null;
let hoverSyncing = false;
let cursorSyncing = false;
let cursorMoveBound = false;
const CURSOR_LINE_CLASS = "synced-cursor-line";
let apiSettings = { ...API_SETTINGS_DEFAULT };
let lastTouchTapAt = 0;
let lastTouchTapX = null;
let lastTouchTapEl = null;
let dragZoomBound = false;
let touchDoubleTapZoomActive = false;
let touchDoubleTapPrevRange = null;
let suppressPlotlyClickUntil = 0;
let hoveredLineTraceIndex = null;
let activeLineTraceIndex = null;
let appliedLineHighlightTraceIndex = null;
let startupLoaderHideTimer = null;
let startupLoaderRafId = 0;
let startupLoaderDisplayProgress = 100;
let startupLoaderTargetProgress = 100;

/* localStorage persistence */
function sanitizeCustomStocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const ticker = String(item.ticker || "").trim().toUpperCase();
    const name = String(item.name || "").trim();
    const code = String(item.code || "").trim();
    const market = String(item.market || "").trim().toUpperCase();
    if (!ticker || !name) return;
    if (!/^[0-9]{6}\.(KS|KQ)$/.test(ticker)) return;
    if (seen.has(ticker)) return;
    seen.add(ticker);
    out.push({ ticker, name, code, market });
  });
  return out.slice(0, MAX_CUSTOM_STOCKS);
}

function applyCustomStockDisplayNames() {
  customStocks.forEach((item) => {
    if (item?.ticker && item?.name) DISPLAY_NAMES[item.ticker] = item.name;
  });
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      activeMonths,
      hiddenSeries: [...hiddenSeries],
      customStocks,
      seriesOffsets,
      seriesScales,
      creditOffset: -CREDIT_OFFSET_DAYS,
      hoverShowPopup,
      showDisclosures,
    }));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.activeMonths === "number") activeMonths = p.activeMonths;
    if (Array.isArray(p.hiddenSeries)) hiddenSeries = new Set(p.hiddenSeries);
    if (p.seriesOffsets && typeof p.seriesOffsets === "object") seriesOffsets = p.seriesOffsets;
    if (p.seriesScales && typeof p.seriesScales === "object") seriesScales = p.seriesScales;
    if (typeof p.creditOffset === "number") CREDIT_OFFSET_DAYS = Math.abs(p.creditOffset);
    if (typeof p.hoverShowPopup === "boolean") hoverShowPopup = p.hoverShowPopup;
    if (typeof p.showDisclosures === "boolean") showDisclosures = p.showDisclosures;
    if (Array.isArray(p.customStocks)) customStocks = sanitizeCustomStocks(p.customStocks);
    applyCustomStockDisplayNames();
  } catch (_) {}
}

function sanitizeApiSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  Object.keys(API_SETTINGS_DEFAULT).forEach((key) => {
    const value = src[key];
    if (typeof API_SETTINGS_DEFAULT[key] === "boolean") {
      out[key] = value === true;
    } else {
      out[key] = typeof value === "string" ? value.trim() : "";
    }
  });
  return out;
}

function saveApiSettings() {
  try {
    sessionStorage.setItem(API_SETTINGS_SESSION_KEY, JSON.stringify(sanitizeApiSettings(apiSettings)));
  } catch (_) {}
  try { localStorage.removeItem(API_SETTINGS_KEY); } catch (_) {}
}

function clearApiSettingsStorage() {
  try { sessionStorage.removeItem(API_SETTINGS_SESSION_KEY); } catch (_) {}
  try { localStorage.removeItem(API_SETTINGS_KEY); } catch (_) {}
}

function loadApiSettings() {
  try {
    const raw = sessionStorage.getItem(API_SETTINGS_SESSION_KEY);
    if (raw) {
      apiSettings = sanitizeApiSettings(JSON.parse(raw));
      try { localStorage.removeItem(API_SETTINGS_KEY); } catch (_) {}
      return;
    }
  } catch (_) {
    apiSettings = { ...API_SETTINGS_DEFAULT };
  }

  try {
    const legacyRaw = localStorage.getItem(API_SETTINGS_KEY);
    if (!legacyRaw) {
      apiSettings = { ...API_SETTINGS_DEFAULT };
      return;
    }
    apiSettings = sanitizeApiSettings(JSON.parse(legacyRaw));
    try {
      sessionStorage.setItem(API_SETTINGS_SESSION_KEY, JSON.stringify(apiSettings));
    } catch (_) {}
    localStorage.removeItem(API_SETTINGS_KEY);
  } catch (_) {
    apiSettings = { ...API_SETTINGS_DEFAULT };
  }
}

function copyDisplayNames(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    Object.entries(src)
      .filter(([key, value]) => key && typeof value === "string" && value.trim())
      .map(([key, value]) => [key, value.trim()]),
  );
}

function sanitizePricePayloadForSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const records = normalizePayloadRecords(raw.records);
  if (!records.length) return null;
  return {
    generated_at: typeof raw.generated_at === "string" ? raw.generated_at : "",
    records,
    series: Array.isArray(raw.series) ? raw.series.filter(Boolean) : getSeriesColumns(records),
    display_names: copyDisplayNames(raw.display_names),
  };
}

function classifyDisclosureType(title) {
  const text = String(title || "");
  if (/반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출/.test(text)) return "실적";
  if (/배당|현금ㆍ현물배당|현금.?현물배당/.test(text)) return "배당";
  if (/단일판매|공급계약|수주/.test(text)) return "수주";
  if (/유상증자|무상증자|감자|증권신고서\(지분증권\)/.test(text)) return "증자/감자";
  if (/전환사채|신주인수권|신주인수권부사채|교환사채|사채권/.test(text)) return "자금조달";
  if (/자기주식(취득|처분)결정|주식소각/.test(text)) return "자사주";
  if (/합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자/.test(text)) return "구조/투자";
  if (/최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/.test(text)) return "경영변동";
  return "공시";
}

function isImportantDisclosureTitle(title, type = "") {
  const text = String(title || "");
  const normalizedType = String(type || "");
  if (/^(실적|배당|수주|증자\/감자|자금조달|자사주|구조\/투자|경영변동)$/.test(normalizedType)) return true;
  return /반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/.test(text);
}

function isLowImpactDisclosureTitle(title) {
  const text = String(title || "");
  return /임원ㆍ주요주주특정증권등소유상황보고서|주식등의대량보유상황보고서|최대주주등소유주식변동신고서|기업설명회|IR\)|대규모기업집단현황공시|기업지배구조보고서|지속가능경영보고서|동일인등출자계열회사|특수관계인|지급수단별|주주총회소집공고|주주총회소집결의|주주총회집중일|정기주주총회결과|의결권대리행사|주주명부폐쇄|기준일설정|사외이사의선임|해임또는중도퇴임|자기주식취득결과보고서|자기주식처분결과보고서/.test(text);
}

function shouldDisplayDisclosure(title, type = "") {
  if (isImportantDisclosureTitle(title, type)) return true;
  if (isLowImpactDisclosureTitle(title)) return false;
  return false;
}

function explainDartFetchError(err) {
  const message = String(err?.message || err || "unknown error");
  if (/Failed to fetch|NetworkError|Load failed|CORS|fetch/i.test(message)) {
    if (!apiSettings?.dartProxyEnabled) {
      return "OpenDART가 브라우저 직접 호출(CORS)을 허용하지 않습니다. 추가 종목 공시를 바로 받으려면 API 설정에서 DART 공개 프록시 사용을 켜야 합니다.";
    }
    return "OpenDART 공시를 불러오지 못했습니다. 공개 프록시가 일시적으로 막혔거나 DART API 응답이 지연됐을 수 있습니다.";
  }
  return message;
}

function sanitizeDisclosureRows(records) {
  if (!Array.isArray(records)) return [];
  const out = [];
  const seen = new Set();
  records.forEach((record) => {
    if (!record || typeof record !== "object") return;
    const ticker = String(record.ticker || "").trim().toUpperCase();
    const code = String(record.code || ticker.split(".")[0] || "").trim();
    const date = String(record.date || "").slice(0, 10);
    const title = String(record.title || record.report_nm || "").trim();
    if (!/^[0-9]{6}\.(KS|KQ)$/.test(ticker)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return;
    const classifiedType = classifyDisclosureType(title);
    const rawType = String(record.type || "").trim();
    const type = (!rawType || rawType === "공시") ? classifiedType : rawType;
    if (!shouldDisplayDisclosure(title, type)) return;
    const url = String(record.url || "").trim();
    const key = `${ticker}|${date}|${title}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      ticker,
      code,
      name: String(record.name || record.corp_name || labelName(ticker)).trim() || labelName(ticker),
      date,
      type,
      title,
      summary: String(record.summary || "").trim(),
      url,
      source: String(record.source || "DART").trim(),
      receiptNo: String(record.receiptNo || record.rcept_no || "").trim(),
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}

function sanitizeDartCorpCodeRows(records) {
  if (!Array.isArray(records)) return [];
  const out = [];
  const seen = new Set();
  records.forEach((record) => {
    if (!record || typeof record !== "object") return;
    const stockCode = String(record.stock_code || record.stockCode || "").replace(/\D/g, "").slice(0, 6);
    const corpCode = String(record.corp_code || record.corpCode || "").replace(/\D/g, "");
    if (stockCode.length !== 6 || !corpCode || seen.has(stockCode)) return;
    seen.add(stockCode);
    out.push({
      stock_code: stockCode,
      corp_code: corpCode,
      corp_name: String(record.corp_name || record.corpName || "").trim(),
    });
  });
  return out;
}

function setDartCorpCodeRows(records) {
  dartCorpCodeMap = new Map();
  sanitizeDartCorpCodeRows(records).forEach((record) => {
    dartCorpCodeMap.set(record.stock_code, record);
  });
}

function buildRuntimeDataSnapshot() {
  const safePricePayload = sanitizePricePayloadForSnapshot(pricePayload);
  const safeMacroRows = normalizePayloadRecords(macroRows);
  const safeCreditRows = normalizeCreditRows(creditRows);
  const safeAdrRows = normalizePayloadRecords(adrRows);
  const safeDisclosureRows = sanitizeDisclosureRows(disclosureRows);

  if (!safePricePayload && !safeMacroRows.length && !safeCreditRows.length && !safeAdrRows.length && !safeDisclosureRows.length) return null;

  return {
    version: DATA_CACHE_SCHEMA_VERSION,
    app_version: APP_BUILD_VERSION,
    saved_at: new Date().toISOString(),
    pricePayload: safePricePayload,
    macroRows: safeMacroRows,
    creditRows: safeCreditRows,
    adrRows: safeAdrRows,
    disclosureRows: safeDisclosureRows,
  };
}

function isRuntimeSnapshotUsable(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.version !== DATA_CACHE_SCHEMA_VERSION) return false;
  const savedAtMs = Date.parse(String(snapshot.saved_at || ""));
  if (!Number.isFinite(savedAtMs)) return false;
  const now = Date.now();
  if (savedAtMs > now + DAY_MS) return false;
  if (now - savedAtMs > DATA_CACHE_MAX_AGE_DAYS * DAY_MS) return false;
  return true;
}

function applyRuntimeDataSnapshot(snapshot) {
  if (!isRuntimeSnapshotUsable(snapshot)) return false;

  const safePricePayload = sanitizePricePayloadForSnapshot(snapshot.pricePayload);
  const safeMacroRows = normalizePayloadRecords(snapshot.macroRows);
  const safeCreditRows = normalizeCreditRows(snapshot.creditRows);
  const safeAdrRows = normalizePayloadRecords(snapshot.adrRows);
  const safeDisclosureRows = sanitizeDisclosureRows(snapshot.disclosureRows);

  if (!safePricePayload && !safeMacroRows.length && !safeCreditRows.length && !safeAdrRows.length && !safeDisclosureRows.length) return false;

  if (safePricePayload) {
    pricePayload = safePricePayload;
    Object.assign(DISPLAY_NAMES, safePricePayload.display_names || {});
  }
  if (safeMacroRows.length) macroRows = safeMacroRows;
  if (safeCreditRows.length) creditRows = safeCreditRows;
  if (safeAdrRows.length) adrRows = safeAdrRows;
  if (safeDisclosureRows.length) disclosureRows = safeDisclosureRows;
  return true;
}

function hasRuntimeDataLoaded() {
  return Boolean(
    pricePayload?.records?.length
    || macroRows?.length
    || creditRows?.length
    || adrRows?.length
  );
}

function openRuntimeCacheDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const req = indexedDB.open(DATA_CACHE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DATA_CACHE_STORE_NAME)) {
        db.createObjectStore(DATA_CACHE_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function readRuntimeSnapshotFromIndexedDb() {
  let db = null;
  try {
    db = await openRuntimeCacheDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DATA_CACHE_STORE_NAME, "readonly");
      const store = tx.objectStore(DATA_CACHE_STORE_NAME);
      const req = store.get(DATA_CACHE_RECORD_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
    });
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

async function writeRuntimeSnapshotToIndexedDb(snapshot) {
  let db = null;
  try {
    db = await openRuntimeCacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DATA_CACHE_STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
      tx.objectStore(DATA_CACHE_STORE_NAME).put(snapshot, DATA_CACHE_RECORD_KEY);
    });
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

async function deleteRuntimeSnapshotFromIndexedDb() {
  let db = null;
  try {
    db = await openRuntimeCacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DATA_CACHE_STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB delete aborted"));
      tx.objectStore(DATA_CACHE_STORE_NAME).delete(DATA_CACHE_RECORD_KEY);
    });
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

function readRuntimeSnapshotFromLocalStorage() {
  try {
    const raw = localStorage.getItem(DATA_CACHE_LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeRuntimeSnapshotToLocalStorage(snapshot) {
  localStorage.setItem(DATA_CACHE_LOCAL_KEY, JSON.stringify(snapshot));
}

function deleteRuntimeSnapshotFromLocalStorage() {
  localStorage.removeItem(DATA_CACHE_LOCAL_KEY);
}

async function readLastRuntimeSnapshot() {
  try {
    const snapshot = await readRuntimeSnapshotFromIndexedDb();
    if (snapshot) return snapshot;
  } catch (_) {
    // Fall back to localStorage for browsers or modes that block IndexedDB.
  }
  return readRuntimeSnapshotFromLocalStorage();
}

async function clearLastRuntimeSnapshot() {
  try { await deleteRuntimeSnapshotFromIndexedDb(); } catch (_) {}
  try { deleteRuntimeSnapshotFromLocalStorage(); } catch (_) {}
}

async function saveLastRuntimeSnapshot() {
  const snapshot = buildRuntimeDataSnapshot();
  if (!snapshot) return false;

  try {
    await writeRuntimeSnapshotToIndexedDb(snapshot);
    return true;
  } catch (idbErr) {
    try {
      writeRuntimeSnapshotToLocalStorage(snapshot);
      return true;
    } catch (storageErr) {
      const message = storageErr?.message || idbErr?.message || "runtime cache write failed";
      throw new Error(message);
    }
  }
}

async function loadLastRuntimeSnapshot() {
  const snapshot = await readLastRuntimeSnapshot();
  const applied = applyRuntimeDataSnapshot(snapshot);
  if (!applied && snapshot) clearLastRuntimeSnapshot().catch(() => {});
  return applied;
}

let runtimeSnapshotExitSaveBound = false;
function bindRuntimeSnapshotExitSave() {
  if (runtimeSnapshotExitSaveBound || typeof window === "undefined") return;
  runtimeSnapshotExitSaveBound = true;
  const save = () => {
    saveLastRuntimeSnapshot().catch(() => {});
  };
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
}

function hasAnyApiKey() {
  return Object.entries(apiSettings || {}).some(([key, value]) => {
    if (typeof API_SETTINGS_DEFAULT[key] === "boolean") return value === true;
    return String(value || "").trim().length > 0;
  });
}

function syncApiOptionsButton() {
  const btn = document.getElementById("apiOptionsBtn");
  if (!btn) return;
  btn.classList.toggle("is-configured", hasAnyApiKey());
}

function renderAppVersionLabel() {
  const el = document.getElementById("appVersionText");
  if (el) el.textContent = APP_BUILD_VERSION;
}

function setMessage(msgEl, lines, isError = false) {
  if (!msgEl) return;
  const list = (Array.isArray(lines) ? lines : [lines])
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (!list.length) {
    msgEl.innerHTML = "";
    return;
  }
  const body = list.map((line) => escapeHtml(line)).join("<br>");
  msgEl.innerHTML = `<div class="message${isError ? " error" : ""}">${body}</div>`;
}

function syncDisclosureToggleButton(markerCount = null) {
  const btn = document.getElementById("disclosureToggle");
  if (!btn) return;
  const count = Number(markerCount);
  const hasCount = showDisclosures && Number.isFinite(count) && count > 0;
  btn.classList.toggle("is-active", showDisclosures);
  btn.textContent = showDisclosures ? `공시${hasCount ? ` ${count}` : ""}` : "공시 OFF";
  btn.title = showDisclosures
    ? `공시 마커 켜짐${hasCount ? ` - 현재 범위 ${count}개` : ""}`
    : "공시 마커 꺼짐";
}

function enableDisclosureMarkers() {
  showDisclosures = true;
  syncDisclosureToggleButton(lastDisclosureTraceStats.markers);
}

function latestDateForRows(rows, keys = []) {
  return dateSpanForRows(rows, keys).latest;
}

function dateSpanForRows(rows, keys = []) {
  if (!Array.isArray(rows)) return { first: "", latest: "" };
  const targetKeys = Array.isArray(keys) ? keys : [];
  let first = "";
  let latest = "";
  rows.forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    const hasValue = targetKeys.length
      ? targetKeys.some((key) => toNum(row?.[key]) !== null)
      : Object.entries(row).some(([key, value]) => key !== "date" && toNum(value) !== null);
    if (!hasValue) return;
    if (!first || date < first) first = date;
    if (!latest || date > latest) latest = date;
  });
  return { first, latest };
}

function daysSinceDate(dateText) {
  const time = toUtcMs(dateText);
  if (!Number.isFinite(time)) return null;
  const today = toUtcMs(new Date().toISOString().slice(0, 10));
  if (!Number.isFinite(today)) return null;
  return Math.floor((today - time) / DAY_MS);
}

function renderDataFreshness() {
  const el = document.getElementById("dataFreshness");
  if (!el) return;

  const priceKeys = Array.isArray(pricePayload?.series) ? pricePayload.series : [];
  const creditSourceRows = [...(macroRows || []), ...(creditRows || [])];
  const items = [
    { label: "가격", ...dateSpanForRows(pricePayload?.records || [], priceKeys), staleDays: 10 },
    { label: "선행", ...dateSpanForRows(macroRows, ["leading_cycle"]), staleDays: 75 },
    { label: "신용", ...dateSpanForRows(creditSourceRows, CREDIT_COLS), staleDays: 14 },
    { label: "ADR", ...dateSpanForRows(adrRows, ADR_SERIES), staleDays: 10 },
  ].map((item) => ({ ...item, date: item.latest }));

  el.innerHTML = items.map((item) => {
    const age = daysSinceDate(item.date);
    const isEmpty = !item.date;
    const isStale = Number.isFinite(age) && age > item.staleDays;
    const classes = [
      "freshness-chip",
      isEmpty ? "is-empty" : "",
      isStale ? "is-stale" : "",
    ].filter(Boolean).join(" ");
    const rangeTitle = item.first && item.latest ? `범위: ${item.first} ~ ${item.latest}` : "";
    const staleTitle = isStale ? `최신 데이터 확인 필요: ${age}일 전` : "";
    const title = [rangeTitle, staleTitle].filter(Boolean).join(" / ");
    return `<span class="${classes}" title="${escapeHtml(title)}"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.date || "없음")}</span>`;
  }).join("");
}

function ensureStartupLoader() {
  const titleEl = document.querySelector(".hero h1");
  if (!titleEl) return null;

  if (!titleEl.dataset.title) {
    const titleText = String(titleEl.textContent || "Think Stock").trim() || "Think Stock";
    titleEl.dataset.title = titleText;
  }

  return titleEl;
}

function renderStartupLoaderProgress(value) {
  const titleEl = ensureStartupLoader();
  if (!titleEl) return;

  const clamped = Math.max(0, Math.min(100, value));
  titleEl.style.setProperty("--title-load", `${clamped.toFixed(2)}%`);
  titleEl.setAttribute("aria-valuemin", "0");
  titleEl.setAttribute("aria-valuemax", "100");
  titleEl.setAttribute("aria-valuenow", String(Math.round(clamped)));
}

function runStartupLoaderTween() {
  const diff = startupLoaderTargetProgress - startupLoaderDisplayProgress;
  if (Math.abs(diff) < 0.28) {
    startupLoaderDisplayProgress = startupLoaderTargetProgress;
    renderStartupLoaderProgress(startupLoaderDisplayProgress);
    startupLoaderRafId = 0;
    return;
  }

  startupLoaderDisplayProgress += diff * 0.16;
  renderStartupLoaderProgress(startupLoaderDisplayProgress);
  startupLoaderRafId = requestAnimationFrame(runStartupLoaderTween);
}

function setStartupLoaderProgress(percent, _label = "") {
  const titleEl = ensureStartupLoader();
  if (!titleEl) return;

  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  startupLoaderTargetProgress = value;

  if (!startupLoaderRafId) {
    startupLoaderRafId = requestAnimationFrame(runStartupLoaderTween);
  }
}

function showStartupLoader() {
  if (startupLoaderHideTimer) {
    clearTimeout(startupLoaderHideTimer);
    startupLoaderHideTimer = null;
  }

  if (startupLoaderRafId) {
    cancelAnimationFrame(startupLoaderRafId);
    startupLoaderRafId = 0;
  }

  const titleEl = ensureStartupLoader();
  if (!titleEl) return;

  titleEl.classList.add("is-loading");
  startupLoaderDisplayProgress = 0;
  startupLoaderTargetProgress = 0;
  renderStartupLoaderProgress(0);
}

function hideStartupLoader() {
  const titleEl = ensureStartupLoader();
  if (!titleEl) return;

  setStartupLoaderProgress(100);
  if (startupLoaderHideTimer) clearTimeout(startupLoaderHideTimer);
  startupLoaderHideTimer = setTimeout(() => {
    titleEl.classList.remove("is-loading");
    startupLoaderHideTimer = null;
  }, 460);
}

function setupApiSettingsPanel(msgEl) {
  const modal = document.getElementById("apiSettingsModal");
  const openBtn = document.getElementById("apiOptionsBtn");
  if (!modal || !openBtn) return;

  const closeBtn = document.getElementById("apiSettingsCloseBtn");
  const saveBtn = document.getElementById("apiSettingsSaveBtn");
  const clearBtn = document.getElementById("apiSettingsClearBtn");
  const dataCacheClearBtn = document.getElementById("dataCacheClearBtn");
  const inputs = {
    ecosApiKey: document.getElementById("ecosApiInput"),
    kofiaApiKey: document.getElementById("kofiaApiInput"),
    kosisApiKey: document.getElementById("kosisApiInput"),
    krxApiKey: document.getElementById("krxApiInput"),
    dartApiKey: document.getElementById("dartApiInput"),
    dartProxyEnabled: document.getElementById("dartProxyEnabledInput"),
  };

  const fillInputs = () => {
    Object.entries(inputs).forEach(([key, el]) => {
      if (!el) return;
      if (el.type === "checkbox") {
        el.checked = Boolean(apiSettings[key]);
      } else {
        el.value = apiSettings[key] || "";
      }
    });
  };

  const readInputs = () => sanitizeApiSettings({
    ecosApiKey: inputs.ecosApiKey?.value || "",
    kofiaApiKey: inputs.kofiaApiKey?.value || "",
    kosisApiKey: inputs.kosisApiKey?.value || "",
    krxApiKey: inputs.krxApiKey?.value || "",
    dartApiKey: inputs.dartApiKey?.value || "",
    dartProxyEnabled: Boolean(inputs.dartProxyEnabled?.checked),
  });

  const close = () => { modal.hidden = true; };
  const open = () => {
    fillInputs();
    modal.hidden = false;
  };

  if (openBtn.dataset.bound === "1") {
    syncApiOptionsButton();
    return;
  }
  openBtn.dataset.bound = "1";

  openBtn.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  modal.querySelectorAll("[data-api-close='1']").forEach((node) => {
    node.addEventListener("click", close);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });

  saveBtn?.addEventListener("click", () => {
    const prevKrxKey = String(apiSettings?.krxApiKey || "").trim();
    const prevDartKey = String(apiSettings?.dartApiKey || "").trim();
    const prevDartProxyEnabled = Boolean(apiSettings?.dartProxyEnabled);
    apiSettings = readInputs();
    saveApiSettings();
    const nextKrxKey = String(apiSettings?.krxApiKey || "").trim();
    const nextDartKey = String(apiSettings?.dartApiKey || "").trim();
    const nextDartProxyEnabled = Boolean(apiSettings?.dartProxyEnabled);
    if (prevKrxKey !== nextKrxKey) {
      resetKrxUniverseCache();
      hideStockSuggestList();
    }
    syncApiOptionsButton();
    close();
    setMessage(msgEl, ["API keys saved for this browser tab."]);
    const dartSettingChanged = prevDartKey !== nextDartKey || prevDartProxyEnabled !== nextDartProxyEnabled;
    const shouldRefreshDart = Boolean(nextDartKey) && (dartSettingChanged || nextDartProxyEnabled);
    if (shouldRefreshDart) {
      const refreshCurrentTickers = nextDartProxyEnabled;
      enableDisclosureMarkers();
      saveState();
      setMessage(msgEl, [
        refreshCurrentTickers
          ? "DART 공개 프록시 설정이 저장됐습니다. 현재 차트 종목의 3년 공시를 다시 갱신하는 중입니다..."
          : "DART API 저장됨. 최근 공시를 불러오는 중입니다...",
      ]);
      const refreshTask = refreshCurrentTickers
        ? refreshDartDisclosuresForVisibleTickersFromApi(nextDartKey)
        : refreshDartDisclosuresFromApi(nextDartKey);
      refreshTask
        .then((info) => {
          renderChart(false);
          saveLastRuntimeSnapshot().catch(() => {});
          const lines = [`DART 공시 ${info.fetched}건 확인, ${info.added}건 반영${info.latestDate ? `(~ ${info.latestDate})` : ""}`];
          lines.push(
            lastDisclosureTraceStats.markers > 0
              ? `현재 차트에 공시 마커 ${lastDisclosureTraceStats.markers}개 표시됨`
              : "공시 데이터는 확인했지만 현재 차트 범위/종목에는 표시할 마커가 없습니다. 기간을 넓히거나 종목선이 켜져 있는지 확인해 주세요.",
          );
          if (Array.isArray(info.failed) && info.failed.length) {
            lines.push(`일부 종목 실패: ${info.failed.slice(0, 2).join(" / ")}`);
          }
          setMessage(msgEl, lines, Array.isArray(info.failed) && info.failed.length > 0);
        })
        .catch((err) => {
          setMessage(msgEl, `DART 공시 불러오기 오류: ${err.message}`, true);
        });
    }
  });

  clearBtn?.addEventListener("click", () => {
    const hadKrxKey = String(apiSettings?.krxApiKey || "").trim().length > 0;
    apiSettings = { ...API_SETTINGS_DEFAULT };
    clearApiSettingsStorage();
    if (hadKrxKey) {
      resetKrxUniverseCache();
      hideStockSuggestList();
    }
    fillInputs();
    syncApiOptionsButton();
    setMessage(msgEl, ["Saved API keys were cleared."]);
  });

  dataCacheClearBtn?.addEventListener("click", async () => {
    try {
      await clearLastRuntimeSnapshot();
      close();
      setMessage(msgEl, ["Last chart screen cache was cleared."]);
    } catch (err) {
      setMessage(msgEl, `Last chart screen cache could not be cleared: ${err.message}`, true);
    }
  });

  syncApiOptionsButton();
}
function shiftMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() - months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function shiftDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}


function toMsSafe(v) {
  if (v == null) return null;
  const n = Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
}

function findNearestHoverPoint(el, xValue) {
  if (!el?.data?.length) return null;
  const targetMs = toMsSafe(xValue);
  if (targetMs === null) return null;

  const nearestInTrace = (trace) => {
    if (!trace || trace.visible === "legendonly" || trace.hoverinfo === "skip" || !Array.isArray(trace.x) || !trace.x.length) return null;
    const xs = trace.x;
    const toMsAt = (i) => toMsSafe(xs[i]);

    let lo = 0;
    let hi = xs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const ms = toMsAt(mid);
      if (ms === null) return null;
      if (ms < targetMs) lo = mid + 1;
      else hi = mid - 1;
    }

    const cand = [];
    if (lo >= 0 && lo < xs.length) cand.push(lo);
    if (lo - 1 >= 0 && lo - 1 < xs.length) cand.push(lo - 1);
    if (!cand.length) return null;

    let bestIdx = cand[0];
    let bestDiff = Math.abs(toMsAt(bestIdx) - targetMs);
    for (let i = 1; i < cand.length; i += 1) {
      const idx = cand[i];
      const diff = Math.abs(toMsAt(idx) - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = idx;
      }
    }
    return { pointNumber: bestIdx, diff: bestDiff };
  };

  let best = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  el.data.forEach((trace, curveNumber) => {
    const near = nearestInTrace(trace);
    if (!near) return;
    if (near.diff < bestDiff) {
      bestDiff = near.diff;
      best = { curveNumber, pointNumber: near.pointNumber };
    }
  });
  return best;
}

function syncHoverToChartNow(targetEl, xValue) {
  if (!targetEl || !window.Plotly?.Fx?.hover || xValue == null) return;
  hoverSyncing = true;
  try {
    // Prefer exact x-date synchronization first.
    Plotly.Fx.hover(targetEl, [{ xval: xValue }], ["xy"]);
  } catch (_) {
    const pt = findNearestHoverPoint(targetEl, xValue);
    if (!pt) {
      requestAnimationFrame(() => { hoverSyncing = false; });
      return;
    }
    try {
      Plotly.Fx.hover(targetEl, [pt], ["xy"]);
    } catch (_) {
      // no-op
    }
  }
  requestAnimationFrame(() => { hoverSyncing = false; });
}

function syncHoverToChart(targetEl, xValue) {
  if (!targetEl || xValue == null) return;
  const key = `${targetEl.id || "chart"}|${String(xValue)}`;
  pendingHoverSync = { targetEl, xValue, key };
  if (hoverSyncRafId) return;
  hoverSyncRafId = requestAnimationFrame(() => {
    const pending = pendingHoverSync;
    pendingHoverSync = null;
    hoverSyncRafId = 0;
    if (!pending || pending.key === lastHoverSyncKey) return;
    lastHoverSyncKey = pending.key;
    syncHoverToChartNow(pending.targetEl, pending.xValue);
  });
}

function clearHoverOnChart(targetEl) {
  if (!targetEl || !window.Plotly?.Fx?.unhover) return;
  if (hoverSyncRafId) {
    cancelAnimationFrame(hoverSyncRafId);
    hoverSyncRafId = 0;
  }
  pendingHoverSync = null;
  lastHoverSyncKey = "";
  hoverSyncing = true;
  try {
    Plotly.Fx.unhover(targetEl);
  } catch (_) {
    // no-op
  }
  requestAnimationFrame(() => { hoverSyncing = false; });
}

function ensureCursorLine(el) {
  if (!el) return null;
  let line = el.querySelector(`.${CURSOR_LINE_CLASS}`);
  if (!line) {
    line = document.createElement("div");
    line.className = CURSOR_LINE_CLASS;
    el.appendChild(line);
  }
  return line;
}

function hideCursorLine(el) {
  const line = ensureCursorLine(el);
  if (!line) return;
  line.style.opacity = "0";
}

function toLocalXFromValue(el, xValue) {
  const xa = el?._fullLayout?.xaxis;
  if (!xa) return null;
  let plotX = null;
  try {
    if (typeof xa.d2p === "function") plotX = xa.d2p(xValue);
    else if (typeof xa.r2p === "function") plotX = xa.r2p(xValue);
  } catch (_) {
    plotX = null;
  }
  if (!Number.isFinite(plotX)) return null;
  const localX = xa._offset + plotX;
  if (!Number.isFinite(localX)) return null;
  return localX;
}

function showCursorLine(el, localX) {
  const line = ensureCursorLine(el);
  const xa = el?._fullLayout?.xaxis;
  if (!line || !xa || !Number.isFinite(localX)) return hideCursorLine(el);
  const minX = xa._offset;
  const maxX = xa._offset + xa._length;
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || localX < minX || localX > maxX) return hideCursorLine(el);
  line.style.opacity = "1";
  line.style.transform = `translateX(${localX.toFixed(2)}px)`;
}

function applySyncedCursor(xValue, sourceEl, sourceClientX) {
  const mainEl = document.getElementById("chart");
  const adrEl = document.getElementById("chart-adr");
  const targets = [mainEl, adrEl].filter(Boolean);
  if (!targets.length) return;
  if (xValue == null) {
    targets.forEach((el) => hideCursorLine(el));
    return;
  }
  targets.forEach((el) => {
    if (!el?._fullLayout?.xaxis) {
      hideCursorLine(el);
      return;
    }
    if (el === sourceEl && Number.isFinite(sourceClientX)) {
      const rect = el.getBoundingClientRect();
      showCursorLine(el, sourceClientX - rect.left);
      return;
    }
    showCursorLine(el, toLocalXFromValue(el, xValue));
  });
}

function scheduleSyncedCursor(xValue, sourceEl, sourceClientX) {
  pendingCursorState = { xValue, sourceEl, sourceClientX };
  if (cursorRafId) return;
  cursorRafId = requestAnimationFrame(() => {
    const pending = pendingCursorState;
    pendingCursorState = null;
    cursorRafId = 0;
    if (!pending) return;
    applySyncedCursor(pending.xValue, pending.sourceEl, pending.sourceClientX);
  });
}

function axisPixelToXValue(el, clientX, clampToAxis = false) {
  const xa = el?._fullLayout?.xaxis;
  if (!xa || !Number.isFinite(clientX)) return null;
  const rect = el.getBoundingClientRect();
  const localX = clientX - rect.left;
  let px = localX - xa._offset;
  if (!Number.isFinite(px)) return null;
  if (px < 0 || px > xa._length) {
    if (!clampToAxis) return null;
    px = Math.max(0, Math.min(xa._length, px));
  }

  try {
    if (typeof xa.p2d === "function") {
      const d = xa.p2d(px);
      if (d != null) return d;
    }
  } catch (_) {
    // no-op
  }

  let linear = null;
  try {
    if (typeof xa.p2l === "function") linear = xa.p2l(px);
    else if (typeof xa.p2c === "function") linear = xa.p2c(px);
  } catch (_) {
    linear = null;
  }
  if (!Number.isFinite(linear)) return null;
  if (xa.type === "date") return linear;
  return linear;
}

function clearTouchDoubleTapZoomState() {
  touchDoubleTapZoomActive = false;
  touchDoubleTapPrevRange = null;
}
function getCurrentXRangeMs(sourceEl) {
  const el = sourceEl || document.getElementById("chart");
  const range = el?._fullLayout?.xaxis?.range;
  if (!Array.isArray(range) || range.length < 2) return null;
  const r0 = toMsSafe(range[0]);
  const r1 = toMsSafe(range[1]);
  if (!Number.isFinite(r0) || !Number.isFinite(r1) || r1 <= r0) return null;
  return [r0, r1];
}

function applySyncedXRangeMs(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

  const mainEl = document.getElementById("chart");
  const adrEl = document.getElementById("chart-adr");
  const r0 = new Date(startMs).toISOString();
  const r1 = new Date(endMs).toISOString();

  pinnedXRange = [r0, r1];
  chartSyncing = true;

  const tasks = [];
  if (mainEl?.data) {
    tasks.push(Plotly.relayout(mainEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }));
  }
  if (adrEl?.data) {
    tasks.push(Plotly.relayout(adrEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }));
  }

  Promise.allSettled(tasks).finally(() => {
    chartSyncing = false;
  });
}

function zoomAroundClientX(sourceEl, clientX, zoomFactor = 0.5) {
  const xValue = axisPixelToXValue(sourceEl, clientX, true);
  const centerMs = toMsSafe(xValue);
  if (!Number.isFinite(centerMs)) return false;

  const range = getCurrentXRangeMs(sourceEl);
  if (!range) return false;

  const [curStart, curEnd] = range;
  const span = curEnd - curStart;
  if (!Number.isFinite(span) || span <= 0) return false;

  const targetSpan = Math.max(span * zoomFactor, DAY_MS * 7);
  let startMs = centerMs - targetSpan / 2;
  let endMs = centerMs + targetSpan / 2;

  if (startMs < curStart) {
    endMs += (curStart - startMs);
    startMs = curStart;
  }
  if (endMs > curEnd) {
    startMs -= (endMs - curEnd);
    endMs = curEnd;
  }

  if (startMs < curStart) startMs = curStart;
  if (endMs > curEnd) endMs = curEnd;
  if (endMs <= startMs) return false;

  applySyncedXRangeMs(startMs, endMs);
  return true;
}

function ensureDragZoomOverlay(el) {
  if (!el) return null;
  let overlay = el.querySelector('.drag-zoom-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'drag-zoom-overlay';
    const box = document.createElement('div');
    box.className = 'drag-zoom-box';
    overlay.appendChild(box);
    el.appendChild(overlay);
  }
  const box = overlay.querySelector('.drag-zoom-box');
  return { overlay, box };
}

function hideDragZoomOverlay(el) {
  const ui = ensureDragZoomOverlay(el);
  if (!ui) return;
  ui.overlay.style.display = 'none';
  ui.box.style.width = '0px';
}

function renderDragZoomOverlay(el, startClientX, currentClientX) {
  const xa = el?._fullLayout?.xaxis;
  if (!xa || !Number.isFinite(startClientX) || !Number.isFinite(currentClientX)) return;

  const rect = el.getBoundingClientRect();
  const minClient = rect.left + xa._offset;
  const maxClient = minClient + xa._length;

  const sx = Math.max(minClient, Math.min(maxClient, startClientX));
  const cx = Math.max(minClient, Math.min(maxClient, currentClientX));

  const left = Math.min(sx, cx) - rect.left;
  const width = Math.max(1, Math.abs(cx - sx));

  const ui = ensureDragZoomOverlay(el);
  if (!ui) return;
  ui.overlay.style.display = 'block';
  ui.box.style.left = `${left}px`;
  ui.box.style.width = `${width}px`;
}

function yValueToLocalPixel(el, value) {
  const ya = el?._fullLayout?.yaxis;
  const range = ya?.range;
  if (!ya || !Array.isArray(range) || range.length < 2 || !Number.isFinite(value)) return null;
  const [minY, maxY] = range;
  const span = maxY - minY;
  if (!Number.isFinite(span) || span === 0) return null;
  const frac = (value - minY) / span;
  return ya._offset + ya._length * (1 - frac);
}

function interpolateTraceYAtMs(trace, targetMs) {
  if (!trace || !Array.isArray(trace.x) || !Array.isArray(trace.y) || !Number.isFinite(targetMs)) return null;

  const xs = trace.x;
  const ys = trace.y;
  let lo = 0;
  let hi = xs.length - 1;
  let rightIndex = xs.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const time = toMsSafe(xs[mid]);
    if (!Number.isFinite(time) || time < targetMs) {
      lo = mid + 1;
    } else {
      rightIndex = mid;
      hi = mid - 1;
    }
  }

  let left = null;
  for (let i = Math.min(rightIndex, xs.length - 1); i >= 0; i -= 1) {
    const y = toNum(ys[i]);
    if (y === null) continue;
    const time = toMsSafe(xs[i]);
    if (!Number.isFinite(time) || time > targetMs) continue;
    if (time === targetMs) return y;
    left = { time, y };
    break;
  }

  let right = null;
  for (let i = Math.max(0, rightIndex); i < xs.length; i += 1) {
    const y = toNum(ys[i]);
    if (y === null) continue;
    const time = toMsSafe(xs[i]);
    if (!Number.isFinite(time) || time < targetMs) continue;
    if (time === targetMs) return y;
    right = { time, y };
    break;
  }

  if (!left || !right) return null;
  const span = right.time - left.time;
  if (!Number.isFinite(span) || span <= 0) return null;
  const t = (targetMs - left.time) / span;
  return left.y + (right.y - left.y) * t;
}

function findNearestLineDragTarget(el, clientX, clientY, isTouch = false) {
  const mainEl = document.getElementById("chart");
  if (!el || el !== mainEl || !el._fullLayout || !Array.isArray(el.data)) return null;

  const xa = el._fullLayout.xaxis;
  const ya = el._fullLayout.yaxis;
  if (!xa || !ya) return null;

  const rect = el.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const minX = xa._offset;
  const maxX = xa._offset + xa._length;
  const minY = ya._offset;
  const maxY = ya._offset + ya._length;
  if (localX < minX || localX > maxX || localY < minY || localY > maxY) return null;

  const xValue = axisPixelToXValue(el, clientX);
  const targetMs = toMsSafe(xValue);
  if (!Number.isFinite(targetMs)) return null;

  const tolerance = isTouch ? LINE_DRAG_TOUCH_TOLERANCE_PX : LINE_DRAG_TOLERANCE_PX;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  el.data.forEach((trace, traceIndex) => {
    if (!trace || trace.visible === "legendonly") return;
    const seriesKey = currentSelected[traceIndex];
    if (!seriesKey) return;
    const y = interpolateTraceYAtMs(trace, targetMs);
    const pixelY = yValueToLocalPixel(el, y);
    if (!Number.isFinite(pixelY)) return;
    const distance = Math.abs(pixelY - localY);
    if (distance <= tolerance && distance < bestDistance) {
      bestDistance = distance;
      best = { traceIndex, seriesKey };
    }
  });

  return best;
}

function getTraceBaseLineWidth(trace) {
  const metaWidth = toNum(trace?.meta?.baseLineWidth);
  if (metaWidth !== null) return metaWidth;
  const lineWidth = toNum(trace?.line?.width);
  return lineWidth !== null ? lineWidth : 2;
}

function setTraceLineHighlighted(el, traceIndex, highlighted) {
  if (!el?.data || traceIndex == null || traceIndex < 0 || traceIndex >= el.data.length) return;
  const trace = el.data[traceIndex];
  if (!trace || trace.visible === "legendonly") return;
  const baseWidth = getTraceBaseLineWidth(trace);
  const nextWidth = highlighted ? baseWidth + LINE_HIGHLIGHT_EXTRA_WIDTH : baseWidth;
  Plotly.restyle(el, { "line.width": [nextWidth] }, [traceIndex]);
}

function refreshLineHighlight() {
  const el = document.getElementById("chart");
  if (!el?.data) return;

  const nextIndex = activeLineTraceIndex ?? hoveredLineTraceIndex;
  if (appliedLineHighlightTraceIndex === nextIndex) return;

  const prevIndex = appliedLineHighlightTraceIndex;
  appliedLineHighlightTraceIndex = nextIndex;

  if (prevIndex != null && prevIndex !== nextIndex) {
    setTraceLineHighlighted(el, prevIndex, false);
  }
  if (nextIndex != null) {
    setTraceLineHighlighted(el, nextIndex, true);
  }

  el.classList.toggle("is-line-hovering", nextIndex != null);
}

function setHoveredLineTarget(target) {
  const nextIndex = target?.traceIndex ?? null;
  if (hoveredLineTraceIndex === nextIndex) return;
  hoveredLineTraceIndex = nextIndex;
  refreshLineHighlight();
}

function setActiveLineTarget(target) {
  const nextIndex = target?.traceIndex ?? null;
  if (activeLineTraceIndex === nextIndex) return;
  activeLineTraceIndex = nextIndex;
  refreshLineHighlight();
}

function beginLineOffsetDrag(el, target, startClientY) {
  const ya = el?._fullLayout?.yaxis;
  const range = ya?.range;
  if (!target || !ya || !Array.isArray(range) || range.length < 2 || !ya._length) return false;

  const startOffset = seriesOffsets[target.seriesKey] || 0;
  const lockedXRange = getCurrentMainXRange();
  let moved = false;

  suppressPlotlyClickUntil = Date.now() + 500;
  isHandleDragging = true;
  setActiveLineTarget(target);
  el.classList.add("is-line-dragging");
  hideDragZoomOverlay(el);
  lockCurrentYAxisRange();

  function onMove(clientY) {
    const dy = clientY - startClientY;
    if (Math.abs(dy) >= 3) moved = true;
    const dataDelta = -dy * (range[1] - range[0]) / ya._length;
    seriesOffsets[target.seriesKey] = startOffset + dataDelta;
    restyleLive(target.traceIndex, target.seriesKey);
  }

  function onEnd(clientY) {
    el.classList.remove("is-line-dragging");
    isHandleDragging = false;
    setActiveLineTarget(null);
    if (lockedXRange) pinnedXRange = [...lockedXRange];
    if (!moved || Math.abs(clientY - startClientY) < 3) {
      seriesOffsets[target.seriesKey] = startOffset;
    }
    saveState();
    renderChart();
  }

  addDragListeners(startClientY, onMove, onEnd);
  return true;
}

function bindCursorMoveSync() {
  const mainEl = document.getElementById("chart");
  const adrEl = document.getElementById("chart-adr");
  if (!mainEl || !adrEl) return;
  ensureCursorLine(mainEl);
  ensureCursorLine(adrEl);
  ensureDragZoomOverlay(mainEl);
  ensureDragZoomOverlay(adrEl);

  if (!cursorMoveBound) {
    let pointerMoveRafId = 0;
    let pendingPointerMove = null;

    const moveAt = (sourceEl, clientX) => {
      const xValue = axisPixelToXValue(sourceEl, clientX);
      if (xValue == null) {
        scheduleSyncedCursor(null);
        return;
      }
      scheduleSyncedCursor(xValue, sourceEl, clientX);
    };

    const processPointerMove = (sourceEl, clientX, clientY, findLineTarget) => {
      if (findLineTarget) {
        const lineTarget = findNearestLineDragTarget(sourceEl, clientX, clientY, false);
        setHoveredLineTarget(lineTarget);
      }
      moveAt(sourceEl, clientX);
    };

    const schedulePointerMove = (sourceEl, clientX, clientY, findLineTarget) => {
      pendingPointerMove = { sourceEl, clientX, clientY, findLineTarget };
      if (pointerMoveRafId) return;
      pointerMoveRafId = requestAnimationFrame(() => {
        const pending = pendingPointerMove;
        pendingPointerMove = null;
        pointerMoveRafId = 0;
        if (!pending) return;
        processPointerMove(pending.sourceEl, pending.clientX, pending.clientY, pending.findLineTarget);
      });
    };

    const onMove = (event) => {
      schedulePointerMove(event.currentTarget, event.clientX, event.clientY, true);
    };

    const onLeave = () => {
      if (pointerMoveRafId) {
        cancelAnimationFrame(pointerMoveRafId);
        pointerMoveRafId = 0;
      }
      pendingPointerMove = null;
      setHoveredLineTarget(null);
      scheduleSyncedCursor(null);
      clearHoverOnChart(mainEl);
      clearHoverOnChart(adrEl);
    };

    const onTouchStart = (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      event.preventDefault();
      const touch = event.touches[0];
      const lineTarget = findNearestLineDragTarget(event.currentTarget, touch.clientX, touch.clientY, true);
      if (lineTarget && beginLineOffsetDrag(event.currentTarget, lineTarget, touch.clientY)) {
        setHoveredLineTarget(lineTarget);
        lastTouchTapAt = 0;
        lastTouchTapX = null;
        lastTouchTapEl = null;
        clearTouchDoubleTapZoomState();
        return;
      }
      setHoveredLineTarget(null);
      moveAt(event.currentTarget, touch.clientX);

      const now = Date.now();
      const sameTarget = lastTouchTapEl === event.currentTarget;
      const nearX = Number.isFinite(lastTouchTapX) ? Math.abs(lastTouchTapX - touch.clientX) <= 28 : false;
      const isDoubleTap = sameTarget && nearX && (now - lastTouchTapAt) <= 320;

      if (isDoubleTap) {
        if (touchDoubleTapZoomActive
          && Array.isArray(touchDoubleTapPrevRange)
          && touchDoubleTapPrevRange.length === 2) {
          applySyncedXRangeMs(touchDoubleTapPrevRange[0], touchDoubleTapPrevRange[1]);
          clearTouchDoubleTapZoomState();
        } else {
          const currentRange = getCurrentXRangeMs(event.currentTarget);
          if (Array.isArray(currentRange) && currentRange.length === 2) {
            touchDoubleTapPrevRange = [currentRange[0], currentRange[1]];
            const zoomed = zoomAroundClientX(event.currentTarget, touch.clientX, 0.5);
            if (zoomed) touchDoubleTapZoomActive = true;
          }
        }
        lastTouchTapAt = 0;
        lastTouchTapX = null;
        lastTouchTapEl = null;
        return;
      }
      lastTouchTapAt = now;
      lastTouchTapX = touch.clientX;
      lastTouchTapEl = event.currentTarget;
    };

    const onTouchMove = (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      event.preventDefault();
      const touch = event.touches[0];
      schedulePointerMove(event.currentTarget, touch.clientX, touch.clientY, false);
    };

    const onTouchEnd = (event) => {
      if (event.touches && event.touches.length > 0) return;
      setHoveredLineTarget(null);
      onLeave();
    };

    mainEl.addEventListener("mousemove", onMove, { passive: true });
    adrEl.addEventListener("mousemove", onMove, { passive: true });
    mainEl.addEventListener("mouseleave", onLeave);
    adrEl.addEventListener("mouseleave", onLeave);

    mainEl.addEventListener("touchstart", onTouchStart, { passive: false });
    adrEl.addEventListener("touchstart", onTouchStart, { passive: false });
    mainEl.addEventListener("touchmove", onTouchMove, { passive: false });
    adrEl.addEventListener("touchmove", onTouchMove, { passive: false });
    mainEl.addEventListener("touchend", onTouchEnd);
    adrEl.addEventListener("touchend", onTouchEnd);
    mainEl.addEventListener("touchcancel", onTouchEnd);
    adrEl.addEventListener("touchcancel", onTouchEnd);

    cursorMoveBound = true;
  }

  if (!dragZoomBound) {
    let dragState = null;

    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      if (event.target?.closest('.y-handle')) return;

      const sourceEl = event.currentTarget;
      const xa = sourceEl?._fullLayout?.xaxis;
      if (!xa) return;

      const lineTarget = findNearestLineDragTarget(sourceEl, event.clientX, event.clientY, false);
      if (lineTarget && beginLineOffsetDrag(sourceEl, lineTarget, event.clientY)) {
        event.preventDefault();
        event.stopPropagation();
        clearTouchDoubleTapZoomState();
        return;
      }

      if (isTouchDevice()) return;

      dragState = {
        sourceEl,
        startClientX: event.clientX,
        moved: false,
      };

      renderDragZoomOverlay(sourceEl, dragState.startClientX, dragState.startClientX);
      event.preventDefault();

      const onWindowMove = (moveEvent) => {
        if (!dragState) return;
        const delta = Math.abs(moveEvent.clientX - dragState.startClientX);
        if (delta >= 3) dragState.moved = true;
        renderDragZoomOverlay(dragState.sourceEl, dragState.startClientX, moveEvent.clientX);
        const xValue = axisPixelToXValue(dragState.sourceEl, moveEvent.clientX, true);
        if (xValue != null) scheduleSyncedCursor(xValue, dragState.sourceEl, moveEvent.clientX);
      };

      const onWindowUp = (upEvent) => {
        const st = dragState;
        dragState = null;

        window.removeEventListener('mousemove', onWindowMove);
        window.removeEventListener('mouseup', onWindowUp);

        if (!st) return;
        hideDragZoomOverlay(st.sourceEl);

        if (!st.moved) return;

        const xStart = axisPixelToXValue(st.sourceEl, st.startClientX, true);
        const xEnd = axisPixelToXValue(st.sourceEl, upEvent.clientX, true);
        const ms0 = toMsSafe(xStart);
        const ms1 = toMsSafe(xEnd);
        if (!Number.isFinite(ms0) || !Number.isFinite(ms1)) return;

        const startMs = Math.min(ms0, ms1);
        const endMs = Math.max(ms0, ms1);
        if ((endMs - startMs) < DAY_MS) return;

        applySyncedXRangeMs(startMs, endMs);
        clearTouchDoubleTapZoomState();
      };

      window.addEventListener('mousemove', onWindowMove);
      window.addEventListener('mouseup', onWindowUp);
    };

    mainEl.addEventListener('mousedown', onMouseDown);
    adrEl.addEventListener('mousedown', onMouseDown);
    dragZoomBound = true;
  }
}
function parseCsv(text) {
  const result = Papa.parse(text.trim(), {
    header: true, dynamicTyping: true, skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (result.errors.length) throw new Error(result.errors[0].message);
  if (!result.meta.fields.includes("date")) throw new Error("CSV에 date 컬럼이 있어야 합니다.");
  return result.data.map((row) => {
    const out = { date: String(row.date).slice(0, 10) };
    Object.entries(row).forEach(([k, v]) => {
      if (k === "date" || v === "") return;
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : v;
    });
    return out;
  }).sort((a, b) => a.date.localeCompare(b.date));
}


function normalizePayloadRecords(records) {
  const list = Array.isArray(records) ? records : [];
  return list.map((row) => {
    const out = { date: String(row.date || "").slice(0, 10) };
    Object.entries(row).forEach(([k, v]) => {
      if (k === "date") return;
      out[k] = toNum(v);
    });
    return out;
  })
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseMacroPayload(text) {
  const payload = JSON.parse(text.replace(/\bNaN\b/g, "null"));
  return normalizePayloadRecords(payload?.records);
}

function getSeriesColumns(rows) {
  const cols = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== "date") cols.add(k); }));
  return [...cols];
}

function mergeRowsPreservingExisting(existingRows, incomingRows) {
  const byDate = new Map();
  normalizePayloadRecords(existingRows).forEach((row) => {
    byDate.set(row.date, { ...row });
  });

  normalizePayloadRecords(incomingRows).forEach((row) => {
    const prev = byDate.get(row.date);
    if (!prev) {
      byDate.set(row.date, { ...row });
      return;
    }

    const merged = { ...prev };
    Object.entries(row).forEach(([key, value]) => {
      if (key === "date") return;
      if (toNum(merged[key]) === null && toNum(value) !== null) {
        merged[key] = toNum(value);
      }
    });
    byDate.set(row.date, merged);
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergePricePayloadPreservingExisting(existingPayload, incomingPayload) {
  const existing = sanitizePricePayloadForSnapshot(existingPayload);
  const incoming = sanitizePricePayloadForSnapshot(incomingPayload);
  if (!existing) return incoming;
  if (!incoming) return existing;

  const records = mergeRowsPreservingExisting(existing.records, incoming.records);
  return {
    ...incoming,
    records,
    series: [...new Set([...(incoming.series || []), ...(existing.series || []), ...getSeriesColumns(records)])],
    display_names: {
      ...(incoming.display_names || {}),
      ...(existing.display_names || {}),
    },
  };
}

function getSeriesPriorityOrder() {
  const customOrder = customStocks.map((item) => item.ticker);
  return [
    ...CORE_SERIES,
    ...customOrder,
    ...ADR_SERIES,
  ];
}

function sortSeries(list) {
  const priorityOrder = getSeriesPriorityOrder();
  const pri = new Map(priorityOrder.map((name, idx) => [name, idx]));
  return [...list].sort((a, b) => {
    const ar = pri.has(a) ? pri.get(a) : priorityOrder.length + 1;
    const br = pri.has(b) ? pri.get(b) : priorityOrder.length + 1;
    return ar !== br ? ar - br : labelName(a).localeCompare(labelName(b), "ko");
  });
}

/* Dense macro interpolation (for daily data) */

function syncSeriesToggleBoard(allSeries) {
  const available = new Set(allSeries || []);
  document.querySelectorAll(".series-toggle-btn").forEach((btn) => {
    const key = btn.dataset.series;
    btn.style.setProperty("--series-color", seriesColor(key));
    const isAvailable = available.has(key);
    const isVisible = isAvailable && !hiddenSeries.has(key);
    btn.disabled = !isAvailable;
    btn.classList.toggle("is-disabled", !isAvailable);
    btn.classList.toggle("is-on", isVisible);
    btn.classList.toggle("is-off", isAvailable && !isVisible);
  });
}

function bindSeriesToggleBoard() {
  document.querySelectorAll(".series-toggle-btn").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const key = btn.dataset.series;
      if (!key || btn.disabled) return;
      if (hiddenSeries.has(key)) hiddenSeries.delete(key);
      else hiddenSeries.add(key);
      saveState();
      renderChart();
    });
  });
}

function renderCustomStockButtons() {
  const container = document.getElementById("customStockButtons");
  if (!container) return;
  container.innerHTML = customStocks.map((item) => {
    const ticker = item.ticker;
    const name = item.name;
    const color = seriesColor(ticker);
    return `
      <div class="custom-stock-chip" data-custom-series="${escapeHtml(ticker)}">
        <button class="series-toggle-btn custom-stock-toggle-btn" data-series="${escapeHtml(ticker)}" style="--series-color:${escapeHtml(color)}">${escapeHtml(name)}</button>
        <button class="stock-remove-btn" type="button" data-remove-series="${escapeHtml(ticker)}" aria-label="${escapeHtml(name)} remove">-</button>
      </div>
    `;
  }).join("");
  bindSeriesToggleBoard();
  bindCustomStockRemoveButtons();
}

function bindCustomStockRemoveButtons() {
  document.querySelectorAll(".stock-remove-btn").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ticker = btn.dataset.removeSeries;
      if (!ticker) return;
      removeCustomStock(ticker);
    });
  });
}

function removeCustomStock(ticker) {
  const before = customStocks.length;
  customStocks = customStocks.filter((item) => item.ticker !== ticker);
  if (customStocks.length === before) return;
  hiddenSeries.delete(ticker);
  delete seriesOffsets[ticker];
  delete seriesScales[ticker];
  delete DISPLAY_NAMES[ticker];
  loadingCustomStocks.delete(ticker);
  clearTickerSeriesFromPricePayload(ticker);
  renderCustomStockButtons();
  saveState();
  renderChart(false);
}

function clearTickerSeriesFromPricePayload(ticker) {
  if (!ticker || !pricePayload || typeof pricePayload !== "object") return;

  if (Array.isArray(pricePayload.records)) {
    pricePayload.records.forEach((row) => {
      if (row && typeof row === "object") delete row[ticker];
    });
  }

  if (Array.isArray(pricePayload.series)) {
    pricePayload.series = pricePayload.series.filter((key) => key !== ticker);
  }

  if (pricePayload.display_names && typeof pricePayload.display_names === "object") {
    delete pricePayload.display_names[ticker];
  }
}

function toYyyymmdd(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = `${dateObj.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${dateObj.getUTCDate()}`.padStart(2, "0");
  return `${y}${m}${d}`;
}

function getRecentKrxBaseDates(daysBack = KRX_LOOKBACK_DAYS) {
  const out = [];
  for (let i = 0; i <= daysBack; i += 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(toYyyymmdd(d));
  }
  return out;
}

function normalizeKrxUniverseRows(rows, fallbackMarket) {
  const normalized = [];
  const seen = new Set();
  rows.forEach((row) => {
    const codeRaw = String(row?.ISU_SRT_CD || "").replace(/\D/g, "");
    if (!codeRaw) return;
    const code = codeRaw.padStart(6, "0").slice(-6);
    const marketRaw = String(row?.MKT_TP_NM || fallbackMarket || "").toUpperCase();
    const isKosdaq = marketRaw.includes("KOSDAQ");
    const isKospi = marketRaw.includes("KOSPI") || (!isKosdaq && String(fallbackMarket || "").toUpperCase() === "KOSPI");
    if (!isKospi && !isKosdaq) return;
    const market = isKosdaq ? "KOSDAQ" : "KOSPI";
    const suffix = isKosdaq ? "KQ" : "KS";
    const ticker = `${code}.${suffix}`;
    if (seen.has(ticker)) return;
    seen.add(ticker);
    const name = String(row?.ISU_ABBRV || row?.ISU_NM || "").trim();
    if (!name) return;
    normalized.push({
      ticker,
      code,
      name,
      market,
    });
  });
  return normalized;
}

async function fetchKrxUniverseRows(apiKey, baseDate, market) {
  const endpoint = KRX_BASE_INFO_ENDPOINTS[market];
  if (!endpoint) return [];
  const key = String(apiKey || "").trim();
  if (!key) return [];
  const roots = [
    `https://data-dbg.krx.co.kr/svc/apis/sto/${endpoint}`,
    `https://data-dbg.krx.co.kr/svc/sample/apis/sto/${endpoint}`,
  ];
  for (const root of roots) {
    const url = `${root}?basDd=${encodeURIComponent(baseDate)}&AUTH_KEY=${encodeURIComponent(key)}`;
    try {
      const payload = await fetchJsonWithProxyFallback(url, null, { allowProxy: false });
      const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
      if (rows.length) return rows;
    } catch (_) {
      // try next endpoint
    }
  }
  return [];
}

let krxUniversePromise = null;

function resetKrxUniverseCache() {
  krxUniverse = [];
  krxUniverseLoaded = false;
  krxUniverseLoading = false;
  krxUniversePromise = null;
}

async function ensureKrxUniverseLoaded() {
  if (krxUniverseLoaded && krxUniverse.length) return;
  if (krxUniversePromise) {
    await krxUniversePromise;
    return;
  }

  const key = String(apiSettings?.krxApiKey || "").trim();
  if (!key) throw new Error("KRX AUTH_KEY가 설정되지 않았습니다. API 키 설정에서 먼저 입력해 주세요.");

  krxUniverseLoading = true;
  krxUniversePromise = (async () => {
    let universe = [];
    const dates = getRecentKrxBaseDates();
    for (const baseDate of dates) {
      const [kospiRows, kosdaqRows] = await Promise.all([
        fetchKrxUniverseRows(key, baseDate, "KOSPI"),
        fetchKrxUniverseRows(key, baseDate, "KOSDAQ"),
      ]);
      const merged = [
        ...normalizeKrxUniverseRows(kospiRows, "KOSPI"),
        ...normalizeKrxUniverseRows(kosdaqRows, "KOSDAQ"),
      ];
      if (merged.length) {
        universe = merged;
        break;
      }
    }

    if (!universe.length) {
      throw new Error("KRX 종목 목록을 불러오지 못했습니다. AUTH_KEY 또는 기준일을 확인해 주세요.");
    }

    krxUniverse = universe.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    krxUniverseLoaded = true;
  })().finally(() => {
    krxUniverseLoading = false;
    krxUniversePromise = null;
  });

  await krxUniversePromise;
}

function filterKrxUniverse(keyword) {
  const q = String(keyword || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return [];

  const scored = [];
  krxUniverse.forEach((item) => {
    const name = item.name.toLowerCase().replace(/\s+/g, "");
    const code = item.code.toLowerCase();
    const ticker = item.ticker.toLowerCase();

    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (code.startsWith(q)) score = 2;
    else if (code.includes(q) || ticker.includes(q)) score = 3;
    if (score < 0) return;

    scored.push({ item, score });
  });

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.name.localeCompare(b.item.name, "ko");
  });

  return scored.slice(0, 12).map((entry) => entry.item);
}

function hideStockSuggestList() {
  const listEl = document.getElementById("stockSuggestList");
  if (!listEl) return;
  listEl.hidden = true;
  listEl.innerHTML = "";
  stockSuggestItems = [];
  stockSuggestActiveIndex = -1;
}

function setStockSuggestActiveIndex(index) {
  const listEl = document.getElementById("stockSuggestList");
  const maxIndex = stockSuggestItems.length - 1;
  if (!listEl || maxIndex < 0) {
    stockSuggestActiveIndex = -1;
    return;
  }

  let next = Number(index);
  if (!Number.isFinite(next)) next = -1;
  if (next < -1) next = -1;
  if (next > maxIndex) next = maxIndex;
  stockSuggestActiveIndex = next;

  const nodes = listEl.querySelectorAll(".stock-suggest-item");
  nodes.forEach((node, nodeIndex) => {
    const isActive = nodeIndex === stockSuggestActiveIndex;
    node.classList.toggle("is-active", isActive);
    node.setAttribute("aria-selected", isActive ? "true" : "false");
    if (isActive) node.scrollIntoView({ block: "nearest" });
  });
}

function renderStockSuggestList(items) {
  const listEl = document.getElementById("stockSuggestList");
  if (!listEl) return;
  stockSuggestItems = Array.isArray(items) ? items : [];
  stockSuggestActiveIndex = -1;

  if (!stockSuggestItems.length) {
    listEl.hidden = true;
    listEl.innerHTML = "";
    return;
  }

  listEl.innerHTML = stockSuggestItems.map((item, idx) => `
    <button type="button" class="stock-suggest-item" data-suggest-idx="${idx}" aria-selected="false">
      <span class="stock-suggest-name">${escapeHtml(item.name)}</span>
      <span class="stock-suggest-meta">${escapeHtml(item.code)} / ${escapeHtml(item.market)}</span>
    </button>
  `).join("");
  listEl.hidden = false;
}

function buildYahooHistoryUrl(ticker, sinceDate = "") {
  const baseUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d`;
  const safeSinceDate = String(sinceDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(safeSinceDate)) {
    const startDate = shiftDays(safeSinceDate, -7);
    const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
    const period2 = Math.floor((Date.now() + DAY_MS) / 1000);
    if (Number.isFinite(period1) && Number.isFinite(period2) && period2 > period1) {
      return `${baseUrl}&period1=${period1}&period2=${period2}`;
    }
  }
  return `${baseUrl}&range=30y`;
}

async function fetchYahooHistorySeries(ticker, options = {}) {
  const baseUrl = buildYahooHistoryUrl(ticker, options?.sinceDate || "");
  const url = appendCacheBust(baseUrl);
  const payload = await fetchJsonWithProxyFallback(url);
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(`${ticker} 가격 이력을 불러오지 못했습니다.`);

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const offsetSec = Number(result?.meta?.gmtoffset || 0);
  const byDate = new Map();

  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = Number(timestamps[i]);
    const close = toNum(closes[i]);
    if (!Number.isFinite(ts) || close === null) continue;
    const date = new Date((ts + offsetSec) * 1000).toISOString().slice(0, 10);
    byDate.set(date, close);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }));
}

function mergeTickerSeriesIntoPricePayload(ticker, points) {
  const byDate = new Map();
  (pricePayload?.records || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    byDate.set(date, { ...row });
  });

  points.forEach(({ date, close }) => {
    if (!date || !Number.isFinite(close)) return;
    const prev = byDate.get(date) || { date };
    prev[ticker] = close;
    byDate.set(date, prev);
  });

  const merged = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!pricePayload) pricePayload = {};
  pricePayload.records = merged;

  if (!Array.isArray(pricePayload.series)) pricePayload.series = [];
  if (!pricePayload.series.includes(ticker)) pricePayload.series.push(ticker);

  if (!pricePayload.display_names || typeof pricePayload.display_names !== "object") {
    pricePayload.display_names = {};
  }
  if (DISPLAY_NAMES[ticker]) pricePayload.display_names[ticker] = DISPLAY_NAMES[ticker];
}

function getLatestTickerDateFromPricePayload(ticker) {
  let latest = "";
  (pricePayload?.records || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const value = toNum(row?.[ticker]);
    if (!date || value === null) return;
    if (!latest || date > latest) latest = date;
  });
  return latest;
}
async function ensureCustomTickerSeriesLoaded(ticker, options = {}) {
  const forceRefresh = Boolean(options?.forceRefresh);
  const hasExisting = (pricePayload?.records || []).some((row) => toNum(row?.[ticker]) !== null);
  if (hasExisting && !forceRefresh) return;

  const sinceDate = hasExisting && forceRefresh ? getLatestTickerDateFromPricePayload(ticker) : "";
  const points = await fetchYahooHistorySeries(ticker, { sinceDate });
  if (!points.length) throw new Error(`${ticker} 종목의 가격 히스토리를 가져오지 못했습니다.`);
  mergeTickerSeriesIntoPricePayload(ticker, points);
}

function parseLooseNumber(raw) {
  const cleaned = String(raw ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeKrxDate(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d{8}$/.test(text)) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function scoreKrxIndexName(name, market) {
  const text = String(name || "").toUpperCase().replace(/\s+/g, "");
  if (!text) return 0;
  if (market === "KOSPI") {
    if (text === "코스피" || text === "KOSPI") return 100;
    if (text.includes("코스피")) return 70;
    if (text.includes("KOSPI")) return 50;
    return 0;
  }
  if (market === "KOSDAQ") {
    if (text === "코스닥" || text === "KOSDAQ") return 100;
    if (text.includes("코스닥")) return 70;
    if (text.includes("KOSDAQ")) return 50;
    return 0;
  }
  return 0;
}

function pickKrxIndexSeriesPoint(rows, market) {
  const list = Array.isArray(rows)
    ? rows
    : ((rows && typeof rows === "object") ? [rows] : []);
  let best = null;

  list.forEach((row) => {
    const date = normalizeKrxDate(row?.BAS_DD ?? row?.basDd ?? row?.BASDD);
    const close = parseLooseNumber(
      row?.CLSPRC_IDX ?? row?.TDD_CLSPRC ?? row?.CLSPRC ?? row?.closePrice,
    );
    if (!date || !Number.isFinite(close)) return;

    const score = scoreKrxIndexName(
      row?.IDX_NM ?? row?.IDX_NM_KOR ?? row?.IDX_NM_ENG ?? row?.IDX_NM_EN ?? "",
      market,
    );

    if (!best || score > best.score) {
      best = { date, close, score };
    }
  });

  return best ? { date: best.date, close: best.close } : null;
}

async function fetchKrxIndexPoint(apiKey, market, baseDate) {
  const endpoint = KRX_INDEX_ENDPOINTS[market];
  const key = String(apiKey || "").trim();
  if (!endpoint || !key || !/^\d{8}$/.test(String(baseDate || ""))) return null;

  const roots = [
    `https://data-dbg.krx.co.kr/svc/apis/idx/${endpoint}`,
    `https://data-dbg.krx.co.kr/svc/sample/apis/idx/${endpoint}`,
  ];

  for (const root of roots) {
    const url = `${root}?basDd=${encodeURIComponent(baseDate)}&AUTH_KEY=${encodeURIComponent(key)}`;
    try {
      const payload = await fetchJsonWithProxyFallback(url, null, { allowProxy: false });
      const rows = payload?.OutBlock_1 ?? payload?.output ?? payload?.data ?? [];
      const point = pickKrxIndexSeriesPoint(rows, market);
      if (point) return point;
    } catch (_) {
      // try next endpoint root/date
    }
  }
  return null;
}

async function fetchLatestKrxCoreIndexRows(apiKey, daysBack = 20) {
  const key = String(apiKey || "").trim();
  if (!key) return [];
  const dates = getRecentKrxBaseDates(daysBack);
  const targets = [
    { market: "KOSPI", ticker: "^KS11" },
    { market: "KOSDAQ", ticker: "^KQ11" },
  ];

  const found = await Promise.all(targets.map(async (target) => {
    let best = null;

    for (const baseDate of dates) {
      const point = await fetchKrxIndexPoint(key, target.market, baseDate);
      if (!point) continue;

      if (!best || point.date > best.date) {
        best = { ticker: target.ticker, date: point.date, close: point.close };
      }

      const baseDateIso = normalizeKrxDate(baseDate);
      if (best && baseDateIso && baseDateIso <= best.date) {
        break;
      }
    }

    return best;
  }));

  return found.filter(Boolean);
}
async function refreshCoreIndexSeries() {
  const tickers = ["^KS11", "^KQ11"];
  const beforeLatest = {};

  tickers.forEach((ticker) => {
    beforeLatest[ticker] = "";
  });

  (pricePayload?.records || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    tickers.forEach((ticker) => {
      const v = toNum(row?.[ticker]);
      if (v === null) return;
      if (!beforeLatest[ticker] || date > beforeLatest[ticker]) beforeLatest[ticker] = date;
    });
  });

  const applied = [];
  const warnings = [];

  const yahooResults = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const points = await fetchYahooHistorySeries(ticker, { sinceDate: beforeLatest[ticker] });
      if (!points.length) throw new Error("price history is empty");
      mergeTickerSeriesIntoPricePayload(ticker, points);
      return { ticker, latestDate: points[points.length - 1]?.date || "" };
    }),
  );

  yahooResults.forEach((result, idx) => {
    const ticker = tickers[idx];
    if (result.status === "fulfilled") {
      const latestDate = String(result.value?.latestDate || "");
      if (latestDate && latestDate !== beforeLatest[ticker]) {
        applied.push(`${labelName(ticker)} 반영(${latestDate})`);
      }
      return;
    }
    const reason = result.reason?.message || String(result.reason || "unknown error");
    warnings.push(`${labelName(ticker)} 갱신 오류: ${reason}`);
  });

  const krxKey = String(apiSettings?.krxApiKey || "").trim();
  if (krxKey) {
    try {
      const latestRows = await fetchLatestKrxCoreIndexRows(krxKey, 25);
      const found = new Set();
      latestRows.forEach((row) => {
        if (!row?.ticker || !row?.date || !Number.isFinite(row?.close)) return;
        found.add(row.ticker);
        const yahooLatest = getLatestTickerDateFromPricePayload(row.ticker);
        if (yahooLatest && row.date <= yahooLatest) return;
        mergeTickerSeriesIntoPricePayload(row.ticker, [{ date: row.date, close: row.close }]);
        applied.push(`${labelName(row.ticker)} KRX 반영(${row.date})`);
      });

      tickers.forEach((ticker) => {
        if (!found.has(ticker)) warnings.push(`${labelName(ticker)} KRX 최신값을 찾지 못했습니다.`);
      });
    } catch (err) {
      warnings.push(`KRX 지수 불러오기 오류: ${err.message}`);
    }
  }

  return { applied, warnings };
}

async function addCustomStock(candidate, msgEl) {
  if (!candidate?.ticker || !candidate?.name) return;

  if (customStocks.some((item) => item.ticker === candidate.ticker)) {
    setMessage(msgEl, ["이미 추가된 종목입니다."], true);
    return;
  }
  if (customStocks.length >= MAX_CUSTOM_STOCKS) {
    setMessage(msgEl, [`종목은 최대 ${MAX_CUSTOM_STOCKS}개까지 추가할 수 있습니다.`], true);
    return;
  }
  if (loadingCustomStocks.has(candidate.ticker)) return;

  loadingCustomStocks.add(candidate.ticker);
  try {
    DISPLAY_NAMES[candidate.ticker] = candidate.name;
    await ensureCustomTickerSeriesLoaded(candidate.ticker);

    customStocks.push({
      ticker: candidate.ticker,
      name: candidate.name,
      code: candidate.code,
      market: candidate.market,
    });

    hiddenSeries.delete(candidate.ticker);
    renderCustomStockButtons();
    saveState();
    renderChart(false);
    setMessage(msgEl, [`${candidate.name} 종목이 추가되었습니다.`]);
    requestDartDisclosureRefreshForTicker(candidate.ticker, msgEl);
  } catch (err) {
    delete DISPLAY_NAMES[candidate.ticker];
    setMessage(msgEl, `종목 추가 중 오류가 발생했습니다: ${err.message}`, true);
  } finally {
    loadingCustomStocks.delete(candidate.ticker);
  }
}

function setupStockAddPanel(msgEl) {
  const inputEl = document.getElementById("stockSearchInput");
  const listEl = document.getElementById("stockSuggestList");
  if (!inputEl || !listEl) return;
  if (inputEl.dataset.bound === "1") return;
  inputEl.dataset.bound = "1";

  let searchSeq = 0;

  const refreshSuggest = async () => {
    const keyword = inputEl.value.trim();
    if (!keyword) {
      hideStockSuggestList();
      return;
    }

    if (!String(apiSettings?.krxApiKey || "").trim()) {
      hideStockSuggestList();
      setMessage(msgEl, ["API 키 설정에서 KRX AUTH_KEY를 먼저 입력해 주세요."], true);
      return;
    }

    const seq = ++searchSeq;
    try {
      await ensureKrxUniverseLoaded();
      if (seq !== searchSeq) return;
      const items = filterKrxUniverse(keyword);
      renderStockSuggestList(items);
    } catch (err) {
      if (seq !== searchSeq) return;
      hideStockSuggestList();
      setMessage(msgEl, `종목 검색 목록을 불러오지 못했습니다: ${err.message}`, true);
    }
  };

  const submitSuggestByIndex = (idx) => {
    const item = stockSuggestItems[idx];
    if (!item) return;
    addCustomStock(item, msgEl).finally(() => {
      inputEl.value = "";
      hideStockSuggestList();
    });
  };

  inputEl.addEventListener("input", () => {
    refreshSuggest();
  });

  inputEl.addEventListener("focus", () => {
    if (!inputEl.value.trim()) return;
    refreshSuggest();
  });

  inputEl.addEventListener("click", () => {
    if (!inputEl.value.trim()) return;
    if (!listEl.hidden) return;
    refreshSuggest();
  });

  inputEl.addEventListener("keydown", (event) => {
    const key = event.key;

    if (key === "ArrowDown") {
      if (!stockSuggestItems.length) return;
      event.preventDefault();
      const next = stockSuggestActiveIndex < 0
        ? 0
        : ((stockSuggestActiveIndex + 1) % stockSuggestItems.length);
      setStockSuggestActiveIndex(next);
      return;
    }

    if (key === "ArrowUp") {
      if (!stockSuggestItems.length) return;
      event.preventDefault();
      const next = stockSuggestActiveIndex < 0
        ? (stockSuggestItems.length - 1)
        : ((stockSuggestActiveIndex - 1 + stockSuggestItems.length) % stockSuggestItems.length);
      setStockSuggestActiveIndex(next);
      return;
    }

    if (key === "Escape") {
      hideStockSuggestList();
      return;
    }

    if (key !== "Enter") return;
    event.preventDefault();
    if (!stockSuggestItems.length) return;
    const pickIndex = stockSuggestActiveIndex >= 0 ? stockSuggestActiveIndex : 0;
    submitSuggestByIndex(pickIndex);
  });

  listEl.addEventListener("mousemove", (event) => {
    const btn = event.target.closest("[data-suggest-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.suggestIdx);
    if (!Number.isFinite(idx)) return;
    setStockSuggestActiveIndex(idx);
  });

  listEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-suggest-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.suggestIdx);
    if (!Number.isFinite(idx)) return;
    setStockSuggestActiveIndex(idx);
    submitSuggestByIndex(idx);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target === inputEl || listEl.contains(target)) return;
    hideStockSuggestList();
  });
}

async function preloadCustomStocks(options = {}) {
  if (!customStocks.length) return { failedNames: [] };

  const forceRefresh = Boolean(options?.forceRefresh);
  const failed = [];
  const failedNames = [];
  for (const item of customStocks) {
    const hadExisting = (pricePayload?.records || []).some((row) => toNum(row?.[item.ticker]) !== null);
    try {
      await ensureCustomTickerSeriesLoaded(item.ticker, { forceRefresh });
      DISPLAY_NAMES[item.ticker] = item.name;
    } catch (_) {
      // Keep ticker if older history exists and refresh fails.
      if (hadExisting) {
        DISPLAY_NAMES[item.ticker] = item.name;
        continue;
      }
      failed.push(item.ticker);
      failedNames.push(item.name || item.ticker);
    }
  }

  if (!failed.length) return { failedNames: [] };

  customStocks = customStocks.filter((item) => !failed.includes(item.ticker));
  failed.forEach((ticker) => {
    hiddenSeries.delete(ticker);
    delete seriesOffsets[ticker];
    delete seriesScales[ticker];
    delete DISPLAY_NAMES[ticker];
  });
  renderCustomStockButtons();
  saveState();
  return { failedNames };
}
function buildDenseMacroRows(sourceRows, targetDates) {
  const sorted = [...sourceRows].sort((a, b) => a.date.localeCompare(b.date));
  const cols = getSeriesColumns(sorted);
  if (!sorted.length || !targetDates.length || !cols.length) return sorted;
  const targets = targetDates.map((d) => ({ date: d, time: toUtcMs(d) }));
  const dense = targets.map(({ date }) => ({ date }));
  cols.forEach((col) => {
    const pts = sorted.map((r) => ({ time: toUtcMs(r.date), value: toNum(r[col]) })).filter((p) => p.value !== null).sort((a, b) => a.time - b.time);
    if (!pts.length) { targets.forEach((_, i) => { dense[i][col] = null; }); return; }
    let ptr = 0;
    targets.forEach(({ time }, i) => {
      if (time < pts[0].time || time > pts[pts.length - 1].time) { dense[i][col] = null; return; }
      while (ptr + 1 < pts.length && pts[ptr + 1].time < time) ptr += 1;
      const L = pts[ptr], R = pts[ptr + 1];
      if (!L) { dense[i][col] = null; return; }
      if (!R || L.time === time || L.time === R.time) { dense[i][col] = L.value; return; }
      if (R.time === time) { dense[i][col] = R.value; return; }
      const t = (time - L.time) / (R.time - L.time);
      dense[i][col] = L.value + (R.value - L.value) * t;
    });
  });
  return dense.filter((r) => cols.some((c) => toNum(r[c]) !== null));
}

let CREDIT_OFFSET_DAYS = 2;  // Credit publication-lag alignment in days (UI uses negative sign for display)
const CREDIT_COLS = ["kospi_credit", "kosdaq_credit"];

/**
 * Interpolate credit rows onto the price-date axis after applying the
 * publication-lag offset. This keeps credit values on trading dates instead of
 * visually spilling into weekends when the offset is enabled.
 */
function buildCreditInterpolator(creditRowsSrc) {
  if (!creditRowsSrc.length) return () => null;

  const points = [...creditRowsSrc]
    .map((r) => ({
      time: toUtcMs(r.date),
      kospi_credit: toNum(r.kospi_credit),
      kosdaq_credit: toNum(r.kosdaq_credit),
    }))
    .filter((r) => Number.isFinite(r.time))
    .sort((a, b) => a.time - b.time);
  if (!points.length) return () => null;

  const byTime = new Map(points.map((p) => [p.time, p]));
  const firstTime = points[0].time;
  const lastTime = points[points.length - 1].time;

  function interpolate(targetTime) {
    if (targetTime < firstTime || targetTime > lastTime) return null;

    const exact = byTime.get(targetTime);
    if (exact) return exact;

    let lo = 0;
    let hi = points.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].time < targetTime) lo = mid + 1;
      else hi = mid - 1;
    }

    const right = points[lo];
    const left = points[lo - 1];
    if (!left || !right) return null;

    const span = right.time - left.time;
    if (!Number.isFinite(span) || span <= 0) return null;
    const t = (targetTime - left.time) / span;

    const out = {};
    CREDIT_COLS.forEach((k) => {
      const lv = left[k];
      const rv = right[k];
      if (lv === null && rv === null) out[k] = null;
      else if (lv === null) out[k] = rv;
      else if (rv === null) out[k] = lv;
      else out[k] = lv + (rv - lv) * t;
    });
    return out;
  }

  return function findShiftedCredit(priceDate) {
    const baseTime = toUtcMs(priceDate);
    if (!Number.isFinite(baseTime)) return null;
    const shiftedTime = baseTime + CREDIT_OFFSET_DAYS * DAY_MS;
    return interpolate(shiftedTime);
  };
}

function mergeSources(priceRows, denseRows, creditRowsSrc, start, end) {
  const priceMap  = new Map(priceRows.map((r) => [r.date, r]));
  const macroMap  = new Map(denseRows.map((r) => [r.date, r]));

  const historicalCredit = new Map();
  denseRows.forEach((r) => {
    historicalCredit.set(r.date, {
      kospi_credit: toNum(r.kospi_credit),
      kosdaq_credit: toNum(r.kosdaq_credit),
    });
  });

  const kofiaCredit = new Map();
  creditRowsSrc.forEach((r) => {
    const date = String(r.date || "").slice(0, 10);
    if (!date) return;
    const prev = kofiaCredit.get(date) || {};
    const nextKospi = toNum(r.kospi_credit);
    const nextKosdaq = toNum(r.kosdaq_credit);
    kofiaCredit.set(date, {
      kospi_credit: nextKospi ?? prev.kospi_credit ?? null,
      kosdaq_credit: nextKosdaq ?? prev.kosdaq_credit ?? null,
    });
  });

  const kofiaDates = [...kofiaCredit.keys()].sort();
  const firstKofiaDate = kofiaDates.length ? kofiaDates[0] : "";

  // Align old historical credit scale to the KOFIA scale to avoid boundary jumps.
  const calcAlignFactor = (key) => {
    const ratios = [];
    kofiaDates.forEach((d) => {
      const h = historicalCredit.get(d)?.[key];
      const k = kofiaCredit.get(d)?.[key];
      if (Number.isFinite(h) && Number.isFinite(k) && h !== 0) ratios.push(k / h);
    });
    if (!ratios.length) return 1;
    ratios.sort((a, b) => a - b);
    const m = Math.floor(ratios.length / 2);
    const med = ratios.length % 2 ? ratios[m] : (ratios[m - 1] + ratios[m]) / 2;
    if (!(Number.isFinite(med) && med > 0)) return 1;
    return (med > 1.15 || med < 0.85) ? med : 1;
  };

  const alignFactor = {
    kospi_credit: calcAlignFactor("kospi_credit"),
    kosdaq_credit: calcAlignFactor("kosdaq_credit"),
  };

  const creditByDate = new Map();
  historicalCredit.forEach((vals, date) => {
    const shouldAlign = firstKofiaDate && date < firstKofiaDate;
    const out = {};
    CREDIT_COLS.forEach((k) => {
      const v = vals?.[k];
      const f = alignFactor[k] ?? 1;
      out[k] = shouldAlign && Number.isFinite(v) ? v * f : v;
    });
    creditByDate.set(date, out);
  });

  // Use KOFIA values on overlapping/new dates.
  kofiaCredit.forEach((vals, date) => {
    const prev = creditByDate.get(date) || {};
    creditByDate.set(date, {
      kospi_credit: Number.isFinite(vals.kospi_credit) ? vals.kospi_credit : (prev.kospi_credit ?? null),
      kosdaq_credit: Number.isFinite(vals.kosdaq_credit) ? vals.kosdaq_credit : (prev.kosdaq_credit ?? null),
    });
  });

  const creditSeriesRows = [...creditByDate.entries()]
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const shiftedCreditAtPriceDate = buildCreditInterpolator(creditSeriesRows);

  const liveCols   = getSeriesColumns(priceRows);
  const macroCols  = getSeriesColumns(denseRows).filter((c) => !CREDIT_COLS.includes(c));

  const rows = [];
  priceRows.forEach(({ date }) => {
    if (date < start || date > end) return;
    const row = { date };
    const pr = priceMap.get(date) || {};
    const mr = macroMap.get(date) || {};
    const exactCredit = creditByDate.get(date) || null;
    const shiftedCredit = shiftedCreditAtPriceDate(date) || exactCredit;
    liveCols.forEach((k) => { row[k] = toNum(pr[k]); });
    macroCols.forEach((k) => { row[k] = toNum(mr[k]); });
    CREDIT_COLS.forEach((k) => { row[k] = shiftedCredit ? toNum(shiftedCredit[k]) : null; });
    rows.push(row);
  });

  const allMacroCols = [...new Set([...macroCols, ...CREDIT_COLS])];
  return { rows, macroCols: allMacroCols, liveCols };
}

function normalizeSeries(values) {
  const first = values.find((v) => Number.isFinite(v));
  const base = Number.isFinite(first) && first !== 0 ? first : 1;
  return values.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null));
}

function centeredScale(values, pct, normalized) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return values;
  const pivot = normalized ? 100 : (Math.min(...nums) + Math.max(...nums)) / 2;
  const r = pct / 100;
  return values.map((v) => (Number.isFinite(v) ? pivot + (v - pivot) * r : null));
}

function autoFitScales(rows, selected, normBases) {
  const info = [];
  selected.forEach((s) => {
    if (s === "leading_cycle") return;
    let vals = rows.map((r) => toNum(r[s])).filter((v) => v !== null);
    if (!vals.length) return;
    const base = normBases[s];
    vals = (base && base !== 0) ? vals.map((v) => (v / base) * 100) : normalizeSeries(vals).filter((v) => Number.isFinite(v));
    const range = Math.max(Math.max(...vals) - Math.min(...vals), 1);
    info.push([s, range]);
  });
  if (!info.length) return {};
  const sorted = info.map(([, r]) => r).sort((a, b) => a - b);
  const target = sorted[Math.floor(sorted.length / 2)];
  return Object.fromEntries(info.map(([s, r]) => [s, Math.max(5, Math.min(5000, Math.round((target / r) * 100)))]));
}

/* Drag handles */

function updateHandles() {
  const el = document.getElementById("chart");
  if (!el || !el._fullLayout) return;

  let container = document.getElementById("y-handles");
  if (!container) {
    container = document.createElement("div");
    container.id = "y-handles";
    el.appendChild(container);
  }
  container.innerHTML = "";

  const ya = el._fullLayout.yaxis;
  const xa = el._fullLayout.xaxis;
  if (!ya || !ya._length) return;

  const rightX = xa._offset + xa._length + 6;

  el.data.forEach((trace, i) => {
    if (trace.visible === "legendonly") return;
    const key = currentSelected[i];
    if (!key) return;

    let firstY = null;
    for (let j = 0; j < trace.y.length; j++) {
      if (trace.y[j] !== null) { firstY = trace.y[j]; break; }
    }
    let lastY = null;
    for (let j = trace.y.length - 1; j >= 0; j--) {
      if (trace.y[j] !== null) { lastY = trace.y[j]; break; }
    }
    if (firstY === null) return;

    const firstFrac = (firstY - ya.range[0]) / (ya.range[1] - ya.range[0]);
    const leftPixelY = ya._offset + ya._length * (1 - firstFrac);
    const lastFrac = lastY !== null ? (lastY - ya.range[0]) / (ya.range[1] - ya.range[0]) : firstFrac;
    const rightPixelY = ya._offset + ya._length * (1 - lastFrac);
    const color = trace.line.color;

    const leftHandle = document.createElement("div");
    leftHandle.className = "y-handle y-handle-left";
    leftHandle.style.top = leftPixelY - 7 + "px";
    leftHandle.style.backgroundColor = color;
    leftHandle.title = labelName(key) + " (위치)";
    setupOffsetDrag(leftHandle, i, key, leftPixelY, ya);
    container.appendChild(leftHandle);

    const rightHandle = document.createElement("div");
    rightHandle.className = "y-handle y-handle-right";
    rightHandle.style.top = rightPixelY - 7 + "px";
    rightHandle.style.left = rightX + "px";
    rightHandle.style.backgroundColor = color;
    rightHandle.title = labelName(key) + " (스케일)";
    setupScaleDrag(rightHandle, i, key, rightPixelY, ya);
    container.appendChild(rightHandle);
  });
}

function defaultSeriesScale(seriesKey) {
  return seriesKey === "leading_cycle" ? 20 : 1;
}

function computeFinalValues(seriesKey) {
  const base = baseTraceValues[seriesKey];
  if (!base) return null;
  const s = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : defaultSeriesScale(seriesKey);
  const o = seriesOffsets[seriesKey] || 0;
  return base.map((v) => (v !== null ? 100 + (v - 100) * s + o : null));
}

function restyleLive(traceIndex, seriesKey) {
  if (dragRafId) return;
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null;
    const el = document.getElementById("chart");
    const newY = computeFinalValues(seriesKey);
    if (newY) Plotly.restyle(el, { y: [newY] }, [traceIndex]);
  });
}


function lockCurrentYAxisRange() {
  const el = document.getElementById("chart");
  const range = el?._fullLayout?.yaxis?.range;
  if (!el || !Array.isArray(range) || range.length < 2) return;
  Plotly.relayout(el, {
    "yaxis.range[0]": range[0],
    "yaxis.range[1]": range[1],
    "yaxis.autorange": false,
  });
}

function getCurrentMainXRange() {
  const range = document.getElementById("chart")?._fullLayout?.xaxis?.range;
  if (!Array.isArray(range) || range.length < 2) return null;
  return [range[0], range[1]];
}

function setupOffsetDrag(handle, traceIndex, seriesKey, basePixelY, ya) {
  function onStart(startClientY) {
    const startOffset = seriesOffsets[seriesKey] || 0;
    const lockedXRange = getCurrentMainXRange();
    isHandleDragging = true;
    handle.classList.add("dragging");
    lockCurrentYAxisRange();

    function onMove(clientY) {
      const dy = clientY - startClientY;
      const dataDelta = -dy * (ya.range[1] - ya.range[0]) / ya._length;
      seriesOffsets[seriesKey] = startOffset + dataDelta;
      handle.style.top = basePixelY + dy - 7 + "px";
      restyleLive(traceIndex, seriesKey);
    }

    function onEnd(clientY) {
      handle.classList.remove("dragging");
      isHandleDragging = false;
      if (lockedXRange) pinnedXRange = [...lockedXRange];
      const dy = clientY - startClientY;
      if (Math.abs(dy) < 3) {
        seriesOffsets[seriesKey] = startOffset;
        if (hiddenSeries.has(seriesKey)) hiddenSeries.delete(seriesKey);
        else hiddenSeries.add(seriesKey);
      }
      saveState();
      renderChart();
    }

    addDragListeners(startClientY, onMove, onEnd);
  }

  handle.addEventListener("mousedown", (e) => { e.preventDefault(); onStart(e.clientY); });
  handle.addEventListener("touchstart", (e) => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
}

function setupScaleDrag(handle, traceIndex, seriesKey, basePixelY, ya) {
  function onStart(startClientY) {
    const startScale = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : defaultSeriesScale(seriesKey);
    const lockedXRange = getCurrentMainXRange();
    isHandleDragging = true;
    handle.classList.add("dragging");
    lockCurrentYAxisRange();

    function onMove(clientY) {
      const dy = clientY - startClientY;
      const factor = 1 - dy / 150;
      seriesScales[seriesKey] = startScale * factor;
      handle.style.top = basePixelY + dy - 7 + "px";
      restyleLive(traceIndex, seriesKey);
    }

    function onEnd() {
      handle.classList.remove("dragging");
      isHandleDragging = false;
      if (lockedXRange) pinnedXRange = [...lockedXRange];
      saveState();
      renderChart();
    }

    addDragListeners(startClientY, onMove, onEnd);
  }

  handle.addEventListener("mousedown", (e) => { e.preventDefault(); onStart(e.clientY); });
  handle.addEventListener("touchstart", (e) => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
}

function addDragListeners(startClientY, onMove, onEnd) {
  const mouseMove = (e) => onMove(e.clientY);
  const mouseUp = (e) => {
    document.removeEventListener("mousemove", mouseMove);
    document.removeEventListener("mouseup", mouseUp);
    onEnd(e.clientY);
  };
  document.addEventListener("mousemove", mouseMove);
  document.addEventListener("mouseup", mouseUp);

  const touchMove = (e) => { e.preventDefault(); onMove(e.touches[0].clientY); };
  const touchEnd = (e) => {
    document.removeEventListener("touchmove", touchMove);
    document.removeEventListener("touchend", touchEnd);
    onEnd(e.changedTouches[0].clientY);
  };
  document.addEventListener("touchmove", touchMove, { passive: false });
  document.addEventListener("touchend", touchEnd);
}

function resetHandles() {
  seriesOffsets = {};
  seriesScales = {};
  pinnedXRange = null;
  saveState();
  renderChart(false);
}

function findNearestDisclosurePoint(eventDate, ticker, rows, chartYBySeries) {
  const yByDate = chartYBySeries?.[ticker];
  if (!yByDate) return null;
  const targetMs = toUtcMs(eventDate);
  if (!Number.isFinite(targetMs)) return null;

  let best = null;
  rows.forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const y = yByDate.get(date);
    if (!date || !Number.isFinite(y)) return;
    const ms = toUtcMs(date);
    if (!Number.isFinite(ms)) return;
    const diff = Math.abs(ms - targetMs);
    if (diff > 10 * DAY_MS) return;
    if (!best || diff < best.diff || (diff === best.diff && date >= eventDate && best.date < eventDate)) {
      best = { date, y, diff };
    }
  });
  return best;
}

function buildDisclosureTrace(rows, selected, chartYBySeries, start, end) {
  lastDisclosureTraceStats = { total: disclosureRows.length, candidates: 0, markers: 0 };
  if (!disclosureRows.length || !rows.length) return null;
  const selectedSet = new Set(selected);
  const grouped = new Map();

  disclosureRows.forEach((event) => {
    if (!selectedSet.has(event.ticker) || hiddenSeries.has(event.ticker)) return;
    if (event.date < start || event.date > end) return;
    lastDisclosureTraceStats.candidates += 1;
    const point = findNearestDisclosurePoint(event.date, event.ticker, rows, chartYBySeries);
    if (!point) return;
    const key = `${event.ticker}|${point.date}`;
    const group = grouped.get(key) || {
      ticker: event.ticker,
      name: event.name || labelName(event.ticker),
      plotDate: point.date,
      y: point.y,
      events: [],
    };
    group.events.push(event);
    grouped.set(key, group);
  });

  const groups = [...grouped.values()].sort((a, b) => a.plotDate.localeCompare(b.plotDate));
  lastDisclosureTraceStats.markers = groups.length;
  if (!groups.length) return null;

  return {
    x: groups.map((group) => group.plotDate),
    y: groups.map((group) => group.y),
    text: groups.map(() => "v"),
    customdata: groups.map((group) => [JSON.stringify(group)]),
    type: "scatter",
    mode: "markers+text",
    name: DISCLOSURE_TRACE_NAME,
    showlegend: false,
    cliponaxis: false,
    hovertemplate: groups.map((group) => {
      const first = group.events[0];
      const more = group.events.length > 1 ? ` 외 ${group.events.length - 1}건` : "";
      return `${escapeHtml(group.name)}<br>${escapeHtml(first.type)}: ${escapeHtml(first.title)}${more}<extra>공시</extra>`;
    }),
    meta: { isDisclosureTrace: true },
    textposition: "top center",
    textfont: { color: DISCLOSURE_MARKER_COLOR, size: DISCLOSURE_TEXT_SIZE, family: "Arial Black, sans-serif" },
    marker: {
      symbol: "triangle-down",
      size: DISCLOSURE_MARKER_SIZE,
      color: DISCLOSURE_MARKER_COLOR,
      line: { color: DISCLOSURE_MARKER_LINE_COLOR, width: DISCLOSURE_MARKER_LINE_WIDTH },
    },
  };
}

function ensureDisclosurePopover() {
  const chart = document.getElementById("chart");
  if (!chart) return null;
  let node = chart.querySelector(".disclosure-popover");
  if (!node) {
    node = document.createElement("div");
    node.className = "disclosure-popover";
    node.hidden = true;
    chart.appendChild(node);
  }
  return node;
}

function hideDisclosurePopover() {
  const node = document.querySelector(".disclosure-popover");
  if (node) node.hidden = true;
}

function showDisclosurePopover(group, sourceEvent) {
  const node = ensureDisclosurePopover();
  const chart = document.getElementById("chart");
  if (!node || !chart || !group?.events?.length) return;

  const items = group.events.map((event) => {
    const url = event.url ? `<a href="${escapeHtml(event.url)}" target="_blank" rel="noopener">원문</a>` : "";
    const summary = event.summary ? `<p>${escapeHtml(event.summary)}</p>` : "";
    return `
      <li>
        <span class="disclosure-type">${escapeHtml(event.type || "공시")}</span>
        <strong>${escapeHtml(event.title)}</strong>
        ${summary}
        ${url}
      </li>
    `;
  }).join("");

  node.innerHTML = `
    <div class="disclosure-popover-head">
      <div>
        <b>${escapeHtml(group.name || labelName(group.ticker))}</b>
        <span>${escapeHtml(group.plotDate || "")}</span>
      </div>
      <button type="button" aria-label="공시 닫기">×</button>
    </div>
    <ul>${items}</ul>
  `;
  node.querySelector("button")?.addEventListener("click", hideDisclosurePopover, { once: true });

  const rect = chart.getBoundingClientRect();
  const clientX = sourceEvent?.clientX ?? (rect.left + rect.width * 0.5);
  const clientY = sourceEvent?.clientY ?? (rect.top + rect.height * 0.35);
  const width = Math.min(320, Math.max(248, rect.width - 24));
  const left = Math.max(12, Math.min(rect.width - width - 12, clientX - rect.left - width * 0.5));
  const maxTop = Math.max(12, rect.height - 180);
  const top = Math.max(12, Math.min(maxTop, clientY - rect.top + 12));

  node.style.width = `${width}px`;
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.hidden = false;
}

function handleDisclosureClick(evtData) {
  const point = evtData?.points?.find((p) => p?.data?.meta?.isDisclosureTrace);
  if (!point) return false;
  try {
    const raw = point.customdata?.[0];
    const group = JSON.parse(raw);
    showDisclosurePopover(group, evtData.event);
    return true;
  } catch (_) {
    return false;
  }
}

function findDisclosureEventPoint(evtData) {
  return evtData?.points?.find((p) => p?.data?.meta?.isDisclosureTrace) || null;
}

function resetDisclosureHoverHighlight(chartEl = document.getElementById("chart")) {
  if (!chartEl || !currentDisclosureHighlight) return;
  const traceIndex = currentDisclosureHighlight.traceIndex;
  currentDisclosureHighlight = null;
  Plotly.restyle(chartEl, {
    "marker.size": [DISCLOSURE_MARKER_SIZE],
    "marker.color": [DISCLOSURE_MARKER_COLOR],
    "marker.line.width": [DISCLOSURE_MARKER_LINE_WIDTH],
    "marker.line.color": [DISCLOSURE_MARKER_LINE_COLOR],
    "textfont.size": [DISCLOSURE_TEXT_SIZE],
    "textfont.color": [DISCLOSURE_MARKER_COLOR],
  }, [traceIndex]).catch(() => {});
}

function highlightDisclosureHoverPoint(evtData) {
  const chartEl = document.getElementById("chart");
  const point = findDisclosureEventPoint(evtData);
  if (!chartEl || !point) {
    resetDisclosureHoverHighlight(chartEl);
    return;
  }

  const traceIndex = point.curveNumber;
  const pointIndex = point.pointIndex ?? point.pointNumber;
  const count = Array.isArray(point.data?.x) ? point.data.x.length : 0;
  if (!Number.isInteger(traceIndex) || !Number.isInteger(pointIndex) || count <= 0) return;
  if (
    currentDisclosureHighlight
    && currentDisclosureHighlight.traceIndex === traceIndex
    && currentDisclosureHighlight.pointIndex === pointIndex
  ) {
    return;
  }

  resetDisclosureHoverHighlight(chartEl);

  const sizes = Array(count).fill(DISCLOSURE_MARKER_SIZE);
  const colors = Array(count).fill(DISCLOSURE_MARKER_COLOR);
  const lineWidths = Array(count).fill(DISCLOSURE_MARKER_LINE_WIDTH);
  const lineColors = Array(count).fill(DISCLOSURE_MARKER_LINE_COLOR);
  const textSizes = Array(count).fill(DISCLOSURE_TEXT_SIZE);
  const textColors = Array(count).fill(DISCLOSURE_MARKER_COLOR);

  sizes[pointIndex] = DISCLOSURE_MARKER_HOVER_SIZE;
  colors[pointIndex] = DISCLOSURE_MARKER_HOVER_COLOR;
  lineWidths[pointIndex] = DISCLOSURE_MARKER_HOVER_LINE_WIDTH;
  lineColors[pointIndex] = DISCLOSURE_MARKER_HOVER_LINE_COLOR;
  textSizes[pointIndex] = DISCLOSURE_TEXT_HOVER_SIZE;
  textColors[pointIndex] = DISCLOSURE_MARKER_HOVER_LINE_COLOR;

  currentDisclosureHighlight = { traceIndex, pointIndex };
  Plotly.restyle(chartEl, {
    "marker.size": [sizes],
    "marker.color": [colors],
    "marker.line.width": [lineWidths],
    "marker.line.color": [lineColors],
    "textfont.size": [textSizes],
    "textfont.color": [textColors],
  }, [traceIndex]).catch(() => {});
}

function yyyymmddFromDate(dateStr) {
  return String(dateStr || "").slice(0, 10).replace(/-/g, "");
}

function shiftYears(dateStr, years) {
  const d = new Date(`${String(dateStr || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return dateStr;
  const originalMonth = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCMonth() !== originalMonth) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function disclosureTargetTickers() {
  const tickers = new Set();
  (pricePayload?.series || []).forEach((series) => {
    const ticker = String(series || "").trim().toUpperCase();
    if (/^[0-9]{6}\.(KS|KQ)$/.test(ticker)) tickers.add(ticker);
  });
  customStocks.forEach((item) => {
    const ticker = String(item?.ticker || "").trim().toUpperCase();
    if (/^[0-9]{6}\.(KS|KQ)$/.test(ticker)) tickers.add(ticker);
  });
  return [...tickers];
}

function disclosureTargetMaps() {
  const byCode = new Map();
  const markets = new Set();
  disclosureTargetTickers().forEach((ticker) => {
    const code = ticker.slice(0, 6);
    if (!byCode.has(code)) byCode.set(code, ticker);
    markets.add(ticker.endsWith(".KQ") ? "K" : "Y");
  });
  return { byCode, markets: [...markets] };
}

function dartItemToDisclosureRecord(item, targetByCode) {
  const code = String(item?.stock_code || "").trim();
  if (!/^\d{6}$/.test(code) || !targetByCode.has(code)) return null;
  const title = String(item?.report_nm || "").trim();
  const type = classifyDisclosureType(title);
  if (!title) return null;
  if (!shouldDisplayDisclosure(title, type)) return null;
  const rawDate = String(item?.rcept_dt || "").trim();
  if (!/^\d{8}$/.test(rawDate)) return null;
  const receiptNo = String(item?.rcept_no || "").trim();
  return {
    ticker: targetByCode.get(code),
    code,
    name: String(item?.corp_name || labelName(targetByCode.get(code))).trim(),
    date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
    type,
    title,
    summary: "",
    source: "OpenDART",
    receiptNo,
    url: receiptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}` : "",
  };
}

async function fetchDartDisclosurePage(apiKey, market, pageNo) {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = shiftDays(endDate, -DART_RUNTIME_LOOKBACK_DAYS);
  const query = new URLSearchParams({
    crtfc_key: String(apiKey || "").trim(),
    bgn_de: yyyymmddFromDate(startDate),
    end_de: yyyymmddFromDate(endDate),
    last_reprt_at: "Y",
    corp_cls: market,
    sort: "date",
    sort_mth: "desc",
    page_no: String(pageNo),
    page_count: "100",
  });
  try {
    return await fetchJsonWithProxyFallback(
      `${DART_DISCLOSURE_URL}?${query.toString()}`,
      null,
      { allowProxy: Boolean(apiSettings?.dartProxyEnabled) },
    );
  } catch (err) {
    throw new Error(explainDartFetchError(err));
  }
}

async function fetchDartDisclosurePageForCorp(apiKey, corpCode, pageNo) {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = shiftYears(endDate, -DART_STOCK_LOOKBACK_YEARS);
  const query = new URLSearchParams({
    crtfc_key: String(apiKey || "").trim(),
    corp_code: String(corpCode || "").trim(),
    bgn_de: yyyymmddFromDate(startDate),
    end_de: yyyymmddFromDate(endDate),
    last_reprt_at: "Y",
    sort: "date",
    sort_mth: "asc",
    page_no: String(pageNo),
    page_count: "100",
  });
  try {
    return await fetchJsonWithProxyFallback(
      `${DART_DISCLOSURE_URL}?${query.toString()}`,
      null,
      { allowProxy: Boolean(apiSettings?.dartProxyEnabled) },
    );
  } catch (err) {
    throw new Error(explainDartFetchError(err));
  }
}

function appendDartDisclosureRecordsFromPayload(payload, targetByCode, records) {
  (payload?.list || []).forEach((item) => {
    const record = dartItemToDisclosureRecord(item, targetByCode);
    if (record) records.push(record);
  });
}

async function fetchDartDisclosuresLive(apiKey) {
  const clean = String(apiKey || "").trim();
  if (!clean) return [];
  const { byCode, markets } = disclosureTargetMaps();
  if (!byCode.size || !markets.length) return [];

  const records = [];
  for (const market of markets) {
    const firstPayload = await fetchDartDisclosurePage(clean, market, 1);
    const status = String(firstPayload?.status || "");
    if (status === "013") continue;
    if (status && status !== "000") {
      throw new Error(firstPayload?.message || `DART status ${status}`);
    }

    appendDartDisclosureRecordsFromPayload(firstPayload, byCode, records);

    const totalPage = Math.min(
      DART_RUNTIME_MAX_PAGES_PER_MARKET,
      Math.max(1, Number(firstPayload?.total_page) || 1),
    );
    for (let pageStart = 2; pageStart <= totalPage; pageStart += DART_RUNTIME_PAGE_BATCH) {
      const pageNos = [];
      for (let pageNo = pageStart; pageNo < pageStart + DART_RUNTIME_PAGE_BATCH && pageNo <= totalPage; pageNo += 1) {
        pageNos.push(pageNo);
      }
      const pages = await Promise.allSettled(pageNos.map((pageNo) => fetchDartDisclosurePage(clean, market, pageNo)));
      pages.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const payload = result.value;
        const pageStatus = String(payload?.status || "");
        if (pageStatus && pageStatus !== "000" && pageStatus !== "013") return;
        appendDartDisclosureRecordsFromPayload(payload, byCode, records);
      });
    }
  }
  return sanitizeDisclosureRows(records);
}

async function fetchDartDisclosuresForTickerLive(apiKey, ticker) {
  const clean = String(apiKey || "").trim();
  const targetTicker = String(ticker || "").trim().toUpperCase();
  const code = targetTicker.slice(0, 6);
  if (!clean || !/^[0-9]{6}\.(KS|KQ)$/.test(targetTicker)) return [];

  const corp = dartCorpCodeMap.get(code);
  if (!corp?.corp_code) {
    throw new Error("DART corp_code 매핑을 찾지 못했습니다. 앱을 새로고침한 뒤 다시 시도해 주세요.");
  }

  const targetByCode = new Map([[code, targetTicker]]);
  const records = [];

  const firstPayload = await fetchDartDisclosurePageForCorp(clean, corp.corp_code, 1);
  const firstStatus = String(firstPayload?.status || "");
  if (firstStatus === "013") return [];
  if (firstStatus && firstStatus !== "000") {
    throw new Error(firstPayload?.message || `DART status ${firstStatus}`);
  }
  appendDartDisclosureRecordsFromPayload(firstPayload, targetByCode, records);

  const totalPage = Math.max(1, Number(firstPayload?.total_page) || 1);
  for (let pageStart = 2; pageStart <= totalPage; pageStart += DART_STOCK_PAGE_BATCH) {
    const pageNos = [];
    for (let pageNo = pageStart; pageNo < pageStart + DART_STOCK_PAGE_BATCH && pageNo <= totalPage; pageNo += 1) {
      pageNos.push(pageNo);
    }
    const pages = await Promise.allSettled(
      pageNos.map((pageNo) => fetchDartDisclosurePageForCorp(clean, corp.corp_code, pageNo)),
    );
    pages.forEach((result) => {
      if (result.status !== "fulfilled") return;
      const payload = result.value;
      const status = String(payload?.status || "");
      if (status && status !== "000" && status !== "013") return;
      appendDartDisclosureRecordsFromPayload(payload, targetByCode, records);
    });
  }
  return sanitizeDisclosureRows(records);
}

function mergeDisclosureRows(existingRows, incomingRows) {
  const map = new Map();
  sanitizeDisclosureRows(existingRows).forEach((row) => {
    map.set(`${row.ticker}|${row.date}|${row.title}`, row);
  });
  sanitizeDisclosureRows(incomingRows).forEach((row) => {
    map.set(`${row.ticker}|${row.date}|${row.title}`, row);
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}

async function refreshDartDisclosuresFromApi(apiKey, ticker = "") {
  const liveRows = ticker
    ? await fetchDartDisclosuresForTickerLive(apiKey, ticker)
    : await fetchDartDisclosuresLive(apiKey);
  const beforeCount = disclosureRows.length;
  disclosureRows = mergeDisclosureRows(disclosureRows, liveRows);
  const latestDate = disclosureRows.length ? disclosureRows[disclosureRows.length - 1].date : "";
  return {
    fetched: liveRows.length,
    added: Math.max(0, disclosureRows.length - beforeCount),
    latestDate,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.min(Number(limit) || 1, source.length || 1));
  const results = Array(source.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(source[index], index);
    }
  }));
  return results;
}

async function refreshDartDisclosuresForVisibleTickersFromApi(apiKey) {
  const tickers = disclosureTargetTickers()
    .filter((ticker) => !hiddenSeries.has(ticker));
  const uniqueTickers = [...new Set(tickers)];
  const beforeCount = disclosureRows.length;
  const incomingRows = [];
  const failed = [];

  const results = await mapWithConcurrency(uniqueTickers, DART_VISIBLE_REFRESH_CONCURRENCY, async (ticker) => {
    try {
      const rows = await fetchDartDisclosuresForTickerLive(apiKey, ticker);
      return { ticker, rows };
    } catch (err) {
      return { ticker, error: err };
    }
  });

  results.forEach((result) => {
    if (!result) return;
    if (result.error) {
      failed.push(`${labelName(result.ticker)}: ${result.error.message}`);
      return;
    }
    incomingRows.push(...(result.rows || []));
  });

  disclosureRows = mergeDisclosureRows(disclosureRows, incomingRows);

  const latestDate = disclosureRows.length ? disclosureRows[disclosureRows.length - 1].date : "";
  return {
    fetched: incomingRows.length,
    added: Math.max(0, disclosureRows.length - beforeCount),
    latestDate,
    failed,
  };
}

let dartDisclosureRefreshPromise = null;

function requestDartDisclosureRefreshForTicker(ticker, msgEl) {
  const apiKey = String(apiSettings?.dartApiKey || "").trim();
  if (!apiKey || dartDisclosureRefreshPromise) return;

  const name = labelName(ticker);
  enableDisclosureMarkers();
  saveState();
  setMessage(msgEl, [`${name} 종목을 추가했습니다. DART 공시를 백그라운드로 확인하는 중입니다...`]);
  dartDisclosureRefreshPromise = refreshDartDisclosuresFromApi(apiKey, ticker)
    .then((info) => {
      renderChart(false);
      saveLastRuntimeSnapshot().catch(() => {});
      if (info.fetched > 0) {
        setMessage(msgEl, [
          `${name} 종목을 추가했습니다.`,
          `DART 공시 ${info.fetched}건 확인, ${info.added}건 반영${info.latestDate ? `(~ ${info.latestDate})` : ""}`,
          lastDisclosureTraceStats.markers > 0
            ? `현재 차트에 공시 마커 ${lastDisclosureTraceStats.markers}개 표시됨`
            : "공시 데이터는 확인했지만 현재 차트 범위에는 표시할 마커가 없습니다.",
        ]);
      } else {
        setMessage(msgEl, [
          `${name} 종목을 추가했습니다.`,
          "DART 최근 공시에서 현재 차트 종목의 이벤트를 찾지 못했습니다.",
        ]);
      }
    })
    .catch((err) => {
      setMessage(msgEl, [
        `${name} 종목은 추가됐지만 DART 공시 백그라운드 갱신은 실패했습니다.`,
        err.message,
      ], true);
    })
    .finally(() => {
      dartDisclosureRefreshPromise = null;
    });
}

/* Main chart */

function renderChart(preserveZoom = true) {
  const el = document.getElementById("chart");
  const msgEl = document.getElementById("messageArea");
  const priceRows = pricePayload.records || [];
  const today = new Date().toISOString().slice(0, 10);

  const minCandidates = [];
  const maxCandidates = [];
  const pushBounds = (rows) => {
    if (!Array.isArray(rows) || !rows.length) return;
    const first = String(rows[0]?.date || "").slice(0, 10);
    const last = String(rows[rows.length - 1]?.date || "").slice(0, 10);
    if (first) minCandidates.push(first);
    if (last) maxCandidates.push(last);
  };

  pushBounds(priceRows);
  pushBounds(macroRows);
  pushBounds(creditRows);
  pushBounds(adrRows);
  renderDataFreshness();

  const maxDate = maxCandidates.length
    ? maxCandidates.reduce((mx, d) => (d > mx ? d : mx), maxCandidates[0])
    : today;
  const minDate = minCandidates.length
    ? minCandidates.reduce((mn, d) => (d < mn ? d : mn), minCandidates[0])
    : maxDate;

  const end = maxDate;
  let start = shiftMonths(end, activeMonths);
  if (start < minDate) start = minDate;

  const { rows, macroCols, liveCols } = mergeSources(priceRows, macroRows, creditRows, start, end);
  currentRows = rows;
  currentStart = start;
  const allowedSeries = new Set([
    ...CORE_SERIES,
    ...ADR_SERIES,
    ...customStocks.map((item) => item.ticker),
  ]);
  const allSeries = sortSeries(
    [...new Set([...liveCols, ...macroCols])]
      .filter((s) => allowedSeries.has(s))
      .filter((s) => rows.some((r) => toNum(r[s]) !== null))
  );
  syncSeriesToggleBoard(allSeries);
  // ADR series are rendered in the sub-chart, so exclude them from the main chart set.
  const selected = sortSeries(allSeries.filter((s) => !ADR_SERIES.includes(s)));
  if (!selected.length) {
    const fallback = sortSeries(allSeries);
    selected.push(...fallback.slice(0, 2));
  }
  currentSelected = [...selected];
  if (!showDisclosures) hideDisclosurePopover();
  hoveredLineTraceIndex = null;
  activeLineTraceIndex = null;
  appliedLineHighlightTraceIndex = null;
  currentDisclosureHighlight = null;
  el.classList.remove("is-line-hovering", "is-line-dragging");

  if (!rows.length || !selected.length) {
    msgEl.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }
  msgEl.innerHTML = "";

  // Common normalization base
  const commonNormBases = {};
  const firstDates = selected.map((s) => {
    const r = rows.find((row) => toNum(row[s]) !== null);
    return r ? r.date : null;
  }).filter(Boolean);
  const commonBaseDate = firstDates.length ? firstDates.reduce((mx, d) => (d > mx ? d : mx)) : null;
  if (commonBaseDate) {
    selected.forEach((s) => {
      const r = rows.find((row) => row.date >= commonBaseDate && toNum(row[s]) !== null);
      commonNormBases[s] = r ? toNum(r[s]) : null;
    });
  }
  const visibleForAuto = selected.filter((s) => !hiddenSeries.has(s));
  const autoScales = autoFitScales(
    rows,
    visibleForAuto.length ? visibleForAuto : selected,
    commonNormBases,
  );
  const chartYBySeries = {};

  const traces = selected.map((series, i) => {
    const rawValues = rows.map((r) => toNum(r[series]));
    const rawTexts = rawValues.map((v) => formatActualValue(v));
    const baseLineWidth = macroCols.includes(series) ? 3 : 2;

    let values = [...rawValues];
    const base = commonNormBases[series];
    values = (base && base !== 0)
      ? values.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null))
      : normalizeSeries(values);
    values = centeredScale(values, series === "leading_cycle" ? 100 : (autoScales[series] || 100), true);

    baseTraceValues[series] = values;

    const userScale = seriesScales[series] != null ? seriesScales[series] : defaultSeriesScale(series);
    if (userScale !== 1) {
      values = values.map((v) => (v !== null ? 100 + (v - 100) * userScale : null));
    }

    const offset = seriesOffsets[series] || 0;
    if (offset) values = values.map((v) => (v !== null ? v + offset : null));

    const xValues = rows.map((r) => r.date);
    chartYBySeries[series] = new Map(xValues.map((date, valueIndex) => [date, values[valueIndex]]));

    return {
      x: xValues,
      y: values,
      text: rawTexts,
      type: "scatter",
      mode: "lines",
      name: labelName(series),
      visible: hiddenSeries.has(series) ? "legendonly" : true,
      connectgaps: true,
      meta: { seriesKey: series, baseLineWidth },
      line: {
        color: seriesColor(series),
        width: baseLineWidth,
        shape: "linear",
      },
      marker: { symbol: "circle", size: 7, color: seriesColor(series) },
      hovertemplate: "%{text}<extra>%{fullData.name}</extra>",
    };
  });

  if (!showDisclosures) {
    lastDisclosureTraceStats = { total: disclosureRows.length, candidates: 0, markers: 0 };
  }
  const disclosureTrace = showDisclosures
    ? buildDisclosureTrace(rows, selected, chartYBySeries, start, end)
    : null;
  if (disclosureTrace) traces.push(disclosureTrace);
  syncDisclosureToggleButton(lastDisclosureTraceStats.markers);

  // Preserve zoom while reapplying handle transforms and updated traces.

  if (!preserveZoom) pinnedXRange = null;
  const savedXRange = preserveZoom
    ? (pinnedXRange ? [...pinnedXRange] : (el._fullLayout?.xaxis?.range?.slice() || null))
    : null;
  const savedYRange = preserveZoom ? (el._fullLayout?.yaxis?.range?.slice() || null) : null;
  const defaultXRange = [start, end];

  Plotly.react(el, traces, {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    margin: { l: 42, r: 42, t: 28, b: 32 },
    hovermode: "x unified",
    showlegend: false,
    legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
    xaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, color: "#666", tickfont: { size: 10 }, fixedrange: false, showspikes: false, hoverformat: "%Y.%-m.%-d", ...(savedXRange ? { range: savedXRange } : { range: defaultXRange, autorange: false }) },
    yaxis: { showticklabels: false, title: "", showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, fixedrange: true, ...(savedYRange ? { range: savedYRange, autorange: false } : {}) },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: hoverShowPopup ? { bgcolor: "rgba(34,34,34,0.45)", bordercolor: "rgba(140,140,140,0.35)", font: { color: "#eee" } } : { bgcolor: "rgba(0,0,0,0)", bordercolor: "rgba(0,0,0,0)", font: { color: "rgba(0,0,0,0)", size: 1 } },
    dragmode: false,
  }, PLOTLY_CONFIG);

  if (!legendHandlerSet) {
    el.on("plotly_legendclick", (evtData) => {
      const idx = evtData.curveNumber;
      const key = currentSelected[idx];
      if (key) {
        if (hiddenSeries.has(key)) hiddenSeries.delete(key);
        else hiddenSeries.add(key);
      }
      Plotly.restyle(el, { visible: hiddenSeries.has(key) ? "legendonly" : true }, [idx]);
      saveState();
      updateHandles();
      return false;
    });
    el.on("plotly_legenddoubleclick", () => {
      hiddenSeries.clear();
      Plotly.restyle(el, { visible: currentSelected.map(() => true) });
      saveState();
      updateHandles();
      return false;
    });
    el.on("plotly_relayout", (eventData) => {
      const rangePair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
      const hasRange = (eventData["xaxis.range[0]"] != null && eventData["xaxis.range[1]"] != null)
        || (Array.isArray(rangePair) && rangePair.length === 2);
      const hasAuto = eventData["xaxis.autorange"] === true;
      if (chartSyncing || isHandleDragging) return;
      if (cursorSyncing && !hasRange && !hasAuto) return;
      setTimeout(updateHandles, 50);
      // Sync main chart pan/zoom to ADR chart x-axis.
      const adrEl = document.getElementById("chart-adr");
      if (adrEl && adrEl.data) {
        const r0 = eventData["xaxis.range[0]"] ?? (Array.isArray(rangePair) ? rangePair[0] : null);
        const r1 = eventData["xaxis.range[1]"] ?? (Array.isArray(rangePair) ? rangePair[1] : null);
        if (r0 != null && r1 != null) {
          pinnedXRange = [r0, r1];
          chartSyncing = true;
          Plotly.relayout(adrEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }).finally(() => { chartSyncing = false; });
        } else if (hasAuto) {
          pinnedXRange = null;
          const mainRange = el._fullLayout?.xaxis?.range?.slice();
          chartSyncing = true;
          if (Array.isArray(mainRange) && mainRange.length === 2) {
            Plotly.relayout(adrEl, { "xaxis.range[0]": mainRange[0], "xaxis.range[1]": mainRange[1] }).finally(() => { chartSyncing = false; });
          } else {
            Plotly.relayout(adrEl, { "xaxis.autorange": true }).finally(() => { chartSyncing = false; });
          }
        }
      }
    });
    el.on("plotly_hover", (eventData) => {
      highlightDisclosureHoverPoint(eventData);
      if (hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      const adrEl = document.getElementById("chart-adr");
      syncHoverToChart(adrEl, xValue);
    });
    el.on("plotly_unhover", () => {
      resetDisclosureHoverHighlight(el);
      if (hoverSyncing) return;
      const adrEl = document.getElementById("chart-adr");
      clearHoverOnChart(adrEl);
    });
    el.on("plotly_click", (evtData) => {
      if (Date.now() < suppressPlotlyClickUntil) return;
      if (handleDisclosureClick(evtData)) return;
      // iPhone Safari sends click after touchend; if we auto-reset here,
      // double-tap zoom is immediately cancelled when the finger is lifted.
      if (isTouchDevice()) return;
      Plotly.relayout(el, { "xaxis.autorange": true, "yaxis.autorange": true });
    });
    legendHandlerSet = true;
  }

  updateHandles();
  const mainRangeForAdr = el._fullLayout?.xaxis?.range?.slice() || (savedXRange ? [...savedXRange] : null);
  renderAdrChart(mainRangeForAdr ? [...mainRangeForAdr] : null);
  bindCursorMoveSync();
}

/* ADR sub-chart rendering (source: adrinfo.kr) */

// Threshold zone styling for ADR visualization.
const ADR_ZONE_LOW_COLOR   = "#b0c6ed";   // < 80
const ADR_ZONE_HIGH_COLOR  = "#e6adad";   // > 120
const ADR_BAND_COLOR       = "rgba(100,100,100,0.06)";
const ADR_LOW_THRESH  = 80;
const ADR_HIGH_THRESH = 120;

/**
 * Build ADR overlay traces with segmented zones.
 *   - below 80  : low-risk/oversold zone fill
 *   - 80 ~ 120  : neutral zone line
 *   - above 120 : high-risk/overheated zone fill
 *
 * Uses threshold baselines with fill="tonexty" to avoid filling toward y=0.
 */
function buildAdrZoneTraces(dates, values, mainColor, legendName) {
  const base = { x: dates, type: "scatter", mode: "lines", connectgaps: false };
  const noHover = { hoverinfo: "skip", hovertemplate: undefined };

  // Split series into low/mid/high bands for coloring.
  const yLow = [], yMid = [], yHigh = [];
  const yBaseLow = [], yBaseHigh = [];   // Threshold baselines used by tonexty fills

  values.forEach((v) => {
    const isLow  = v !== null && v < ADR_LOW_THRESH;
    const isHigh = v !== null && v > ADR_HIGH_THRESH;
    const isMid  = v !== null && !isLow && !isHigh;
    yLow.push(isLow   ? v : null);
    yMid.push(isMid   ? v : null);
    yHigh.push(isHigh ? v : null);
    yBaseLow.push(isLow   ? ADR_LOW_THRESH  : null);
    yBaseHigh.push(isHigh ? ADR_HIGH_THRESH : null);
  });

  // Add seam points at threshold crossings so zone transitions look continuous.
  // Handles 4 cases:
  //   (A) mid -> low
  //   (B) low -> mid
  //   (C) mid -> high
  //   (D) high -> mid
  // This prevents tiny gaps in area fills around crossing points.
  for (let i = 0; i < values.length; i++) {
    const v    = values[i];
    if (v === null) continue;
    const prev = i > 0 ? values[i - 1] : null;
    if (prev === null) continue;
    // (A) mid -> low
    if (v < ADR_LOW_THRESH  && prev >= ADR_LOW_THRESH)  { yMid[i]  = v; yBaseLow[i]  = ADR_LOW_THRESH; }
    // (B) low -> mid
    if (v >= ADR_LOW_THRESH && prev <  ADR_LOW_THRESH)  { yLow[i]  = v; yBaseLow[i]  = ADR_LOW_THRESH; }
    // (C) mid -> high
    if (v > ADR_HIGH_THRESH && prev <= ADR_HIGH_THRESH) { yMid[i]  = v; yBaseHigh[i] = ADR_HIGH_THRESH; }
    // (D) high -> mid
    if (v <= ADR_HIGH_THRESH && prev > ADR_HIGH_THRESH) { yHigh[i] = v; yBaseHigh[i] = ADR_HIGH_THRESH; }
  }

  return [
    // Low zone fill (< 80)
    { ...base, y: yBaseLow,  showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, mode: "lines+markers", y: yLow, name: legendName, showlegend: true, legendgroup: legendName,
      line: { color: ADR_ZONE_LOW_COLOR, width: 1.5 },
      marker: { symbol: "circle", size: 7, color: mainColor },
      fill: "tonexty", fillcolor: "rgba(176,198,237,0.15)", ...noHover },

    // Mid zone line (80~120)
    { ...base, y: yMid, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: mainColor, width: 2 }, ...noHover },

    // High zone fill (> 120)
    { ...base, y: yBaseHigh, showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, y: yHigh, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: ADR_ZONE_HIGH_COLOR, width: 1.5 },
      fill: "tonexty", fillcolor: "rgba(230,173,173,0.15)", ...noHover },
  ];
}

let adrRows = [];   // ADR daily records (seed file + live append)

const ADR_SOURCE_URL = "http://www.adrinfo.kr/chart";
const CORS_PROXY     = "https://corsproxy.io/?url=";

function renderAdrChart(xRange) {
  const el = document.getElementById("chart-adr");
  if (!el || !adrRows.length) return;

  // Filter ADR rows by active time range.
  const allDates = adrRows.map((r) => r.date);
  const maxDate = allDates[allDates.length - 1];
  const startDate = shiftMonths(maxDate, activeMonths);
  const filtered = adrRows.filter((r) => r.date >= startDate);
  if (!filtered.length) return;

  const dates = filtered.map((r) => r.date);
  const kospiVals  = filtered.map((r) => toNum(r.adr_kospi));
  const kosdaqVals = filtered.map((r) => toNum(r.adr_kosdaq));

  const adrNums = [...kospiVals, ...kosdaqVals].filter((v) => Number.isFinite(v));
  const adrRawMin = adrNums.length ? Math.min(...adrNums) : ADR_LOW_THRESH;
  const adrRawMax = adrNums.length ? Math.max(...adrNums) : ADR_HIGH_THRESH;
  const adrYMin = Math.min(adrRawMin, ADR_LOW_THRESH) - 2.5;
  const adrYMax = Math.max(adrRawMax, ADR_HIGH_THRESH) + 1.2;

  const hoverProxyTraces = [
    {
      x: dates,
      y: dates.map((_, i) => {
        const k = kospiVals[i];
        const q = kosdaqVals[i];
        return Number.isFinite(k) ? k : (Number.isFinite(q) ? q : null);
      }),
      customdata: dates.map((_, i) => [
        Number.isFinite(kospiVals[i]) ? `${kospiVals[i].toFixed(2)}%` : "N/A",
        Number.isFinite(kosdaqVals[i]) ? `${kosdaqVals[i].toFixed(2)}%` : "N/A",
      ]),
      type: "scatter",
      mode: "lines",
      name: "ADR HOVER",
      showlegend: false,
      connectgaps: false,
      line: { color: "rgba(0,0,0,0)", width: 1 },
      hovertemplate: "KOSPI. %{customdata[0]}<br>KOSDAQ. %{customdata[1]}<extra></extra>",
    },
  ];

  const traces = [
    ...buildAdrZoneTraces(dates, kospiVals,  "#facc15", "ADR KOSPI"),
    ...buildAdrZoneTraces(dates, kosdaqVals, "#f472b6", "ADR KOSDAQ"),
    ...hoverProxyTraces,
  ];

  const layout = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    // Keep left/right margins identical with the main chart so synced cursor lines
    // stay visually aligned across the full width (especially near edges).
    margin: { l: 42, r: 42, t: 14, b: 36 },
    hovermode: "x unified",
    showlegend: true,
    legend: {
      orientation: "h", x: 0.5, y: 1.12, xanchor: "center",
      font: { color: "rgba(255,255,255,0.7)", size: 10 },
    },
    shapes: [
      // Highlight neutral ADR band (80~120)
      {
        type: "rect", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_HIGH_THRESH,
        fillcolor: ADR_BAND_COLOR, line: { width: 0 }, layer: "below",
      },
      // 80% reference line
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_LOW_THRESH,
        line: { color: ADR_ZONE_LOW_COLOR, width: 0.9, dash: "dash" },
      },
      // 120% reference line
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_HIGH_THRESH, y1: ADR_HIGH_THRESH,
        line: { color: ADR_ZONE_HIGH_COLOR, width: 0.9, dash: "dash" },
      },
      // 100% center line
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: 100, y1: 100,
        line: { color: "rgba(255,255,255,0.15)", width: 0.8, dash: "dot" },
      },
    ],
    annotations: [
      {
        xref: "paper", yref: "y", x: 1.01, y: ADR_LOW_THRESH,
        text: "80%", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_LOW_COLOR, size: 9 },
      },
      {
        xref: "paper", yref: "y", x: 1.01, y: ADR_HIGH_THRESH,
        text: "120%", showarrow: false, xanchor: "left",
        font: { color: ADR_ZONE_HIGH_COLOR, size: 9 },
      },
    ],
    xaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
      zeroline: false, color: "#666", tickfont: { size: 9 },
      fixedrange: false,
      showspikes: false,
      hoverformat: "%Y, %-m, %-d",
      ...(xRange ? { range: xRange } : {}),
    },
    yaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1,
      zeroline: false, color: "#666", tickfont: { size: 9 },
      fixedrange: true, ticksuffix: "%",
      tickformat: ".0f",
      autorange: false,
      range: [adrYMin, adrYMax],
    },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: hoverShowPopup ? { bgcolor: "rgba(34,34,34,0.45)", bordercolor: "rgba(140,140,140,0.35)", font: { color: "#eee", size: 11 } } : { bgcolor: "rgba(0,0,0,0)", bordercolor: "rgba(0,0,0,0)", font: { color: "rgba(0,0,0,0)", size: 1 } },
    dragmode: false,
  };

  Plotly.react(el, traces, layout, PLOTLY_CONFIG);

  if (!adrHandlerSet) {
    el.on("plotly_relayout", (eventData) => {
      const rangePair = Array.isArray(eventData["xaxis.range"]) ? eventData["xaxis.range"] : null;
      const hasRange = (eventData["xaxis.range[0]"] != null && eventData["xaxis.range[1]"] != null)
        || (Array.isArray(rangePair) && rangePair.length === 2);
      const hasAuto = eventData["xaxis.autorange"] === true;
      if (chartSyncing) return;
      if (cursorSyncing && !hasRange && !hasAuto) return;
      const mainEl = document.getElementById("chart");
      if (mainEl && mainEl.data) {
        const r0 = eventData["xaxis.range[0]"] ?? (Array.isArray(rangePair) ? rangePair[0] : null);
        const r1 = eventData["xaxis.range[1]"] ?? (Array.isArray(rangePair) ? rangePair[1] : null);
        if (r0 != null && r1 != null) {
          pinnedXRange = [r0, r1];
          chartSyncing = true;
          Plotly.relayout(mainEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }).finally(() => { chartSyncing = false; });
        } else if (hasAuto) {
          pinnedXRange = null;
          const adrRange = el._fullLayout?.xaxis?.range?.slice();
          chartSyncing = true;
          if (Array.isArray(adrRange) && adrRange.length === 2) {
            Plotly.relayout(mainEl, { "xaxis.range[0]": adrRange[0], "xaxis.range[1]": adrRange[1] }).finally(() => { chartSyncing = false; });
          } else {
            Plotly.relayout(mainEl, { "xaxis.autorange": true }).finally(() => { chartSyncing = false; });
          }
        }
      }
    });
    el.on("plotly_hover", (eventData) => {
      if (hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      const mainEl = document.getElementById("chart");
      syncHoverToChart(mainEl, xValue);
    });
    el.on("plotly_unhover", () => {
      if (hoverSyncing) return;
      const mainEl = document.getElementById("chart");
      clearHoverOnChart(mainEl);
    });
    adrHandlerSet = true;
  }
}

function syncButtons() {
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.months) === activeMonths);
  });
}

function toYyyymm(dateObj) {
  const year = dateObj.getUTCFullYear();
  const month = `${dateObj.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}${month}`;
}

function monthCodeToDate(code) {
  const raw = String(code || "").trim();
  if (!/^\d{6}$/.test(raw)) return "";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-01`;
}

function dayCodeToDate(code) {
  const raw = String(code || "").trim();
  if (!/^\d{8}$/.test(raw)) return "";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function normalizeLeadingRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    const value = toNum(row?.leading_cycle);
    if (!date || !Number.isFinite(value)) return;
    map.set(date, { date, leading_cycle: value });
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeCreditRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    const next = {
      date,
      kospi_credit: toNum(row?.kospi_credit),
      kosdaq_credit: toNum(row?.kosdaq_credit),
    };
    if (!Number.isFinite(next.kospi_credit) && !Number.isFinite(next.kosdaq_credit)) return;
    const prev = map.get(date) || { date, kospi_credit: null, kosdaq_credit: null };
    map.set(date, {
      date,
      kospi_credit: Number.isFinite(next.kospi_credit) ? next.kospi_credit : prev.kospi_credit,
      kosdaq_credit: Number.isFinite(next.kosdaq_credit) ? next.kosdaq_credit : prev.kosdaq_credit,
    });
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeLeadingSources(ecosRows, kosisRows) {
  const out = new Map();
  normalizeLeadingRows(kosisRows).forEach((row) => out.set(row.date, row));
  normalizeLeadingRows(ecosRows).forEach((row) => out.set(row.date, row));
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sameNullableNumber(a, b) {
  const na = toNum(a);
  const nb = toNum(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) <= 1e-9;
}

async function fetchJsonWithProxyFallback(url, init = null, options = {}) {
  const allowProxy = options?.allowProxy !== false;
  const candidates = allowProxy ? [url, CORS_PROXY + encodeURIComponent(url)] : [url];
  let lastError = "Request failed";
  for (const target of candidates) {
    try {
      const requestInit = { cache: "no-store", ...(init || {}) };
      const res = await fetch(target, requestInit);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const text = await res.text();
      if (!text) {
        lastError = "Empty response";
        continue;
      }
      return JSON.parse(text);
    } catch (err) {
      lastError = err?.message || String(err);
    }
  }
  throw new Error(lastError);
}
async function fetchEcosLeadingCycleLive(apiKey) {
  const clean = String(apiKey || "").trim();
  if (!clean) return [];
  const endYm = toYyyymm(new Date());
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(clean)}/json/kr/1/5000/${ECOS_STAT_CODE}/M/${ECOS_START}/${endYm}/${ECOS_ITEM_CODE}`;
  const payload = await fetchJsonWithProxyFallback(url, null, { allowProxy: false });
  const rows = Array.isArray(payload?.StatisticSearch?.row) ? payload.StatisticSearch.row : [];
  return normalizeLeadingRows(rows.map((row) => ({
    date: monthCodeToDate(row?.TIME),
    leading_cycle: toNum(row?.DATA_VALUE),
  })));
}

async function fetchKosisLeadingCycleLive(apiKey) {
  const clean = String(apiKey || "").trim();
  if (!clean) return [];
  const query = new URLSearchParams({
    method: "getList",
    apiKey: clean,
    format: "json",
    jsonVD: "Y",
    orgId: "101",
    tblId: "DT_1C8015",
    itmId: "T1",
    objL1: "A03",
    prdSe: "M",
    startPrdDe: KOSIS_START,
    endPrdDe: "209912",
  });
  const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${query.toString()}`;
  const payload = await fetchJsonWithProxyFallback(url, null, { allowProxy: false });
  const rows = Array.isArray(payload) ? payload : [];
  return normalizeLeadingRows(rows.map((row) => ({
    date: monthCodeToDate(row?.PRD_DE),
    leading_cycle: toNum(row?.DT),
  })));
}

function parseKofiaAmountToTrillion(rawValue) {
  const n = Number(String(rawValue ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1e12) * 10000) / 10000;
}

async function fetchKofiaCreditLive(apiKey) {
  const clean = String(apiKey || "").trim();
  if (!clean) return [];

  const keyCandidates = [clean];
  try {
    const decoded = decodeURIComponent(clean);
    if (decoded && decoded !== clean) keyCandidates.push(decoded);
  } catch (_) {
    // ignore
  }

  let lastError = null;

  for (const serviceKey of [...new Set(keyCandidates)]) {
    try {
      const rows = [];
      const numOfRows = 1000;
      const pageMeta = new Map();

      const fetchPage = async (pageNo) => {
        if (!Number.isFinite(pageNo) || pageNo < 1) return null;
        if (pageMeta.has(pageNo)) return pageMeta.get(pageNo);

        const query = new URLSearchParams({
          serviceKey,
          numOfRows: String(numOfRows),
          pageNo: String(pageNo),
          resultType: "json",
        });
        const url = appendCacheBust(`${KOFIA_CREDIT_URL}?${query.toString()}`);
        const payload = await fetchJsonWithProxyFallback(url, null, { allowProxy: false });

        const header = payload?.response?.header || {};
        if (header.resultCode && header.resultCode !== "00") {
          if (pageNo > 1) {
            const empty = { totalCount: 0, rowsPerPage: numOfRows, currentPage: pageNo, itemCount: 0 };
            pageMeta.set(pageNo, empty);
            return empty;
          }
          throw new Error(header.resultMsg || "KOFIA API error");
        }

        const body = payload?.response?.body || {};
        const rawItems = body?.items?.item;
        const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);

        items.forEach((item) => {
          const basDt = String(item?.basDt || "");
          if (!/^\d{8}$/.test(basDt)) return;
          const date = `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6, 8)}`;
          const kospi = parseKofiaAmountToTrillion(item?.crdTrFingScrs);
          const kosdaq = parseKofiaAmountToTrillion(item?.crdTrFingKosdaq);
          if (!Number.isFinite(kospi) && !Number.isFinite(kosdaq)) return;
          rows.push({ date, kospi_credit: kospi, kosdaq_credit: kosdaq });
        });

        const totalCount = Number(body?.totalCount);
        const bodyNumRows = Number(body?.numOfRows);
        const rowsPerPage = Number.isFinite(bodyNumRows) && bodyNumRows > 0
          ? bodyNumRows
          : (items.length || numOfRows);
        const currentPage = Number(body?.pageNo) || pageNo;

        const meta = {
          totalCount: Number.isFinite(totalCount) ? totalCount : 0,
          rowsPerPage,
          currentPage,
          itemCount: items.length,
        };
        pageMeta.set(pageNo, meta);
        return meta;
      };

      const firstMeta = await fetchPage(1);
      if (!firstMeta || !firstMeta.itemCount) {
        const normalized = normalizeCreditRows(rows);
        if (normalized.length) return normalized;
        continue;
      }

      let lastPage = 1;
      if (Number.isFinite(firstMeta.totalCount) && firstMeta.totalCount > 0) {
        const rowsPerPage = Math.max(1, Number(firstMeta.rowsPerPage) || numOfRows);
        lastPage = Math.max(1, Math.ceil(firstMeta.totalCount / rowsPerPage));
      } else {
        let low = 1;
        let high = 2;
        let highMeta = await fetchPage(high);
        const maxProbe = 4096;

        while (highMeta && highMeta.itemCount > 0 && high < maxProbe) {
          low = high;
          high *= 2;
          highMeta = await fetchPage(high);
        }

        if (highMeta && highMeta.itemCount > 0) {
          lastPage = high;
        } else {
          let lo = low;
          let hi = high;
          while (lo + 1 < hi) {
            const mid = Math.floor((lo + hi) / 2);
            const midMeta = await fetchPage(mid);
            if (midMeta && midMeta.itemCount > 0) lo = mid;
            else hi = mid;
          }
          lastPage = lo;
        }
      }

      const pagesToFetch = [2, 3, lastPage, lastPage - 1, lastPage - 2, lastPage - 3]
        .filter((p) => Number.isFinite(p) && p > 1);

      for (const page of pagesToFetch) {
        await fetchPage(page);
      }

      const normalized = normalizeCreditRows(rows);
      if (normalized.length) return normalized;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function fetchFreesisCreditLive(startDate = "", endDate = "") {
  const today = new Date().toISOString().slice(0, 10);
  const safeEnd = String(endDate || "").slice(0, 10) || today;
  const safeStart = String(startDate || "").slice(0, 10)
    || shiftDays(safeEnd, -FREESIS_CREDIT_LOOKBACK_DAYS);
  const fromYmd = safeStart.replace(/-/g, "");
  const toYmd = safeEnd.replace(/-/g, "");
  if (!/^\d{8}$/.test(fromYmd) || !/^\d{8}$/.test(toYmd)) return [];

  const payload = {
    dmSearch: {
      OBJ_NM: FREESIS_CREDIT_OBJ_NM,
      tmpV1: "D",
      tmpV40: FREESIS_CREDIT_UNIT_CODE,
      tmpV45: fromYmd,
      tmpV46: toYmd,
    },
  };

  const response = await fetchJsonWithProxyFallback(
    appendCacheBust(FREESIS_CREDIT_META_URL),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload),
    },
  );

  const rows = Array.isArray(response?.ds1) ? response.ds1 : [];
  return normalizeCreditRows(rows.map((row) => ({
    date: dayCodeToDate(row?.TMPV1),
    kospi_credit: parseKofiaAmountToTrillion(row?.TMPV3),
    kosdaq_credit: parseKofiaAmountToTrillion(row?.TMPV4),
  })));
}

function applyLeadingCycleLiveRows(monthlyRows) {
  const normalized = normalizeLeadingRows(monthlyRows);
  if (!normalized.length || !pricePayload?.records?.length) return { updated: 0, latestDate: "" };

  const priceDates = (pricePayload.records || []).map((r) => r.date).filter(Boolean);
  if (!priceDates.length) return { updated: 0, latestDate: normalized[normalized.length - 1].date };

  const dense = buildDenseMacroRows(normalized, priceDates);
  if (!dense.length) return { updated: 0, latestDate: normalized[normalized.length - 1].date };

  const byDate = new Map((macroRows || []).map((row) => [row.date, { ...row }]));
  priceDates.forEach((date) => {
    if (!byDate.has(date)) byDate.set(date, { date });
  });

  let updated = 0;
  dense.forEach((row) => {
    const date = String(row.date || "").slice(0, 10);
    const value = toNum(row.leading_cycle);
    if (!date || !Number.isFinite(value)) return;
    const prev = byDate.get(date) || { date };
    if (!sameNullableNumber(prev.leading_cycle, value)) updated += 1;
    prev.leading_cycle = value;
    byDate.set(date, prev);
  });

  macroRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { updated, latestDate: normalized[normalized.length - 1].date };
}

function applyCreditLiveRows(liveRows) {
  const normalized = normalizeCreditRows(liveRows);
  if (!normalized.length) return { updated: 0, latestDate: "" };

  const byDate = new Map();
  (creditRows || []).forEach((row) => {
    const date = String(row?.date || "").slice(0, 10);
    if (!date) return;
    byDate.set(date, {
      date,
      kospi_credit: toNum(row?.kospi_credit),
      kosdaq_credit: toNum(row?.kosdaq_credit),
    });
  });

  let updated = 0;
  normalized.forEach((row) => {
    const prev = byDate.get(row.date) || { date: row.date, kospi_credit: null, kosdaq_credit: null };
    const next = {
      date: row.date,
      kospi_credit: Number.isFinite(toNum(row.kospi_credit)) ? toNum(row.kospi_credit) : prev.kospi_credit,
      kosdaq_credit: Number.isFinite(toNum(row.kosdaq_credit)) ? toNum(row.kosdaq_credit) : prev.kosdaq_credit,
    };
    if (!sameNullableNumber(prev.kospi_credit, next.kospi_credit) || !sameNullableNumber(prev.kosdaq_credit, next.kosdaq_credit)) {
      updated += 1;
    }
    byDate.set(row.date, next);
  });

  creditRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const latestDate = creditRows.length
    ? String(creditRows[creditRows.length - 1].date || "").slice(0, 10)
    : normalized[normalized.length - 1].date;
  return { updated, latestDate };
}

function medianCreditScaleFactor(existingRows, liveRows, key) {
  const existingByDate = new Map();
  normalizeCreditRows(existingRows).forEach((row) => {
    existingByDate.set(row.date, row);
  });

  const ratios = [];
  normalizeCreditRows(liveRows).forEach((row) => {
    const existing = existingByDate.get(row.date);
    const existingValue = toNum(existing?.[key]);
    const liveValue = toNum(row?.[key]);
    if (Number.isFinite(existingValue) && Number.isFinite(liveValue) && liveValue > 0) {
      ratios.push(existingValue / liveValue);
    }
  });

  if (!ratios.length) return 1;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const factor = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function scaleCreditRowsToExisting(liveRows, existingRows) {
  const normalized = normalizeCreditRows(liveRows);
  if (!normalized.length) return normalized;

  const factors = {
    kospi_credit: medianCreditScaleFactor(existingRows, normalized, "kospi_credit"),
    kosdaq_credit: medianCreditScaleFactor(existingRows, normalized, "kosdaq_credit"),
  };

  return normalized.map((row) => ({
    date: row.date,
    kospi_credit: Number.isFinite(toNum(row.kospi_credit))
      ? toNum(row.kospi_credit) * factors.kospi_credit
      : null,
    kosdaq_credit: Number.isFinite(toNum(row.kosdaq_credit))
      ? toNum(row.kosdaq_credit) * factors.kosdaq_credit
      : null,
  }));
}

async function refreshLiveApiData() {
  const applied = [];
  const warnings = [];

  const hasLeadingApi = Boolean(apiSettings.ecosApiKey || apiSettings.kosisApiKey);
  const hasCreditApi = Boolean(apiSettings.kofiaApiKey);
  if (!hasLeadingApi) {
    warnings.push("선행지수 API 키(ECOS 또는 KOSIS)가 없어 선행지수를 불러오지 못했습니다.");
  }
  if (!hasCreditApi) {
    warnings.push("KOFIA API 키가 없어 신용잔고는 저장 데이터까지만 표시됩니다.");
  }

  // Preserve seeded macro credit history while live APIs refresh only their own series.
  // Clearing macroRows here would remove pre-KOFIA credit data before 2021-11-09.
  let ecosRows = [];
  let kosisRows = [];

  if (apiSettings.ecosApiKey) {
    try {
      ecosRows = await fetchEcosLeadingCycleLive(apiSettings.ecosApiKey);
    } catch (err) {
      warnings.push(`ECOS 불러오기 오류: ${err.message}`);
    }
  }

  if (apiSettings.kosisApiKey) {
    try {
      kosisRows = await fetchKosisLeadingCycleLive(apiSettings.kosisApiKey);
    } catch (err) {
      warnings.push(`KOSIS 불러오기 오류: ${err.message}`);
    }
  }

  const leadingRows = mergeLeadingSources(ecosRows, kosisRows);
  if (leadingRows.length) {
    const info = applyLeadingCycleLiveRows(leadingRows);
    applied.push(`선행지수 순환변동치 반영(${info.updated}건, 최신일 ${info.latestDate})`);
  }

  if (apiSettings.kofiaApiKey) {
    try {
      const kofiaRows = await fetchKofiaCreditLive(apiSettings.kofiaApiKey);
      if (kofiaRows.length) {
        const info = applyCreditLiveRows(kofiaRows);
        applied.push(`신용잔고 반영(${info.updated}건, 최신일 ${info.latestDate})`);
      } else {
        warnings.push("KOFIA 응답에서 신용잔고 데이터를 찾지 못했습니다.");
      }
    } catch (err) {
      warnings.push(`KOFIA 불러오기 오류: ${err.message}`);
    }
  }

  warnings.push("Freesis 신용잔고 보조 데이터는 KOFIA와 값 체계가 달라 적용하지 않았습니다.");

  return { applied, warnings };
}
/**
 * Fetch adrinfo.kr/chart via CORS proxy, parse arrays, and append only new rows to adrRows.
 * Returns: { added: number, latestDate: string }
 */
async function refreshAdrFromWeb() {
  const sourceUrl = appendCacheBust(ADR_SOURCE_URL);
  const proxyUrl = CORS_PROXY + encodeURIComponent(sourceUrl);
  const res = await fetch(proxyUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`adrinfo.kr 응답 오류: ${res.status}`);
  const html = await res.text();

  function extractJsArray(src, varName) {
    const marker = `const ${varName}=`;
    const s = src.indexOf(marker);
    if (s < 0) return [];
    const e = src.indexOf("];", s) + 1;
    return JSON.parse(src.slice(s + marker.length, e).replace(/,\s*\]/g, "]"));
  }

  const kospiRaw  = extractJsArray(html, "kospi_adr");
  const kosdaqRaw = extractJsArray(html, "kosdaq_adr");
  if (!kospiRaw.length && !kosdaqRaw.length) throw new Error("ADR data parse failed. Source format may have changed.");

  const tsToDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
  const kospiMap  = new Map(kospiRaw.map(([ts, v])  => [tsToDate(ts), v]));
  const kosdaqMap = new Map(kosdaqRaw.map(([ts, v]) => [tsToDate(ts), v]));

  // Append only dates newer than the last known ADR date.
  const lastKnown = adrRows.length ? adrRows[adrRows.length - 1].date : "";
  const allDates  = [...new Set([...kospiMap.keys(), ...kosdaqMap.keys()])].sort();
  const newRows   = allDates
    .filter((d) => d > lastKnown)
    .map((d) => ({ date: d, adr_kospi: kospiMap.get(d) ?? null, adr_kosdaq: kosdaqMap.get(d) ?? null }))
    .filter((r) => r.adr_kospi !== null || r.adr_kosdaq !== null);

  if (newRows.length > 0) {
    adrRows = [...adrRows, ...newRows];
  }

  return {
    added: newRows.length,
    latestDate: adrRows.length ? adrRows[adrRows.length - 1].date : lastKnown,
  };
}

async function loadData(forceNetwork = false, options = {}) {
  const mergeWithExisting = Boolean(options?.mergeWithExisting);
  if (!pricePayload || typeof pricePayload !== "object") {
    pricePayload = { records: [], series: [], display_names: {} };
  } else {
    if (!Array.isArray(pricePayload.records)) pricePayload.records = [];
    if (!Array.isArray(pricePayload.series)) pricePayload.series = [];
    if (!pricePayload.display_names || typeof pricePayload.display_names !== "object") {
      pricePayload.display_names = {};
    }
  }
  if (!Array.isArray(macroRows)) macroRows = [];
  if (!Array.isArray(creditRows)) creditRows = [];
  const opt = forceNetwork ? { cache: "reload" } : {};
  const buildUrl = (path) => (forceNetwork ? appendCacheBust(path) : path);
  async function fetchSeedText(path) {
    const firstUrl = buildUrl(path);
    try {
      const firstRes = await fetch(firstUrl, opt);
      if (firstRes.ok) return await firstRes.text();
    } catch (_) {
      // Try fallback below.
    }
    if (!forceNetwork) return null;
    try {
      const fallbackRes = await fetch(path, { cache: "no-store" });
      if (fallbackRes.ok) return await fallbackRes.text();
    } catch (_) {
      // Ignore.
    }
    return null;
  }

  const [priceText, macroText, creditText, adrText, disclosureText, dartCorpCodeText] = await Promise.all([
    fetchSeedText("./data/prices.json"),
    fetchSeedText("./data/macro_data.json"),
    fetchSeedText("./data/credit_data.json"),
    fetchSeedText("./data/adr_data.json"),
    fetchSeedText("./data/disclosures.json"),
    fetchSeedText("./data/dart_corp_codes.json"),
  ]);

  try {
    if (priceText) {
      const payload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));
      if (payload && typeof payload === "object" && Array.isArray(payload.records)) {
        const priceRows = normalizePayloadRecords(payload.records);
        const seededPricePayload = {
          ...payload,
          records: priceRows,
          series: Array.isArray(payload.series) ? payload.series : getSeriesColumns(priceRows),
          display_names: payload.display_names && typeof payload.display_names === "object" ? payload.display_names : {},
        };
        pricePayload = mergeWithExisting
          ? mergePricePayloadPreservingExisting(pricePayload, seededPricePayload)
          : seededPricePayload;
        Object.assign(DISPLAY_NAMES, pricePayload.display_names || {});
      }
    }
  } catch (_) {
    // Price seed load failed; runtime refresh will still try core index APIs.
  }

  try {
    if (macroText) {
      const seededMacroRows = parseMacroPayload(macroText);
      if (seededMacroRows.length) {
        macroRows = mergeWithExisting
          ? mergeRowsPreservingExisting(macroRows, seededMacroRows)
          : seededMacroRows;
      }
    }
  } catch (_) {
    // Macro seed load failed; runtime refresh will still try live APIs.
  }

  try {
    if (creditText) {
      const seededCreditRows = parseMacroPayload(creditText);
      if (seededCreditRows.length) {
        creditRows = mergeWithExisting
          ? normalizeCreditRows(mergeRowsPreservingExisting(creditRows, seededCreditRows))
          : normalizeCreditRows(seededCreditRows);
      }
    }
  } catch (_) {
    // Credit seed load failed; runtime refresh will still try live APIs.
  }

  try {
    if (adrText) {
      const adrPayload = JSON.parse(adrText);
      if (Array.isArray(adrPayload?.records)) {
        adrRows = mergeWithExisting
          ? mergeRowsPreservingExisting(adrRows, adrPayload.records)
          : adrPayload.records;
      }
    }
  } catch (_) {
    // ADR seed load failed; runtime refresh will try web source next.
  }

  try {
    if (disclosureText) {
      const disclosurePayload = JSON.parse(disclosureText);
      const seededDisclosureRows = sanitizeDisclosureRows(disclosurePayload?.records || []);
      disclosureRows = mergeWithExisting
        ? mergeDisclosureRows(disclosureRows, seededDisclosureRows)
        : seededDisclosureRows;
    }
  } catch (_) {
    // Disclosure seed load failed; chart simply renders without event markers.
  }

  try {
    if (dartCorpCodeText) {
      const dartCorpCodePayload = JSON.parse(dartCorpCodeText);
      setDartCorpCodeRows(dartCorpCodePayload?.records || []);
    }
  } catch (_) {
    // DART corp code seed load failed; dynamic disclosure refresh will explain if needed.
  }
}

async function refreshRuntimeData(msgEl) {
  const infoLines = [];
  const warnLines = [];
  let refreshedDart = false;

  const coreIndexResult = await refreshCoreIndexSeries();
  infoLines.push(...coreIndexResult.applied);
  warnLines.push(...coreIndexResult.warnings);

  const preloadResult = await preloadCustomStocks({ forceRefresh: true });
  if (preloadResult.failedNames.length) {
    warnLines.push(`일부 선택 종목을 불러오지 못했습니다: ${preloadResult.failedNames.join(", ")}`);
  }

  try {
    const { added, latestDate } = await refreshAdrFromWeb();
    if (added > 0) {
      infoLines.push(`ADR ${added}건 추가 반영(~ ${latestDate})`);
    }
  } catch (adrErr) {
    warnLines.push(`ADR 불러오기 오류: ${adrErr.message}`);
  }

  if (apiSettings.dartApiKey) {
    try {
      const refreshCurrentTickers = Boolean(apiSettings.dartProxyEnabled);
      if (refreshCurrentTickers) {
        enableDisclosureMarkers();
        saveState();
      }
      const info = refreshCurrentTickers
        ? await refreshDartDisclosuresForVisibleTickersFromApi(apiSettings.dartApiKey)
        : await refreshDartDisclosuresFromApi(apiSettings.dartApiKey);
      refreshedDart = true;
      if (info.fetched > 0) {
        infoLines.push(`DART 공시 ${info.fetched}건 확인, ${info.added}건 반영${info.latestDate ? `(~ ${info.latestDate})` : ""}`);
        if (Array.isArray(info.failed) && info.failed.length) {
          warnLines.push(`일부 DART 종목 실패: ${info.failed.slice(0, 2).join(" / ")}`);
        }
      } else {
        warnLines.push("DART 최근 공시에서 현재 차트 종목의 주요 이벤트를 찾지 못했습니다.");
      }
    } catch (dartErr) {
      warnLines.push(`DART 공시 불러오기 오류: ${dartErr.message}`);
    }
  }

  const liveResult = await refreshLiveApiData();
  infoLines.push(...liveResult.applied);
  warnLines.push(...liveResult.warnings);

  renderChart(false);
  if (refreshedDart) {
    if (lastDisclosureTraceStats.markers > 0) {
      infoLines.push(`현재 차트에 공시 마커 ${lastDisclosureTraceStats.markers}개 표시됨`);
    } else if (showDisclosures && disclosureRows.length) {
      warnLines.push("공시 데이터는 있지만 현재 차트 범위/켜진 종목에는 표시할 마커가 없습니다.");
    }
  }
  try {
    await saveLastRuntimeSnapshot();
  } catch (cacheErr) {
    warnLines.push(`마지막 화면 저장 오류: ${cacheErr.message}`);
  }

  if (infoLines.length || warnLines.length) {
    setMessage(msgEl, [...infoLines, ...warnLines], infoLines.length === 0);
  } else {
    setMessage(msgEl, []);
  }
}

function waitForFirstPaint() {
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(done);
    } else {
      done();
    }
  });
}

async function boot() {
  const msgEl = document.getElementById("messageArea");
  showStartupLoader();
  setStartupLoaderProgress(4, "Preparing");
  loadState();
  loadApiSettings();
  renderCustomStockButtons();
  bindSeriesToggleBoard();
  setupStockAddPanel(msgEl);
  syncButtons();
  setupApiSettingsPanel(msgEl);
  syncApiOptionsButton();
  renderAppVersionLabel();
  bindRuntimeSnapshotExitSave();
  setStartupLoaderProgress(10, "Preparing");
  try {
    const restoredLastSnapshot = await loadLastRuntimeSnapshot();
    if (restoredLastSnapshot) {
      setStartupLoaderProgress(42, "Restoring last view");
    } else {
      await loadData(true);
      setStartupLoaderProgress(45, "Loading saved data");
    }
    renderChart(false);
    setStartupLoaderProgress(72, restoredLastSnapshot ? "Rendering last view" : "Rendering saved data");

    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeMonths = Number(btn.dataset.months);
        pinnedXRange = null;
        syncButtons();
        saveState();
        renderChart(false);
      });
    });

    document.getElementById("resetHandles").addEventListener("click", resetHandles);

    // Hover popup toggle
    const hoverToggleBtn = document.getElementById("hoverToggle");
    const applyHoverState = () => {
      document.getElementById("chart")?.classList.toggle("no-hover-popup", !hoverShowPopup);
      document.getElementById("chart-adr")?.classList.toggle("no-hover-popup", !hoverShowPopup);
    };
    if (hoverToggleBtn) {
      hoverToggleBtn.classList.toggle("is-active", hoverShowPopup);
      applyHoverState();
      hoverToggleBtn.addEventListener("click", () => {
        hoverShowPopup = !hoverShowPopup;
        hoverToggleBtn.classList.toggle("is-active", hoverShowPopup);
        applyHoverState();
        saveState();
        renderChart();
      });
    }

    const disclosureToggleBtn = document.getElementById("disclosureToggle");
    if (disclosureToggleBtn) {
      syncDisclosureToggleButton(lastDisclosureTraceStats.markers);
      disclosureToggleBtn.addEventListener("click", () => {
        showDisclosures = !showDisclosures;
        syncDisclosureToggleButton(lastDisclosureTraceStats.markers);
        if (!showDisclosures) hideDisclosurePopover();
        saveState();
        renderChart();
      });
    }

    // Credit offset input binding
    const creditOffsetEl = document.getElementById("creditOffset");
    if (creditOffsetEl) {
      creditOffsetEl.value = -CREDIT_OFFSET_DAYS;
      creditOffsetEl.addEventListener("change", () => {
        const v = parseInt(creditOffsetEl.value, 10);
        if (Number.isFinite(v)) {
          CREDIT_OFFSET_DAYS = Math.abs(v);
          saveState();
          renderChart();
        }
      });
    }

    // Manual refresh: reload seed files and live APIs
    const refreshBtn = document.getElementById("refreshData");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        if (refreshBtn.classList.contains("spinning")) return;
        refreshBtn.classList.add("spinning");
        setMessage(msgEl, []);
        try {
          if (navigator.serviceWorker.controller) {
            await requestServiceWorkerDataRefresh();
          }
          if (hasRuntimeDataLoaded()) {
            await loadData(true, { mergeWithExisting: true });
          } else {
            const restored = await loadLastRuntimeSnapshot();
            if (restored) renderChart(false);
            else await loadData(true);
          }
          await refreshRuntimeData(msgEl);
        } catch (err) {
          setMessage(msgEl, `데이터 갱신 중 오류: ${err.message}`, true);
        } finally {
          refreshBtn.classList.remove("spinning");
        }
      });
    }

    await waitForFirstPaint();
    setStartupLoaderProgress(84, "Refreshing latest data");
    try {
      if (restoredLastSnapshot) {
        await loadData(true, { mergeWithExisting: true });
      }
      await refreshRuntimeData(msgEl);
    } catch (refreshErr) {
      setMessage(msgEl, `최신 데이터 갱신 오류: ${refreshErr.message}`, true);
    }
    setStartupLoaderProgress(100, "Ready");
  } catch (err) {
    setMessage(msgEl, err.message || "데이터를 가져오지 못했습니다.", true);
  } finally {
    hideStartupLoader();
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
}

boot();





