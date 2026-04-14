const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용잔고",
  kosdaq_credit: "코스닥 신용잔고",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
};

const SERIES_PRIORITY = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ"];
const SERIES_COLORS = {
  leading_cycle: "#9ca3af",
  "^KS11": "#4ade80",
  kospi_credit: "#60a5fa",
  "^KQ11": "#f87171",
  kosdaq_credit: "#c084fc",
  "005930.KS": "#2dd4bf",
  "218410.KQ": "#fb923c",
};
const DEFAULT_VISIBLE = ["leading_cycle", "^KS11"];
const DEFAULT_ACTIVE_SERIES = "leading_cycle";
const PRESETS = {
  default: { label: "기본", series: ["leading_cycle", "^KS11"] },
  market: { label: "시장", series: ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit"] },
  all: { label: "전체", series: SERIES_PRIORITY },
};
const DATE_PRESETS = [
  { key: "6m", label: "6M", months: 6 },
  { key: "1y", label: "1Y", months: 12 },
  { key: "3y", label: "3Y", months: 36 },
  { key: "5y", label: "5Y", months: 60 },
  { key: "10y", label: "10Y", months: 120 },
  { key: "20y", label: "20Y", months: 240 },
  { key: "30y", label: "30Y", months: 360 },
];
const DEFAULT_DATE_PRESET = "10y";
const STATE_KEY = "thinkstock-pages-v3";
const SCALE_MIN = -12;
const SCALE_MAX = 12;
const SCALE_DEADZONE = 0.05;

const toNum = (value) => (value != null && Number.isFinite(Number(value)) ? Number(value) : null);
const labelName = (key) => DISPLAY_NAMES[key] || key;
const seriesColor = (key) => SERIES_COLORS[key] || "#888888";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toUtcMs = (dateStr) => Date.parse(`${dateStr}T00:00:00Z`);

const state = {
  pricePayload: null,
  macroRows: [],
  activePresetKey: DEFAULT_DATE_PRESET,
  hiddenSeries: new Set(SERIES_PRIORITY.filter((series) => !DEFAULT_VISIBLE.includes(series))),
  seriesOffsets: {},
  seriesScales: {},
  activeSeries: DEFAULT_ACTIVE_SERIES,
  activeHandleKind: null,
  showGuides: true,
  showReferenceBand: true,
  currentVisible: [],
  currentRows: [],
  currentAllSeries: [],
  legendHandlerSet: false,
  dragRafId: null,
};

function saveState() {
  const payload = {
    activePresetKey: state.activePresetKey,
    hiddenSeries: [...state.hiddenSeries],
    seriesOffsets: state.seriesOffsets,
    seriesScales: state.seriesScales,
    activeSeries: state.activeSeries,
    showGuides: state.showGuides,
    showReferenceBand: state.showReferenceBand,
  };
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload.activePresetKey) state.activePresetKey = payload.activePresetKey;
    if (Array.isArray(payload.hiddenSeries)) state.hiddenSeries = new Set(payload.hiddenSeries);
    if (payload.seriesOffsets && typeof payload.seriesOffsets === "object") state.seriesOffsets = payload.seriesOffsets;
    if (payload.seriesScales && typeof payload.seriesScales === "object") state.seriesScales = payload.seriesScales;
    if (payload.activeSeries) state.activeSeries = payload.activeSeries;
    if (typeof payload.showGuides === "boolean") state.showGuides = payload.showGuides;
    if (typeof payload.showReferenceBand === "boolean") state.showReferenceBand = payload.showReferenceBand;
  } catch (_) {}
}

function shiftMonths(dateStr, monthsBack) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  const originalDay = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() - monthsBack);
  if (date.getUTCDate() !== originalDay) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  if (abs >= 100) return value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function formatDelta(value) {
  if (value == null || Number.isNaN(value)) return "변화 없음";
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function parseCsv(text) {
  if (!text || !text.trim()) return [];
  const result = Papa.parse(text.trim(), {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  if (result.errors.length) throw new Error(result.errors[0].message);
  if (!result.meta.fields.includes("date")) throw new Error("CSV에 date 컬럼이 필요합니다.");
  return result.data.map((row) => {
    const out = { date: String(row.date).slice(0, 10) };
    Object.entries(row).forEach(([key, value]) => {
      if (key === "date" || value === "") return;
      const parsed = Number(value);
      out[key] = Number.isFinite(parsed) ? parsed : value;
    });
    return out;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function parsePayloadRows(text) {
  const payload = JSON.parse(text.replace(/\bNaN\b/g, "null"));
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.records) ? payload.records : [];
}

function getSeriesColumns(rows) {
  const cols = new Set();
  rows.forEach((row) => Object.keys(row).forEach((key) => { if (key !== "date") cols.add(key); }));
  return [...cols];
}

function sortSeries(list) {
  const priority = new Map(SERIES_PRIORITY.map((name, index) => [name, index]));
  return [...list].sort((a, b) => {
    const aRank = priority.has(a) ? priority.get(a) : SERIES_PRIORITY.length + 1;
    const bRank = priority.has(b) ? priority.get(b) : SERIES_PRIORITY.length + 1;
    return aRank !== bRank ? aRank - bRank : labelName(a).localeCompare(labelName(b), "ko");
  });
}

function buildDenseMacroRows(sourceRows, targetDates) {
  const sortedRows = [...sourceRows].sort((a, b) => a.date.localeCompare(b.date));
  const cols = getSeriesColumns(sortedRows);
  if (!sortedRows.length || !targetDates.length || !cols.length) return sortedRows;

  const targets = targetDates.map((date) => ({ date, time: toUtcMs(date) }));
  const denseRows = targets.map(({ date }) => ({ date }));

  cols.forEach((col) => {
    const points = sortedRows.map((row) => ({ time: toUtcMs(row.date), value: toNum(row[col]) }))
      .filter((point) => point.value !== null)
      .sort((a, b) => a.time - b.time);
    if (!points.length) {
      targets.forEach((_, index) => { denseRows[index][col] = null; });
      return;
    }
    let pointer = 0;
    targets.forEach(({ time }, index) => {
      if (time < points[0].time || time > points[points.length - 1].time) {
        denseRows[index][col] = null;
        return;
      }
      while (pointer + 1 < points.length && points[pointer + 1].time < time) pointer += 1;
      const left = points[pointer];
      const right = points[pointer + 1];
      if (!left) {
        denseRows[index][col] = null;
        return;
      }
      if (!right || left.time === time || left.time === right.time) {
        denseRows[index][col] = left.value;
        return;
      }
      if (right.time === time) {
        denseRows[index][col] = right.value;
        return;
      }
      const ratio = (time - left.time) / (right.time - left.time);
      denseRows[index][col] = left.value + (right.value - left.value) * ratio;
    });
  });

  return denseRows.filter((row) => cols.some((col) => toNum(row[col]) !== null));
}

function mergeSources(priceRows, macroRowsInput, start, end) {
  const priceMap = new Map(priceRows.map((row) => [row.date, row]));
  const macroMap = new Map(macroRowsInput.map((row) => [row.date, row]));
  const liveCols = getSeriesColumns(priceRows);
  const macroCols = getSeriesColumns(macroRowsInput);
  const baseDates = priceRows.length ? priceRows.map((row) => row.date) : macroRowsInput.map((row) => row.date);
  const rows = [];
  baseDates.forEach((date) => {
    if (date < start || date > end) return;
    const row = { date };
    const priceRow = priceMap.get(date) || {};
    const macroRow = macroMap.get(date) || {};
    liveCols.forEach((col) => { row[col] = toNum(priceRow[col]); });
    macroCols.forEach((col) => { row[col] = toNum(macroRow[col]); });
    rows.push(row);
  });
  return { rows, liveCols, macroCols };
}

function normalizeSeries(values) {
  const first = values.find((value) => Number.isFinite(value));
  const base = Number.isFinite(first) && first !== 0 ? first : 1;
  return values.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null));
}

function centeredScale(values, pct, normalized) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return values;
  const pivot = normalized ? 100 : (Math.min(...nums) + Math.max(...nums)) / 2;
  const ratio = pct / 100;
  return values.map((value) => (Number.isFinite(value) ? pivot + (value - pivot) * ratio : null));
}

function autoFitScales(rows, seriesNames, normBases) {
  const info = [];
  seriesNames.forEach((seriesName) => {
    let values = rows.map((row) => toNum(row[seriesName])).filter((value) => value !== null);
    if (!values.length) return;
    const base = normBases[seriesName];
    values = (base && base !== 0) ? values.map((value) => (value / base) * 100) : normalizeSeries(values).filter((value) => Number.isFinite(value));
    const range = Math.max(Math.max(...values) - Math.min(...values), 1);
    info.push([seriesName, range]);
  });
  if (!info.length) return {};
  const sortedRanges = info.map(([, range]) => range).sort((a, b) => a - b);
  const targetRange = sortedRanges[Math.floor(sortedRanges.length / 2)];
  return Object.fromEntries(info.map(([seriesName, range]) => [seriesName, Math.max(5, Math.min(5000, Math.round((targetRange / range) * 100)))]));
}

function getPresetByKey(key) {
  return DATE_PRESETS.find((preset) => preset.key === key) || DATE_PRESETS.find((preset) => preset.key === DEFAULT_DATE_PRESET);
}

function getVisibleSeries(allSeries) {
  return allSeries.filter((series) => !state.hiddenSeries.has(series));
}

function ensureState(allSeries) {
  const allSet = new Set(allSeries);
  state.hiddenSeries = new Set([...state.hiddenSeries].filter((series) => allSet.has(series)));
  if (!getVisibleSeries(allSeries).length) {
    DEFAULT_VISIBLE.forEach((series) => { if (allSet.has(series)) state.hiddenSeries.delete(series); });
    if (!getVisibleSeries(allSeries).length && allSeries[0]) state.hiddenSeries.delete(allSeries[0]);
  }
  const visible = getVisibleSeries(allSeries);
  if (!visible.includes(state.activeSeries)) state.activeSeries = visible.includes(DEFAULT_ACTIVE_SERIES) ? DEFAULT_ACTIVE_SERIES : (visible[0] || null);
  state.currentAllSeries = allSeries;
  state.currentVisible = visible;
}

function latestSnapshot(rows, seriesName) {
  const values = rows.map((row) => ({ date: row.date, value: toNum(row[seriesName]) })).filter((row) => row.value !== null);
  if (!values.length) return null;
  const latest = values[values.length - 1];
  const prev = values.length > 1 ? values[values.length - 2] : null;
  return { date: latest.date, value: latest.value, delta: prev ? latest.value - prev.value : null };
}

function saveAndRender() {
  saveState();
  render();
}

function renderRangeButtons() {
  const container = document.getElementById("rangeButtons");
  container.innerHTML = DATE_PRESETS.map((preset) => `<button class="range-btn ${preset.key === state.activePresetKey ? "is-active" : ""}" data-range-key="${preset.key}" type="button">${preset.label}</button>`).join("");
  container.querySelectorAll("[data-range-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePresetKey = button.dataset.rangeKey;
      saveAndRender();
    });
  });
}

function applyVisibleSeries(seriesList) {
  const allowed = new Set(seriesList);
  state.currentAllSeries.forEach((series) => {
    if (allowed.has(series)) state.hiddenSeries.delete(series);
    else state.hiddenSeries.add(series);
  });
  const visible = getVisibleSeries(state.currentAllSeries);
  state.activeSeries = visible.includes(state.activeSeries) ? state.activeSeries : (visible[0] || null);
}

function renderPresetButtons() {
  const visible = new Set(state.currentVisible);
  const activePreset = Object.entries(PRESETS).find(([, preset]) => {
    const candidate = preset.series.filter((series) => state.currentAllSeries.includes(series));
    return candidate.length === visible.size && candidate.every((series) => visible.has(series));
  })?.[0] || null;
  const container = document.getElementById("presetButtons");
  container.innerHTML = Object.entries(PRESETS).map(([key, preset]) => `<button class="preset-btn ${key === activePreset ? "is-active" : ""}" data-preset-key="${key}" type="button">${preset.label}</button>`).join("");
  container.querySelectorAll("[data-preset-key]").forEach((button) => {
    button.addEventListener("click", () => {
      applyVisibleSeries(PRESETS[button.dataset.presetKey].series);
      saveAndRender();
    });
  });
}

function renderSwitches() {
  document.getElementById("guideToggle").classList.toggle("is-active", state.showGuides);
  document.getElementById("bandToggle").classList.toggle("is-active", state.showReferenceBand);
}

function renderRangeStatus(minDate, maxDate) {
  document.getElementById("rangeStatus").textContent = `${minDate} ~ ${maxDate}`;
}

function renderSummary(rows, visibleSeries) {
  const container = document.getElementById("seriesSummary");
  if (!visibleSeries.length) {
    container.innerHTML = '<div class="message">표시 중인 시리즈가 없습니다.</div>';
    return;
  }
  container.innerHTML = visibleSeries.map((series) => {
    const snapshot = latestSnapshot(rows, series);
    return `<button class="summary-card-item ${series === state.activeSeries ? "is-active" : ""}" data-summary-series="${series}" type="button" style="--series-color:${seriesColor(series)};">
      <div class="summary-top"><span class="summary-name"><span class="dot"></span>${labelName(series)}</span><span class="summary-delta">${snapshot ? snapshot.date : "-"}</span></div>
      <div class="summary-value">${snapshot ? formatNumber(snapshot.value) : "-"}</div>
      <div class="summary-delta">변화 ${snapshot ? formatDelta(snapshot.delta) : "변화 없음"}</div>
    </button>`;
  }).join("");
  container.querySelectorAll("[data-summary-series]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSeries = button.dataset.summarySeries;
      saveAndRender();
    });
  });
}

function renderSeriesToggles(rows, allSeries) {
  const container = document.getElementById("seriesToggles");
  container.innerHTML = allSeries.map((series) => {
    const visible = !state.hiddenSeries.has(series);
    const snapshot = latestSnapshot(rows, series);
    return `<button class="toggle-card ${visible ? "is-visible" : ""} ${series === state.activeSeries ? "is-active" : ""}" data-toggle-series="${series}" type="button" style="--series-color:${seriesColor(series)};">
      <div class="toggle-top"><span class="toggle-name"><span class="dot"></span>${labelName(series)}</span><span class="toggle-state">${visible ? "ON" : "OFF"}</span></div>
      <div class="toggle-meta">${snapshot ? `최근 ${snapshot.date} · ${formatNumber(snapshot.value)}` : "데이터 없음"}</div>
    </button>`;
  }).join("");
  container.querySelectorAll("[data-toggle-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const series = button.dataset.toggleSeries;
      if (state.hiddenSeries.has(series)) {
        state.hiddenSeries.delete(series);
        state.activeSeries = series;
      } else {
        const visibleCount = getVisibleSeries(state.currentAllSeries).length;
        if (visibleCount > 1) state.hiddenSeries.add(series);
      }
      const visible = getVisibleSeries(state.currentAllSeries);
      if (!visible.includes(state.activeSeries)) state.activeSeries = visible[0] || null;
      saveAndRender();
    });
  });
}

function renderFocusButtons(visibleSeries) {
  const container = document.getElementById("focusButtons");
  container.innerHTML = visibleSeries.map((series) => `<button class="focus-btn ${series === state.activeSeries ? "is-active" : ""}" data-focus-series="${series}" type="button" style="--series-color:${seriesColor(series)};"><span class="dot"></span>${labelName(series)}</button>`).join("");
  container.querySelectorAll("[data-focus-series]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSeries = button.dataset.focusSeries;
      saveAndRender();
    });
  });
}

function renderMeta(minDate, maxDate, visibleSeries) {
  document.getElementById("chartContext").textContent = `${minDate} ~ ${maxDate} · 표시 ${visibleSeries.length}개 · 활성 ${labelName(state.activeSeries)}`;
  document.getElementById("activeBadge").innerHTML = state.activeSeries ? `<span class="dot" style="--series-color:${seriesColor(state.activeSeries)}"></span>${labelName(state.activeSeries)}` : "시리즈 없음";
}

function refreshHandleStates() {
  document.querySelectorAll(".y-handle").forEach((handle) => handle.classList.toggle("is-active", handle.dataset.kind === state.activeHandleKind));
}

function addDragListeners(onMove, onEnd) {
  const mouseMove = (event) => onMove(event.clientY);
  const mouseUp = (event) => {
    document.removeEventListener("mousemove", mouseMove);
    document.removeEventListener("mouseup", mouseUp);
    document.removeEventListener("touchmove", touchMove);
    document.removeEventListener("touchend", touchEnd);
    document.body.classList.remove("is-dragging");
    onEnd(event.clientY);
  };
  const touchMove = (event) => { event.preventDefault(); onMove(event.touches[0].clientY); };
  const touchEnd = (event) => {
    document.removeEventListener("mousemove", mouseMove);
    document.removeEventListener("mouseup", mouseUp);
    document.removeEventListener("touchmove", touchMove);
    document.removeEventListener("touchend", touchEnd);
    document.body.classList.remove("is-dragging");
    onEnd(event.changedTouches[0].clientY);
  };
  document.addEventListener("mousemove", mouseMove);
  document.addEventListener("mouseup", mouseUp);
  document.addEventListener("touchmove", touchMove, { passive: false });
  document.addEventListener("touchend", touchEnd);
}

function computeFinalValues(baseValues, seriesKey) {
  const scale = state.seriesScales[seriesKey] != null ? state.seriesScales[seriesKey] : 1;
  const offset = state.seriesOffsets[seriesKey] || 0;
  return baseValues.map((value) => (value !== null ? 100 + (value - 100) * scale + offset : null));
}

function restyleActiveTrace(seriesKey) {
  if (state.dragRafId) return;
  state.dragRafId = requestAnimationFrame(() => {
    state.dragRafId = null;
    const chart = document.getElementById("chart");
    if (!chart || !Array.isArray(chart.data)) return;
    const index = chart.data.findIndex((trace) => trace.meta?.series === seriesKey && !trace.meta?.aux);
    if (index < 0) return;
    const baseValues = chart.data[index].meta.baseValues;
    const nextValues = computeFinalValues(baseValues, seriesKey);
    Plotly.restyle(chart, { y: [nextValues] }, [index]);
    window.requestAnimationFrame(updateHandles);
  });
}

function setupOffsetDrag(handle, seriesKey, basePixelY, yAxis) {
  function onStart(startClientY) {
    const startOffset = state.seriesOffsets[seriesKey] || 0;
    state.activeHandleKind = "offset";
    handle.classList.add("dragging");
    document.body.classList.add("is-dragging");
    refreshHandleStates();
    addDragListeners((clientY) => {
      const dy = clientY - startClientY;
      const dataDelta = -dy * (yAxis.range[1] - yAxis.range[0]) / yAxis._length;
      state.seriesOffsets[seriesKey] = startOffset + dataDelta;
      handle.style.top = `${basePixelY + dy - 10}px`;
      restyleActiveTrace(seriesKey);
    }, () => {
      handle.classList.remove("dragging");
      state.activeHandleKind = null;
      saveAndRender();
    });
  }
  handle.addEventListener("mousedown", (event) => { event.preventDefault(); onStart(event.clientY); });
  handle.addEventListener("touchstart", (event) => { event.preventDefault(); onStart(event.touches[0].clientY); }, { passive: false });
}

function setupScaleDrag(handle, seriesKey, basePixelY) {
  function onStart(startClientY) {
    const startScale = state.seriesScales[seriesKey] != null ? state.seriesScales[seriesKey] : 1;
    state.activeHandleKind = "scale";
    handle.classList.add("dragging");
    document.body.classList.add("is-dragging");
    refreshHandleStates();
    addDragListeners((clientY) => {
      const dy = clientY - startClientY;
      let nextScale = clamp(startScale - dy / 120, SCALE_MIN, SCALE_MAX);
      if (Math.abs(nextScale) < SCALE_DEADZONE) nextScale = nextScale < 0 ? -SCALE_DEADZONE : SCALE_DEADZONE;
      state.seriesScales[seriesKey] = nextScale;
      handle.style.top = `${basePixelY + dy - 10}px`;
      restyleActiveTrace(seriesKey);
    }, () => {
      handle.classList.remove("dragging");
      state.activeHandleKind = null;
      saveAndRender();
    });
  }
  handle.addEventListener("mousedown", (event) => { event.preventDefault(); onStart(event.clientY); });
  handle.addEventListener("touchstart", (event) => { event.preventDefault(); onStart(event.touches[0].clientY); }, { passive: false });
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
  const trace = chart.data.find((item) => item.meta?.series === state.activeSeries && !item.meta?.aux);
  if (!trace || trace.visible === "legendonly") return;
  const yAxis = chart._fullLayout.yaxis;
  const xAxis = chart._fullLayout.xaxis;
  if (!yAxis || !xAxis || !yAxis._length || !xAxis._length) return;
  const values = Array.isArray(trace.y) ? trace.y : [];
  const firstY = values.find((value) => value !== null && value !== undefined);
  let lastY = null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null && values[index] !== undefined) {
      lastY = values[index];
      break;
    }
  }
  if (firstY == null || lastY == null) return;
  const rangeSpan = yAxis.range[1] - yAxis.range[0] || 1;
  const toPixelY = (value) => yAxis._offset + yAxis._length * (1 - ((value - yAxis.range[0]) / rangeSpan));
  const leftPixelY = toPixelY(firstY);
  const rightPixelY = toPixelY(lastY);
  const rightX = xAxis._offset + xAxis._length + 8;
  const color = trace.line.color;

  const leftHandle = document.createElement("button");
  leftHandle.type = "button";
  leftHandle.className = "y-handle y-handle-left";
  leftHandle.dataset.kind = "offset";
  leftHandle.style.top = `${leftPixelY - 10}px`;
  leftHandle.style.backgroundColor = color;
  leftHandle.title = `${labelName(state.activeSeries)} 위치`;
  setupOffsetDrag(leftHandle, state.activeSeries, leftPixelY, yAxis);
  container.appendChild(leftHandle);

  const rightHandle = document.createElement("button");
  rightHandle.type = "button";
  rightHandle.className = "y-handle y-handle-right";
  rightHandle.dataset.kind = "scale";
  rightHandle.style.top = `${rightPixelY - 10}px`;
  rightHandle.style.left = `${rightX}px`;
  rightHandle.style.backgroundColor = color;
  rightHandle.title = `${labelName(state.activeSeries)} 스케일`;
  setupScaleDrag(rightHandle, state.activeSeries, rightPixelY);
  container.appendChild(rightHandle);
  refreshHandleStates();
}

function buildLayout(activeSeriesLatestDate) {
  const shapes = [];
  if (state.showReferenceBand) {
    shapes.push({ type: "rect", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 90, y1: 110, line: { width: 0 }, fillcolor: "rgba(141, 182, 255, 0.05)", layer: "below" });
    shapes.push({ type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 100, y1: 100, line: { color: "rgba(255,255,255,0.12)", width: 1, dash: "dot" }, layer: "below" });
  }
  if (state.showGuides && activeSeriesLatestDate) {
    shapes.push({ type: "line", xref: "x", yref: "paper", x0: activeSeriesLatestDate, x1: activeSeriesLatestDate, y0: 0, y1: 1, line: { color: "rgba(255,255,255,0.18)", width: 1, dash: "dot" }, layer: "above" });
  }
  return {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#05070b",
    margin: { l: 44, r: 44, t: 18, b: 36 },
    hovermode: "x unified",
    dragmode: "pan",
    showlegend: false,
    shapes,
    xaxis: {
      showgrid: true,
      gridcolor: "rgba(255,255,255,0.08)",
      gridwidth: 1,
      zeroline: false,
      color: "#93a4bb",
      tickfont: { size: 10 },
      fixedrange: false,
      showspikes: true,
      spikethickness: 1,
      spikecolor: "rgba(255,255,255,0.22)",
      spikedash: "dot",
      rangeslider: { visible: true, thickness: 0.08, bgcolor: "#0c1119", bordercolor: "rgba(255,255,255,0.08)" },
    },
    yaxis: { showticklabels: false, showgrid: true, gridcolor: "rgba(255,255,255,0.08)", gridwidth: 1, zeroline: false, fixedrange: true },
    font: { color: "#dbe5f5", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
    hoverlabel: { bgcolor: "#0e1522", bordercolor: "#1f2a3d", font: { color: "#f4f8ff" } },
  };
}

function renderChart(rows, visibleSeries) {
  const chart = document.getElementById("chart");
  const messageArea = document.getElementById("messageArea");
  if (!rows.length || !visibleSeries.length) {
    messageArea.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }
  messageArea.innerHTML = "";
  const normBases = {};
  const firstDates = visibleSeries.map((series) => rows.find((row) => toNum(row[series]) !== null)?.date || null).filter(Boolean);
  const commonBaseDate = firstDates.length ? firstDates.reduce((latest, current) => (current > latest ? current : latest)) : null;
  if (commonBaseDate) {
    visibleSeries.forEach((series) => {
      const row = rows.find((candidate) => candidate.date >= commonBaseDate && toNum(candidate[series]) !== null);
      normBases[series] = row ? toNum(row[series]) : null;
    });
  }
  const autoScales = autoFitScales(rows, visibleSeries, normBases);
  let activeSeriesLatestDate = null;
  const traces = [];
  visibleSeries.forEach((series) => {
    let values = rows.map((row) => toNum(row[series]));
    const base = normBases[series];
    values = (base && base !== 0) ? values.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null)) : normalizeSeries(values);
    values = centeredScale(values, autoScales[series] || 100, true);
    const finalValues = computeFinalValues(values, series);
    const isActive = series === state.activeSeries;
    const latestPoint = finalValues.map((value, index) => ({ value, index })).filter((item) => item.value != null).at(-1);
    if (isActive && latestPoint) activeSeriesLatestDate = rows[latestPoint.index].date;
    traces.push({
      x: rows.map((row) => row.date),
      y: finalValues,
      type: "scatter",
      mode: "lines",
      name: labelName(series),
      meta: { series, baseValues: values },
      connectgaps: false,
      opacity: state.activeSeries && !isActive ? 0.54 : 1,
      line: { color: seriesColor(series), width: isActive ? 4.6 : 2.3, shape: "linear" },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    });
    if (state.showGuides && latestPoint) {
      traces.push({
        x: [rows[latestPoint.index].date],
        y: [finalValues[latestPoint.index]],
        type: "scatter",
        mode: "markers",
        showlegend: false,
        hoverinfo: "skip",
        meta: { series, aux: true },
        marker: { size: isActive ? 10 : 7, color: seriesColor(series), line: { color: "rgba(255,255,255,0.85)", width: isActive ? 1.6 : 1.1 } },
      });
    }
  });
  Plotly.react(chart, traces, buildLayout(activeSeriesLatestDate), { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: false, doubleClick: "reset" });
  if (!state.legendHandlerSet) {
    chart.on("plotly_relayout", () => window.requestAnimationFrame(updateHandles));
    state.legendHandlerSet = true;
  }
  window.requestAnimationFrame(updateHandles);
}

function render() {
  const priceRows = state.pricePayload?.records || [];
  if (!priceRows.length) return;
  const preset = getPresetByKey(state.activePresetKey);
  const maxDate = priceRows[priceRows.length - 1].date;
  const minDate = priceRows[0].date;
  const boundedStart = [shiftMonths(maxDate, preset.months), minDate].sort()[1];
  const { rows, liveCols, macroCols } = mergeSources(priceRows, state.macroRows, boundedStart, maxDate);
  const allSeries = sortSeries([...new Set([...liveCols, ...macroCols])].filter((series) => rows.some((row) => toNum(row[series]) !== null)));
  ensureState(allSeries);
  renderRangeButtons();
  renderPresetButtons();
  renderSwitches();
  renderRangeStatus(boundedStart, maxDate);
  renderMeta(boundedStart, maxDate, state.currentVisible);
  renderSummary(rows, state.currentVisible);
  renderSeriesToggles(rows, allSeries);
  renderFocusButtons(state.currentVisible);
  renderChart(rows, state.currentVisible);
  state.currentRows = rows;
}

async function loadMacroRows(priceRows) {
  const priceDates = priceRows.map((row) => row.date);
  try {
    const response = await fetch("./data/macro_data.json", { cache: "no-store" });
    if (response.ok) return buildDenseMacroRows(parsePayloadRows(await response.text()), priceDates);
  } catch (_) {}
  const fallback = await fetch("./data/sample_macro_data.csv", { cache: "no-store" });
  return buildDenseMacroRows(parseCsv(await fallback.text()), priceDates);
}

async function boot() {
  const messageArea = document.getElementById("messageArea");
  loadState();
  try {
    const priceResponse = await fetch("./data/prices.json", { cache: "no-store" });
    state.pricePayload = JSON.parse((await priceResponse.text()).replace(/\bNaN\b/g, "null"));
    state.macroRows = await loadMacroRows(state.pricePayload.records || []);
    document.getElementById("guideToggle").addEventListener("click", () => { state.showGuides = !state.showGuides; saveAndRender(); });
    document.getElementById("bandToggle").addEventListener("click", () => { state.showReferenceBand = !state.showReferenceBand; saveAndRender(); });
    document.getElementById("resetHandles").addEventListener("click", () => { state.seriesOffsets = {}; state.seriesScales = {}; saveAndRender(); });
    document.getElementById("resetViewBtn").addEventListener("click", () => { state.activePresetKey = DEFAULT_DATE_PRESET; applyVisibleSeries(DEFAULT_VISIBLE); state.activeSeries = DEFAULT_ACTIVE_SERIES; saveAndRender(); });
    render();
  } catch (error) {
    messageArea.innerHTML = `<div class="message error">${error.message || "앱을 시작하지 못했습니다."}</div>`;
  }
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
}

boot();
