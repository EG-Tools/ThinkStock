(function initThinkStockAppStateController(globalScope) {
  "use strict";

  function sanitizeCustomStocks(raw, maxStocks = 20) {
    if (!Array.isArray(raw)) return [];
    const output = [];
    const seen = new Set();
    raw.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const ticker = String(item.ticker || "").trim().toUpperCase();
      const name = String(item.name || "").trim();
      const code = String(item.code || "").trim();
      const market = String(item.market || "").trim().toUpperCase();
      if (!/^[0-9]{6}\.(KS|KQ)$/.test(ticker) || !name || seen.has(ticker)) return;
      seen.add(ticker);
      output.push({ ticker, name, code, market });
    });
    return output.slice(0, Math.max(1, Number(maxStocks) || 20));
  }

  function migrateAuxiliaryVisibility(state, persisted, config) {
    if (Array.isArray(persisted.hiddenAuxiliaryPanels)) {
      state.hiddenAuxiliaryPanels = new Set(
        persisted.hiddenAuxiliaryPanels.filter((key) => config.panelKeys.includes(key)),
      );
      return;
    }
    if (!Array.isArray(persisted.hiddenAuxiliarySeries)) return;
    const groupedPanels = [
      ["adr", [config.seriesKeys.adrKospi, config.seriesKeys.adrKosdaq]],
      ["vkospi", [config.seriesKeys.vkospi, config.seriesKeys.vix]],
    ];
    groupedPanels.forEach(([panelKey, seriesKeys]) => {
      if (!seriesKeys.every((key) => state.hiddenAuxiliarySeries.has(key))) return;
      state.hiddenAuxiliaryPanels.add(panelKey);
      seriesKeys.forEach((key) => state.hiddenAuxiliarySeries.delete(key));
    });
    [
      ["fearGreed", config.seriesKeys.fearGreed],
      ["newsSentiment", config.seriesKeys.newsSentiment],
    ].forEach(([panelKey, seriesKey]) => {
      if (!state.hiddenAuxiliarySeries.has(seriesKey)) return;
      state.hiddenAuxiliaryPanels.add(panelKey);
      state.hiddenAuxiliarySeries.delete(seriesKey);
    });
  }

  function createAppStateController(options = {}) {
    const state = options.state;
    const store = options.store;
    if (!state || !store) throw new Error("app state controller dependencies are incomplete");
    const panelKeys = [...(options.panelKeys || [])];
    const seriesKeys = options.seriesKeys || {};
    const normalizeCursorLineMode = options.normalizeCursorLineMode || ((value) => value);
    const normalizeNewsMovingAverageDays = options.normalizeNewsMovingAverageDays || ((value) => value);

    function save() {
      try {
        store.write({
          activeMonths: state.activeMonths,
          hiddenSeries: [...state.hiddenSeries],
          hiddenAuxiliarySeries: [...state.hiddenAuxiliarySeries],
          hiddenAuxiliaryPanels: [...state.hiddenAuxiliaryPanels],
          auxiliaryPanelOrder: [...state.auxiliaryPanelOrder],
          customStocks: options.getCustomStocks?.() || [],
          seriesOffsets: state.seriesOffsets,
          seriesScales: state.seriesScales,
          creditOffset: -Math.abs(Number(options.getCreditOffset?.()) || 0),
          hoverShowPopup: state.hoverShowPopup,
          cursorLineMode: state.cursorLineMode,
          newsSentimentMovingAverageDays: state.newsSentimentMovingAverageDays,
          showDisclosures: state.showDisclosures,
          showInsiderTrades: state.showInsiderTrades,
          showCoMovement: state.showCoMovement,
          showChartTools: state.showChartTools,
          showChartHandles: state.showChartHandles,
          showRecessionSignals: state.showRecessionSignals,
          autoChartReset: state.autoChartReset,
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    function load(loadOptions = {}) {
      state.showAiForecast = false;
      try {
        const persisted = store.read(null);
        if (!persisted) return false;
        if (loadOptions.allowActiveMonths && typeof persisted.activeMonths === "number") {
          state.activeMonths = persisted.activeMonths;
        }
        if (Array.isArray(persisted.hiddenSeries)) state.hiddenSeries = new Set(persisted.hiddenSeries);
        if (Array.isArray(persisted.hiddenAuxiliarySeries)) {
          state.hiddenAuxiliarySeries = new Set(persisted.hiddenAuxiliarySeries);
        }
        migrateAuxiliaryVisibility(state, persisted, { panelKeys, seriesKeys });
        if (Array.isArray(persisted.auxiliaryPanelOrder)) {
          state.auxiliaryPanelOrder = [
            ...new Set([...persisted.auxiliaryPanelOrder, ...panelKeys]),
          ].filter((key) => panelKeys.includes(key));
        }
        if (typeof persisted.autoChartReset === "boolean") state.autoChartReset = persisted.autoChartReset;
        if (!state.autoChartReset) {
          if (persisted.seriesOffsets && typeof persisted.seriesOffsets === "object") {
            state.seriesOffsets = persisted.seriesOffsets;
          }
          if (persisted.seriesScales && typeof persisted.seriesScales === "object") {
            state.seriesScales = persisted.seriesScales;
          }
        }
        if (typeof persisted.creditOffset === "number") {
          options.setCreditOffset?.(Math.abs(persisted.creditOffset));
        }
        if (typeof persisted.hoverShowPopup === "boolean") state.hoverShowPopup = persisted.hoverShowPopup;
        state.cursorLineMode = normalizeCursorLineMode(persisted.cursorLineMode);
        state.newsSentimentMovingAverageDays = normalizeNewsMovingAverageDays(
          persisted.newsSentimentMovingAverageDays,
        );
        [
          "showDisclosures",
          "showInsiderTrades",
          "showCoMovement",
          "showChartTools",
          "showChartHandles",
          "showRecessionSignals",
        ].forEach((key) => {
          if (typeof persisted[key] === "boolean") state[key] = persisted[key];
        });
        if (Array.isArray(persisted.customStocks)) {
          options.setCustomStocks?.(sanitizeCustomStocks(persisted.customStocks, options.maxCustomStocks));
        }
        options.applyCustomStockDisplayNames?.();
        return true;
      } catch (_) {
        return false;
      }
    }

    return Object.freeze({ load, save });
  }

  globalScope.ThinkStockAppStateController = Object.freeze({
    createAppStateController,
    migrateAuxiliaryVisibility,
    sanitizeCustomStocks,
  });
}(typeof self !== "undefined" ? self : globalThis));
