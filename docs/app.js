const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용잔고",
  kosdaq_credit: "코스닥 신용잔고",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
  adr_kospi: "ADR K",
  adr_kosdaq: "ADR KQ",
};

const SERIES_PRIORITY = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ", "adr_kospi", "adr_kosdaq"];
const SERIES_COLORS = {
  leading_cycle: "#9ca3af",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#c084fc",
  "005930.KS": "#2dd4bf",
  "218410.KQ": "#fb923c",
  adr_kospi: "#facc15",
  adr_kosdaq: "#f472b6",
};
const DEFAULT_VISIBLE = ["leading_cycle", "^KS11"];
const DEFAULT_ACTIVE_SERIES = "leading_cycle";
const DATE_PRESETS = [
  { key: "1y", label: "1Y", months: 12 },
  { key: "3y", label: "3Y", months: 36 },
  { key: "5y", label: "5Y", months: 60 },
  { key: "10y", label: "10Y", months: 120 },
  { key: "20y", label: "20Y", months: 240 },
  { key: "30y", label: "30Y", months: 360 },
];
const DEFAULT_DATE_PRESET = "10y";
const STATE_KEY = "thinkstock-pages-v4";
const SCALE_MIN = -12;
const SCALE_MAX = 12;
const SCALE_DEADZONE = 0.05;

const toNum = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const labelName = (k) => DISPLAY_NAMES[k] || k;
const seriesColor = (k) => SERIES_COLORS[k] || "#888888";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toUtcMs = (d) => Date.parse(`${d}T00:00:00Z`);

/* ── State ── */
const state = {
  pricePayload: null,
  macroRows: [],
  activePresetKey: DEFAULT_DATE_PRESET,
  hiddenSeries: new Set(SERIES_PRIORITY.filter((s) => !DEFAULT_VISIBLE.includes(s))),
  seriesOffsets: {},
  seriesScales: {},
  activeSeries: DEFAULT_ACTIVE_SERIES,
  activeHandleKind: null,
  legendHandlerSet: false,
  dragRafId: null,
};

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      activePresetKey: state.activePresetKey,
      hiddenSeries: [...state.hiddenSeries],
      seriesOffsets: state.seriesOffsets,
      seriesScales: state.seriesScales,
      activeSeries: state.activeSeries,
    }));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.activePresetKey) state.activePresetKey = p.activePresetKey;
    if (Array.isArray(p.hiddenSeries)) state.hiddenSeries = new Set(p.hiddenSeries);
    if (p.seriesOffsets && typeof p.seriesOffsets === "object") state.seriesOffsets = p.seriesOffsets;
    if (p.seriesScales && typeof p.seriesScales === "object") state.seriesScales = p.seriesScales;
    if (p.activeSeries) state.activeSeries = p.activeSeries;
  } catch (_) {}
}

/* ── Helpers ── */
function shiftMonths(dateStr, m) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() - m);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function parseCsv(text) {
  if (!text || !text.trim()) return [];
  const result = Papa.parse(text.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (result.errors.length) throw new Error(result.errors[0].message);
  if (!result.meta.fields.includes("date")) throw new Error("CSV에 date 컬럼이 필요합니다.");
  return result.data.map((row) => {
    const out = { date: String(row.date).slice(0, 10) };
    Object.entries(row).forEach(([k, v]) => { if (k !== "date" && v !== "") { const n = Number(v); out[k] = Number.isFinite(n) ? n : v; } });
    return out;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function parsePayloadRows(text) {
  const p = JSON.parse(text.replace(/\bNaN\b/g, "null"));
  return Array.isArray(p) ? p : (Array.isArray(p.records) ? p.records : []);
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

/* ── Dense macro interpolation ── */
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

/* ── Merge price + macro ── */
function mergeSources(priceRows, macroInput, start, end) {
  const priceMap = new Map(priceRows.map((r) => [r.date, r]));
  const macroMap = new Map(macroInput.map((r) => [r.date, r]));
  const liveCols = getSeriesColumns(priceRows);
  const macroCols = getSeriesColumns(macroInput);
  const baseDates = priceRows.length ? priceRows.map((r) => r.date) : macroInput.map((r) => r.date);
  const rows = [];
  baseDates.forEach((date) => {
    if (date < start || date > end) return;
    const row = { date };
    const pr = priceMap.get(date) || {};
    const mr = macroMap.get(date) || {};
    liveCols.forEach((c) => { row[c] = toNum(pr[c]); });
    macroCols.forEach((c) => { row[c] = toNum(mr[c]); });
    rows.push(row);
  });
  return { rows, liveCols, macroCols };
}

/* ── Normalization ── */
function normalizeSeries(vals) {
  const first = vals.find((v) => Number.isFinite(v));
  const base = Number.isFinite(first) && first !== 0 ? first : 1;
  return vals.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null));
}

function centeredScale(vals, pct, normalized) {
  const nums = vals.filter((v) => Number.isFinite(v));
  if (!nums.length) return vals;
  const pivot = normalized ? 100 : (Math.min(...nums) + Math.max(...nums)) / 2;
  const r = pct / 100;
  return vals.map((v) => (Number.isFinite(v) ? pivot + (v - pivot) * r : null));
}

function autoFitScales(rows, series, normBases) {
  const info = [];
  series.forEach((s) => {
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

function getVisibleSeries(allSeries) {
  return allSeries.filter((s) => !state.hiddenSeries.has(s));
}

/* ── Drag + Handles ── */
function computeFinalValues(baseValues, key) {
  const scale = state.seriesScales[key] != null ? state.seriesScales[key] : 1;
  const offset = state.seriesOffsets[key] || 0;
  return baseValues.map((v) => (v !== null ? 100 + (v - 100) * scale + offset : null));
}

function restyleActiveTrace(key) {
  if (state.dragRafId) return;
  state.dragRafId = requestAnimationFrame(() => {
    state.dragRafId = null;
    const chart = document.getElementById("chart");
    if (!chart || !Array.isArray(chart.data)) return;
    const idx = chart.data.findIndex((t) => t.meta?.series === key && !t.meta?.aux);
    if (idx < 0) return;
    Plotly.restyle(chart, { y: [computeFinalValues(chart.data[idx].meta.baseValues, key)] }, [idx]);
    requestAnimationFrame(updateHandles);
  });
}

function addDragListeners(onMove, onEnd) {
  const mm = (e) => onMove(e.clientY);
  const mu = (e) => { cleanup(); onEnd(e.clientY); };
  const tm = (e) => { e.preventDefault(); onMove(e.touches[0].clientY); };
  const te = (e) => { cleanup(); onEnd(e.changedTouches[0].clientY); };
  function cleanup() {
    document.removeEventListener("mousemove", mm);
    document.removeEventListener("mouseup", mu);
    document.removeEventListener("touchmove", tm);
    document.removeEventListener("touchend", te);
    document.body.classList.remove("is-dragging");
  }
  document.addEventListener("mousemove", mm);
  document.addEventListener("mouseup", mu);
  document.addEventListener("touchmove", tm, { passive: false });
  document.addEventListener("touchend", te);
}

function refreshHandleStates() {
  document.querySelectorAll(".y-handle").forEach((h) => h.classList.toggle("is-active", h.dataset.kind === state.activeHandleKind));
}

function setupOffsetDrag(handle, key, basePixelY, yAxis) {
  function onStart(startY) {
    const startOffset = state.seriesOffsets[key] || 0;
    state.activeHandleKind = "offset";
    handle.classList.add("dragging");
    document.body.classList.add("is-dragging");
    refreshHandleStates();
    addDragListeners((clientY) => {
      const dy = clientY - startY;
      state.seriesOffsets[key] = startOffset + (-dy * (yAxis.range[1] - yAxis.range[0]) / yAxis._length);
      handle.style.top = `${basePixelY + dy - 10}px`;
      restyleActiveTrace(key);
    }, () => {
      handle.classList.remove("dragging");
      state.activeHandleKind = null;
      saveAndRender();
    });
  }
  handle.addEventListener("mousedown", (e) => { e.preventDefault(); onStart(e.clientY); });
  handle.addEventListener("touchstart", (e) => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
}

function setupScaleDrag(handle, key, basePixelY) {
  function onStart(startY) {
    const startScale = state.seriesScales[key] != null ? state.seriesScales[key] : 1;
    state.activeHandleKind = "scale";
    handle.classList.add("dragging");
    document.body.classList.add("is-dragging");
    refreshHandleStates();
    addDragListeners((clientY) => {
      const dy = clientY - startY;
      let next = clamp(startScale - dy / 120, SCALE_MIN, SCALE_MAX);
      if (Math.abs(next) < SCALE_DEADZONE) next = next < 0 ? -SCALE_DEADZONE : SCALE_DEADZONE;
      state.seriesScales[key] = next;
      handle.style.top = `${basePixelY + dy - 10}px`;
      restyleActiveTrace(key);
    }, () => {
      handle.classList.remove("dragging");
      state.activeHandleKind = null;
      saveAndRender();
    });
  }
  handle.addEventListener("mousedown", (e) => { e.preventDefault(); onStart(e.clientY); });
  handle.addEventListener("touchstart", (e) => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
}

function updateHandles() {
  const chart = document.getElementById("chart");
  if (!chart || !chart._fullLayout || !state.activeSeries) return;
  let container = document.getElementById("y-handles");
  if (!container) {
    container = document.createElement("div");
    container.id = "y-handles";
    chart.appendChild(container);
  }
  container.innerHTML = "";
  const trace = chart.data.find((t) => t.meta?.series === state.activeSeries && !t.meta?.aux);
  if (!trace || trace.visible === "legendonly") return;
  const yAxis = chart._fullLayout.yaxis;
  const xAxis = chart._fullLayout.xaxis;
  if (!yAxis || !xAxis || !yAxis._length || !xAxis._length) return;
  const values = Array.isArray(trace.y) ? trace.y : [];
  const firstY = values.find((v) => v !== null && v !== undefined);
  let lastY = null;
  for (let i = values.length - 1; i >= 0; i--) { if (values[i] !== null && values[i] !== undefined) { lastY = values[i]; break; } }
  if (firstY == null || lastY == null) return;
  const span = yAxis.range[1] - yAxis.range[0] || 1;
  const toPixelY = (v) => yAxis._offset + yAxis._length * (1 - ((v - yAxis.range[0]) / span));
  const leftPx = toPixelY(firstY);
  const rightPx = toPixelY(lastY);
  const color = trace.line.color;

  const left = document.createElement("button");
  left.type = "button";
  left.className = "y-handle y-handle-left";
  left.dataset.kind = "offset";
  left.style.top = `${leftPx - 10}px`;
  left.style.backgroundColor = color;
  left.title = `${labelName(state.activeSeries)} 위치`;
  setupOffsetDrag(left, state.activeSeries, leftPx, yAxis);
  container.appendChild(left);

  const right = document.createElement("button");
  right.type = "button";
  right.className = "y-handle y-handle-right";
  right.dataset.kind = "scale";
  right.style.top = `${rightPx - 10}px`;
  right.style.backgroundColor = color;
  right.title = `${labelName(state.activeSeries)} 스케일`;
  setupScaleDrag(right, state.activeSeries, rightPx);
  container.appendChild(right);
  refreshHandleStates();
}

/* ── Layout ── */
function buildLayout() {
  return {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#05070b",
    margin: { l: 44, r: 44, t: 18, b: 36 },
    hovermode: "x unified",
    dragmode: "pan",
    showlegend: true,
    legend: { orientation: "h", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom", font: { size: 11, color: "#c4d0e4" }, bgcolor: "transparent" },
    shapes: [
      { type: "rect", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 90, y1: 110, line: { width: 0 }, fillcolor: "rgba(141, 182, 255, 0.05)", layer: "below" },
      { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 100, y1: 100, line: { color: "rgba(255,255,255,0.12)", width: 1, dash: "dot" }, layer: "below" },
    ],
    xaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.08)", gridwidth: 1, zeroline: false,
      color: "#93a4bb", tickfont: { size: 10 }, fixedrange: false,
      showspikes: true, spikethickness: 1, spikecolor: "rgba(255,255,255,0.22)", spikedash: "dot",
    },
    yaxis: { showticklabels: false, showgrid: true, gridcolor: "rgba(255,255,255,0.08)", gridwidth: 1, zeroline: false, fixedrange: true },
    font: { color: "#dbe5f5", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: { bgcolor: "#0e1522", bordercolor: "#1f2a3d", font: { color: "#f4f8ff" } },
  };
}

/* ── Chart render ── */
function renderChart(rows, visibleSeries) {
  const chart = document.getElementById("chart");
  const msg = document.getElementById("messageArea");
  if (!rows.length || !visibleSeries.length) {
    msg.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }
  msg.innerHTML = "";
  const normBases = {};
  const firstDates = visibleSeries.map((s) => rows.find((r) => toNum(r[s]) !== null)?.date || null).filter(Boolean);
  const commonBase = firstDates.length ? firstDates.reduce((a, b) => (b > a ? b : a)) : null;
  if (commonBase) {
    visibleSeries.forEach((s) => {
      const r = rows.find((row) => row.date >= commonBase && toNum(row[s]) !== null);
      normBases[s] = r ? toNum(r[s]) : null;
    });
  }
  const autoScales = autoFitScales(rows, visibleSeries, normBases);
  const traces = [];
  visibleSeries.forEach((s) => {
    let vals = rows.map((r) => toNum(r[s]));
    const base = normBases[s];
    vals = (base && base !== 0) ? vals.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null)) : normalizeSeries(vals);
    vals = centeredScale(vals, autoScales[s] || 100, true);
    const final = computeFinalValues(vals, s);
    const isActive = s === state.activeSeries;
    const latestPt = final.map((v, i) => ({ v, i })).filter((p) => p.v != null).at(-1);
    traces.push({
      x: rows.map((r) => r.date), y: final,
      type: "scatter", mode: "lines",
      name: labelName(s),
      meta: { series: s, baseValues: vals },
      connectgaps: false,
      opacity: state.activeSeries && !isActive ? 0.54 : 1,
      line: { color: seriesColor(s), width: isActive ? 4.6 : 2.3, shape: "linear" },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    });
    if (latestPt) {
      traces.push({
        x: [rows[latestPt.i].date], y: [final[latestPt.i]],
        type: "scatter", mode: "markers", showlegend: false, hoverinfo: "skip",
        meta: { series: s, aux: true },
        marker: { size: isActive ? 10 : 7, color: seriesColor(s), line: { color: "rgba(255,255,255,0.85)", width: isActive ? 1.6 : 1.1 } },
      });
    }
  });
  Plotly.react(chart, traces, buildLayout(), { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: false, doubleClick: "reset" });
  if (!state.legendHandlerSet) {
    chart.on("plotly_legendclick", (e) => {
      const clicked = e.data[e.curveNumber]?.meta?.series;
      if (!clicked) return false;
      if (state.hiddenSeries.has(clicked)) {
        state.hiddenSeries.delete(clicked);
        state.activeSeries = clicked;
      } else {
        const vis = getVisibleSeries(state.currentAllSeries);
        if (vis.length > 1) {
          state.hiddenSeries.add(clicked);
          if (state.activeSeries === clicked) state.activeSeries = getVisibleSeries(state.currentAllSeries)[0] || null;
        } else {
          state.activeSeries = clicked;
        }
      }
      saveAndRender();
      return false;
    });
    chart.on("plotly_relayout", () => requestAnimationFrame(updateHandles));
    state.legendHandlerSet = true;
  }
  requestAnimationFrame(updateHandles);
}

/* ── Range buttons ── */
function renderRangeButtons() {
  const c = document.getElementById("rangeButtons");
  c.innerHTML = DATE_PRESETS.map((p) =>
    `<button class="range-btn ${p.key === state.activePresetKey ? "is-active" : ""}" data-key="${p.key}" type="button">${p.label}</button>`
  ).join("");
  c.querySelectorAll("[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => { state.activePresetKey = btn.dataset.key; saveAndRender(); });
  });
}

/* ── Main render ── */
function saveAndRender() { saveState(); render(); }

function render() {
  const priceRows = state.pricePayload?.records || [];
  if (!priceRows.length) return;
  const preset = DATE_PRESETS.find((p) => p.key === state.activePresetKey) || DATE_PRESETS.find((p) => p.key === DEFAULT_DATE_PRESET);
  const maxDate = priceRows[priceRows.length - 1].date;
  const minDate = priceRows[0].date;
  const start = [shiftMonths(maxDate, preset.months), minDate].sort()[1];
  const { rows, liveCols, macroCols } = mergeSources(priceRows, state.macroRows, start, maxDate);
  const allSeries = sortSeries([...new Set([...liveCols, ...macroCols])].filter((s) => rows.some((r) => toNum(r[s]) !== null)));

  // ensure state consistency
  const allSet = new Set(allSeries);
  state.hiddenSeries = new Set([...state.hiddenSeries].filter((s) => allSet.has(s)));
  const visible = getVisibleSeries(allSeries);
  if (!visible.length) {
    DEFAULT_VISIBLE.forEach((s) => { if (allSet.has(s)) state.hiddenSeries.delete(s); });
  }
  const vis = getVisibleSeries(allSeries);
  if (!vis.includes(state.activeSeries)) state.activeSeries = vis[0] || null;
  state.currentAllSeries = allSeries;

  renderRangeButtons();
  renderChart(rows, vis);
}

/* ── Data loading ── */
async function loadMacroRows(priceRows) {
  const dates = priceRows.map((r) => r.date);
  try {
    const res = await fetch("./data/macro_data.json", { cache: "no-store" });
    if (res.ok) return buildDenseMacroRows(parsePayloadRows(await res.text()), dates);
  } catch (_) {}
  const fb = await fetch("./data/sample_macro_data.csv", { cache: "no-store" });
  return buildDenseMacroRows(parseCsv(await fb.text()), dates);
}

/* ── Boot ── */
async function boot() {
  const msg = document.getElementById("messageArea");
  loadState();
  try {
    const res = await fetch("./data/prices.json", { cache: "no-store" });
    state.pricePayload = JSON.parse((await res.text()).replace(/\bNaN\b/g, "null"));
    state.macroRows = await loadMacroRows(state.pricePayload.records || []);
    document.getElementById("resetHandles").addEventListener("click", () => {
      state.seriesOffsets = {};
      state.seriesScales = {};
      saveAndRender();
    });
    render();
  } catch (err) {
    msg.innerHTML = `<div class="message error">${err.message || "앱을 시작하지 못했습니다."}</div>`;
  }
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
}

boot();
