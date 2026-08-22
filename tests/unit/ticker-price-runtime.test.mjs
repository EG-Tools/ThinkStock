import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/ticker-price-runtime.js");
const runtime = globalThis.ThinkStockTickerPriceRuntime;

test("stores normalized ticker price status and selects the visible ticker", () => {
  const store = runtime.createStatusStore({
    tickerPattern: /^\d{6}\.(KS|KQ)$/,
    now: () => 1234,
  });
  assert.equal(store.set("bad", {}), null);
  const status = store.set("005930.ks", {
    source: "krx",
    latestDate: "2026-08-03T00:00:00Z",
  });
  assert.deepEqual(status, {
    ticker: "005930.KS",
    source: "KRX",
    latestDate: "2026-08-03",
    marketDate: "",
    expectedDate: "",
    cached: false,
    localCache: false,
    stale: false,
    crossCheck: "",
    warning: "",
    checkedAt: 1234,
  });
  assert.equal(store.visible(["005930.KS"], "005930.KS"), status);
});

test("merges, reads and clears a ticker series without changing other prices", () => {
  const payload = {
    records: [
      { date: "2026-08-01", "^KS11": 4100 },
      { date: "2026-08-03", "^KS11": 4200 },
    ],
    series: ["^KS11"],
    display_names: {},
  };
  runtime.mergeSeries(payload, "005930.ks", [
    { date: "2026-08-02", close: 70000 },
    { date: "2026-08-03", close: 71000 },
    { date: "2026-08-04", close: 0 },
  ], "Samsung");
  assert.equal(runtime.latestSeriesDate(payload, "005930.KS", (value) => value ?? null), "2026-08-03");
  assert.deepEqual(runtime.seriesPoints(payload, "005930.KS"), [
    { date: "2026-08-01", close: undefined },
    { date: "2026-08-02", close: 70000 },
    { date: "2026-08-03", close: 71000 },
  ]);
  runtime.clearSeries(payload, "005930.KS");
  assert.equal(payload.records[2]["^KS11"], 4200);
  assert.equal("005930.KS" in payload.records[2], false);
  assert.deepEqual(payload.series, ["^KS11"]);
});

test("rejects a restored price snapshot with a stale corporate-action boundary", () => {
  const stale = runtime.inspectPricePayloadIntegrity({
    series: ["^KS11", "183300.KQ"],
    records: [
      { date: "2026-07-28", "^KS11": 4100, "183300.KQ": 109000 },
      { date: "2026-08-20", "^KS11": 4200, "183300.KQ": 138500 },
      { date: "2026-08-21", "^KS11": 4210, "183300.KQ": 27700 },
    ],
  });
  assert.equal(stale.clean, false);
  assert.equal(stale.ticker, "183300.KQ");
  assert.equal(stale.firstDate, "2026-08-21");

  const adjusted = runtime.inspectPricePayloadIntegrity({
    series: ["183300.KQ"],
    records: [
      { date: "2026-07-28", "183300.KQ": 21800 },
      { date: "2026-08-21", "183300.KQ": 27700 },
    ],
  });
  assert.equal(adjusted.clean, true);
});

test("inspects Korean ticker columns even when a stale snapshot omitted them from series", () => {
  const result = runtime.inspectPricePayloadIntegrity({
    series: ["^KS11"],
    records: [
      { date: "2026-07-28", "183300.KQ": 21800 },
      { date: "2026-08-20", "183300.KQ": 54400 },
      { date: "2026-08-21", "183300.KQ": 27700 },
    ],
  });
  assert.equal(result.clean, false);
  assert.equal(result.ticker, "183300.KQ");
});

test("does not mistake a sparse multi-year history for a corporate action", () => {
  const result = runtime.inspectPricePayloadIntegrity({
    series: ["000001.KS"],
    records: [
      { date: "2003-01-02", "000001.KS": 5000 },
      { date: "2026-08-10", "000001.KS": 13000 },
    ],
  });
  assert.equal(result.clean, true);
});

test("drops a stale latest-price row that predates complete adjusted history", () => {
  assert.deepEqual(runtime.filterLatestTailPoints([
    { date: "2026-07-28", close: 21800 },
    { date: "2026-08-21", close: 27700 },
  ], [
    { date: "2026-08-20", close: 54400 },
  ]), []);
  assert.deepEqual(runtime.filterLatestTailPoints([
    { date: "2026-08-20", close: 27000 },
  ], [
    { date: "2026-08-21", close: 27700 },
  ]), [
    { date: "2026-08-21", close: 27700 },
  ]);
});

test("uses a recent market confirmation before benchmark freshness", () => {
  assert.equal(runtime.isCacheFresh({
    latestDate: "2026-08-01",
    expectedDate: "2026-08-03",
    benchmarkDate: "2026-08-03",
    status: { stale: false, expectedDate: "2026-08-03", checkedAt: 900 },
    nowMs: 1000,
    maxAgeMs: 200,
  }), true);
  assert.equal(runtime.isCacheFresh({
    latestDate: "2026-08-01",
    expectedDate: "2026-08-03",
    benchmarkDate: "2026-08-03",
    status: { stale: true, expectedDate: "2026-08-03", checkedAt: 900 },
    nowMs: 1000,
    maxAgeMs: 200,
  }), false);
});

test("backfills partial or legacy five-year caches before using incremental updates", () => {
  const base = {
    hasExisting: true,
    hasVolumeHistory: true,
    latestDate: "2026-08-12",
  };
  assert.equal(runtime.resolveHistoryFetchSinceDate({
    ...base,
    historyCoverage: runtime.HISTORY_COVERAGE_PARTIAL,
  }), "");
  assert.equal(runtime.resolveHistoryFetchSinceDate(base), "");
  assert.equal(runtime.resolveHistoryFetchSinceDate({
    ...base,
    historyCoverage: runtime.HISTORY_COVERAGE_FULL,
  }), "2026-08-12");
});

test("touches ticker cache metadata at most once per interval", () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(runtime.shouldTouchCacheRecord(undefined, day, day), true);
  assert.equal(runtime.shouldTouchCacheRecord(day, day + 1000, day), false);
  assert.equal(runtime.shouldTouchCacheRecord(day, day * 2, day), true);
  assert.equal(runtime.shouldTouchCacheRecord(day * 2, day, day), true);
});

test("payload controller owns price, volume and invalidation mutations", () => {
  let payload = { records: [{ date: "2026-08-12", "^KS11": 4200 }], series: ["^KS11"] };
  const volumes = new Map();
  const changes = [];
  const cleared = [];
  const controller = runtime.createPayloadController({
    getPayload: () => payload,
    setPayload: (value) => { payload = value; },
    volumesByTicker: volumes,
    toNumber: (value) => value == null ? null : Number(value),
    normalizePoints: (points) => points.filter((point) => Number.isFinite(point.close)),
    sameNumber: (left, right) => left === right,
    displayName: () => "삼성전자",
    onChanged: (ticker) => changes.push(ticker),
    onClear: (ticker) => cleared.push(ticker),
  });

  assert.equal(controller.merge("005930.ks", [
    { date: "2026-08-12", close: 70000, volume: 1234 },
  ]), true);
  assert.deepEqual(controller.points("005930.KS"), [
    { date: "2026-08-12", close: 70000, volume: 1234 },
  ]);
  assert.equal(controller.hasVolumeHistory("005930.KS", 1), true);
  assert.equal(controller.clear("005930.KS"), true);
  assert.deepEqual(changes, ["005930.KS", "005930.KS"]);
  assert.deepEqual(cleared, ["005930.KS"]);
  assert.equal(volumes.has("005930.KS"), false);
});

test("replaces a complete ticker history instead of retaining orphaned cached dates", () => {
  let payload = {
    records: [
      { date: "2017-05-01", "207940.KS": 999999 },
      { date: "2017-05-02", "207940.KS": 272328 },
    ],
    series: ["207940.KS"],
    display_names: {},
  };
  const controller = runtime.createPayloadController({
    getPayload: () => payload,
    setPayload: (value) => { payload = value; },
    toNumber: (value) => value == null ? null : Number(value),
    normalizePoints: (points) => points.filter((point) => Number.isFinite(point.close)),
    sameNumber: (left, right) => left === right,
  });

  controller.merge("207940.KS", [
    { date: "2017-05-02", close: 272328, volume: 89745 },
    { date: "2017-06-01", close: 348397, volume: 300468 },
  ], { replace: true });

  assert.deepEqual(controller.points("207940.KS"), [
    { date: "2017-05-02", close: 272328, volume: 89745 },
    { date: "2017-06-01", close: 348397, volume: 300468 },
  ]);
});

test("does not replace a healthy cache with a severely truncated full-history response", () => {
  const existing = Array.from({ length: 300 }, (_, index) => ({ date: `old-${index}`, close: index + 1 }));
  const complete = Array.from({ length: 280 }, (_, index) => ({ date: `new-${index}`, close: index + 1 }));
  assert.equal(runtime.shouldReplaceFullHistory(existing, complete), true);
  assert.equal(runtime.shouldReplaceFullHistory(existing, complete.slice(0, 2)), false);
  assert.equal(runtime.shouldReplaceFullHistory([], complete.slice(0, 2)), true);
});

test("converts validated price cache records into research history", () => {
  const rows = Array.from({ length: 252 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 100 + index,
  }));
  const normalize = (values) => Array.isArray(values) ? values : [];
  const history = runtime.priceCacheToResearchHistory({
    schema: 4,
    ticker: "005930.ks",
    savedAt: 10,
    status: { source: "KRX" },
    points: rows,
  }, "005930.KS", normalize, { priceSchema: 4, now: () => 20 });
  assert.equal(history.ticker, "005930.KS");
  assert.equal(history.source, "KRX");
  assert.equal(history.rows.length, 252);
  assert.equal(runtime.normalizeResearchHistoryCache(history, "005930.KS", normalize)?.rows.length, 252);
  assert.equal(runtime.priceCacheToResearchHistory({ ...history, schema: 3 }, "005930.KS", normalize, {
    priceSchema: 4,
  }), null);
});

test("rejects corporate-action contamination in both shared price caches", () => {
  const rows = Array.from({ length: 252 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 20000 + index,
  }));
  rows.push(
    { date: "2026-08-20", close: 54400 },
    { date: "2026-08-21", close: 27700 },
  );
  const normalize = (values) => Array.isArray(values) ? values : [];
  assert.equal(runtime.normalizeResearchHistoryCache({
    schema: 1,
    ticker: "183300.KQ",
    rows,
  }, "183300.KQ", normalize), null);
  assert.equal(runtime.priceCacheToResearchHistory({
    schema: 6,
    ticker: "183300.KQ",
    points: rows,
  }, "183300.KQ", normalize, { priceSchema: 6 }), null);
});

test("series loader never inserts an older latest-price row into a complete cache", async () => {
  const calls = [];
  const points = [
    { date: "2026-07-28", close: 21800, volume: 516832 },
    { date: "2026-08-21", close: 27700, volume: 1595930 },
  ];
  const loader = runtime.createSeriesLoader({
    applySharedCache: async () => ({
      applied: true,
      latestDate: "2026-08-21",
      historyCoverage: runtime.HISTORY_COVERAGE_FULL,
    }),
    assessPriceUpdate: () => ({ invalidateDerived: false, fullHistoryRequired: false }),
    clearSeries: () => {},
    fetchHistory: async () => { throw new Error("history should not be fetched"); },
    fetchLatest: async () => [{ date: "2026-08-20", close: 54400 }],
    getPoints: () => points,
    hasSeries: () => true,
    hasVolumeHistory: () => true,
    invalidateCache: async () => {},
    isCacheFresh: () => true,
    latestDate: () => "2026-08-21",
    mergePoints: () => calls.push("merge"),
    normalizePoints: (values) => values,
    setStatus: () => {},
    writeCache: async () => calls.push("write"),
  });

  const result = await loader.load("183300.KQ");
  assert.equal(result.cached, true);
  assert.deepEqual(calls, []);
});

test("uses a newer research session but keeps the price basis on equal dates", () => {
  const priceHistory = {
    latestDate: "2026-08-20",
    source: "KRX",
    rows: [{ date: "2026-08-20", close: 25050 }],
  };
  const newerResearch = {
    latestDate: "2026-08-21",
    source: "NAVER_LIVE",
    rows: [{ date: "2026-08-21", close: 25800 }],
  };
  assert.equal(
    runtime.selectPreferredResearchHistory(priceHistory, newerResearch),
    newerResearch,
  );
  const sameDatePrice = { ...priceHistory, latestDate: "2026-08-21" };
  assert.equal(
    runtime.selectPreferredResearchHistory(sameDatePrice, newerResearch),
    sameDatePrice,
  );
});

test("does not replace complete price history with a short newer scanner history", () => {
  const priceHistory = {
    latestDate: "2026-08-20",
    historyCoverage: "full",
    rows: Array.from({ length: 500 }, (_, index) => ({
      date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
      close: 10000 + index,
    })),
  };
  const scannerHistory = {
    latestDate: "2026-08-21",
    historyCoverage: "partial",
    rows: Array.from({ length: 252 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      close: 12000 + index,
    })),
  };

  assert.equal(
    runtime.selectPreferredResearchHistory(priceHistory, scannerHistory),
    priceHistory,
  );
});

test("repairs a same-day price cache that retained a pre-split boundary", () => {
  const stalePrice = {
    latestDate: "2026-08-21",
    source: "LOCAL_CACHE",
    rows: [
      { date: "2026-07-28", close: 54400 },
      { date: "2026-08-20", close: 69200 },
      { date: "2026-08-21", close: 27700 },
    ],
  };
  const adjustedResearch = {
    latestDate: "2026-08-21",
    source: "NAVER_FULL_HISTORY",
    rows: [
      { date: "2026-07-28", close: 21800 },
      { date: "2026-08-21", close: 27700 },
    ],
  };

  assert.equal(
    runtime.selectPreferredResearchHistory(stalePrice, adjustedResearch),
    adjustedResearch,
  );
});

test("repairs an older split boundary after newer post-split sessions were cached", () => {
  const stalePrice = {
    latestDate: "2026-08-28",
    rows: [
      { date: "2026-07-28", close: 109000 },
      { date: "2026-08-20", close: 138500 },
      { date: "2026-08-21", close: 27700 },
      { date: "2026-08-24", close: 28200 },
      { date: "2026-08-28", close: 29000 },
    ],
  };
  const adjustedResearch = {
    latestDate: "2026-08-28",
    rows: [
      { date: "2026-07-28", close: 21800 },
      { date: "2026-08-21", close: 27700 },
      { date: "2026-08-24", close: 28200 },
      { date: "2026-08-28", close: 29000 },
    ],
  };

  assert.equal(runtime.inspectPriceHistoryIntegrity(stalePrice).anomalyCount, 1);
  assert.equal(runtime.inspectPriceHistoryIntegrity(adjustedResearch).anomalyCount, 0);
  assert.equal(
    runtime.selectPreferredResearchHistory(stalePrice, adjustedResearch),
    adjustedResearch,
  );
});

test("payload replacement removes stale dates from an earlier price basis", () => {
  let payload = {
    records: [
      { date: "2026-07-28", "183300.KQ": 54400 },
      { date: "2026-08-20", "183300.KQ": 69200 },
    ],
    series: ["183300.KQ"],
    display_names: { "183300.KQ": "코미코" },
  };
  const controller = runtime.createPayloadController({
    getPayload: () => payload,
    setPayload: (value) => { payload = value; },
    normalizePoints: (points) => points.filter((point) => (
      /^\d{4}-\d{2}-\d{2}$/.test(String(point?.date || ""))
      && Number.isFinite(Number(point?.close))
      && Number(point.close) > 0
    )).map((point) => ({ date: point.date, close: Number(point.close) })),
    toNumber: (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    },
  });

  controller.merge("183300.KQ", [
    { date: "2026-07-28", close: 21800 },
    { date: "2026-08-21", close: 27700 },
  ], { replace: true });

  assert.deepEqual(controller.points("183300.KQ"), [
    { date: "2026-07-28", close: 21800 },
    { date: "2026-08-21", close: 27700 },
  ]);
  assert.equal(payload.records.find((row) => row.date === "2026-08-20")?.["183300.KQ"], undefined);
});

test("series loader reuses a complete fresh cache after one latest-point check", async () => {
  const calls = [];
  const loader = runtime.createSeriesLoader({
    applySharedCache: async () => ({
      applied: true,
      latestDate: "2026-08-20",
      historyCoverage: runtime.HISTORY_COVERAGE_FULL,
    }),
    assessPriceUpdate: () => ({ invalidateDerived: false, fullHistoryRequired: false }),
    clearSeries: () => {},
    fetchHistory: async () => { throw new Error("history should not be fetched"); },
    fetchLatest: async () => {
      calls.push("latest");
      return [{ date: "2026-08-20", close: 71000 }];
    },
    getPoints: () => [{ date: "2026-08-20", close: 71000, volume: 100 }],
    hasSeries: () => true,
    hasVolumeHistory: () => true,
    invalidateCache: async () => {},
    isCacheFresh: () => true,
    latestDate: () => "2026-08-20",
    mergePoints: () => calls.push("merge"),
    normalizePoints: (points) => points,
    setStatus: () => {},
    writeCache: async () => calls.push("write"),
  });

  assert.deepEqual(await loader.load("005930.ks"), {
    ready: true,
    cached: true,
    deferredRefresh: false,
    latestDate: "2026-08-20",
  });
  assert.deepEqual(calls, ["latest", "merge", "write"]);
});

test("series loader invalidates derived caches before merging revised history", async () => {
  const calls = [];
  const history = [{ date: "2026-08-20", close: 70000, volume: 100 }];
  const loader = runtime.createSeriesLoader({
    applySharedCache: async () => ({ applied: true, historyCoverage: runtime.HISTORY_COVERAGE_FULL }),
    assessPriceUpdate: () => ({ invalidateDerived: true, fullHistoryRequired: false }),
    clearSeries: () => {},
    fetchHistory: async () => history,
    fetchLatest: async () => [],
    findRebaseSignal: () => null,
    getPoints: () => history,
    hasSeries: () => true,
    hasVolumeHistory: () => true,
    invalidateCache: async () => calls.push("invalidate"),
    isCacheFresh: () => false,
    latestDate: () => "2026-08-20",
    mergePoints: () => calls.push("merge"),
    normalizePoints: (points) => points,
    setStatus: () => {},
    writeCache: async () => calls.push("write"),
  });

  const result = await loader.load("005930.KS", { forceRefresh: true });
  assert.equal(result.cached, false);
  assert.deepEqual(calls, ["invalidate", "merge", "write"]);
});

test("series loader restores full adjusted history before accepting a corporate-action boundary", async () => {
  const calls = [];
  let currentPoints = [
    { date: "2026-07-28", close: 54400, volume: 100 },
  ];
  const adjustedHistory = [
    { date: "2026-07-27", close: 25446, volume: 120 },
    { date: "2026-07-28", close: 21800, volume: 100 },
    { date: "2026-08-21", close: 27700, volume: 140 },
  ];
  const loader = runtime.createSeriesLoader({
    applySharedCache: async () => ({
      applied: true,
      latestDate: "2026-07-28",
      historyCoverage: runtime.HISTORY_COVERAGE_FULL,
    }),
    assessPriceUpdate: (_existing, _incoming, { rebaseSignal }) => rebaseSignal
      ? {
        invalidateDerived: true,
        invalidatePrice: true,
        fullHistoryRequired: true,
        reason: "corporate-action-boundary",
      }
      : { invalidateDerived: false, fullHistoryRequired: false },
    clearSeries: () => {
      calls.push("clear");
      currentPoints = [];
    },
    fetchHistory: async (_ticker, options) => {
      calls.push(`history:${options.sinceDate || "full"}`);
      return adjustedHistory;
    },
    fetchLatest: async () => {
      calls.push("latest");
      return [{ date: "2026-08-21", close: 27700, volume: 140 }];
    },
    findRebaseSignal: () => ({ type: "boundary", ratio: 54400 / 27700 }),
    getPoints: () => currentPoints,
    hasSeries: () => currentPoints.length > 0,
    hasVolumeHistory: () => currentPoints.some((point) => point.volume > 0),
    invalidateCache: async () => calls.push("invalidate"),
    isCacheFresh: () => true,
    latestDate: () => currentPoints.at(-1)?.date || "",
    mergePoints: (_ticker, points, options = {}) => {
      calls.push(`merge:${options.replace === true ? "replace" : "append"}`);
      currentPoints = options.replace === true ? [...points] : [...currentPoints, ...points];
    },
    normalizePoints: (points) => points,
    setStatus: () => {},
    writeCache: async () => calls.push("write"),
  });

  const result = await loader.load("183300.KQ");
  assert.equal(result.cached, false);
  assert.deepEqual(currentPoints, adjustedHistory);
  assert.deepEqual(calls, [
    "latest",
    "history:full",
    "invalidate",
    "clear",
    "merge:replace",
    "write",
  ]);
});

test("series loader repairs a corporate-action boundary already buried inside cache history", async () => {
  const calls = [];
  let currentPoints = [
    { date: "2026-07-28", close: 109000, volume: 100 },
    { date: "2026-08-20", close: 138500, volume: 100 },
    { date: "2026-08-21", close: 27700, volume: 140 },
    { date: "2026-08-24", close: 28200, volume: 130 },
  ];
  const adjustedHistory = [
    { date: "2026-07-28", close: 21800, volume: 100 },
    { date: "2026-08-21", close: 27700, volume: 140 },
    { date: "2026-08-24", close: 28200, volume: 130 },
  ];
  const loader = runtime.createSeriesLoader({
    applySharedCache: async () => ({
      applied: true,
      latestDate: "2026-08-24",
      historyCoverage: runtime.HISTORY_COVERAGE_FULL,
    }),
    assessPriceUpdate: (_existing, _incoming, { rebaseSignal }) => rebaseSignal
      ? { invalidateDerived: true, fullHistoryRequired: true }
      : { invalidateDerived: false, fullHistoryRequired: false },
    clearSeries: () => {
      calls.push("clear");
      currentPoints = [];
    },
    fetchHistory: async (_ticker, options) => {
      calls.push(`history:${options.sinceDate || "full"}`);
      return adjustedHistory;
    },
    fetchLatest: async () => {
      calls.push("latest");
      return [{ date: "2026-08-24", close: 28200, volume: 130 }];
    },
    getPoints: () => currentPoints,
    hasSeries: () => currentPoints.length > 0,
    hasVolumeHistory: () => true,
    inspectHistoryIntegrity: runtime.inspectPriceHistoryIntegrity,
    invalidateCache: async () => calls.push("invalidate"),
    isCacheFresh: () => true,
    latestDate: () => currentPoints.at(-1)?.date || "",
    mergePoints: (_ticker, points, options = {}) => {
      calls.push(`merge:${options.replace === true ? "replace" : "append"}`);
      currentPoints = options.replace === true ? [...points] : [...currentPoints, ...points];
    },
    normalizePoints: (points) => points,
    setStatus: () => {},
    writeCache: async () => calls.push("write"),
  });

  const result = await loader.load("183300.KQ");
  assert.equal(result.cached, false);
  assert.deepEqual(currentPoints, adjustedHistory);
  assert.deepEqual(calls, [
    "history:full",
    "invalidate",
    "clear",
    "merge:replace",
    "write",
  ]);
});

test("series loader preserves a complete cache when adjusted history is truncated", async () => {
  const calls = [];
  const originalPoints = Array.from({ length: 300 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 50000 + index,
    volume: 100,
  }));
  let currentPoints = [...originalPoints];
  const loader = runtime.createSeriesLoader({
    applySharedCache: async () => ({
      applied: true,
      latestDate: originalPoints.at(-1).date,
      historyCoverage: runtime.HISTORY_COVERAGE_FULL,
    }),
    assessPriceUpdate: (_existing, _incoming, { rebaseSignal }) => rebaseSignal
      ? { invalidateDerived: true, fullHistoryRequired: true }
      : { invalidateDerived: false, fullHistoryRequired: false },
    clearSeries: () => {
      calls.push("clear");
      currentPoints = [];
    },
    fetchHistory: async () => {
      calls.push("history");
      return [{ date: "2026-08-21", close: 27700, volume: 100 }];
    },
    fetchLatest: async () => [{ date: "2026-08-21", close: 27700, volume: 100 }],
    findRebaseSignal: () => ({ type: "boundary", ratio: 2 }),
    getPoints: () => currentPoints,
    getStatus: () => ({ source: "LOCAL_CACHE" }),
    hasSeries: () => currentPoints.length > 0,
    hasVolumeHistory: () => true,
    invalidateCache: async () => calls.push("invalidate"),
    isCacheFresh: () => true,
    latestDate: () => currentPoints.at(-1)?.date || "",
    mergePoints: () => calls.push("merge"),
    normalizePoints: (points) => points,
    setStatus: () => calls.push("stale"),
    writeCache: async () => calls.push("write"),
  });

  const result = await loader.load("183300.KQ");
  assert.equal(result.cached, true);
  assert.equal(result.stale, true);
  assert.deepEqual(currentPoints, originalPoints);
  assert.deepEqual(calls, ["history", "stale"]);
});
