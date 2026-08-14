import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/app-state-controller.js");
const module = globalThis.ThinkStockAppStateController;


function state() {
  return {
    activeMonths: 6,
    hiddenSeries: new Set(),
    hiddenAuxiliarySeries: new Set(),
    hiddenAuxiliaryPanels: new Set(),
    auxiliaryPanelOrder: ["adr", "fearGreed", "newsSentiment", "vkospi"],
    seriesOffsets: {},
    seriesScales: {},
    hoverShowPopup: true,
    cursorLineMode: "vertical",
    newsSentimentMovingAverageDays: 1,
    showDisclosures: true,
    showInsiderTrades: false,
    showCoMovement: false,
    showChartTools: true,
    showChartHandles: true,
    showRecessionSignals: false,
    showAiForecast: true,
    autoChartReset: true,
  };
}


const seriesKeys = {
  adrKospi: "adr_kospi",
  adrKosdaq: "adr_kosdaq",
  vkospi: "vkospi",
  vix: "vix",
  fearGreed: "fear_greed",
  newsSentiment: "news_sentiment",
};


test("sanitizes and deduplicates persisted custom stocks", () => {
  assert.deepEqual(module.sanitizeCustomStocks([
    { ticker: "005930.ks", name: "삼성전자", code: "005930", market: "kospi" },
    { ticker: "005930.KS", name: "중복" },
    { ticker: "bad", name: "무효" },
  ], 20), [{ ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" }]);
});


test("preserves only safe persisted custom stock colors", () => {
  assert.deepEqual(module.sanitizeCustomStocks([
    { ticker: "005930.KS", name: "Samsung", color: "#D41111" },
    { ticker: "000660.KS", name: "SK Hynix", color: "not-a-color" },
  ]), [
    { ticker: "005930.KS", name: "Samsung", code: "", market: "", color: "#d41111" },
    { ticker: "000660.KS", name: "SK Hynix", code: "", market: "" },
  ]);
});


test("assigns unique random stock colors away from fixed series and the last removed color", () => {
  const options = {
    palette: ["#4ade80", "#d41111", "#2beeee"],
    reservedColors: ["#4ade80"],
    minimumDistance: 85,
    random: () => 0,
  };
  const assigned = module.assignCustomStockColors([
    { ticker: "005930.KS", name: "Samsung" },
    { ticker: "000660.KS", name: "SK Hynix" },
  ], options);

  assert.equal(assigned[0].color, "#d41111");
  assert.equal(assigned[1].color, "#2beeee");
  assert.notEqual(assigned[0].color, options.reservedColors[0]);
  assert.notEqual(assigned[0].color, assigned[1].color);

  const readded = module.assignCustomStockColors([
    { ticker: "005930.KS", name: "Samsung" },
  ], {
    ...options,
    previousColorsByTicker: new Map([["005930.KS", assigned[0].color]]),
  });
  assert.equal(readded[0].color, "#2beeee");
});


test("loads legacy auxiliary visibility and keeps AI disabled at boot", () => {
  const chartState = state();
  let customStocks = [];
  let creditOffset = 2;
  const controller = module.createAppStateController({
    state: chartState,
    store: {
      read: () => ({
        activeMonths: 12,
        hiddenAuxiliarySeries: ["adr_kospi", "adr_kosdaq", "fear_greed"],
        auxiliaryPanelOrder: ["vkospi", "adr"],
        autoChartReset: false,
        seriesOffsets: { A: 3 },
        seriesScales: { A: 1.5 },
        creditOffset: -4,
        cursorLineMode: "cross",
        newsSentimentMovingAverageDays: 5,
        showChartTools: false,
        customStocks: [{ ticker: "005930.KS", name: "삼성전자" }],
      }),
      write: () => {},
    },
    panelKeys: ["adr", "fearGreed", "newsSentiment", "vkospi"],
    seriesKeys,
    normalizeCursorLineMode: (value) => value,
    normalizeNewsMovingAverageDays: (value) => Number(value) || 1,
    getCustomStocks: () => customStocks,
    setCustomStocks: (value) => { customStocks = value; },
    getCreditOffset: () => creditOffset,
    setCreditOffset: (value) => { creditOffset = value; },
  });

  assert.equal(controller.load({ allowActiveMonths: true }), true);
  assert.equal(chartState.activeMonths, 12);
  assert.equal(chartState.showAiForecast, false);
  assert.equal(chartState.showChartTools, false);
  assert.deepEqual([...chartState.hiddenAuxiliaryPanels].sort(), ["adr", "fearGreed"]);
  assert.deepEqual([...chartState.hiddenAuxiliarySeries], []);
  assert.deepEqual(chartState.seriesOffsets, { A: 3 });
  assert.equal(creditOffset, 4);
  assert.equal(customStocks[0].ticker, "005930.KS");
});


test("saves one normalized application state record", () => {
  const chartState = state();
  let saved = null;
  const controller = module.createAppStateController({
    state: chartState,
    store: { read: () => null, write: (value) => { saved = value; } },
    panelKeys: ["adr", "fearGreed", "newsSentiment", "vkospi"],
    seriesKeys,
    getCustomStocks: () => [{ ticker: "005930.KS", name: "삼성전자" }],
    getCreditOffset: () => 2,
  });

  assert.equal(controller.save(), true);
  assert.equal(saved.creditOffset, -2);
  assert.equal(saved.showAiForecast, undefined);
  assert.equal(saved.showChartTools, true);
  assert.deepEqual(saved.customStocks, [{ ticker: "005930.KS", name: "삼성전자" }]);
});
