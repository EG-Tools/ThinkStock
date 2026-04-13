const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용잔고",
  kosdaq_credit: "코스닥 신용잔고",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
};

const DEFAULT_SELECTED_SERIES = ["^KS11", "leading_cycle"];
const DATE_PRESET_YEARS = [10, 20, 30];
const SERIES_PRIORITY = ["^KS11", "leading_cycle", "^KQ11", "kospi_credit", "kosdaq_credit", "005930.KS", "218410.KQ"];
const PRESETS = {
  "기본 보기": ["^KS11", "leading_cycle"],
  "시장 + 거시 밸런스": ["leading_cycle", "kospi_credit", "kosdaq_credit", "^KS11", "^KQ11"],
  "코스피 레짐 체크": ["leading_cycle", "kospi_credit", "^KS11", "005930.KS"],
  "코스닥 모멘텀 체크": ["leading_cycle", "kosdaq_credit", "^KQ11", "218410.KQ"],
  "반도체 비교": ["leading_cycle", "^KS11", "005930.KS", "218410.KQ"],
};
const COLORS = ["#1d5f4a", "#c17335", "#26547c", "#d14d41", "#6c5ce7", "#0f8b8d", "#8a6f4d"];

const state = {
  pricePayload: null,
  sampleMacroText: "",
  macroText: "",
  manualLabel: "샘플 CSV",
  selectedSeries: [],
  manualScaleValues: {},
  minDate: "",
  maxDate: "",
  activeRangeYears: DATE_PRESET_YEARS[0],
};

const el = {
  statusPills: document.getElementById("statusPills"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  normalizeToggle: document.getElementById("normalizeToggle"),
  scaleMode: document.getElementById("scaleMode"),
  presetSelect: document.getElementById("presetSelect"),
  applyPresetButton: document.getElementById("applyPresetButton"),
  macroSource: document.getElementById("macroSource"),
  remoteUrl: document.getElementById("remoteUrl"),
  fileInput: document.getElementById("fileInput"),
  macroTextarea: document.getElementById("macroTextarea"),
  applyMacroButton: document.getElementById("applyMacroButton"),
  resetMacroButton: document.getElementById("resetMacroButton"),
  reloadButton: document.getElementById("reloadButton"),
  messageArea: document.getElementById("messageArea"),
  metricGrid: document.getElementById("metricGrid"),
  chart: document.getElementById("chart"),
  scalePanel: document.getElementById("scalePanel"),
  seriesChooser: document.getElementById("seriesChooser"),
  previewTable: document.getElementById("previewTable"),
  downloadButton: document.getElementById("downloadButton"),
  periodButtons: [...document.querySelectorAll("[data-range-years]")],
};

const labelName = (key) => DISPLAY_NAMES[key] || key;

function sortSeriesNames(series) {
  const priority = new Map(SERIES_PRIORITY.map((name, index) => [name, index]));
  return [...series].sort((left, right) => {
    const leftRank = priority.has(left) ? priority.get(left) : SERIES_PRIORITY.length + 1;
    const rightRank = priority.has(right) ? priority.get(right) : SERIES_PRIORITY.length + 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return labelName(left).localeCompare(labelName(right), "ko");
  });
}

function defaultSelectedSeries(allSeries) {
  const defaults = DEFAULT_SELECTED_SERIES.filter((series) => allSeries.includes(series));
  return defaults.length ? defaults : allSeries.slice(0, Math.min(2, allSeries.length));
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

function clampDate(dateString, minDate, maxDate) {
  let value = dateString;
  if (minDate && value < minDate) {
    value = minDate;
  }
  if (maxDate && value > maxDate) {
    value = maxDate;
  }
  return value;
}

function syncRangeButtons() {
  el.periodButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.rangeYears) === state.activeRangeYears);
  });
}

function refreshRangePresetState() {
  const match = DATE_PRESET_YEARS.find((years) => {
    const expectedStart = clampDate(shiftYears(state.maxDate, years), state.minDate, state.maxDate);
    return el.endDate.value === state.maxDate && el.startDate.value === expectedStart;
  });
  state.activeRangeYears = match ?? null;
  syncRangeButtons();
}

function applyDatePreset(years, renderAfter = true) {
  state.activeRangeYears = years;
  const end = state.maxDate || new Date().toISOString().slice(0, 10);
  const start = clampDate(shiftYears(end, years), state.minDate, end);
  el.endDate.value = end;
  el.startDate.value = start;
  syncRangeButtons();
  if (renderAfter) {
    renderApp();
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
    throw new Error("CSV에는 date 컬럼이 반드시 있어야 합니다.");
  }
  return result.data.map((row) => {
    const out = { date: String(row.date).slice(0, 10) };
    Object.entries(row).forEach(([key, value]) => {
      if (key === "date" || value === "") {
        return;
      }
      const numeric = Number(value);
      out[key] = Number.isFinite(numeric) ? numeric : value;
    });
    return out;
  }).sort((left, right) => left.date.localeCompare(right.date));
}

const toMap = (rows) => new Map(rows.map((row) => [row.date, { ...row }]));

function daterange(start, end) {
  const rows = [];
  let current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (current <= last) {
    rows.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return rows;
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

function formatValue(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (Math.abs(value) >= 100) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function centeredScale(values, scalePct, normalized) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) {
    return values;
  }
  const pivot = normalized ? 100 : (Math.min(...numeric) + Math.max(...numeric)) / 2;
  const ratio = scalePct / 100;
  return values.map((value) => (Number.isFinite(value) ? pivot + (value - pivot) * ratio : null));
}

function normalizeSeries(values) {
  const first = values.find((value) => Number.isFinite(value));
  const base = Number.isFinite(first) && first !== 0 ? first : 1;
  return values.map((value) => (Number.isFinite(value) ? (value / base) * 100 : null));
}

function autoFitScales(rows, selected, normalized) {
  const info = [];
  selected.forEach((series) => {
    let values = rows.map((row) => Number(row[series])).filter((value) => Number.isFinite(value));
    if (!values.length) {
      return;
    }
    if (normalized) {
      values = normalizeSeries(values).filter((value) => Number.isFinite(value));
    }
    const range = Math.max(Math.max(...values) - Math.min(...values), 1);
    info.push([series, range]);
  });
  if (!info.length) {
    return {};
  }
  const sorted = info.map(([, range]) => range).sort((left, right) => left - right);
  const target = sorted[Math.floor(sorted.length / 2)];
  return Object.fromEntries(info.map(([series, range]) => [series, Math.max(5, Math.min(5000, Math.round((target / range) * 100)))]));
}

function mergeSources(priceRows, manualRows, start, end) {
  const priceMap = toMap(priceRows);
  const manualMap = toMap(manualRows);
  const manualCols = getSeriesColumns(manualRows);
  const liveCols = getSeriesColumns(priceRows);
  const baseDates = priceRows.length ? priceRows.map((row) => row.date) : daterange(start, end);
  const rows = [];
  const carry = {};
  baseDates.forEach((date) => {
    if (date < start || date > end) {
      return;
    }
    const row = { date };
    const live = priceMap.get(date) || {};
    const manual = manualMap.get(date) || {};
    liveCols.forEach((key) => {
      const value = Number(live[key]);
      row[key] = Number.isFinite(value) ? value : null;
    });
    manualCols.forEach((key) => {
      const raw = Number(manual[key]);
      if (Number.isFinite(raw)) {
        carry[key] = raw;
      }
      row[key] = Number.isFinite(carry[key]) ? carry[key] : null;
    });
    rows.push(row);
  });
  return { rows, manualCols, liveCols };
}

function latestSnapshot(rows, series) {
  const valid = rows.filter((row) => Number.isFinite(Number(row[series])));
  if (!valid.length) {
    return null;
  }
  const latest = valid[valid.length - 1];
  const previous = valid.length > 1 ? valid[valid.length - 2] : null;
  return {
    date: latest.date,
    value: Number(latest[series]),
    delta: previous ? Number(latest[series]) - Number(previous[series]) : null,
  };
}

function setMessages(messages) {
  el.messageArea.innerHTML = messages.map((message) => `<div class="message ${message.type || ""}">${message.text}</div>`).join("");
}

function setStatusPills(liveCols, manualCols, rows) {
  const generated = state.pricePayload?.generated_at || "-";
  el.statusPills.innerHTML = `<span class="pill ok">공개 링크: GitHub Pages</span><span class="pill ok">가격 캐시 ${liveCols.length}개</span><span class="pill warn">매크로 소스 ${state.manualLabel}</span><span class="pill warn">최근 가격 반영 ${generated.slice(0, 10)}</span><span class="pill warn">표시 행 ${rows.length.toLocaleString()}개</span><span class="pill warn">매크로 시리즈 ${manualCols.length}개</span>`;
}

function renderSeriesChooser(allSeries) {
  el.seriesChooser.innerHTML = allSeries.map((series) => `<label class="check-card"><input type="checkbox" data-series="${series}" ${state.selectedSeries.includes(series) ? "checked" : ""}><span>${labelName(series)}</span></label>`).join("");
  el.seriesChooser.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const selectedSet = new Set(state.selectedSeries);
      const series = checkbox.dataset.series;
      if (checkbox.checked) {
        selectedSet.add(series);
      } else {
        selectedSet.delete(series);
      }
      state.selectedSeries = allSeries.filter((item) => selectedSet.has(item));
      renderApp();
    });
  });
}

function renderMetrics(rows, selected, manualCols) {
  const metricSeries = selected.slice(0, 6);
  el.metricGrid.innerHTML = metricSeries.map((series) => {
    const snapshot = latestSnapshot(rows, series);
    if (!snapshot) {
      return `<div class="metric-card"><div class="metric-label">${labelName(series)}</div><div class="metric-value">데이터 없음</div><div class="metric-meta">값이 없습니다.</div></div>`;
    }
    const delta = Number.isFinite(snapshot.delta) ? `${snapshot.delta > 0 ? "+" : ""}${formatValue(snapshot.delta)}` : "-";
    const source = manualCols.includes(series) ? "매크로" : "가격";
    return `<div class="metric-card"><div class="metric-label">${labelName(series)}</div><div class="metric-value">${formatValue(snapshot.value)}</div><div class="metric-meta">${source} | ${snapshot.date} | 변화 ${delta}</div></div>`;
  }).join("");
}

function renderScalePanel(selected, autoScales) {
  if (el.scaleMode.value !== "manual") {
    el.scalePanel.classList.remove("is-visible");
    el.scalePanel.innerHTML = "";
    return;
  }
  el.scalePanel.classList.add("is-visible");
  el.scalePanel.innerHTML = `<div class="section-title-row"><h2>직접 배율 조정</h2><span class="subtle-note">시리즈별 진폭만 확대·축소합니다.</span></div><div class="scale-grid">${selected.map((series) => {
    const value = state.manualScaleValues[series] ?? autoScales[series] ?? 100;
    state.manualScaleValues[series] = value;
    return `<label class="field"><span>${labelName(series)} 비율 (%)</span><input type="number" min="5" max="5000" step="1" data-scale-series="${series}" value="${value}"></label>`;
  }).join("")}</div>`;
  el.scalePanel.querySelectorAll("input[data-scale-series]").forEach((input) => {
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) {
        state.manualScaleValues[input.dataset.scaleSeries] = Math.max(5, Math.min(5000, value));
        renderChart();
      }
    });
  });
}

function renderPreviewTable(rows, selected) {
  const trimmed = rows.slice(-120);
  const headers = ["date", ...selected];
  const head = headers.map((header) => `<th>${header === "date" ? "date" : labelName(header)}</th>`).join("");
  const body = trimmed.map((row) => `<tr>${headers.map((header) => header === "date" ? `<td>${row.date}</td>` : `<td>${formatValue(Number(row[header]))}</td>`).join("")}</tr>`).join("");
  el.previewTable.innerHTML = `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const buildCsv = (rows, selected) => [`date,${selected.join(",")}`, ...rows.map((row) => [row.date, ...selected.map((series) => row[series] ?? "")].join(","))].join("\n");

function renderChart() {
  const start = el.startDate.value;
  const end = el.endDate.value;
  const manualRows = parseCsv(state.macroText);
  const priceRows = state.pricePayload.records || [];
  const { rows, manualCols, liveCols } = mergeSources(priceRows, manualRows, start, end);
  const allSeries = sortSeriesNames([...new Set([...liveCols, ...manualCols])].filter((series) => rows.some((row) => Number.isFinite(Number(row[series])))));
  const defaultSelected = defaultSelectedSeries(allSeries);
  if (!state.selectedSeries.length) {
    state.selectedSeries = defaultSelected;
  }
  const selectedSet = new Set(state.selectedSeries.filter((series) => allSeries.includes(series)));
  state.selectedSeries = allSeries.filter((series) => selectedSet.has(series));
  if (!state.selectedSeries.length) {
    state.selectedSeries = defaultSelected;
  }
  renderSeriesChooser(allSeries);
  renderMetrics(rows, state.selectedSeries, manualCols);
  setMessages([]);
  if (!rows.length || !state.selectedSeries.length) {
    setMessages([{ type: "error", text: "표시할 데이터가 없습니다. 날짜 범위와 매크로 소스를 확인해 주세요." }]);
    Plotly.purge(el.chart);
    return;
  }
  setStatusPills(liveCols, manualCols, rows);
  renderPreviewTable(rows, state.selectedSeries);
  const normalized = el.normalizeToggle.checked;
  const autoScales = autoFitScales(rows, state.selectedSeries, normalized);
  renderScalePanel(state.selectedSeries, autoScales);
  const traces = state.selectedSeries.map((series, index) => {
    let values;
    if (manualCols.includes(series)) {
      // Emit a value only when the carry-forward changes (i.e. a new monthly point).
      // CSV dates (e.g. Jan 1) are holidays and never appear in trading-day rows,
      // so exact-date lookup always misses — use value-change detection instead.
      let lastValue = null;
      values = rows.map((row) => {
        const carried = Number.isFinite(Number(row[series])) ? Number(row[series]) : null;
        if (carried !== null && carried !== lastValue) {
          lastValue = carried;
          return carried;
        }
        return null;
      });
    } else {
      values = rows.map((row) => Number(row[series])).map((value) => Number.isFinite(value) ? value : null);
    }
    if (normalized) {
      values = normalizeSeries(values);
    }
    let scaleValue = 100;
    if (el.scaleMode.value === "auto") {
      scaleValue = autoScales[series] || 100;
    } else if (el.scaleMode.value === "manual") {
      scaleValue = state.manualScaleValues[series] || autoScales[series] || 100;
    }
    values = centeredScale(values, scaleValue, normalized);
    return {
      x: rows.map((row) => row.date),
      y: values,
      type: "scatter",
      mode: "lines",
      name: labelName(series),
      connectgaps: true,
      line: {
        color: COLORS[index % COLORS.length],
        width: manualCols.includes(series) ? 3.2 : 2.4,
        shape: "linear",
      },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    };
  });
  Plotly.react(el.chart, traces, {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,255,255,0.78)",
    margin: { l: 18, r: 18, t: 18, b: 20 },
    hovermode: "x unified",
    legend: { orientation: "h", x: 0, y: 1.08 },
    xaxis: { showgrid: true, gridcolor: "rgba(23,48,34,0.22)", gridwidth: 1, zeroline: false },
    yaxis: { title: normalized ? "비교 지수" : "값", showgrid: true, gridcolor: "rgba(23,48,34,0.22)", gridwidth: 1, zeroline: false },
    font: { color: "#173022", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
  }, { responsive: true, displaylogo: false });
  el.downloadButton.onclick = () => {
    const blob = new Blob([buildCsv(rows, state.selectedSeries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `thinkstock_mobile_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
}

function renderApp() {
  try {
    renderChart();
  } catch (error) {
    setMessages([{ type: "error", text: error.message || "데이터를 렌더링하지 못했습니다." }]);
  }
}

async function resolveMacroText() {
  const source = el.macroSource.value;
  if (source === "sample") {
    state.manualLabel = "샘플 CSV";
    return state.sampleMacroText;
  }
  if (source === "paste") {
    state.manualLabel = "직접 붙여넣기";
    return el.macroTextarea.value;
  }
  if (source === "remote") {
    if (!el.remoteUrl.value.trim()) {
      throw new Error("원격 CSV URL을 입력해 주세요.");
    }
    const response = await fetch(el.remoteUrl.value.trim());
    if (!response.ok) {
      throw new Error("원격 CSV를 가져오지 못했습니다.");
    }
    state.manualLabel = el.remoteUrl.value.trim();
    return await response.text();
  }
  const file = el.fileInput.files[0];
  if (!file) {
    throw new Error("업로드할 CSV 파일을 선택해 주세요.");
  }
  state.manualLabel = file.name;
  return await file.text();
}

async function boot() {
  const [priceResponse, macroResponse] = await Promise.all([fetch("./data/prices.json"), fetch("./data/sample_macro_data.csv")]);
  const priceText = await priceResponse.text();
  state.pricePayload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));
  state.sampleMacroText = await macroResponse.text();
  state.macroText = state.sampleMacroText;
  el.macroTextarea.value = state.sampleMacroText;
  Object.keys(PRESETS).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    el.presetSelect.appendChild(option);
  });
  el.presetSelect.value = "기본 보기";
  const dates = (state.pricePayload.records || []).map((row) => row.date);
  const fallbackToday = new Date().toISOString().slice(0, 10);
  state.minDate = dates[0] || fallbackToday;
  state.maxDate = dates[dates.length - 1] || fallbackToday;
  el.startDate.min = state.minDate;
  el.startDate.max = state.maxDate;
  el.endDate.min = state.minDate;
  el.endDate.max = state.maxDate;
  applyDatePreset(DATE_PRESET_YEARS[0], false);
  document.querySelectorAll(".tab-button[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button[data-tab]").forEach((node) => node.classList.toggle("is-active", node === button));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${button.dataset.tab}Tab`));
    });
  });
  el.periodButtons.forEach((button) => {
    button.addEventListener("click", () => applyDatePreset(Number(button.dataset.rangeYears)));
  });
  [el.startDate, el.endDate].forEach((input) => {
    input.addEventListener("change", () => {
      refreshRangePresetState();
      renderApp();
    });
  });
  [el.normalizeToggle, el.scaleMode].forEach((input) => input.addEventListener("change", renderApp));
  el.applyPresetButton.addEventListener("click", () => {
    const presetSeries = PRESETS[el.presetSelect.value] || DEFAULT_SELECTED_SERIES;
    state.selectedSeries = [...presetSeries];
    renderApp();
  });
  el.applyMacroButton.addEventListener("click", async () => {
    try {
      state.macroText = await resolveMacroText();
      renderApp();
    } catch (error) {
      setMessages([{ type: "error", text: error.message || "매크로 데이터를 불러오지 못했습니다." }]);
    }
  });
  el.resetMacroButton.addEventListener("click", () => {
    state.macroText = state.sampleMacroText;
    state.manualLabel = "샘플 CSV";
    el.macroSource.value = "sample";
    el.macroTextarea.value = state.sampleMacroText;
    renderApp();
  });
  el.reloadButton.addEventListener("click", () => window.location.reload());
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
  renderApp();
}

boot().catch((error) => {
  setMessages([{ type: "error", text: error.message || "앱을 시작하지 못했습니다." }]);
});
