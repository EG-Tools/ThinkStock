const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용잔고",
  kosdaq_credit: "코스닥 신용잔고",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
};

const DEFAULT_SELECTED = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ"];
const SERIES_PRIORITY = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ"];
const SERIES_COLORS = {
  leading_cycle: "#999999",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#a78bfa",
  "005930.KS": "#2dd4bf",
  "218410.KQ": "#fb923c",
};

const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const labelName = (key) => DISPLAY_NAMES[key] || key;
const seriesColor = (key) => SERIES_COLORS[key] || "#888";

let pricePayload = null;
let macroText = "";
let activeYears = 10;
let hiddenSeries = new Set(["kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ"]);
let seriesOffsets = {};   // key -> y offset in data units
let seriesScales = {};    // key -> user scale multiplier (default 1)
let currentSelected = [];
let baseTraceValues = {};  // key -> y values after normalization+autofit, before user offset/scale
let legendHandlerSet = false;
let dragRafId = null;

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

function mergeSources(priceRows, manualRows, start, end) {
  const priceMap = new Map(priceRows.map((r) => [r.date, r]));
  const manualCols = getSeriesColumns(manualRows);
  const liveCols = getSeriesColumns(priceRows);
  const baseDates = priceRows.length ? priceRows.map((r) => r.date) : [];
  const sortedManual = [...manualRows].sort((a, b) => a.date.localeCompare(b.date));
  let mi = 0;
  const carry = {};
  const rows = [];
  baseDates.forEach((date) => {
    if (date < start || date > end) return;
    while (mi < sortedManual.length && sortedManual[mi].date <= date) {
      const mr = sortedManual[mi];
      manualCols.forEach((k) => { const v = toNum(mr[k]); if (v !== null) carry[k] = v; });
      mi++;
    }
    const row = { date };
    const live = priceMap.get(date) || {};
    liveCols.forEach((k) => { row[k] = toNum(live[k]); });
    manualCols.forEach((k) => { row[k] = carry[k] != null ? carry[k] : null; });
    rows.push(row);
  });
  return { rows, manualCols, liveCols };
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

    // First non-null y for left handle, last non-null y for right handle
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

    // Left handle: position (offset) — at first value
    const leftHandle = document.createElement("div");
    leftHandle.className = "y-handle y-handle-left";
    leftHandle.style.top = leftPixelY - 7 + "px";
    leftHandle.style.backgroundColor = color;
    leftHandle.title = labelName(key) + " (위치)";
    setupOffsetDrag(leftHandle, i, key, leftPixelY, ya);
    container.appendChild(leftHandle);

    // Right handle: scale — at last value
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
  renderChart();
}

/* ── Chart ── */

function renderChart() {
  const el = document.getElementById("chart");
  const msgEl = document.getElementById("messageArea");

  const priceRows = pricePayload.records || [];
  const manualRows = parseCsv(macroText);
  const dates = priceRows.map((r) => r.date);
  const maxDate = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
  const minDate = dates[0] || maxDate;
  const end = maxDate;
  let start = shiftYears(end, activeYears);
  if (start < minDate) start = minDate;

  const { rows, manualCols, liveCols } = mergeSources(priceRows, manualRows, start, end);
  const allSeries = sortSeries(
    [...new Set([...liveCols, ...manualCols])].filter((s) => rows.some((r) => toNum(r[s]) !== null))
  );
  const selected = DEFAULT_SELECTED.filter((s) => allSeries.includes(s));
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

    // Store base values before user adjustments
    baseTraceValues[series] = values;

    // Apply user scale (allows negative = inverted)
    const userScale = seriesScales[series] != null ? seriesScales[series] : 1;
    if (userScale !== 1) {
      values = values.map((v) => (v !== null ? 100 + (v - 100) * userScale : null));
    }

    // Apply user offset
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
        width: manualCols.includes(series) ? 3 : 2,
        shape: "linear",
      },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    };
  });

  Plotly.react(el, traces, {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#111111",
    margin: { l: 42, r: 42, t: 28, b: 32 },
    hovermode: "x unified",
    legend: { orientation: "h", x: 0, y: 1.08, font: { color: "rgba(255,255,255,0.7)", size: 11 } },
    xaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.06)", gridwidth: 1, zeroline: false, color: "#666", tickfont: { size: 10 }, fixedrange: false },
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
      updateHandles();
      return false;
    });
    el.on("plotly_legenddoubleclick", () => {
      hiddenSeries.clear();
      Plotly.restyle(el, { visible: currentSelected.map(() => true) });
      updateHandles();
      return false;
    });
    el.on("plotly_relayout", () => setTimeout(updateHandles, 50));
    el.on("plotly_click", () => {
      Plotly.relayout(el, { "xaxis.autorange": true, "yaxis.autorange": true });
    });
    legendHandlerSet = true;
  }

  updateHandles();
}

function syncButtons() {
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.years) === activeYears);
  });
}

async function boot() {
  const msgEl = document.getElementById("messageArea");
  try {
    const [priceRes, macroRes] = await Promise.all([
      fetch("./data/prices.json"),
      fetch("./data/sample_macro_data.csv"),
    ]);
    const priceText = await priceRes.text();
    pricePayload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));
    macroText = await macroRes.text();

    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeYears = Number(btn.dataset.years);
        syncButtons();
        renderChart();
      });
    });

    document.getElementById("resetHandles").addEventListener("click", resetHandles);

    renderChart();
  } catch (err) {
    msgEl.innerHTML = `<div class="message error">${err.message || "앱을 시작하지 못했습니다."}</div>`;
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
}

boot();
