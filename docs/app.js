const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용",
  kosdaq_credit: "코스닥 신용",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
  adr_kospi: "ADR K",
  adr_kosdaq: "ADR KQ",
};

const ADR_SERIES = ["adr_kospi", "adr_kosdaq"];
const DEFAULT_SELECTED = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ"];
const SERIES_PRIORITY = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ", "adr_kospi", "adr_kosdaq"];
const SERIES_COLORS = {
  leading_cycle: "#999999",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#a78bfa",
  "005930.KS": "#2dd4bf",
  "218410.KQ": "#fb923c",
  adr_kospi: "#facc15",
  adr_kosdaq: "#f472b6",
};

const STATE_KEY = "thinkstock-v5";
const DAY_MS = 24 * 60 * 60 * 1000;

const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const labelName = (key) => DISPLAY_NAMES[key] || key;
const seriesColor = (key) => SERIES_COLORS[key] || "#888";
const toUtcMs = (d) => Date.parse(`${d}T00:00:00Z`);

let pricePayload = null;
let macroRows = [];
let creditRows = [];   // KOFIA 신용융자 잔고 (credit_data.json)
let activeMonths = 120;
let hiddenSeries = new Set(["kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ"]);
let seriesOffsets = {};
let seriesScales = {};
let currentSelected = [];
let baseTraceValues = {};
let legendHandlerSet = false;
let adrHandlerSet = false;
let dragRafId = null;
let currentRows = [];
let currentStart = "";
let chartSyncing = false;   // relayout 무한루프 방지 플래그
let hoverShowPopup = false;
let isHandleDragging = false;
let pinnedXRange = null;
let hoverSyncing = false;
let cursorSyncing = false;
let cursorRafId = 0;
let pendingCursorX = null;
let cursorMoveBound = false;
let appliedCursorX = null;
const CURSOR_SHAPE_NAME = "__sync_cursor__";

/* ── localStorage persistence ── */
function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      activeMonths,
      hiddenSeries: [...hiddenSeries],
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
  } catch (_) {}
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

function buildCursorShape(xValue) {
  return {
    name: CURSOR_SHAPE_NAME,
    type: "line",
    xref: "x",
    yref: "paper",
    x0: xValue,
    x1: xValue,
    y0: 0,
    y1: 1,
    line: { color: "rgba(255,255,255,0.35)", width: 1 },
    layer: "above",
  };
}

function nextShapesWithCursor(el, xValue) {
  const shapes = Array.isArray(el?._fullLayout?.shapes) ? el._fullLayout.shapes : [];
  const base = shapes.filter((shape) => shape?.name !== CURSOR_SHAPE_NAME);
  if (xValue == null) return base;
  return [...base, buildCursorShape(xValue)];
}

function applySyncedCursor(xValue) {
  const nextX = xValue ?? null;
  if (appliedCursorX === nextX) return;
  const mainEl = document.getElementById("chart");
  const adrEl = document.getElementById("chart-adr");
  const targets = [mainEl, adrEl].filter((el) => el && el._fullLayout);
  if (!targets.length || !window.Plotly?.relayout) return;
  cursorSyncing = true;
  Promise.allSettled(
    targets.map((el) => Plotly.relayout(el, { shapes: nextShapesWithCursor(el, nextX) }))
  ).finally(() => {
    cursorSyncing = false;
    appliedCursorX = nextX;
  });
}

function scheduleSyncedCursor(xValue) {
  pendingCursorX = xValue ?? null;
  if (cursorRafId) return;
  cursorRafId = requestAnimationFrame(() => {
    cursorRafId = 0;
    applySyncedCursor(pendingCursorX);
  });
}

function axisPixelToXValue(el, clientX) {
  const xa = el?._fullLayout?.xaxis;
  if (!xa || !Number.isFinite(clientX)) return null;
  const px = clientX - xa._offset;
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
  if (xa.type === "date") return new Date(linear).toISOString().slice(0, 10);
  return linear;
}

function bindCursorMoveSync() {
  if (cursorMoveBound) return;
  const mainEl = document.getElementById("chart");
  const adrEl = document.getElementById("chart-adr");
  if (!mainEl || !adrEl) return;

  const onMove = (event) => {
    const xValue = axisPixelToXValue(event.currentTarget, event.clientX);
    if (xValue == null) return;
    scheduleSyncedCursor(xValue);
  };

  const onLeave = () => {
    scheduleSyncedCursor(null);
    clearHoverOnChart(mainEl);
    clearHoverOnChart(adrEl);
  };

  mainEl.addEventListener("mousemove", onMove, { passive: true });
  adrEl.addEventListener("mousemove", onMove, { passive: true });
  mainEl.addEventListener("mouseleave", onLeave);
  adrEl.addEventListener("mouseleave", onLeave);
  cursorMoveBound = true;
}

function parseCsv(text) {
  const result = Papa.parse(text.trim(), {
    header: true, dynamicTyping: true, skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (result.errors.length) throw new Error(result.errors[0].message);
  if (!result.meta.fields.includes("date")) throw new Error("CSV에 date 컬럼이 필요합니다.");
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

function sortSeries(list) {
  const pri = new Map(SERIES_PRIORITY.map((n, i) => [n, i]));
  return [...list].sort((a, b) => {
    const ar = pri.has(a) ? pri.get(a) : SERIES_PRIORITY.length + 1;
    const br = pri.has(b) ? pri.get(b) : SERIES_PRIORITY.length + 1;
    return ar !== br ? ar - br : labelName(a).localeCompare(labelName(b), "ko");
  });
}

/* ── Dense macro interpolation (for daily data) ── */

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

let CREDIT_OFFSET_DAYS = 2;  // 신용잔고 발표 시차 (양수 = 앞당겨 표시). UI 입력값의 절댓값.
const CREDIT_COLS = ["kospi_credit", "kosdaq_credit"];

/**
 * creditRowsSrc 를 정렬된 배열로 인덱싱하고,
 * 주어진 price 날짜에 대해 (date + CREDIT_OFFSET_DAYS) 에서
 * ±4 캘린더일 범위 안의 가장 가까운 실제 거래일 레코드를 반환한다.
 *
 * 캘린더 오프셋으로 주말·공휴일에 걸릴 때 데이터가 누락되던 문제를 해결.
 */
function buildCreditFinder(creditRowsSrc) {
  if (!creditRowsSrc.length) return () => null;
  const sorted = [...creditRowsSrc].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((r) => [r.date, r]));

  return function findNearest(priceDate) {
    // priceDate 기준으로 CREDIT_OFFSET_DAYS 앞의 날짜를 중심으로 탐색
    const base = new Date(`${priceDate}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + CREDIT_OFFSET_DAYS);
    // 중심에서 바깥으로 ±4일 탐색
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

/* ── Drag handles ── */

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

function computeFinalValues(seriesKey) {
  const base = baseTraceValues[seriesKey];
  if (!base) return null;
  const s = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : 1;
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
    const startScale = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : 1;
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

/* ── Chart ── */

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
  const allSeries = sortSeries(
    [...new Set([...liveCols, ...macroCols])].filter((s) => rows.some((r) => toNum(r[s]) !== null))
  );
  syncSeriesToggleBoard(allSeries);
  // ADR 시리즈는 메인 차트에서 제외 — 별도 미니차트에 표시
  const selected = DEFAULT_SELECTED.filter((s) => allSeries.includes(s) && !ADR_SERIES.includes(s));
  if (!selected.length) selected.push(...allSeries.slice(0, 2));
  currentSelected = [...selected];

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

  const traces = selected.map((series, i) => {
    let values = rows.map((r) => toNum(r[series]));
    const base = commonNormBases[series];
    values = (base && base !== 0)
      ? values.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null))
      : normalizeSeries(values);
    values = centeredScale(values, series === "leading_cycle" ? 100 : (autoScales[series] || 100), true);

    baseTraceValues[series] = values;

    const userScale = seriesScales[series] != null ? seriesScales[series] : 1;
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

  // 핸들 드래그 후에만 줌 보존 — 범위 버튼 전환 시엔 초기화

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
    xaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, color: "#666", tickfont: { size: 10 }, fixedrange: false, showspikes: true, spikemode: "across", spikesnap: "cursor", spikecolor: "rgba(255,255,255,0.25)", spikethickness: 1, spikedash: "solid", ...(savedXRange ? { range: savedXRange } : {}) },
    yaxis: { showticklabels: false, title: "", showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, fixedrange: true, ...(savedYRange ? { range: savedYRange, autorange: false } : {}) },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: hoverShowPopup ? { bgcolor: "rgba(34,34,34,0.45)", bordercolor: "rgba(140,140,140,0.35)", font: { color: "#eee" } } : { bgcolor: "rgba(0,0,0,0)", bordercolor: "rgba(0,0,0,0)", font: { color: "rgba(0,0,0,0)", size: 1 } },
    dragmode: false,
  }, { responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: true });

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
      if (chartSyncing || isHandleDragging || cursorSyncing) return;
      setTimeout(updateHandles, 50);
      // 메인 차트 pan/zoom → ADR 차트 x축 동기화
      const adrEl = document.getElementById("chart-adr");
      if (adrEl && adrEl.data) {
        const r0 = eventData["xaxis.range[0]"];
        const r1 = eventData["xaxis.range[1]"];
        if (r0 && r1) {
          pinnedXRange = [r0, r1];
          chartSyncing = true;
          Plotly.relayout(adrEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }).finally(() => { chartSyncing = false; });
        } else if (eventData["xaxis.autorange"]) {
          pinnedXRange = null;
          chartSyncing = true;
          Plotly.relayout(adrEl, { "xaxis.autorange": true }).finally(() => { chartSyncing = false; });
        }
      }
    });
    el.on("plotly_hover", (eventData) => {
      if (hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      scheduleSyncedCursor(xValue);
      const adrEl = document.getElementById("chart-adr");
      syncHoverToChart(adrEl, xValue);
    });
    el.on("plotly_unhover", () => {
      if (hoverSyncing) return;
      const adrEl = document.getElementById("chart-adr");
      clearHoverOnChart(adrEl);
    });
    el.on("plotly_click", () => {
      Plotly.relayout(el, { "xaxis.autorange": true, "yaxis.autorange": true });
    });
    legendHandlerSet = true;
  }

  updateHandles();
  renderAdrChart(savedXRange ? [...savedXRange] : null);
  bindCursorMoveSync();
}

/* ── ADR 미니 차트 (adrinfo.kr 스타일) ── */

// adrinfo.kr 와 동일한 색상 상수
const ADR_ZONE_LOW_COLOR   = "#b0c6ed";   // < 80  (과매도 구간 — 파란색)
const ADR_ZONE_HIGH_COLOR  = "#e6adad";   // > 120 (과매수 구간 — 붉은색)
const ADR_BAND_COLOR       = "rgba(100,100,100,0.06)";
const ADR_LOW_THRESH  = 80;
const ADR_HIGH_THRESH = 120;

/**
 * 하나의 ADR 시리즈를 Plotly 트레이스 배열로 변환한다.
 *   - below 80  → 파란색 선 + 80 기준선 사이만 채우기
 *   - 80 ~ 120  → 기본 컬러 선
 *   - above 120 → 붉은색 선 + 120 기준선 사이만 채우기
 *
 * fill:"tonexty" 를 사용해 threshold ↔ 실제값 사이만 칠한다 (tozeroy 하면 y=0 까지 채워져 여백 과잉).
 */
function buildAdrZoneTraces(dates, values, mainColor, legendName) {
  const base = { x: dates, type: "scatter", mode: "lines", connectgaps: false };
  const noHover = { hoverinfo: "skip", hovertemplate: undefined };

  // ── 3구간 분리 ──────────────────────────────────────────────
  const yLow = [], yMid = [], yHigh = [];
  const yBaseLow = [], yBaseHigh = [];   // threshold 기준선 (채우기 하한/상한)

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

  // ── 구간 전환 시 브릿지 포인트 공유 ────────────────────────
  // 전환에는 4가지 방향이 있다:
  //   (A) mid → low 진입: 첫 low 값을 mid 에도 추가
  //   (B) low → mid 이탈: 첫 mid 값을 low 에도 추가
  //   (C) mid → high 진입: 첫 high 값을 mid 에도 추가
  //   (D) high → mid 이탈: 첫 mid 값을 high 에도 추가
  // 방향이 빠지면 트레이스 사이 틈이 생겨 선이 끊겨 보인다.
  for (let i = 0; i < values.length; i++) {
    const v    = values[i];
    if (v === null) continue;
    const prev = i > 0 ? values[i - 1] : null;
    if (prev === null) continue;
    // (A) mid → low
    if (v < ADR_LOW_THRESH  && prev >= ADR_LOW_THRESH)  { yMid[i]  = v; yBaseLow[i]  = ADR_LOW_THRESH; }
    // (B) low → mid
    if (v >= ADR_LOW_THRESH && prev <  ADR_LOW_THRESH)  { yLow[i]  = v; yBaseLow[i]  = ADR_LOW_THRESH; }
    // (C) mid → high
    if (v > ADR_HIGH_THRESH && prev <= ADR_HIGH_THRESH) { yMid[i]  = v; yBaseHigh[i] = ADR_HIGH_THRESH; }
    // (D) high → mid
    if (v <= ADR_HIGH_THRESH && prev > ADR_HIGH_THRESH) { yHigh[i] = v; yBaseHigh[i] = ADR_HIGH_THRESH; }
  }

  return [
    // ── 과매도 (< 80): 기준선(80) 먼저, 실제값을 tonexty 로 채우기 ──
    { ...base, y: yBaseLow,  showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, mode: "lines+markers", y: yLow, name: legendName, showlegend: true, legendgroup: legendName,
      line: { color: ADR_ZONE_LOW_COLOR, width: 1.5 },
      marker: { symbol: "circle", size: 7, color: mainColor },
      fill: "tonexty", fillcolor: "rgba(176,198,237,0.15)", ...noHover },

    // ── 정상 구간 (80~120) ──────────────────────────────────────
    { ...base, y: yMid, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: mainColor, width: 2 }, ...noHover },

    // ── 과매수 (> 120): 기준선(120) 먼저, 실제값을 tonexty 로 채우기 ──
    { ...base, y: yBaseHigh, showlegend: false, legendgroup: legendName,
      line: { color: "transparent", width: 0 }, ...noHover },
    { ...base, y: yHigh, name: legendName, showlegend: false, legendgroup: legendName,
      line: { color: ADR_ZONE_HIGH_COLOR, width: 1.5 },
      fill: "tonexty", fillcolor: "rgba(230,173,173,0.15)", ...noHover },
  ];
}

let adrRows = [];   // ADR 전용 데이터 (adr_data.json 에서 로드 + 웹 갱신으로 확장)

const ADR_SOURCE_URL = "http://www.adrinfo.kr/chart";
const CORS_PROXY     = "https://corsproxy.io/?url=";

function renderAdrChart(xRange) {
  const el = document.getElementById("chart-adr");
  if (!el || !adrRows.length) return;

  // 현재 activeMonths 에 맞춰 날짜 범위 필터
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
    margin: { l: 46, r: 46, t: 14, b: 36 },
    hovermode: "x unified",
    showlegend: true,
    legend: {
      orientation: "h", x: 0.5, y: 1.12, xanchor: "center",
      font: { color: "rgba(255,255,255,0.7)", size: 10 },
    },
    shapes: [
      // 80~120 배경 밴드
      {
        type: "rect", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_HIGH_THRESH,
        fillcolor: ADR_BAND_COLOR, line: { width: 0 }, layer: "below",
      },
      // 80% 선
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_LOW_THRESH, y1: ADR_LOW_THRESH,
        line: { color: ADR_ZONE_LOW_COLOR, width: 0.9, dash: "dash" },
      },
      // 120% 선
      {
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: ADR_HIGH_THRESH, y1: ADR_HIGH_THRESH,
        line: { color: ADR_ZONE_HIGH_COLOR, width: 0.9, dash: "dash" },
      },
      // 100% 중심선
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
      showspikes: true, spikemode: "across", spikesnap: "cursor",
      spikecolor: "rgba(255,255,255,0.25)", spikethickness: 1, spikedash: "solid",
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

  Plotly.react(el, traces, layout, { responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: true });

  if (!adrHandlerSet) {
    el.on("plotly_relayout", (eventData) => {
      if (chartSyncing || cursorSyncing) return;
      const mainEl = document.getElementById("chart");
      if (mainEl && mainEl.data) {
        const r0 = eventData["xaxis.range[0]"];
        const r1 = eventData["xaxis.range[1]"];
        if (r0 && r1) {
          pinnedXRange = [r0, r1];
          chartSyncing = true;
          Plotly.relayout(mainEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 }).finally(() => { chartSyncing = false; });
        } else if (eventData["xaxis.autorange"]) {
          pinnedXRange = null;
          chartSyncing = true;
          Plotly.relayout(mainEl, { "xaxis.autorange": true }).finally(() => { chartSyncing = false; });
        }
      }
    });
    el.on("plotly_hover", (eventData) => {
      if (hoverSyncing) return;
      const xValue = eventData?.points?.[0]?.x;
      if (!xValue) return;
      scheduleSyncedCursor(xValue);
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

/**
 * adrinfo.kr/chart 를 CORS 프록시로 가져와 adrRows 에 없는 날짜만 추가한다.
 * 반환: { added: number, latestDate: string }
 */
async function refreshAdrFromWeb() {
  const proxyUrl = CORS_PROXY + encodeURIComponent(ADR_SOURCE_URL);
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
  if (!kospiRaw.length && !kosdaqRaw.length) throw new Error("ADR 데이터 파싱 실패 — 사이트 구조 변경 가능성");

  const tsToDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
  const kospiMap  = new Map(kospiRaw.map(([ts, v])  => [tsToDate(ts), v]));
  const kosdaqMap = new Map(kosdaqRaw.map(([ts, v]) => [tsToDate(ts), v]));

  // 현재 adrRows 의 마지막 날짜 이후만 추가
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
  loadState();
  bindSeriesToggleBoard();
  syncButtons();
  try {
    await loadData(true);

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

    // 지수팝업 토글 버튼
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

    // 신용 오프셋 입력박스
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

    // 새로고침 버튼: 캐시 무시하고 최신 데이터 재요청
    
    const refreshBtn = document.getElementById("refreshData");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        if (refreshBtn.classList.contains("spinning")) return;
        refreshBtn.classList.add("spinning");
        msgEl.innerHTML = "";
        try {
          // 1) SW 캐시 삭제 후 서버 파일 재요청
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage("REFRESH_DATA");
          }
          await loadData(true);

          // 2) adrinfo.kr 에서 adrRows 에 없는 날짜만 증분 취득
          const prevLast = adrRows.length ? adrRows[adrRows.length - 1].date : "(없음)";
          try {
            const { added, latestDate } = await refreshAdrFromWeb();
            if (added > 0) {
              msgEl.innerHTML = `<div class="message">ADR ${added}일치 추가됨 (~ ${latestDate})</div>`;
            }
          } catch (adrErr) {
            // ADR 갱신 실패는 경고만 — 가격/신용 데이터는 이미 갱신됨
            msgEl.innerHTML = `<div class="message">ADR 갱신 실패 (${adrErr.message}) — 가격·신용 데이터는 갱신됨</div>`;
          }

          renderChart(false);
        } catch (err) {
          msgEl.innerHTML = `<div class="message error">새로고침 실패: ${err.message}</div>`;
        } finally {
          refreshBtn.classList.remove("spinning");
        }
      });
    }

    renderChart(false);
  } catch (err) {
    msgEl.innerHTML = `<div class="message error">${err.message || "앱을 시작하지 못했습니다."}</div>`;
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
}

boot();
