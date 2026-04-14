const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용잔고",
  kosdaq_credit: "코스닥 신용잔고",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
};

const DEFAULT_VISIBLE = ["leading_cycle", "^KS11"];
const DATE_PRESET_YEARS = [1, 5, 10, 20, 30];
const DEFAULT_ACTIVE_YEARS = 10;
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
const SCALE_MIN = -12;
const SCALE_MAX = 12;
const SCALE_DEADZONE = 0.05;

const toNum = (value) => (value != null && Number.isFinite(Number(value)) ? Number(value) : null);
const labelName = (key) => DISPLAY_NAMES[key] || key;
const seriesColor = (key) => SERIES_COLORS[key] || "#888888";
const utcTime = (dateStr) => Date.parse(`${dateStr}T00:00:00Z`);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let pricePayload = null;
let macroRows = [];
let activeYears = DEFAULT_ACTIVE_YEARS;
let hiddenSeries = new Set();
let seriesOffsets = {};
let seriesScales = {};
let currentSeriesOrder = [];
let baseTraceValues = {};
let legendHandlerSet = false;
let dragRafId = null;
let visibilityInitialized = false;
let activeSeries = null;
let activeHandleKind = null;

function shiftYears(dateStr, years) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
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
  return result.data
    .map((row) => {
      const out = { date: String(row.date).slice(0, 10) };
      Object.entries(row).forEach(([key, value]) => {
        if (key === "date" || value === "") return;
        const parsed = Number(value);
        out[key] = Number.isFinite(parsed) ? parsed : value;
      });
      return out;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parsePayloadRows(text) {
  const payload = JSON.parse(text.replace(/\bNaN\b/g, "null"));
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.records) ? payload.records : [];
}

function getSeriesColumns(rows) {
  const cols = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (key !== "date") cols.add(key);
    });
  });
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

  const target = targetDates.map((date) => ({ date, time: utcTime(date) }));
  const denseRows = target.map(({ date }) => ({ date }));

  cols.forEach((col) => {
    const points = sortedRows
      .map((row) => ({ time: utcTime(row.date), value: toNum(row[col]) }))
      .filter((point) => point.value !== null)
      .sort((a, b) => a.time - b.time);

    if (!points.length) {
      target.forEach((_, index) => {
        denseRows[index][col] = null;
      });
      return;
    }

    let pointer = 0;
    target.forEach(({ time }, index) => {
      if (time < points[0].time || time > points[points.length - 1].time) {
        denseRows[index][col] = null;
        return;
      }

      while (pointer + 1 < points.length && points[pointer + 1].time < time) {
        pointer += 1;
      }

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
    liveCols.forEach((col) => {
      row[col] = toNum(priceRow[col]);
    });
    macroCols.forEach((col) => {
      row[col] = toNum(macroRow[col]);
    });
    rows.push(row);
  });

  return { rows, macroCols, liveCols };
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
    values = (base && base !== 0)
      ? values.map((value) => (value / base) * 100)
      : normalizeSeries(values).filter((value) => Number.isFinite(value));
    const range = Math.max(Math.max(...values) - Math.min(...values), 1);
    info.push([seriesName, range]);
  });

  if (!info.length) return {};

  const sortedRanges = info.map(([, range]) => range).sort((a, b) => a - b);
  const targetRange = sortedRanges[Math.floor(sortedRanges.length / 2)];
  return Object.fromEntries(
    info.map(([seriesName, range]) => [seriesName, Math.max(5, Math.min(5000, Math.round((targetRange / range) * 100)))])
  );
}

function ensureVisibilityState(allSeries) {
  const allSet = new Set(allSeries);
  hiddenSeries = new Set([...hiddenSeries].filter((seriesName) => allSet.has(seriesName)));

  if (!visibilityInitialized) {
    allSeries.forEach((seriesName) => {
      if (!DEFAULT_VISIBLE.includes(seriesName)) hiddenSeries.add(seriesName);
    });
    visibilityInitialized = true;
    return;
  }

  allSeries.forEach((seriesName) => {
    if (!currentSeriesOrder.includes(seriesName) && !DEFAULT_VISIBLE.includes(seriesName)) {
      hiddenSeries.add(seriesName);
    }
  });
}

function computeFinalValues(seriesKey) {
  const base = baseTraceValues[seriesKey];
  if (!base) return null;
  const scale = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : 1;
  const offset = seriesOffsets[seriesKey] || 0;
  return base.map((value) => (value !== null ? 100 + (value - 100) * scale + offset : null));
}

function restyleLive(traceIndex, seriesKey) {
  if (dragRafId) return;
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null;
    const chart = document.getElementById("chart");
    const newY = computeFinalValues(seriesKey);
    if (chart && newY) Plotly.restyle(chart, { y: [newY] }, [traceIndex]);
  });
}

function refreshHandleStates() {
  document.querySelectorAll(".y-handle").forEach((handle) => {
    const seriesName = handle.dataset.series;
    const handleKind = handle.dataset.kind;
    handle.classList.toggle("is-series-active", seriesName === activeSeries);
    handle.classList.toggle("is-active", seriesName === activeSeries && handleKind === activeHandleKind);
  });
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
  const touchMove = (event) => {
    event.preventDefault();
    onMove(event.touches[0].clientY);
  };
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

function setupOffsetDrag(handle, traceIndex, seriesKey, basePixelY, yAxis) {
  function onStart(startClientY) {
    const startOffset = seriesOffsets[seriesKey] || 0;
    activeSeries = seriesKey;
    activeHandleKind = "offset";
    handle.classList.add("dragging");
    document.body.classList.add("is-dragging");
    refreshHandleStates();

    addDragListeners(
      (clientY) => {
        const dy = clientY - startClientY;
        const dataDelta = -dy * (yAxis.range[1] - yAxis.range[0]) / yAxis._length;
        seriesOffsets[seriesKey] = startOffset + dataDelta;
        handle.style.top = `${basePixelY + dy - 9}px`;
        restyleLive(traceIndex, seriesKey);
      },
      () => {
        handle.classList.remove("dragging");
        renderChart();
      }
    );
  }

  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onStart(event.clientY);
  });
  handle.addEventListener("touchstart", (event) => {
    event.preventDefault();
    onStart(event.touches[0].clientY);
  }, { passive: false });
}

function setupScaleDrag(handle, traceIndex, seriesKey, basePixelY) {
  function onStart(startClientY) {
    const startScale = seriesScales[seriesKey] != null ? seriesScales[seriesKey] : 1;
    activeSeries = seriesKey;
    activeHandleKind = "scale";
    handle.classList.add("dragging");
    document.body.classList.add("is-dragging");
    refreshHandleStates();

    addDragListeners(
      (clientY) => {
        const dy = clientY - startClientY;
        let nextScale = clamp(startScale - dy / 120, SCALE_MIN, SCALE_MAX);
        if (Math.abs(nextScale) < SCALE_DEADZONE) {
          nextScale = nextScale < 0 ? -SCALE_DEADZONE : SCALE_DEADZONE;
        }
        seriesScales[seriesKey] = nextScale;
        handle.style.top = `${basePixelY + dy - 9}px`;
        restyleLive(traceIndex, seriesKey);
      },
      () => {
        handle.classList.remove("dragging");
        renderChart();
      }
    );
  }

  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onStart(event.clientY);
  });
  handle.addEventListener("touchstart", (event) => {
    event.preventDefault();
    onStart(event.touches[0].clientY);
  }, { passive: false });
}

function updateHandles() {
  const chart = document.getElementById("chart");
  if (!chart || !chart._fullLayout) return;

  let container = document.getElementById("y-handles");
  if (!container) {
    container = document.createElement("div");
    container.id = "y-handles";
    chart.appendChild(container);
  }
  container.innerHTML = "";

  const yAxis = chart._fullLayout.yaxis;
  const xAxis = chart._fullLayout.xaxis;
  if (!yAxis || !xAxis || !yAxis._length || !xAxis._length) return;

  const rangeSpan = yAxis.range[1] - yAxis.range[0] || 1;
  const rightX = xAxis._offset + xAxis._length + 6;

  chart.data.forEach((trace, index) => {
    if (trace.visible === "legendonly") return;
    const seriesKey = currentSeriesOrder[index];
    if (!seriesKey) return;

    const values = Array.isArray(trace.y) ? trace.y : [];
    const firstY = values.find((value) => value !== null && value !== undefined);
    let lastY = null;
    for (let cursor = values.length - 1; cursor >= 0; cursor -= 1) {
      if (values[cursor] !== null && values[cursor] !== undefined) {
        lastY = values[cursor];
        break;
      }
    }
    if (firstY == null || lastY == null) return;

    const toPixelY = (value) => {
      const ratio = (value - yAxis.range[0]) / rangeSpan;
      return yAxis._offset + yAxis._length * (1 - ratio);
    };

    const leftPixelY = toPixelY(firstY);
    const rightPixelY = toPixelY(lastY);
    const color = trace.line.color;

    const leftHandle = document.createElement("button");
    leftHandle.type = "button";
    leftHandle.className = "y-handle y-handle-left";
    leftHandle.dataset.series = seriesKey;
    leftHandle.dataset.kind = "offset";
    leftHandle.style.top = `${leftPixelY - 9}px`;
    leftHandle.style.backgroundColor = color;
    leftHandle.title = `${labelName(seriesKey)} 위치`;
    setupOffsetDrag(leftHandle, index, seriesKey, leftPixelY, yAxis);
    container.appendChild(leftHandle);

    const rightHandle = document.createElement("button");
    rightHandle.type = "button";
    rightHandle.className = "y-handle y-handle-right";
    rightHandle.dataset.series = seriesKey;
    rightHandle.dataset.kind = "scale";
    rightHandle.style.top = `${rightPixelY - 9}px`;
    rightHandle.style.left = `${rightX}px`;
    rightHandle.style.backgroundColor = color;
    rightHandle.title = `${labelName(seriesKey)} 스케일`;
    setupScaleDrag(rightHandle, index, seriesKey, rightPixelY);
    container.appendChild(rightHandle);
  });

  refreshHandleStates();
}

function resetHandles() {
  seriesOffsets = {};
  seriesScales = {};
  activeSeries = null;
  activeHandleKind = null;
  renderChart();
}

function renderChart() {
  const chart = document.getElementById("chart");
  const messageArea = document.getElementById("messageArea");

  const priceRows = pricePayload?.records || [];
  const dates = priceRows.map((row) => row.date);
  const maxDate = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
  const minDate = dates[0] || maxDate;
  let start = shiftYears(maxDate, activeYears);
  if (start < minDate) start = minDate;

  const { rows, macroCols, liveCols } = mergeSources(priceRows, macroRows, start, maxDate);
  const allSeries = sortSeries(
    [...new Set([...liveCols, ...macroCols])].filter((seriesName) => rows.some((row) => toNum(row[seriesName]) !== null))
  );

  if (!rows.length || !allSeries.length) {
    messageArea.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }
  messageArea.innerHTML = "";

  ensureVisibilityState(allSeries);
  if (activeSeries && !allSeries.includes(activeSeries)) {
    activeSeries = null;
    activeHandleKind = null;
  }
  currentSeriesOrder = [...allSeries];
  baseTraceValues = {};

  const commonNormBases = {};
  const firstDates = allSeries
    .map((seriesName) => rows.find((row) => toNum(row[seriesName]) !== null)?.date || null)
    .filter(Boolean);
  const commonBaseDate = firstDates.length ? firstDates.reduce((latest, current) => (current > latest ? current : latest)) : null;
  if (commonBaseDate) {
    allSeries.forEach((seriesName) => {
      const row = rows.find((candidate) => candidate.date >= commonBaseDate && toNum(candidate[seriesName]) !== null);
      commonNormBases[seriesName] = row ? toNum(row[seriesName]) : null;
    });
  }

  const autoScales = autoFitScales(rows, allSeries, commonNormBases);
  const traces = allSeries.map((seriesName) => {
    let values = rows.map((row) => toNum(row[seriesName]));
    const base = commonNormBases[seriesName];
    values = (base && base !== 0)
      ? values.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null))
      : normalizeSeries(values);
    values = centeredScale(values, autoScales[seriesName] || 100, true);
    baseTraceValues[seriesName] = values;

    const userScale = seriesScales[seriesName] != null ? seriesScales[seriesName] : 1;
    const offset = seriesOffsets[seriesName] || 0;
    const finalValues = values.map((value) => {
      if (value === null) return null;
      return 100 + (value - 100) * userScale + offset;
    });

    const isMacro = macroCols.includes(seriesName);
    const isFocused = activeSeries === seriesName;
    return {
      x: rows.map((row) => row.date),
      y: finalValues,
      type: "scatter",
      mode: "lines",
      name: labelName(seriesName),
      visible: hiddenSeries.has(seriesName) ? "legendonly" : true,
      connectgaps: false,
      opacity: activeSeries && !isFocused ? 0.58 : 1,
      line: {
        color: seriesColor(seriesName),
        width: isFocused ? 4.2 : isMacro ? 3.2 : 2.5,
        shape: "linear",
      },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    };
  });

  Plotly.react(
    chart,
    traces,
    {
      paper_bgcolor: "transparent",
      plot_bgcolor: "#05070b",
      dragmode: "pan",
      hovermode: "x unified",
      margin: { l: 44, r: 44, t: 28, b: 34 },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.1,
        font: { color: "rgba(255,255,255,0.78)", size: 11 },
      },
      xaxis: {
        showgrid: true,
        gridcolor: "rgba(255,255,255,0.08)",
        gridwidth: 1,
        zeroline: false,
        color: "#93a4bb",
        tickfont: { size: 10 },
        fixedrange: false,
      },
      yaxis: {
        showticklabels: false,
        title: "",
        showgrid: true,
        gridcolor: "rgba(255,255,255,0.08)",
        gridwidth: 1,
        zeroline: false,
        fixedrange: true,
      },
      font: {
        color: "#d7deea",
        family: "Apple SD Gothic Neo, Pretendard, sans-serif",
      },
      hoverlabel: {
        bgcolor: "#111826",
        bordercolor: "#1f2a3d",
        font: { color: "#f8fbff" },
      },
    },
    {
      responsive: true,
      displaylogo: false,
      scrollZoom: false,
      doubleClick: "reset",
      modeBarButtonsToRemove: ["zoom2d", "lasso2d", "select2d", "zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d"],
    }
  );

  if (!legendHandlerSet) {
    chart.on("plotly_legendclick", (eventData) => {
      const seriesName = currentSeriesOrder[eventData.curveNumber];
      if (!seriesName) return false;
      activeSeries = seriesName;
      activeHandleKind = null;
      if (hiddenSeries.has(seriesName)) hiddenSeries.delete(seriesName);
      else hiddenSeries.add(seriesName);
      renderChart();
      return false;
    });
    chart.on("plotly_legenddoubleclick", () => {
      hiddenSeries.clear();
      activeHandleKind = null;
      renderChart();
      return false;
    });
    chart.on("plotly_relayout", () => {
      window.requestAnimationFrame(updateHandles);
    });
    legendHandlerSet = true;
  }

  syncButtons();
  updateHandles();
}

function syncButtons() {
  document.querySelectorAll(".range-btn").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.years) === activeYears);
  });
}

async function loadMacroRows(priceRows) {
  const priceDates = priceRows.map((row) => row.date);

  try {
    const response = await fetch("./data/macro_data.json", { cache: "no-store" });
    if (response.ok) {
      const text = await response.text();
      return buildDenseMacroRows(parsePayloadRows(text), priceDates);
    }
  } catch (_) {
    // fall through to CSV fallback
  }

  const fallback = await fetch("./data/sample_macro_data.csv", { cache: "no-store" });
  const text = await fallback.text();
  return buildDenseMacroRows(parseCsv(text), priceDates);
}

async function boot() {
  const messageArea = document.getElementById("messageArea");
  try {
    const priceResponse = await fetch("./data/prices.json", { cache: "no-store" });
    const priceText = await priceResponse.text();
    pricePayload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));
    macroRows = await loadMacroRows(pricePayload.records || []);

    document.querySelectorAll(".range-btn").forEach((button) => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        syncButtons();
        renderChart();
      });
    });

    document.getElementById("resetHandles").addEventListener("click", resetHandles);

    syncButtons();
    renderChart();
  } catch (error) {
    messageArea.innerHTML = `<div class="message error">${error.message || "앱을 시작하지 못했습니다."}</div>`;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
}

boot();
