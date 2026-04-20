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

const STATE_KEY = "thinkstock-v5";
const API_SETTINGS_KEY = "thinkstock-api-v1";
const API_SETTINGS_DEFAULT = Object.freeze({
  ecosApiKey: "",
  kofiaApiKey: "",
  kosisApiKey: "",
  krxApiKey: "",
});
const ECOS_STAT_CODE = "901Y067";
const ECOS_ITEM_CODE = "I16E";
const ECOS_START = "199601";
const KOSIS_START = "199601";
const KOFIA_CREDIT_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo";
const DAY_MS = 24 * 60 * 60 * 1000;

function appendCacheBust(url) {
  const stamp = `_=${Date.now()}`;
  return url.includes("?") ? `${url}&${stamp}` : `${url}?${stamp}`;
}

const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
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

let pricePayload = null;
let macroRows = [];
let creditRows = [];   // KOFIA ???????�????????????(credit_data.json)
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
let baseTraceValues = {};
let legendHandlerSet = false;
let adrHandlerSet = false;
let dragRafId = null;
let currentRows = [];
let currentStart = "";
let chartSyncing = false;   // relayout sync loop guard
let hoverShowPopup = false;
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
let startupLoaderHideTimer = null;
let startupLoaderRafId = 0;
let startupLoaderDisplayProgress = 100;
let startupLoaderTargetProgress = 100;

/* ???? localStorage persistence ???? */
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
    if (Array.isArray(p.customStocks)) customStocks = sanitizeCustomStocks(p.customStocks);
    applyCustomStockDisplayNames();
  } catch (_) {}
}

function sanitizeApiSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  Object.keys(API_SETTINGS_DEFAULT).forEach((key) => {
    const value = src[key];
    out[key] = typeof value === "string" ? value.trim() : "";
  });
  return out;
}

function saveApiSettings() {
  try {
    localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(sanitizeApiSettings(apiSettings)));
  } catch (_) {}
}

function loadApiSettings() {
  try {
    const raw = localStorage.getItem(API_SETTINGS_KEY);
    if (!raw) return;
    apiSettings = sanitizeApiSettings(JSON.parse(raw));
  } catch (_) {
    apiSettings = { ...API_SETTINGS_DEFAULT };
  }
}

function hasAnyApiKey() {
  return Object.values(apiSettings || {}).some((v) => String(v || "").trim().length > 0);
}

function syncApiOptionsButton() {
  const btn = document.getElementById("apiOptionsBtn");
  if (!btn) return;
  btn.classList.toggle("is-configured", hasAnyApiKey());
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
  const inputs = {
    ecosApiKey: document.getElementById("ecosApiInput"),
    kofiaApiKey: document.getElementById("kofiaApiInput"),
    kosisApiKey: document.getElementById("kosisApiInput"),
    krxApiKey: document.getElementById("krxApiInput"),
  };

  const fillInputs = () => {
    Object.entries(inputs).forEach(([key, el]) => {
      if (el) el.value = apiSettings[key] || "";
    });
  };

  const readInputs = () => sanitizeApiSettings({
    ecosApiKey: inputs.ecosApiKey?.value || "",
    kofiaApiKey: inputs.kofiaApiKey?.value || "",
    kosisApiKey: inputs.kosisApiKey?.value || "",
    krxApiKey: inputs.krxApiKey?.value || "",
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
    apiSettings = readInputs();
    saveApiSettings();
    const nextKrxKey = String(apiSettings?.krxApiKey || "").trim();
    if (prevKrxKey !== nextKrxKey) {
      resetKrxUniverseCache();
      hideStockSuggestList();
    }
    syncApiOptionsButton();
    close();
    setMessage(msgEl, ["API keys saved on this device."]);
  });

  clearBtn?.addEventListener("click", () => {
    const hadKrxKey = String(apiSettings?.krxApiKey || "").trim().length > 0;
    apiSettings = { ...API_SETTINGS_DEFAULT };
    saveApiSettings();
    if (hadKrxKey) {
      resetKrxUniverseCache();
      hideStockSuggestList();
    }
    fillInputs();
    syncApiOptionsButton();
    setMessage(msgEl, ["Saved API keys were cleared."]);
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

function syncHoverToChart(targetEl, xValue) {
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

function clearHoverOnChart(targetEl) {
  if (!targetEl || !window.Plotly?.Fx?.unhover) return;
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
  applySyncedCursor(xValue, sourceEl, sourceClientX);
}

function axisPixelToXValue(el, clientX) {
  const xa = el?._fullLayout?.xaxis;
  if (!xa || !Number.isFinite(clientX)) return null;
  const rect = el.getBoundingClientRect();
  const localX = clientX - rect.left;
  const px = localX - xa._offset;
  if (!Number.isFinite(px) || px < 0 || px > xa._length) return null;

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
  const xValue = axisPixelToXValue(sourceEl, clientX);
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

function bindCursorMoveSync() {
  const mainEl = document.getElementById("chart");
  const adrEl = document.getElementById("chart-adr");
  if (!mainEl || !adrEl) return;
  ensureCursorLine(mainEl);
  ensureCursorLine(adrEl);
  ensureDragZoomOverlay(mainEl);
  ensureDragZoomOverlay(adrEl);

  if (!cursorMoveBound) {
    const moveAt = (sourceEl, clientX) => {
      const xValue = axisPixelToXValue(sourceEl, clientX);
      if (xValue == null) {
        scheduleSyncedCursor(null);
        return;
      }
      scheduleSyncedCursor(xValue, sourceEl, clientX);
    };

    const onMove = (event) => {
      moveAt(event.currentTarget, event.clientX);
    };

    const onLeave = () => {
      scheduleSyncedCursor(null);
      clearHoverOnChart(mainEl);
      clearHoverOnChart(adrEl);
    };

    const onTouchStart = (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      event.preventDefault();
      const touch = event.touches[0];
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
      moveAt(event.currentTarget, touch.clientX);
    };

    const onTouchEnd = (event) => {
      if (event.touches && event.touches.length > 0) return;
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
      if (isTouchDevice()) return;
      if (event.button !== 0) return;
      if (event.target?.closest('.y-handle')) return;

      const sourceEl = event.currentTarget;
      const xa = sourceEl?._fullLayout?.xaxis;
      if (!xa) return;

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
        const xValue = axisPixelToXValue(dragState.sourceEl, moveEvent.clientX);
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

        const xStart = axisPixelToXValue(st.sourceEl, st.startClientX);
        const xEnd = axisPixelToXValue(st.sourceEl, upEvent.clientX);
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
  if (!result.meta.fields.includes("date")) throw new Error("CSV??date ???棺堉???????????諛몃�????꿔꺂??????");
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


function parseMacroPayload(text) {
  const payload = JSON.parse(text.replace(/\bNaN\b/g, "null"));
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return records.map((row) => {
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

function getSeriesColumns(rows) {
  const cols = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== "date") cols.add(k); }));
  return [...cols];
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

/* ???? Dense macro interpolation (for daily data) ???? */

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
      const payload = await fetchJsonWithProxyFallback(url);
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
  if (!key) throw new Error("KRX AUTH_KEY??????붺몭??�쨨?? ???????�굣�???꿔꺂??節?�젂???");

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
      throw new Error("KRX ???????�틢???饔낅?????????�뇡?꾩땡沃섏�?????????�늉????轅붽?????筌뤾?�裕?棺堉??????源녾?? ?饔낅????�????�????????");
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

async function fetchYahooHistorySeries(ticker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=30y`;
  const payload = await fetchJsonWithProxyFallback(url);
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(`${ticker} ?????�늉?????????????? ?饔낅??????? ?饔낅????�????�????????`);

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

async function ensureCustomTickerSeriesLoaded(ticker) {
  const hasExisting = (pricePayload?.records || []).some((row) => toNum(row?.[ticker]) !== null);
  if (hasExisting) return;

  const points = await fetchYahooHistorySeries(ticker);
  if (!points.length) throw new Error(`${ticker} ?????�늉????????????????????????????????�졄.`);
  mergeTickerSeriesIntoPricePayload(ticker, points);
}

async function addCustomStock(candidate, msgEl) {
  if (!candidate?.ticker || !candidate?.name) return;

  if (customStocks.some((item) => item.ticker === candidate.ticker)) {
    setMessage(msgEl, ["???? ??????�뱼???????????�틢???????�?Ĳ??"], true);
    return;
  }
  if (customStocks.length >= MAX_CUSTOM_STOCKS) {
    setMessage(msgEl, [`???????�틢??? ?饔낅??????�? ${MAX_CUSTOM_STOCKS}?????�늉??????? ??????�뱼???????????????????�졄.`], true);
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
    setMessage(msgEl, [`${candidate.name} ???????�틢?????????�뱼???????????????�졄.`]);
  } catch (err) {
    delete DISPLAY_NAMES[candidate.ticker];
    setMessage(msgEl, `???????�틢????????�뱼?? ???????�슣?? ${err.message}`, true);
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

async function preloadCustomStocks() {
  if (!customStocks.length) return { failedNames: [] };

  const failed = [];
  const failedNames = [];
  for (const item of customStocks) {
    try {
      await ensureCustomTickerSeriesLoaded(item.ticker);
      DISPLAY_NAMES[item.ticker] = item.name;
    } catch (_) {
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

let CREDIT_OFFSET_DAYS = 2;  // ???????�????????????�땟戮녹???�딆맚嶺??��???롳펲???????(??????= ?????????????. UI ???????�굣�?????�늉???????????�슦???
const CREDIT_COLS = ["kospi_credit", "kosdaq_credit"];

/**
 * creditRowsSrc ????轅붽????壤굿?????????�땟戮녹??�?��????�?�??�ル???????轅붽??????????�첎?�????�렧???
 * ??????�름???????�슖?꿸강????price ???????�???????(date + CREDIT_OFFSET_DAYS) ?????
 * ?? ????????�??????????????�싲�?��????????�늉?????????�늉??????�?��?�???????�싲�?��?源???饔낅챷維??????????????? ?????�땟戮녹??????꿔꺂?????
 *
 * ?????????????????꿔꺂??琉뷩�????????�름??�ル??��?�땟?룹춹?????????�룸?????μ?�媛?�??곸삃???饔낅챷維?????????????????? ?????諛몃�??ｌ꽔????汝뷴????�뙼�??????�?????????嶺뚮??�볠�????????�?�럺.
 */
function buildCreditFinder(creditRowsSrc) {
  if (!creditRowsSrc.length) return () => null;
  const sorted = [...creditRowsSrc].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((r) => [r.date, r]));

  return function findNearest(priceDate) {
    // priceDate ???????????????CREDIT_OFFSET_DAYS ?????????????�????????꾨き???�곥�???????????????
    const base = new Date(`${priceDate}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + CREDIT_OFFSET_DAYS);
    // ?????꾨き???�곥�????????????�땟戮녹??????�베??????????????????
    for (let delta = 0; delta <= 4; delta++) {
      for (const sign of (delta === 0 ? [0] : [1, -1])) {
        const d = new Date(base);
        d.setUTCDate(d.getUTCDate() + delta * sign);
        const key = d.toISOString().slice(0, 10);
        if (byDate.has(key)) return byDate.get(key);
      }
    }
    return null;
  };
}

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

  const liveCols   = getSeriesColumns(priceRows);
  const macroCols  = getSeriesColumns(denseRows).filter((c) => !CREDIT_COLS.includes(c));

  const rows = [];
  priceRows.forEach(({ date }) => {
    if (date < start || date > end) return;
    const row = { date };
    const pr = priceMap.get(date) || {};
    const mr = macroMap.get(date) || {};
    liveCols.forEach((k) => { row[k] = toNum(pr[k]); });
    macroCols.forEach((k) => { row[k] = toNum(mr[k]); });
    const cr = creditByDate.get(date) || null;
    CREDIT_COLS.forEach((k) => { row[k] = cr ? toNum(cr[k]) : null; });
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

/* ???? Drag handles ???? */

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
    leftHandle.title = labelName(key) + " (?????諛몃�??";
    setupOffsetDrag(leftHandle, i, key, leftPixelY, ya);
    container.appendChild(leftHandle);

    const rightHandle = document.createElement("div");
    rightHandle.className = "y-handle y-handle-right";
    rightHandle.style.top = rightPixelY - 7 + "px";
    rightHandle.style.left = rightX + "px";
    rightHandle.style.backgroundColor = color;
    rightHandle.title = labelName(key) + " (?????";
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

/* ???? Chart ???? */

function renderChart(preserveZoom = true) {
  const el = document.getElementById("chart");
  const msgEl = document.getElementById("messageArea");

  const priceRows = pricePayload.records || [];
  const dates = priceRows.map((r) => r.date);
  const maxDate = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
  const minDate = dates[0] || maxDate;
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
  // ADR ???꿔꺂???????믊삳�???????饔낅????????饔낅????�귥????ｋ궙??????????꿔꺂????????????�뮛?????????븍툖???�껊�?????????????????
  const selected = sortSeries(allSeries.filter((s) => !ADR_SERIES.includes(s)));
  if (!selected.length) {
    const fallback = sortSeries(allSeries);
    selected.push(...fallback.slice(0, 2));
  }
  currentSelected = [...selected];

  if (!rows.length || !selected.length) {
    msgEl.innerHTML = '<div class="message error">????????????????? ??????깅즽?????????�졄.</div>';
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

  const traces = selected.map((series, i) => {
    let values = rows.map((r) => toNum(r[series]));
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

    // Credit offset moves x only so the line shape never distorts
    const xValues = CREDIT_COLS.includes(series)
      ? rows.map((r) => shiftDays(r.date, -CREDIT_OFFSET_DAYS))
      : rows.map((r) => r.date);

    return {
      x: xValues,
      y: values,
      type: "scatter",
      mode: "lines",
      name: labelName(series),
      visible: hiddenSeries.has(series) ? "legendonly" : true,
      connectgaps: true,
      line: {
        color: seriesColor(series),
        width: macroCols.includes(series) ? 3 : 2,
        shape: "linear",
      },
      marker: { symbol: "circle", size: 7, color: seriesColor(series) },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    };
  });

  // ??轅붽?????곌램伊볟?????꿔꺂???????????????諛몃�??????��?????????�뮛?????????????????????????�곻?�夷???????�??? ??????멸괜???

  if (!preserveZoom) pinnedXRange = null;
  const savedXRange = preserveZoom
    ? (pinnedXRange ? [...pinnedXRange] : (el._fullLayout?.xaxis?.range?.slice() || null))
    : null;
  const savedYRange = preserveZoom ? (el._fullLayout?.yaxis?.range?.slice() || null) : null;

  Plotly.react(el, traces, {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    margin: { l: 42, r: 42, t: 28, b: 32 },
    hovermode: "x unified",
    showlegend: false,
    legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
    xaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, color: "#666", tickfont: { size: 10 }, fixedrange: false, showspikes: false, ...(savedXRange ? { range: savedXRange } : {}) },
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
      // ?饔낅????????饔낅????�귥????ｋ궙???pan/zoom ??ADR ?饔낅????�귥????ｋ궙???x????????????
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
      if (hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      const adrEl = document.getElementById("chart-adr");
      syncHoverToChart(adrEl, xValue);
    });
    el.on("plotly_unhover", () => {
      if (hoverSyncing) return;
      const adrEl = document.getElementById("chart-adr");
      clearHoverOnChart(adrEl);
    });
    el.on("plotly_click", () => {
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

/* ???? ADR ????븍툖???�껊�????饔낅????�귥????ｋ궙???(adrinfo.kr ????? ???? */

// adrinfo.kr ?? ???????�쿋??????μ?�媛????�귥?�留????????�쑄??
const ADR_ZONE_LOW_COLOR   = "#b0c6ed";   // < 80  (?????????????????????
const ADR_ZONE_HIGH_COLOR  = "#e6adad";   // > 120 (?????????????????????�?�럯????
const ADR_BAND_COLOR       = "rgba(100,100,100,0.06)";
const ADR_LOW_THRESH  = 80;
const ADR_HIGH_THRESH = 120;

/**
 * ???汝뷴??琉껆????ADR ???꿔꺂???????믊삳�????? Plotly ??轅붽???????????깅즽???????�땟戮녹??�?��????�?�??�ル??????????�뮛??????????
 *   - below 80  ?????????+ 80 ??????????????????????????
 *   - 80 ~ 120  ?????????????棺堉???????
 *   - above 120 ???????�?�럯??????+ 120 ??????????????????????????
 *
 * fill:"tonexty" ???????threshold ??????�싲�?��?源??????????????????�듋??�???��?�걡????(tozeroy ??????y=0 ????�?��?�?? ????????????????.
 */
function buildAdrZoneTraces(dates, values, mainColor, legendName) {
  const base = { x: dates, type: "scatter", mode: "lines", connectgaps: false };
  const noHover = { hoverinfo: "skip", hovertemplate: undefined };

  // ???? 3????????????�?�츧???????????????????????????????????????????????????????????????????????????????????????????????
  const yLow = [], yMid = [], yHigh = [];
  const yBaseLow = [], yBaseHigh = [];   // threshold ?????????(????????????????????�슣�??

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

  // ???? ????????????�곻?�夷????????????????꿔꺂????? ???????????�룹??? ????????????????????????????????????????????????
  // ?????�곻?�夷??????4?????�늉???饔낅????? ?????�땟??貫沅?????????????�졄:
  //   (A) mid ??low ?饔낅??????? ??low ?????�늉????mid ???????????�뱼??
  //   (B) low ??mid ?????袁ㅻ?�?? ??mid ?????�늉????low ???????????�뱼??
  //   (C) mid ??high ?饔낅??????? ??high ?????�늉????mid ???????????�뱼??
  //   (D) high ??mid ?????袁ㅻ?�?? ??mid ?????�늉????high ???????????�뱼??
  // ?????�땟??貫沅???????�?????轅붽???????????깅즽??????????�싲�?��??�옃�??????�고???????????�????�??????袁ㅻ?�???????�뮛?????
  for (let i = 0; i < values.length; i++) {
    const v    = values[i];
    if (v === null) continue;
    const prev = i > 0 ? values[i - 1] : null;
    if (prev === null) continue;
    // (A) mid ??low
    if (v < ADR_LOW_THRESH  && prev >= ADR_LOW_THRESH)  { yMid[i]  = v; yBaseLow[i]  = ADR_LOW_THRESH; }
    // (B) low ??mid
    if (v >= ADR_LOW_THRESH && prev <  ADR_LOW_THRESH)  { yLow[i]  = v; yBaseLow[i]  = ADR_LOW_THRESH; }
    // (C) mid ??high
    if (v > ADR_HIGH_THRESH && prev <= ADR_HIGH_THRESH) { yMid[i]  = v; yBaseHigh[i] = ADR_HIGH_THRESH; }
    // (D) high ??mid
    if (v <= ADR_HIGH_THRESH && prev > ADR_HIGH_THRESH) { yHigh[i] = v; yBaseHigh[i] = ADR_HIGH_THRESH; }
  }

  return [
    // ???? ???????(< 80): ?????????80) ????붺몭??�쨨??, ????�싲�?��?源??????�늉????tonexty ?????????????
    { ...base, y: yBaseLow,  showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, mode: "lines+markers", y: yLow, name: legendName, showlegend: true, legendgroup: legendName,
      line: { color: ADR_ZONE_LOW_COLOR, width: 1.5 },
      marker: { symbol: "circle", size: 7, color: mainColor },
      fill: "tonexty", fillcolor: "rgba(176,198,237,0.15)", ...noHover },

    // ???? ??轅붽????????곷뼱????????(80~120) ????????????????????????????????????????????????????????????????????????????
    { ...base, y: yMid, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: mainColor, width: 2 }, ...noHover },

    // ???? ???????(> 120): ?????????120) ????붺몭??�쨨??, ????�싲�?��?源??????�늉????tonexty ?????????????
    { ...base, y: yBaseHigh, showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, y: yHigh, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: ADR_ZONE_HIGH_COLOR, width: 1.5 },
      fill: "tonexty", fillcolor: "rgba(230,173,173,0.15)", ...noHover },
  ];
}

let adrRows = [];   // ADR ?????諛몃�???????????(adr_data.json ?????????�????�맪??+ ???????�늉?????????????轅붽???????

const ADR_SOURCE_URL = "http://www.adrinfo.kr/chart";
const CORS_PROXY     = "https://corsproxy.io/?url=";

function renderAdrChart(xRange) {
  const el = document.getElementById("chart-adr");
  if (!el || !adrRows.length) return;

  // ?????諛몃�??activeMonths ???饔낅??????????????�? ????????????�곻?�夷??
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
      y: kospiVals,
      type: "scatter",
      mode: "lines",
      name: "ADR KOSPI",
      showlegend: false,
      legendgroup: "ADR KOSPI",
      connectgaps: false,
      line: { color: "rgba(0,0,0,0)", width: 1 },
      hovertemplate: "%{x}<br><b>ADR KOSPI: %{y:.2f}%</b><extra></extra>",
    },
    {
      x: dates,
      y: kosdaqVals,
      type: "scatter",
      mode: "lines",
      name: "ADR KOSDAQ",
      showlegend: false,
      legendgroup: "ADR KOSDAQ",
      connectgaps: false,
      line: { color: "rgba(0,0,0,0)", width: 1 },
      hovertemplate: "%{x}<br><b>ADR KOSDAQ: %{y:.2f}%</b><extra></extra>",
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
      // 80~120 ?????�땟戮녹?????�귥빓愿??????�땟戮녹????
      {
        type: "rect", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_HIGH_THRESH,
        fillcolor: ADR_BAND_COLOR, line: { width: 0 }, layer: "below",
      },
      // 80% ??
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_LOW_THRESH,
        line: { color: ADR_ZONE_LOW_COLOR, width: 0.9, dash: "dash" },
      },
      // 120% ??
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_HIGH_THRESH, y1: ADR_HIGH_THRESH,
        line: { color: ADR_ZONE_HIGH_COLOR, width: 0.9, dash: "dash" },
      },
      // 100% ?????꾨き???�곥�????
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

async function fetchJsonWithProxyFallback(url) {
  const candidates = [url, CORS_PROXY + encodeURIComponent(url)];
  let lastError = "Request failed";
  for (const target of candidates) {
    try {
      const res = await fetch(target, { cache: "no-store" });
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
  const payload = await fetchJsonWithProxyFallback(url);
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
  const payload = await fetchJsonWithProxyFallback(url);
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

      for (let pageNo = 1; pageNo <= 30; pageNo += 1) {
        const query = new URLSearchParams({
          serviceKey,
          numOfRows: String(numOfRows),
          pageNo: String(pageNo),
          resultType: "json",
        });
        const url = appendCacheBust(`${KOFIA_CREDIT_URL}?${query.toString()}`);
        const payload = await fetchJsonWithProxyFallback(url);

        const header = payload?.response?.header || {};
        if (header.resultCode && header.resultCode !== "00") {
          throw new Error(header.resultMsg || "KOFIA API error");
        }

        const body = payload?.response?.body || {};
        const rawItems = body?.items?.item;
        const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
        if (!items.length) break;

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
        const rowsPerPage = Number(body?.numOfRows) || numOfRows;
        const currentPage = Number(body?.pageNo) || pageNo;
        if (Number.isFinite(totalCount) && totalCount > 0 && currentPage * rowsPerPage >= totalCount) break;
        if (items.length < rowsPerPage) break;
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
  return { updated, latestDate: normalized[normalized.length - 1].date };
}

async function refreshLiveApiData() {
  const applied = [];
  const warnings = [];

  if (!hasAnyApiKey()) return { applied, warnings };

  let ecosRows = [];
  let kosisRows = [];

  if (apiSettings.ecosApiKey) {
    try {
      ecosRows = await fetchEcosLeadingCycleLive(apiSettings.ecosApiKey);
    } catch (err) {
      warnings.push(`ECOS ???????�슣?? ${err.message}`);
    }
  }

  if (apiSettings.kosisApiKey) {
    try {
      kosisRows = await fetchKosisLeadingCycleLive(apiSettings.kosisApiKey);
    } catch (err) {
      warnings.push(`KOSIS ???????�슣?? ${err.message}`);
    }
  }

  const leadingRows = mergeLeadingSources(ecosRows, kosisRows);
  if (leadingRows.length) {
    const info = applyLeadingCycleLiveRows(leadingRows);
    applied.push(`????影??�筌�?�??�납???�????源녾?????????�늉????(${info.updated}???????�땟戮녹???? ?饔낅??????�??${info.latestDate})`);
  }

  if (apiSettings.kofiaApiKey) {
    try {
      const kofiaRows = await fetchKofiaCreditLive(apiSettings.kofiaApiKey);
      if (kofiaRows.length) {
        const info = applyCreditLiveRows(kofiaRows);
        applied.push(`???????�????????????�늉????(${info.updated}???????�땟戮녹???? ?饔낅??????�??${info.latestDate})`);
      } else {
        warnings.push("KOFIA ?????????????????? ??????깅즽?????????�졄.");
      }
    } catch (err) {
      warnings.push(`KOFIA ???????�슣?? ${err.message}`);
    }
  }

  return { applied, warnings };
}

/**
 * adrinfo.kr/chart ??CORS ?????諛몃�??λ?????꿔꺂?????轅멸???????�늉????? adrRows ??????嶺뚮???????????�?????????�뱼?????꿔꺂?????
 * ?????�땟戮녹???? { added: number, latestDate: string }
 */
async function refreshAdrFromWeb() {
  const sourceUrl = appendCacheBust(ADR_SOURCE_URL);
  const proxyUrl = CORS_PROXY + encodeURIComponent(sourceUrl);
  const res = await fetch(proxyUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`adrinfo.kr ??????????????�굣?? ${res.status}`);
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

  // ?????諛몃�??adrRows ???饔낅???????????????�? ??????밸븶???袁⑤�???????�뱼??
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

async function loadData(forceNetwork = false) {
  const opt = forceNetwork ? { cache: "reload" } : {};
  const [priceRes, macroJsonRes, macroCsvRes, adrRes, creditRes] = await Promise.all([
    fetch("./data/prices.json", opt),
    fetch("./data/macro_data.json", opt),
    fetch("./data/sample_macro_data.csv", opt),
    fetch("./data/adr_data.json", opt),
    fetch("./data/credit_data.json", opt),
  ]);
  const priceText = await priceRes.text();
  pricePayload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));

  let macroSourceRows = [];
  if (macroJsonRes.ok) {
    try {
      macroSourceRows = parseMacroPayload(await macroJsonRes.text());
    } catch (_) {
      macroSourceRows = [];
    }
  }
  if (!macroSourceRows.length && macroCsvRes.ok) {
    macroSourceRows = parseCsv(await macroCsvRes.text());
  }

  const priceDates = (pricePayload.records || []).map((r) => r.date);
  macroRows = buildDenseMacroRows(macroSourceRows, priceDates);
  if (adrRes.ok) {
    const adrPayload = JSON.parse(await adrRes.text());
    adrRows = adrPayload.records || [];
  }
  if (creditRes.ok) {
    const creditPayload = JSON.parse(await creditRes.text());
    creditRows = creditPayload.records || [];
  }
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
  setStartupLoaderProgress(10, "Preparing");
  try {
    await loadData(true);
    setStartupLoaderProgress(45, "Loading data");
    const preloadResult = await preloadCustomStocks();
    setStartupLoaderProgress(60, "Loading stocks");

    const startupInfo = [];
    const startupWarn = [];
    if (preloadResult.failedNames.length) {
      startupWarn.push(`Some selected stocks were removed because price history could not be loaded: ${preloadResult.failedNames.join(", ")}`);
    }

    try {
      const { added, latestDate } = await refreshAdrFromWeb();
      if (added > 0) {
        startupInfo.push(`ADR added ${added} rows (~ ${latestDate})`);
      }
    } catch (adrErr) {
      startupWarn.push(`ADR refresh failed: ${adrErr.message}`);
    }

    setStartupLoaderProgress(74, "Refreshing ADR");
    const startupLive = await refreshLiveApiData();
    startupInfo.push(...startupLive.applied);
    startupWarn.push(...startupLive.warnings);
    setStartupLoaderProgress(90, "Applying data");

    if (startupInfo.length || startupWarn.length) {
      setMessage(msgEl, [...startupInfo, ...startupWarn], startupInfo.length === 0);
    }

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

    // ?饔낅???????????????? ???????
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

    // ???????�??????????????????�굣�?????�땟戮녹??諛명�??
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

    // ???????????????????? ????????嶺뚮Ĳ???????濡ろ?????饔낅??????�??????????????????�뺄?�?��???
    const refreshBtn = document.getElementById("refreshData");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        if (refreshBtn.classList.contains("spinning")) return;
        refreshBtn.classList.add("spinning");
        setMessage(msgEl, []);
        try {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage("REFRESH_DATA");
          }
          await loadData(true);
          const preloadResult = await preloadCustomStocks();

          const infoLines = [];
          const warnLines = [];
          if (preloadResult.failedNames.length) {
            warnLines.push(`Some selected stocks were removed because price history could not be loaded: ${preloadResult.failedNames.join(", ")}`);
          }

          try {
            const { added, latestDate } = await refreshAdrFromWeb();
            if (added > 0) {
              infoLines.push(`ADR ${added}???μ?�媛?�???�펾�???????�뱼????(~ ${latestDate})`);
            }
          } catch (adrErr) {
            warnLines.push(`ADR ?????�늉???????????�슣?? ${adrErr.message}`);
          }

          const liveResult = await refreshLiveApiData();
          infoLines.push(...liveResult.applied);
          warnLines.push(...liveResult.warnings);

          renderChart(false);

          if (infoLines.length || warnLines.length) {
            setMessage(msgEl, [...infoLines, ...warnLines], infoLines.length === 0);
          } else {
            setMessage(msgEl, []);
          }
        } catch (err) {
          setMessage(msgEl, `????????????????????�슣?? ${err.message}`, true);
        } finally {
          refreshBtn.classList.remove("spinning");
        }
      });
    }

    setStartupLoaderProgress(100, "Rendering");
    renderChart(false);
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





