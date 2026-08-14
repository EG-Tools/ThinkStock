import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/series-integrity.mjs");
await import("../../docs/modules/chart-marker-runtime.js");
const markerModule = globalThis.ThinkStockChartMarkerRuntime;

test("timing hover reasons stay concise while preserving the strongest evidence", () => {
  assert.equal(markerModule.compactTimingReasons([
    ["신용 과열", "가격·거래량 둔화 괴리"],
    ["추세 이탈", "신용 과열"],
  ]), "신용 과열 · 가격·거래량 둔화 괴리");
  assert.equal(markerModule.compactTimingReasons([], "복합 신호"), "복합 신호");
});

function createRuntime(overrides = {}) {
  const counters = { index: 0, gap: 0, indexedTickers: [] };
  const chartSession = {
    hiddenSeries: new Set(),
    hoverShowPopup: true,
    showDisclosures: true,
    showInsiderTrades: true,
    showRecessionSignals: true,
  };
  const timingModels = new Map([
    ["005930.KS", {
      signals: [{ date: "2026-08-03", setupReasons: ["과매도", "전일대비 27% 하락"] }],
      sellSignals: [{ date: "2026-08-05", sellSetupReasons: ["과열", "전일대비 27% 상승"] }],
    }],
  ]);
  const pointIndex = {
    "^KS11": [
      { date: "2026-08-03", y: 90 },
    ],
    "005930.KS": [
      { date: "2026-08-03", y: 90 },
      { date: "2026-08-04", y: 95 },
      { date: "2026-08-05", y: 100 },
    ],
  };
  const runtime = markerModule.createChartMarkerRuntime(globalThis, {
    colors: {
      crisis: "blue",
      disclosure: "orange",
      timingBuy: "pink",
      timingSell: "skyblue",
    },
    constants: {
      disclosureIconText: "◆",
      disclosureTextSize: 13,
      disclosureTraceName: "공시",
    },
    chartEventLayer: {
      buildPointIndex(_models, tickers) {
        counters.index += 1;
        counters.indexedTickers = [...tickers].sort();
        return pointIndex;
      },
      markerGap() {
        counters.gap += 1;
        return 10;
      },
      findPointOnDate(date, ticker, index) {
        return index[ticker]?.find((point) => point.date === date) || null;
      },
    },
    chartSession,
    buildInsiderMarkerTraces: (groups) => [{ groups }],
    dataRevisionSignature: () => "revision",
    ensureMarketTimingFeature: async () => {},
    escapeHtml: (value) => String(value),
    getAdrRows: () => [],
    getCreditRows: () => [],
    getCrisisRows: () => [],
    getCustomStocks: () => [],
    getDisclosureRows: () => [{
      ticker: "005930.KS",
      date: "2026-08-04",
      type: "실적",
      title: "분기보고서",
    }],
    getInsiderTradeRows: () => [{
      ticker: "005930.KS",
      date: "2026-08-03",
      side: "buy",
      reporter: "홍길동",
      shares: 10,
    }],
    getMacroRows: () => [],
    getMarketTimingService: () => ({ get: (ticker) => timingModels.get(ticker) || null }),
    getPricePayload: () => ({ records: [] }),
    getTickerVolumeSeriesByTicker: () => new Map(),
    getUseViewportMarkerGap: () => false,
    getViewportYRange: () => [0, 120],
    isForecastSeries: (ticker) => ticker.endsWith(".KS"),
    labelName: () => "삼성전자",
    netSameReporterInsiderTrades: (rows) => rows,
    recordPerfSample: () => {},
    recordRuntimeError: () => {},
    seriesColor: () => "#4ade80",
    startPerfSample: () => 0,
    toNum: (value) => Number.isFinite(Number(value)) ? Number(value) : null,
    toUtcMs: (value) => Date.parse(`${value}T00:00:00Z`),
    ...overrides,
  });
  return { chartSession, counters, runtime };
}

test("one marker frame shares its date index and spacing across every marker layer", () => {
  const { counters, runtime } = createRuntime();
  const frame = runtime.createFrame({
    selected: ["005930.KS"],
    seriesModels: [{ series: "005930.KS" }],
    start: "2026-08-01",
    end: "2026-08-08",
  });

  const buy = runtime.buildTimingBuy(frame);
  const sell = runtime.buildTimingSell(frame);
  const disclosure = runtime.buildDisclosure(frame);
  const insider = runtime.buildInsider(frame);

  assert.equal(counters.index, 1);
  assert.equal(counters.gap, 1);
  assert.equal(buy.count, 1);
  assert.equal(sell.count, 1);
  assert.equal(buy.trace.customdata[0][1], "과매도 · 전일대비 27% 하락");
  assert.equal(sell.trace.customdata[0][1], "과열 · 전일대비 27% 상승");
  assert.equal(disclosure.stats.markers, 1);
  assert.equal(insider.stats.markers, 1);
  assert.deepEqual(disclosure.trace.x, ["2026-08-04"]);
  assert.equal(
    disclosure.groups.get("d|005930.KS|2026-08-04").events[0].title,
    "분기보고서",
  );
});

test("crisis entries are emitted only when the stage rises into warning or crisis", () => {
  const entries = markerModule.collectCrisisSignalEntries([
    { date: "2026-01-01", stage: "stable", score: 10 },
    { date: "2026-02-01", stage: "warning", score: 55 },
    { date: "2026-03-01", stage: "warning", score: 60 },
    { date: "2026-04-01", stage: "crisis", score: 80 },
    { date: "2026-05-01", stage: "caution", score: 30 },
    { date: "2026-06-01", stage: "warning", score: 55 },
  ]);
  assert.deepEqual(entries.map((row) => row.date), [
    "2026-02-01",
    "2026-04-01",
    "2026-06-01",
  ]);
});

test("crisis signal hover keeps only the summary scores", () => {
  const { runtime } = createRuntime({
    getCrisisRows: () => [{
      date: "2026-08-03",
      stage: "warning",
      score: 58,
      curve: 20,
      labor: 18,
      credit: 20,
      t10y2y: -0.2,
      t10y3m: -0.5,
      unemployment: 4.2,
      initialClaims4w: 245000,
      creditSpread: 2.1,
    }],
    getDisclosureRows: () => [],
    getInsiderTradeRows: () => [],
    isForecastSeries: () => true,
    labelName: () => "코스피",
  });
  const frame = runtime.createFrame({
    selected: ["^KS11"],
    seriesModels: [{ series: "^KS11" }],
    start: "2026-08-01",
    end: "2026-08-08",
  });
  const crisis = runtime.buildCrisis(frame);

  assert.equal(crisis.count, 1);
  assert.equal(crisis.trace.customdata[0].length, 6);
  assert.match(crisis.trace.hovertemplate, /금리.*고용.*신용/);
  assert.doesNotMatch(crisis.trace.hovertemplate, /10Y|실업률|신규수당|신용스프레드/);
});

test("marker frames index only visible series used by enabled marker layers", () => {
  const { chartSession, counters, runtime } = createRuntime();
  chartSession.showRecessionSignals = false;
  chartSession.showInsiderTrades = false;
  const frame = runtime.createFrame({
    selected: ["005930.KS", "000660.KS", "leading_cycle"],
    seriesModels: [
      { series: "005930.KS" },
      { series: "000660.KS" },
      { series: "leading_cycle" },
    ],
    start: "2026-08-01",
    end: "2026-08-08",
  });

  assert.equal(counters.index, 1);
  assert.equal(counters.gap, 1);
  assert.deepEqual(counters.indexedTickers, ["005930.KS"]);
  assert.ok(frame.pointIndex["005930.KS"]);
});

test("marker frames skip point and gap calculations when no enabled layer has events", () => {
  const { chartSession, counters, runtime } = createRuntime({
    getDisclosureRows: () => [],
    getInsiderTradeRows: () => [],
  });
  chartSession.showRecessionSignals = false;
  chartSession.showInsiderTrades = false;
  const frame = runtime.createFrame({
    selected: ["005930.KS"],
    seriesModels: [{ series: "005930.KS" }],
    start: "2026-08-01",
    end: "2026-08-08",
  });

  assert.equal(counters.index, 0);
  assert.equal(counters.gap, 0);
  assert.deepEqual(frame.pointIndex, {});
  assert.equal(frame.markerGap, 0);
});

test("point lookup never attaches a marker beyond its allowed trading-day gap", () => {
  const index = {
    "005930.KS": [
      { date: "2026-08-10", y: 100 },
      { date: "2026-08-20", y: 105 },
    ],
  };
  assert.deepEqual(
    markerModule.findPointOnOrAfterDate("2026-08-08", "005930.KS", index, 4),
    { date: "2026-08-10", y: 100 },
  );
  assert.equal(
    markerModule.findPointOnOrAfterDate("2026-08-11", "005930.KS", index, 4),
    null,
  );
});

test("timing preparation excludes inactive custom stocks and reuses relevant fingerprints", async () => {
  let prepared = null;
  const service = {
    stats: () => ({ signature: "", modelCount: 0 }),
    prepare: async (payload) => { prepared = payload; },
  };
  const { runtime } = createRuntime({
    getCustomStocks: () => [{ ticker: "000660.KS" }],
    getMarketTimingService: () => service,
    getPricePayload: () => ({
      records: [
        { date: "2026-08-11", "^KS11": 3200, "^KQ11": 800, "005930.KS": 70000, "000660.KS": 200000 },
        { date: "2026-08-12", "^KS11": 3210, "^KQ11": 805, "005930.KS": 71000, "000660.KS": 201000 },
      ],
    }),
    isForecastSeries: (ticker) => ticker.startsWith("^") || ticker.endsWith(".KS"),
  });

  await runtime.prepareMarketTimingModels(
    ["005930.KS"],
    [{ series: "005930.KS" }],
  );

  assert.deepEqual(Object.keys(prepared.sources.pricesByTicker).sort(), [
    "005930.KS",
    "^KQ11",
    "^KS11",
  ]);
  assert.equal(prepared.sources.pricesByTicker["000660.KS"], undefined);
});
