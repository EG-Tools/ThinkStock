import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/series-integrity.mjs");
const { chartMarkerRuntime: markerModule } = await import("../../docs/modules/chart-marker-runtime.mjs");

test("event marker registry owns marker identity, layer, and interaction policy", () => {
  const traces = {
    crisis: { meta: { isCrisisSignalTrace: true } },
    buy: { meta: { isMarketTimingBuyTrace: true } },
    sell: { meta: { isMarketTimingSellTrace: true } },
    insider: { meta: { isInsiderTradeTrace: true, insiderTradeSide: "buy" } },
    disclosure: { meta: { isDisclosureTrace: true } },
  };
  assert.equal(markerModule.eventMarkerIdentity(traces.crisis), "crisis-signal");
  assert.equal(markerModule.eventMarkerIdentity(traces.buy), "market-timing-buy");
  assert.equal(markerModule.eventMarkerIdentity(traces.sell), "market-timing-sell");
  assert.equal(markerModule.eventMarkerIdentity(traces.insider), "insider:buy");
  assert.equal(markerModule.eventMarkerIdentity(traces.disclosure), "disclosure");
  assert.equal(markerModule.eventMarkerLayer(traces.buy), "timing");
  assert.equal(markerModule.isTimingSignalTrace(traces.crisis), true);
  assert.equal(markerModule.isDirectlyInteractiveEventMarkerTrace(traces.disclosure), true);
  assert.equal(markerModule.isDirectlyInteractiveEventMarkerTrace(traces.insider), true);
});

test("event marker popovers prefer the payload embedded in each marker trace", () => {
  const group = {
    name: "RFHIC",
    plotDate: "2026-07-31",
    events: [{ title: "내부자거래 : 매수", tone: "insider-buy" }],
  };
  assert.equal(markerModule.buildEventMarkerPopoverGroup({
    pointIndex: 0,
    data: { meta: { isInsiderTradeTrace: true, eventGroups: [group] } },
  }), group);
});

test("event markers share one typography contract", () => {
  assert.deepEqual(markerModule.buildEventMarkerTextFont("#fff", 15), {
    color: "#fff",
    family: markerModule.EVENT_MARKER_FONT_FAMILY,
    size: 15,
  });
  assert.equal(markerModule.CHART_MARKER_DEFAULTS.constants.eventMarkerTextSize, 15);
  assert.equal(markerModule.CHART_MARKER_DEFAULTS.constants.disclosureIconText, "◆");
  assert.equal(markerModule.CHART_MARKER_DEFAULTS.colors.disclosure, "#fde047");
  assert.equal(Object.isFrozen(markerModule.CHART_MARKER_DEFAULTS.constants), true);
});

test("event marker specs and trace materialization share the registry order", () => {
  const specs = markerModule.createEventMarkerSpecs({
    disclosure: { enabled: true, build: () => ({ meta: { isDisclosureTrace: true } }) },
    insider: {
      enabled: true,
      build: () => [
        { meta: { isInsiderTradeTrace: true, insiderTradeSide: "sell" } },
        { meta: { isInsiderTradeTrace: true, insiderTradeSide: "buy" } },
      ],
    },
  });
  assert.deepEqual(specs.map((spec) => spec.id), [
    "crisis", "timing-buy", "timing-sell", "insider", "disclosure",
  ]);
  assert.deepEqual(
    markerModule.materializeEventMarkerTraces(specs).map(markerModule.eventMarkerIdentity),
    ["insider:sell", "insider:buy", "disclosure"],
  );
});

test("timing hover reasons stay concise while preserving the strongest evidence", () => {
  assert.equal(markerModule.compactTimingReasons([
    ["신용 과열", "가격·거래량 둔화 괴리"],
    ["추세 이탈", "신용 과열"],
  ]), "신용 과열 · 가격·거래량 둔화 괴리");
  assert.equal(markerModule.compactTimingReasons([], "복합 신호"), "복합 신호");
  assert.equal(markerModule.compactTimingReasons([
    ["시장폭·심리 괴리 단기 과열", "변동성 대비 급등"],
  ], "복합 신호", 2, "<br>· "), "시장폭·심리 괴리 단기 …<br>· 변동성 대비 급등");
});

test("timing signal popovers reuse the compact marker payload", () => {
  const group = markerModule.buildTimingSignalPopoverGroup({
    x: "2026-08-21",
    customdata: [
      "삼성전자", "신용 과열<br>· MACD 반전", "8.2", "-1.3", "강", "slowdown", 5,
      "trend-exhaustion", "추세형",
    ],
    data: { name: "타이밍 매도신호", meta: { isMarketTimingSellTrace: true } },
  });
  assert.equal(group.name, "삼성전자");
  assert.equal(group.plotDate, "2026-08-21");
  assert.deepEqual(group.events.map((event) => event.title), [
    "매도 신호 · 강",
    "근거: 신용 과열",
    "· MACD 반전",
    "신용20일 8.2% · 고점대비 -1.3%",
    "시장 둔화 · 근거 5개",
    "추세 소진 · 추세형",
  ]);
});

test("exceptional timing moves are labeled as warnings instead of predictions", () => {
  const buy = markerModule.buildTimingSignalPopoverGroup({
    x: "2026-08-21",
    customdata: [
      "삼성전자", "전일대비 30% 하락", "-", "-", "-", "이례", "stress", 2,
      "shock-reversal", "고변동·모멘텀", "과매도 경고",
    ],
    data: { meta: { isMarketTimingBuyTrace: true } },
  });
  assert.equal(buy.events[0].title, "과매도 경고 · 이례");
});

function createRuntime(overrides = {}) {
  const counters = { index: 0, gap: 0, indexedTickers: [] };
  const chartSession = {
    hiddenSeries: new Set(),
    hoverShowPopup: true,
    seriesOffsets: {},
    seriesScales: {},
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
      eventMarkerDownText: "▼",
      eventMarkerTextSize: 15,
      eventMarkerUpText: "▲",
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
    buildInsiderMarkerTraces: (groups, options) => {
      counters.insiderTextSize = options?.textSize;
      return [{ groups }];
    },
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
  assert.match(buy.trace.hovertemplate[0], /근거: 과매도<br>· 전일대비 27% 하락/);
  assert.match(sell.trace.hovertemplate[0], /근거: 과열<br>· 전일대비 27% 상승/);
  assert.equal(buy.trace.mode, "text");
  assert.equal(buy.trace.text[0], "▲");
  assert.equal(sell.trace.mode, "text");
  assert.equal(sell.trace.text[0], "▼");
  assert.equal(disclosure.stats.markers, 1);
  assert.equal(disclosure.trace.mode, "text");
  assert.equal(disclosure.trace.text[0], "◆");
  assert.equal(insider.stats.markers, 1);
  assert.equal(counters.insiderTextSize, buy.trace.textfont.size);
  assert.deepEqual(disclosure.trace.x, ["2026-08-04"]);
  assert.equal(
    disclosure.groups.get("d|005930.KS|2026-08-04").events[0].title,
    "분기보고서",
  );
});

test("latest intraday timing markers are labeled as realtime signals", () => {
  const { runtime } = createRuntime({
    getSignalLifecycle: ({ signalDate, latestPriceDate }) => ({
      realtime: signalDate === latestPriceDate,
    }),
  });
  const frame = runtime.createFrame({
    selected: ["005930.KS"],
    seriesModels: [{ series: "005930.KS" }],
    start: "2026-08-01",
    end: "2026-08-08",
  });
  const sell = runtime.buildTimingSell(frame);
  assert.equal(sell.trace.customdata[0][9], "실시간 매도 신호");
});

test("reuses marker point indexes while the chart model identity is unchanged", () => {
  const { chartSession, counters, runtime } = createRuntime();
  const seriesModels = [{ series: "005930.KS" }];
  const frameOptions = {
    selected: ["005930.KS"],
    seriesModels,
    start: "2026-08-01",
    end: "2026-08-08",
  };

  runtime.createFrame(frameOptions);
  runtime.createFrame(frameOptions);
  assert.equal(counters.index, 1);

  chartSession.seriesScales["005930.KS"] = 1.25;
  runtime.createFrame(frameOptions);
  assert.equal(counters.index, 2);

  runtime.createFrame({ ...frameOptions, seriesModels: [...seriesModels] });
  assert.equal(counters.index, 3);
});

test("marker render revisions follow viewport spacing and series colors", () => {
  let markerGap = 10;
  let color = "#4ade80";
  const { runtime } = createRuntime({
    chartEventLayer: {
      buildPointIndex() {
        return {
          "005930.KS": [{ date: "2026-08-03", y: 90 }],
        };
      },
      markerGap() {
        return markerGap;
      },
      findPointOnDate(date, ticker, index) {
        return index[ticker]?.find((point) => point.date === date) || null;
      },
    },
    seriesColor: () => color,
  });
  const frameOptions = {
    selected: ["005930.KS"],
    seriesModels: [{ series: "005930.KS" }],
    start: "2026-08-01",
    end: "2026-08-08",
  };

  const initial = runtime.createFrame(frameOptions).renderRevision;
  markerGap = 14;
  const rescaled = runtime.createFrame(frameOptions).renderRevision;
  color = "#f97316";
  const recolored = runtime.createFrame(frameOptions).renderRevision;

  assert.notEqual(rescaled, initial);
  assert.notEqual(recolored, rescaled);
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
  const progressEvents = [];
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
    signalProgress: {
      begin: (key, label) => {
        progressEvents.push(["begin", key, label]);
        return true;
      },
      update: (key, value, label) => progressEvents.push(["update", key, value, label]),
      complete: (key, label) => progressEvents.push(["complete", key, label]),
      cancel: (key) => progressEvents.push(["cancel", key]),
    },
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
  assert.deepEqual(progressEvents.map(([type]) => type), [
    "begin",
    "update",
    "update",
    "update",
    "complete",
  ]);
  assert.equal(progressEvents[0][2], "삼성전자 신호 로딩중");
});

test("skips repeated timing preparation until a data revision changes", async () => {
  let revision = 1;
  let signature = "";
  let prepareCount = 0;
  let progressBeginCount = 0;
  const preparedTickers = new Set();
  const service = {
    has: (ticker) => preparedTickers.has(ticker),
    stats: () => ({ signature, modelCount: preparedTickers.size }),
    prepare: async (payload) => {
      prepareCount += 1;
      signature = payload.signature;
      payload.targets.forEach((ticker) => preparedTickers.add(ticker));
    },
  };
  const { runtime } = createRuntime({
    dataRevisionSignature: () => `revision-${revision}`,
    getMarketTimingService: () => service,
    getPricePayload: () => ({
      records: [
        { date: "2026-08-11", "^KS11": 3200, "^KQ11": 800, "005930.KS": 70000 },
        { date: "2026-08-12", "^KS11": 3210, "^KQ11": 805, "005930.KS": 71000 },
      ],
    }),
    isForecastSeries: (ticker) => ticker.startsWith("^") || ticker.endsWith(".KS"),
    signalProgress: {
      begin: () => {
        progressBeginCount += 1;
        return true;
      },
      update: () => {},
      complete: () => {},
      cancel: () => {},
    },
  });
  const selected = ["005930.KS"];
  const seriesModels = [{ series: "005930.KS" }];

  await runtime.prepareMarketTimingModels(selected, seriesModels);
  await runtime.prepareMarketTimingModels(selected, seriesModels);
  assert.equal(prepareCount, 1);
  assert.equal(progressBeginCount, 1);

  revision += 1;
  await runtime.prepareMarketTimingModels(selected, seriesModels);
  assert.equal(prepareCount, 2);
  assert.equal(progressBeginCount, 2);
});

test("signal progress names the active stocks when a cached chart gains a peer", async () => {
  const cachedTickers = new Set(["005930.KS"]);
  const progressLabels = [];
  let preparedTargets = [];
  const service = {
    has: (ticker) => cachedTickers.has(ticker),
    stats: () => ({ signature: "previous", modelCount: cachedTickers.size }),
    prepare: async (payload) => {
      preparedTargets = payload.targets;
      payload.targets.forEach((ticker) => cachedTickers.add(ticker));
    },
  };
  const { runtime } = createRuntime({
    getMarketTimingService: () => service,
    getPricePayload: () => ({
      records: [
        { date: "2026-08-11", "^KS11": 3200, "^KQ11": 800, "005930.KS": 70000, "000660.KS": 200000 },
        { date: "2026-08-12", "^KS11": 3210, "^KQ11": 805, "005930.KS": 71000, "000660.KS": 201000 },
      ],
    }),
    isForecastSeries: (ticker) => ticker.startsWith("^") || ticker.endsWith(".KS"),
    labelName: (ticker) => ticker === "000660.KS" ? "SK하이닉스" : "삼성전자",
    signalProgress: {
      begin: (_key, label) => {
        progressLabels.push(label);
        return true;
      },
      update: () => {},
      complete: () => {},
      cancel: () => {},
    },
  });

  await runtime.prepareMarketTimingModels(
    ["005930.KS", "000660.KS"],
    [{ series: "005930.KS" }, { series: "000660.KS" }],
  );

  assert.deepEqual(preparedTargets, ["005930.KS", "000660.KS"]);
  assert.equal(progressLabels[0], "삼성전자 외 1종 신호 로딩중");
});

test("defers restored timing preparation until the startup visual boundary", async () => {
  let prepareCount = 0;
  let progressBeginCount = 0;
  const { runtime } = createRuntime({
    shouldPrepareMarketTimingModels: () => false,
    getMarketTimingService: () => ({
      has: () => false,
      stats: () => ({ signature: "", modelCount: 0 }),
      prepare: async () => { prepareCount += 1; },
    }),
    getPricePayload: () => ({
      records: [
        { date: "2026-08-11", "^KS11": 3200, "^KQ11": 800, "005930.KS": 70000 },
        { date: "2026-08-12", "^KS11": 3210, "^KQ11": 805, "005930.KS": 71000 },
      ],
    }),
    signalProgress: {
      begin: () => { progressBeginCount += 1; return true; },
      update: () => {},
      complete: () => {},
      cancel: () => {},
    },
  });

  await runtime.prepareMarketTimingModels(
    ["005930.KS"],
    [{ series: "005930.KS" }],
  );

  assert.equal(prepareCount, 0);
  assert.equal(progressBeginCount, 0);
});
