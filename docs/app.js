const DISPLAY_NAMES = {
  leading_cycle: "선행지수 순환변동치",
  kospi_credit: "코스피 신용잔고",
  kosdaq_credit: "코스닥 신용잔고",
  "^KS11": "코스피",
  "^KQ11": "코스닥",
  "005930.KS": "삼성전자",
  "218410.KQ": "RFHIC",
};

const DEFAULT_SELECTED = ["^KS11", "leading_cycle"];
const SERIES_PRIORITY = ["^KS11", "leading_cycle", "^KQ11", "kospi_credit", "kosdaq_credit", "005930.KS", "218410.KQ"];
const COLORS = ["#1d5f4a", "#c17335", "#26547c", "#d14d41", "#6c5ce7", "#0f8b8d", "#8a6f4d"];
const DEFAULT_RANGE_YEARS = 10;

const toNum = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const labelName = (key) => DISPLAY_NAMES[key] || key;

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

function renderChart(pricePayload, macroText) {
  const el = document.getElementById("chart");
  const msgEl = document.getElementById("messageArea");

  const priceRows = pricePayload.records || [];
  const manualRows = parseCsv(macroText);
  const dates = priceRows.map((r) => r.date);
  const maxDate = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
  const minDate = dates[0] || maxDate;
  const end = maxDate;
  const start = shiftYears(end, DEFAULT_RANGE_YEARS) < minDate ? minDate : shiftYears(end, DEFAULT_RANGE_YEARS);

  const { rows, manualCols, liveCols } = mergeSources(priceRows, manualRows, start, end);
  const allSeries = sortSeries(
    [...new Set([...liveCols, ...manualCols])].filter((s) => rows.some((r) => toNum(r[s]) !== null))
  );
  const selected = DEFAULT_SELECTED.filter((s) => allSeries.includes(s));
  if (!selected.length) selected.push(...allSeries.slice(0, 2));

  if (!rows.length || !selected.length) {
    msgEl.innerHTML = '<div class="message error">표시할 데이터가 없습니다.</div>';
    return;
  }

  // Common normalization base: latest first-data date among selected series
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
    return {
      x: rows.map((r) => r.date),
      y: values,
      type: "scatter",
      mode: "lines",
      name: labelName(series),
      connectgaps: true,
      line: {
        color: COLORS[i % COLORS.length],
        width: manualCols.includes(series) ? 3.2 : 2.4,
        shape: manualCols.includes(series) ? "hv" : "linear",
      },
      hovertemplate: "%{x}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
    };
  });

  Plotly.react(el, traces, {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(255,255,255,0.78)",
    margin: { l: 18, r: 18, t: 18, b: 20 },
    hovermode: "x unified",
    legend: { orientation: "h", x: 0, y: 1.08 },
    xaxis: { showgrid: true, gridcolor: "rgba(23,48,34,0.22)", gridwidth: 1, zeroline: false },
    yaxis: { title: "비교 지수", showgrid: true, gridcolor: "rgba(23,48,34,0.22)", gridwidth: 1, zeroline: false },
    font: { color: "#173022", family: "Apple SD Gothic Neo, Pretendard, sans-serif" },
  }, { responsive: true, displaylogo: false });
}

async function boot() {
  const msgEl = document.getElementById("messageArea");
  try {
    const [priceRes, macroRes] = await Promise.all([
      fetch("./data/prices.json"),
      fetch("./data/sample_macro_data.csv"),
    ]);
    const priceText = await priceRes.text();
    const pricePayload = JSON.parse(priceText.replace(/\bNaN\b/g, "null"));
    const macroText = await macroRes.text();
    renderChart(pricePayload, macroText);
  } catch (err) {
    msgEl.innerHTML = `<div class="message error">${err.message || "앱을 시작하지 못했습니다."}</div>`;
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => null));
  }
}

boot();
