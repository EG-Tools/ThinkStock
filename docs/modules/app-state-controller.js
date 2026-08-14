(function initThinkStockAppStateController(globalScope) {
  "use strict";

  const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

  function normalizeHexColor(value) {
    const color = String(value || "").trim().toLowerCase();
    return HEX_COLOR_PATTERN.test(color) ? color : "";
  }

  function colorDistance(first, second) {
    const left = normalizeHexColor(first);
    const right = normalizeHexColor(second);
    if (!left || !right) return 0;
    const channel = (color, offset) => Number.parseInt(color.slice(offset, offset + 2), 16);
    return Math.hypot(
      channel(left, 1) - channel(right, 1),
      channel(left, 3) - channel(right, 3),
      channel(left, 5) - channel(right, 5),
    );
  }

  function assignCustomStockColors(rawStocks, options = {}) {
    if (!Array.isArray(rawStocks)) return [];
    const reserved = [...new Set((options.reservedColors || []).map(normalizeHexColor).filter(Boolean))];
    const minimumDistance = Math.max(0, Number(options.minimumDistance) || 0);
    const palette = [...new Set((options.palette || []).map(normalizeHexColor).filter(Boolean))]
      .filter((color) => (
        !reserved.includes(color)
        && reserved.every((fixedColor) => colorDistance(color, fixedColor) >= minimumDistance)
      ));
    if (!palette.length) return rawStocks.map((stock) => ({ ...stock }));

    const previousColors = options.previousColorsByTicker instanceof Map
      ? options.previousColorsByTicker
      : new Map(Object.entries(options.previousColorsByTicker || {}));
    const random = typeof options.random === "function" ? options.random : Math.random;
    const used = new Set();

    return rawStocks.map((stock) => {
      const ticker = String(stock?.ticker || "").trim().toUpperCase();
      const existing = normalizeHexColor(stock?.color);
      const existingIsSafe = existing
        && !used.has(existing)
        && !reserved.includes(existing)
        && reserved.every((fixedColor) => colorDistance(existing, fixedColor) >= minimumDistance);
      if (existingIsSafe) {
        used.add(existing);
        return { ...stock, color: existing };
      }

      const previous = normalizeHexColor(previousColors.get(ticker));
      let candidates = palette.filter((color) => !used.has(color) && color !== previous);
      if (!candidates.length) candidates = palette.filter((color) => color !== previous);
      if (!candidates.length) candidates = palette;
      const randomValue = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
      const color = candidates[Math.floor(randomValue * candidates.length)];
      used.add(color);
      return { ...stock, color };
    });
  }

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
      const color = normalizeHexColor(item.color);
      output.push({ ticker, name, code, market, ...(color ? { color } : {}) });
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
    assignCustomStockColors,
    colorDistance,
    createAppStateController,
    migrateAuxiliaryVisibility,
    normalizeHexColor,
    sanitizeCustomStocks,
  });
}(typeof self !== "undefined" ? self : globalThis));
