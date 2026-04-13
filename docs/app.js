const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용잔고",
  kosdaq_credit: "코스닥 신용잔고",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
};

const HANDLE_LABELS = {
  leading_cycle: "선",
  kospi_credit: "KP",
  kosdaq_credit: "KD",
  "^KS11": "K",
  "^KQ11": "Q",
  "005930.KS": "삼",
  "218410.KQ": "R",
};

const STORAGE_KEY = "thinkstock-mobile-state-v4";
const RANGE_OPTIONS = [10, 20, 30];
const SCALE_MIN = 25;
const SCALE_MAX = 400;
const DEFAULT_SELECTED = ["leading_cycle", "^KS11"];
const SERIES_PRIORITY = ["leading_cycle", "^KS11", "^KQ11", "kospi_credit", "kosdaq_credit", "005930.KS", "218410.KQ"];
const SERIES_COLORS = {
  leading_cycle: "#f7c948",
  "^KS11": "#43c6ff",
  "^KQ11": "#ff5d73",
  kospi_credit: "#9b8cff",
  kosdaq_credit: "#ff9f43",
  "005930.KS": "#5fa8ff",
  "218410.KQ": "#4ade80",
};

const el = {
  chart: document.getElementById("chart"),
  leftRail: document.getElementById("leftRail"),
  rightRail: document.getElementById("rightRail"),
  rangeStatus: document.getElementById("rangeStatus"),
  messageArea: document.getElementById("messageArea"),
  seriesToggles: document.getElementById("seriesToggles"),
  rangeButtons: [...document.querySelectorAll(".range-btn")],
};

const state = {
  pricePayload: null,
  macroText: "",
  minDate: "",
  maxDate: "",
  activeYears: RANGE_OPTIONS[0],
  selectedSeries: [],
  seriesOffsets: {},
  seriesScales: {},
  lastYRange: [70, 130],
  drag: null,
  renderQueued: false,
};

const toNum = (value) => (value != null && Number.isFinite(Number(value)) ? Number(value) : null);
const labelName = (key) => DISPLAY_NAMES[key] || key;
const handleLabel = (key) => HANDLE_LABELS[key] || labelName(key).slice(0, 1);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampDate(value, minDate, maxDate) {
  let next = value;
  if (minDate && next < minDate) {
    next = minDate;
  }
  if (maxDate && next > maxDate) {
    next = maxDate;
  }
  return next;
}

function shiftYears(dateString, years) {
  const base = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(base.getTime())) {
    return dateString;
  }
  const month = base.getMonth();
  base.setFullYear(base.getFullYear() - years);
  if (base.getMonth() !== month) {
    base.setDate(0);
  }
  return base.toISOString().slice(0, 10);
}

function loadStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (RANGE_OPTIONS.includes(parsed.activeYears)) {
      state.activeYears = parsed.activeYears;
    }
    if (Array.isArray(parsed.selectedSeries)) {
      state.selectedSeries = parsed.selectedSeries.filter((series) => typeof series === "string");
    }
    if (parsed.seriesOffsets && typeof parsed.seriesOffsets === "object") {
      Object.entries(parsed.seriesOffsets).forEach(([series, offset]) => {
        const numeric = Number(offset);
        if (Number.isFinite(numeric)) {
          state.seriesOffsets[series] = numeric;
        }
      });
    }
    if (parsed.seriesScales && typeof parsed.seriesScales === "object") {
      Object.entries(parsed.seriesScales).forEach(([series, scale]) => {
        const numeric = Number(scale);
        if (Number.isFinite(numeric)) {
          state.seriesScales[series] = clamp(numeric, SCALE_MIN, SCALE_MAX);
        }
      });
    }
  } catch (_error) {
  }
}

function persistState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeYears: state.activeYears,
        selectedSeries: state.selectedSeries,
        seriesOffsets: state.seriesOffsets,
        seriesScales: state.seriesScales,
      })
    );
  } catch (_error) {
  }
}

function parseCsv(text) {
  const result = Papa.parse(text.trim(), {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  if (result.errors.length) {
    throw new Error(result.errors[0].message || "CSV 파싱 오류가 발생했습니다.");
  }
  if (!result.meta.fields.includes("date")) {
    throw new Error("CSV에 date 컬럼이 필요합니다.");
  }
  return result.data
    .map((row) => {
      const out = { date: String(row.date).slice(0, 10) };
      Object.entries(row).forEach(([key, value]) => {
        if (key === "date" || value === "") {
          return;
        }
        const numeric = Number(value);
        out[key] = Number.isFinite(numeric) ? numeric : value;
      });
      return out;
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function getSeriesColumns(rows) {
  const columns = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (key !== "date") {
        columns.add(key);
      }
    });
  });
  return [...columns];
}

function sortSeries(seriesList) {
  const priority = new Map(SERIES_PRIORITY.map((series, index) => [series, index]));
  return [...seriesList].sort((left, right) => {
    const leftRank = priority.has(left) ? priority.get(left) : SERIES_PRIORITY.length + 1;
    const rightRank = priority.has(right) ? priority.get(right) : SERIES_PRIORITY.length + 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return labelName(left).localeCompare(labelName(right), "ko");
  });
}

function getAllSeries(priceRows, manualRows) {
  return sortSeries([...new Set([...getSeriesColumns(priceRows), ...getSeriesColumns(manualRows)])]);
}

function mergeSources(priceRows, manualRows, start, end) {
  const liveCols = getSeriesColumns(priceRows);
  const manualCols = getSeriesColumns(manualRows);
  const sortedManual = [...manualRows].sort((left, right) => left.date.localeCompare(right.date));
  const carry = {};
  let manualIndex = 0;
  const rows = [];

  priceRows.forEach((priceRow) => {
    const date = priceRow.date;
    if (date < start || date > end) {
      return;
    }
    while (manualIndex < sortedManual.length && sortedManual[manualIndex].date <= date) {
      const manualRow = sortedManual[manualIndex];
      manualCols.forEach((series) => {
        const numeric = toNum(manualRow[series]);
        if (numeric !== null) {
          carry[series] = numeric;
        }
      });
      manualIndex += 1;
    }

    const row = { date };
    liveCols.forEach((series) => {
      row[series] = toNum(priceRow[series]);
    });
    manualCols.forEach((series) => {
      row[series] = carry[series] != null ? carry[series] : null;
    });
    rows.push(row);
  });

  return { rows };
}

function normalizeSeries(values) {
  const first = values.find((value) => Number.isFinite(value));
  const base = Number.isFinite(first) && first !== 0 ? first : 1;
  return values.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null));
}

function centeredScale(values, scalePct) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) {
    return values;
  }
  const pivot = 100;
  const ratio = scalePct / 100;
  return values.map((value) => (Number.isFinite(value) ? pivot + (value - pivot) * ratio : null));
}

function autoFitScales(rows, selectedSeries, baseMap) {
  const info = [];
  selectedSeries.forEach((series) => {
    const base = baseMap[series];
    let values = rows.map((row) => toNum(row[series])).filter((value) => value !== null);
    if (!values.length) {
      return;
    }
    values = base && base !== 0
      ? values.map((value) => (value / base) * 100)
      : normalizeSeries(values).filter((value) => Number.isFinite(value));
    const range = Math.max(Math.max(...values) - Math.min(...values), 1);
    info.push([series, range]);
  });
  if (!info.length) {
    return {};
  }
  const sortedRanges = info.map(([, range]) => range).sort((left, right) => left - right);
  const target = sortedRanges[Math.floor(sortedRanges.length / 2)];
  return Object.fromEntries(
    info.map(([series, range]) => [series, clamp(Math.round((target / range) * 100), SCALE_MIN, SCALE_MAX)])
  );
}

function ensureSelectedSeries(allSeries) {
  const filtered = sortSeries(state.selectedSeries.filter((series) => allSeries.includes(series)));
  if (filtered.length) {
    state.selectedSeries = filtered;
    return;
  }
  const defaults = DEFAULT_SELECTED.filter((series) => allSeries.includes(series));
  state.selectedSeries = defaults.length ? sortSeries(defaults) : allSeries.slice(0, Math.min(2, allSeries.length));
}

function getDateRange() {
  const end = state.maxDate || new Date().toISOString().slice(0, 10);
  const start = clampDate(shiftYears(end, state.activeYears), state.minDate, end);
  return { start, end };
}

function buildCommonBaseMap(rows, selectedSeries) {
  const firstDates = selectedSeries
    .map((series) => {
      const row = rows.find((item) => toNum(item[series]) !== null);
      return row ? row.date : null;
    })
    .filter(Boolean);
  const commonBaseDate = firstDates.length
    ? firstDates.reduce((latest, current) => (current > latest ? current : latest))
    : null;
  const baseMap = {};
  selectedSeries.forEach((series) => {
    const row = rows.find(
      (item) => (!commonBaseDate || item.date >= commonBaseDate) && toNum(item[series]) !== null
    );
    baseMap[series] = row ? toNum(row[series]) : null;
  });
  return baseMap;
}

function getScaleValue(series, autoScales) {
  const manual = Number(state.seriesScales[series]);
  if (Number.isFinite(manual)) {
    return clamp(manual, SCALE_MIN, SCALE_MAX);
  }
  return clamp(autoScales[series] || 100, SCALE_MIN, SCALE_MAX);
}

function scaleToTopPct(scaleValue) {
  const ratio = (clamp(scaleValue, SCALE_MIN, SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN || 1);
  return clamp(95 - ratio * 90, 5, 95);
}

function topPctToScale(topPct) {
  const ratio = clamp((95 - topPct) / 90, 0, 1);
  return clamp(Math.round((SCALE_MIN + ratio * (SCALE_MAX - SCALE_MIN)) * 10) / 10, SCALE_MIN, SCALE_MAX);
}

function setMessage(text = "", type = "") {
  if (!text) {
    el.messageArea.innerHTML = "";
    return;
  }
  el.messageArea.innerHTML = `<div class="message ${type}">${text}</div>`;
}

function syncRangeButtons() {
  el.rangeButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.years) === state.activeYears);
  });
}

function renderSeriesToggles(allSeries) {
  el.seriesToggles.innerHTML = allSeries
    .map((series) => {
      const active = state.selectedSeries.includes(series);
      const color = SERIES_COLORS[series] || "#94a3b8";
      return `
        <button
          class="toggle-chip ${active ? "is-active" : ""}"
          type="button"
          data-series="${series}"
          aria-pressed="${active}"
          style="--series-color: ${color};"
        >
          <span class="toggle-dot"></span>
          <span>${labelName(series)}</span>
        </button>
      `;
    })
    .join("");

  el.seriesToggles.querySelectorAll(".toggle-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const series = button.dataset.series;
      const selected = new Set(state.selectedSeries);
      if (selected.has(series)) {
        if (selected.size === 1) {
          return;
        }
        selected.delete(series);
      } else {
        selected.add(series);
      }
      state.selectedSeries = sortSeries([...selected]);
      persistState();
      renderApp();
    });
  });
}

function queueRender() {
  if (state.renderQueued) {
    return;
  }
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderApp();
  });
}

function stopDragging() {
  state.drag = null;
  document.body.classList.remove("is-dragging");
  window.removeEventListener("pointermove", onHandleDrag);
  window.removeEventListener("pointerup", stopDragging);
  window.removeEventListener("pointercancel", stopDragging);
}

function onHandleDrag(event) {
  if (!state.drag) {
    return;
  }
  if (state.drag.kind === "offset") {
    const span = Math.max(state.drag.yMax - state.drag.yMin, 1);
    const deltaValue = -((event.clientY - state.drag.startY) / state.drag.railHeight) * span;
    state.seriesOffsets[state.drag.series] = Math.round((state.drag.startValue + deltaValue) * 10) / 10;
  } else {
    const deltaPct = ((event.clientY - state.drag.startY) / state.drag.railHeight) * 90;
    const nextTopPct = clamp(state.drag.startTopPct + deltaPct, 5, 95);
    state.seriesScales[state.drag.series] = topPctToScale(nextTopPct);
  }
  persistState();
  queueRender();
}

function startHandleDrag(event) {
  event.preventDefault();
  const handle = event.currentTarget;
  const series = handle.dataset.series;
  const kind = handle.dataset.kind;
  const railHeight = handle.parentElement?.clientHeight || 1;
  const [yMin, yMax] = state.lastYRange;
  state.drag = {
    kind,
    series,
    startY: event.clientY,
    railHeight,
    startTopPct: Number(handle.dataset.topPct) || 50,
    startValue: kind === "offset"
      ? Number(state.seriesOffsets[series]) || 0
      : clamp(Number(state.seriesScales[series]) || Number(handle.dataset.scale) || 100, SCALE_MIN, SCALE_MAX),
    yMin,
    yMax,
  };
  document.body.classList.add("is-dragging");
  window.addEventListener("pointermove", onHandleDrag);
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);
}

function renderRail(target, items, kind) {
  target.innerHTML = items
    .map(
      (item) => `
        <button
          class="axis-handle ${kind === "scale" ? "axis-handle-scale" : ""}"
          type="button"
          data-kind="${kind}"
          data-series="${item.series}"
          data-top-pct="${item.topPct}"
          data-scale="${item.scaleValue ?? ""}"
          title="${item.title}"
          aria-label="${item.title}"
          style="top: ${item.topPct}%; --handle-color: ${item.color};"
        >${item.label}</button>
      `
    )
    .join("");

  target.querySelectorAll(".axis-handle").forEach((button) => {
    button.addEventListener("pointerdown", startHandleDrag);
  });
}

function buildChartModel() {
  const priceRows = state.pricePayload.records || [];
  const manualRows = parseCsv(state.macroText);
  const allSeries = getAllSeries(priceRows, manualRows);
  ensureSelectedSeries(allSeries);

  const { start, end } = getDateRange();
  const { rows } = mergeSources(priceRows, manualRows, start, end);
  const visibleSelected = state.selectedSeries.filter((series) => rows.some((row) => toNum(row[series]) !== null));

  if (!rows.length || !visibleSelected.length) {
    throw new Error("표시할 데이터가 없습니다.");
  }

  const baseMap = buildCommonBaseMap(rows, visibleSelected);
  const autoScales = autoFitScales(rows, visibleSelected, baseMap);

  const seriesMeta = visibleSelected.map((series) => {
    const base = baseMap[series];
    const rawValues = rows.map((row) => toNum(row[series]));
    const normalizedValues = base && base !== 0
      ? rawValues.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null))
      : normalizeSeries(rawValues);
    const scale = getScaleValue(series, autoScales);
    const scaledValues = centeredScale(normalizedValues, scale);
    const offset = Number.isFinite(state.seriesOffsets[series]) ? state.seriesOffsets[series] : 0;
    const shiftedValues = scaledValues.map((value) => (Number.isFinite(value) ? value + offset : null));
    return {
      series,
      color: SERIES_COLORS[series] || "#94a3b8",
      values: shiftedValues,
      offset,
      scale,
    };
  });

  const allValues = seriesMeta.flatMap((meta) => meta.values.filter((value) => Number.isFinite(value)));
  if (!allValues.length) {
    throw new Error("표시할 데이터가 없습니다.");
  }

  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  if (yMin === yMax) {
    yMin -= 12;
    yMax += 12;
  }
  const padding = Math.max((yMax - yMin) * 0.14, 8);
  yMin -= padding;
  yMax += padding;
  state.lastYRange = [yMin, yMax];

  return {
    start,
    end,
    allSeries,
    traces: seriesMeta.map((meta) => ({
      x: rows.map((row) => row.date),
      y: meta.values,
      type: "scatter",
      mode: "lines",
      name: labelName(meta.series),
      connectgaps: true,
      line: {
        color: meta.color,
        width: meta.series === "leading_cycle" ? 3.5 : 2.6,
        shape: "linear",
      },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    })),
    yRange: [yMin, yMax],
    leftItems: seriesMeta.map((meta) => {
      const anchor = 100 + meta.offset;
      const topPct = clamp(((yMax - anchor) / (yMax - yMin)) * 100, 5, 95);
      return {
        series: meta.series,
        color: meta.color,
        label: handleLabel(meta.series),
        title: `${labelName(meta.series)} 위치 조절`,
        topPct,
      };
    }),
    rightItems: seriesMeta.map((meta) => ({
      series: meta.series,
      color: meta.color,
      label: handleLabel(meta.series),
      title: `${labelName(meta.series)} 스케일 조절`,
      topPct: scaleToTopPct(meta.scale),
      scaleValue: meta.scale,
    })),
  };
}

function renderPlot(model) {
  Plotly.react(
    el.chart,
    model.traces,
    {
      paper_bgcolor: "#05070b",
      plot_bgcolor: "#05070b",
      margin: { l: 62, r: 62, t: 20, b: 40 },
      hovermode: "x unified",
      showlegend: false,
      xaxis: {
        showgrid: true,
        gridcolor: "rgba(157, 173, 198, 0.12)",
        tickfont: { color: "#9fb0c7", size: 11 },
        linecolor: "rgba(157, 173, 198, 0.2)",
        zeroline: false,
      },
      yaxis: {
        range: model.yRange,
        showgrid: true,
        gridcolor: "rgba(157, 173, 198, 0.08)",
        showticklabels: false,
        ticks: "",
        title: "",
        zeroline: false,
        showline: false,
      },
      font: { color: "#edf2ff", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
      hoverlabel: {
        bgcolor: "#121923",
        bordercolor: "rgba(255,255,255,0.08)",
        font: { color: "#f8fbff" },
      },
      uirevision: `${state.activeYears}:${state.selectedSeries.join(",")}`,
    },
    { responsive: true, displaylogo: false, displayModeBar: false }
  );
}

function renderApp() {
  try {
    const model = buildChartModel();
    syncRangeButtons();
    el.rangeStatus.textContent = `${model.start} - ${model.end}`;
    renderSeriesToggles(model.allSeries);
    renderPlot(model);
    renderRail(el.leftRail, model.leftItems, "offset");
    renderRail(el.rightRail, model.rightItems, "scale");
    setMessage();
  } catch (error) {
    Plotly.purge(el.chart);
    el.leftRail.innerHTML = "";
    el.rightRail.innerHTML = "";
    setMessage(error.message || "앱을 렌더링하지 못했습니다.", "error");
  }
}

async function boot() {
  loadStoredState();
  try {
    const [priceResponse, macroResponse] = await Promise.all([
      fetch("./data/prices.json"),
      fetch("./data/sample_macro_data.csv"),
    ]);
    const priceText = await priceResponse.text();
    state.pricePayload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));
    state.macroText = await macroResponse.text();

    const priceRows = state.pricePayload.records || [];
    const dates = priceRows.map((row) => row.date);
    const fallbackToday = new Date().toISOString().slice(0, 10);
    state.minDate = dates[0] || fallbackToday;
    state.maxDate = dates[dates.length - 1] || fallbackToday;

    el.rangeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const years = Number(button.dataset.years);
        if (!RANGE_OPTIONS.includes(years)) {
          return;
        }
        state.activeYears = years;
        persistState();
        renderApp();
      });
    });

    renderApp();
  } catch (error) {
    setMessage(error.message || "앱을 시작하지 못했습니다.", "error");
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
}

boot();