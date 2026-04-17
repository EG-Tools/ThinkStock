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

const STATE_KEY = "thinkstock-v4";

const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const labelName = (key) => DISPLAY_NAMES[key] || key;
const seriesColor = (key) => SERIES_COLORS[key] || "#888";
const toUtcMs = (d) => Date.parse(`${d}T00:00:00Z`);

let pricePayload = null;
let macroRows = [];
let activeYears = 10;
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

/* ── localStorage persistence ── */
function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      activeYears,
      hiddenSeries: [...hiddenSeries],
      seriesOffsets,
      seriesScales,
    }));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (typeof p.activeYears === "number") activeYears = p.activeYears;
    if (Array.isArray(p.hiddenSeries)) hiddenSeries = new Set(p.hiddenSeries);
    if (p.seriesOffsets && typeof p.seriesOffsets === "object") seriesOffsets = p.seriesOffsets;
    if (p.seriesScales && typeof p.seriesScales === "object") seriesScales = p.seriesScales;
  } catch (_) {}
}

function shiftYears(dateStr, years) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const m = d.getMonth();
  d.setFullYear(d.getFullYear() - years);
  if (d.getMonth() !== m) d.setDate(0);
  return d.toISOString().slice(0, 10);
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

function mergeSources(priceRows, denseRows, start, end) {
  const priceMap = new Map(priceRows.map((r) => [r.date, r]));
  const macroMap = new Map(denseRows.map((r) => [r.date, r]));
  const liveCols = getSeriesColumns(priceRows);
  const macroCols = getSeriesColumns(denseRows);
  const baseDates = priceRows.length ? priceRows.map((r) => r.date) : [];
  const rows = [];
  baseDates.forEach((date) => {
    if (date < start || date > end) return;
    const row = { date };
    const pr = priceMap.get(date) || {};
    const mr = macroMap.get(date) || {};
    liveCols.forEach((k) => { row[k] = toNum(pr[k]); });
    macroCols.forEach((k) => { row[k] = toNum(mr[k]); });
    rows.push(row);
  });
  return { rows, macroCols, liveCols };
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

function setupOffsetDrag(handle, traceIndex, seriesKey, basePixelY, ya) {
  function onStart(startClientY) {
    const startOffset = seriesOffsets[seriesKey] || 0;
    handle.classList.add("dragging");

    function onMove(clientY) {
      const dy = clientY - startClientY;
      const dataDelta = -dy * (ya.range[1] - ya.range[0]) / ya._length;
      seriesOffsets[seriesKey] = startOffset + dataDelta;
      handle.style.top = basePixelY + dy - 7 + "px";
      restyleLive(traceIndex, seriesKey);
    }

    function onEnd(clientY) {
      handle.classList.remove("dragging");
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
    handle.classList.add("dragging");

    function onMove(clientY) {
      const dy = clientY - startClientY;
      const factor = 1 - dy / 150;
      seriesScales[seriesKey] = startScale * factor;
      handle.style.top = basePixelY + dy - 7 + "px";
      restyleLive(traceIndex, seriesKey);
    }

    function onEnd() {
      handle.classList.remove("dragging");
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
  let start = shiftYears(end, activeYears);
  if (start < minDate) start = minDate;

  const { rows, macroCols, liveCols } = mergeSources(priceRows, macroRows, start, end);
  currentRows = rows;
  currentStart = start;
  const allSeries = sortSeries(
    [...new Set([...liveCols, ...macroCols])].filter((s) => rows.some((r) => toNum(r[s]) !== null))
  );
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

  const autoScales = autoFitScales(rows, selected, commonNormBases);

  const traces = selected.map((series, i) => {
    let values = rows.map((r) => toNum(r[series]));
    const base = commonNormBases[series];
    values = (base && base !== 0)
      ? values.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null))
      : normalizeSeries(values);
    values = centeredScale(values, autoScales[series] || 100, true);

    baseTraceValues[series] = values;

    const userScale = seriesScales[series] != null ? seriesScales[series] : 1;
    if (userScale !== 1) {
      values = values.map((v) => (v !== null ? 100 + (v - 100) * userScale : null));
    }

    const offset = seriesOffsets[series] || 0;
    if (offset) values = values.map((v) => (v !== null ? v + offset : null));

    return {
      x: rows.map((r) => r.date),
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
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    };
  });

  // 핸들 드래그 후에만 줌 보존 — 범위 버튼 전환 시엔 초기화
  const savedXRange = preserveZoom ? (el._fullLayout?.xaxis?.range?.slice() || null) : null;

  Plotly.react(el, traces, {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    margin: { l: 42, r: 42, t: 28, b: 32 },
    hovermode: "x unified",
    legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
    xaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, color: "#666", tickfont: { size: 10 }, fixedrange: false, ...(savedXRange ? { range: savedXRange } : {}) },
    yaxis: { showticklabels: false, title: "", showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, fixedrange: true },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: { bgcolor: "#222", bordercolor: "#444", font: { color: "#eee" } },
    dragmode: false,
  }, { responsive: true, displaylogo: false, scrollZoom: true });

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
      setTimeout(updateHandles, 50);
      // 메인 차트 pan/zoom → ADR 차트 x축 동기화
      const adrEl = document.getElementById("chart-adr");
      if (adrEl && adrEl.data) {
        const r0 = eventData["xaxis.range[0]"];
        const r1 = eventData["xaxis.range[1]"];
        if (r0 && r1) Plotly.relayout(adrEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 });
        else if (eventData["xaxis.autorange"]) Plotly.relayout(adrEl, { "xaxis.autorange": true });
      }
    });
    el.on("plotly_click", () => {
      Plotly.relayout(el, { "xaxis.autorange": true, "yaxis.autorange": true });
    });
    legendHandlerSet = true;
  }

  updateHandles();
  renderAdrChart(rows, preserveZoom ? (el._fullLayout?.xaxis?.range?.slice() || null) : null);
}

/* ── ADR 미니 차트 ── */
function renderAdrChart(rows, xRange) {
  const el = document.getElementById("chart-adr");
  if (!el || !rows.length) return;

  const adrAvailable = ADR_SERIES.filter((s) => rows.some((r) => toNum(r[s]) !== null));
  if (!adrAvailable.length) return;

  const traces = adrAvailable.map((s) => ({
    x: rows.map((r) => r.date),
    y: rows.map((r) => toNum(r[s])),
    type: "scatter",
    mode: "lines",
    name: labelName(s),
    connectgaps: true,
    line: { color: seriesColor(s), width: 2, shape: "linear" },
    hovertemplate: "%{x}<br>%{y:.2f}<extra>%{fullData.name}</extra>",
  }));

  const layout = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    margin: { l: 42, r: 42, t: 14, b: 32 },
    hovermode: "x unified",
    showlegend: true,
    legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
    shapes: [
      { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 1, y1: 1,
        line: { color: "rgba(255,255,255,0.18)", width: 1, dash: "dot" } },
    ],
    xaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.06)", zeroline: false,
      color: "#666", tickfont: { size: 10 }, fixedrange: false,
      ...(xRange ? { range: xRange } : {}),
    },
    yaxis: {
      showgrid: true, gridcolor: "rgba(255,255,255,0.06)", zeroline: false,
      color: "#666", tickfont: { size: 10 }, fixedrange: true,
    },
    font: { color: "#ccc", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: { bgcolor: "#222", bordercolor: "#444", font: { color: "#eee" } },
    dragmode: false,
  };

  Plotly.react(el, traces, layout, { responsive: true, displaylogo: false, scrollZoom: true });

  if (!adrHandlerSet) {
    el.on("plotly_relayout", (eventData) => {
      const mainEl = document.getElementById("chart");
      if (mainEl && mainEl.data) {
        const r0 = eventData["xaxis.range[0]"];
        const r1 = eventData["xaxis.range[1]"];
        if (r0 && r1) Plotly.relayout(mainEl, { "xaxis.range[0]": r0, "xaxis.range[1]": r1 });
        else if (eventData["xaxis.autorange"]) Plotly.relayout(mainEl, { "xaxis.autorange": true });
      }
    });
    adrHandlerSet = true;
  }
}

function syncButtons() {
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.years) === activeYears);
  });
}

async function boot() {
  const msgEl = document.getElementById("messageArea");
  loadState();
  syncButtons();
  try {
    const [priceRes, macroRes] = await Promise.all([
      fetch("./data/prices.json"),
      fetch("./data/sample_macro_data.csv"),
    ]);
    const priceText = await priceRes.text();
    pricePayload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));
    const csvRows = parseCsv(await macroRes.text());
    const priceDates = (pricePayload.records || []).map((r) => r.date);
    macroRows = buildDenseMacroRows(csvRows, priceDates);

    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeYears = Number(btn.dataset.years);
        syncButtons();
        saveState();
        renderChart(false);
      });
    });

    document.getElementById("resetHandles").addEventListener("click", resetHandles);

    renderChart(false);
  } catch (err) {
    msgEl.innerHTML = `<div class="message error">${err.message || "앱을 시작하지 못했습니다."}</div>`;
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
}

boot();
