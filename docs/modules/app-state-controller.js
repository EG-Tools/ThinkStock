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

  function colorHue(value) {
    const color = normalizeHexColor(value);
    if (!color) return null;
    const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels;
    const maximum = Math.max(...channels);
    const minimum = Math.min(...channels);
    const delta = maximum - minimum;
    if (delta < 0.04) return null;
    let sector = 0;
    if (maximum === red) sector = ((green - blue) / delta) % 6;
    else if (maximum === green) sector = ((blue - red) / delta) + 2;
    else sector = ((red - green) / delta) + 4;
    return ((sector * 60) + 360) % 360;
  }

  function hueDistance(first, second) {
    const left = colorHue(first);
    const right = colorHue(second);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 180;
    const distance = Math.abs(left - right);
    return Math.min(distance, 360 - distance);
  }

  function assignCustomStockColors(rawStocks, options = {}) {
    if (!Array.isArray(rawStocks)) return [];
    const reserved = [...new Set((options.reservedColors || []).map(normalizeHexColor).filter(Boolean))];
    const minimumDistance = Math.max(0, Number(options.minimumDistance) || 0);
    const minimumHueDistance = Math.max(0, Number(options.minimumHueDistance) || 0);
    const isSafeFromReserved = (color) => reserved.every((fixedColor) => (
      colorDistance(color, fixedColor) >= minimumDistance
      && hueDistance(color, fixedColor) >= minimumHueDistance
    ));
    const palette = [...new Set((options.palette || []).map(normalizeHexColor).filter(Boolean))]
      .filter((color) => (
        !reserved.includes(color)
        && isSafeFromReserved(color)
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
        && isSafeFromReserved(existing);
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

  function createCustomStockLifecycle(options = {}) {
    const maxStocks = Math.max(1, Number(options.maxStocks) || 20);
    const maxRemovedColors = Math.max(1, Number(options.maxRemovedColors) || 100);
    const assignColors = typeof options.assignColors === "function"
      ? options.assignColors
      : (stocks) => stocks.map((stock) => ({ ...stock }));
    const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
    const loading = new Set();
    const removedColors = new Map();
    let stocks = [];

    function publish(nextStocks, publishOptions = {}) {
      const sanitized = sanitizeCustomStocks(nextStocks, maxStocks);
      stocks = publishOptions.colorize === false
        ? sanitized
        : sanitizeCustomStocks(assignColors(sanitized, { removedColors }), maxStocks);
      onChange(stocks.map((stock) => ({ ...stock })));
      return stocks;
    }

    function normalizeCandidate(candidate) {
      return sanitizeCustomStocks([candidate], 1)[0] || null;
    }

    function beginAdd(candidate) {
      const normalized = normalizeCandidate(candidate);
      if (!normalized) return { ok: false, reason: "invalid", stock: null };
      if (stocks.some((stock) => stock.ticker === normalized.ticker)) {
        return { ok: false, reason: "duplicate", stock: normalized };
      }
      if (stocks.length >= maxStocks) return { ok: false, reason: "limit", stock: normalized };
      if (loading.has(normalized.ticker)) return { ok: false, reason: "loading", stock: normalized };
      loading.add(normalized.ticker);
      return { ok: true, reason: "", stock: normalized };
    }

    function commitAdd(candidate) {
      const normalized = normalizeCandidate(candidate);
      if (!normalized || !loading.has(normalized.ticker)) return null;
      if (stocks.some((stock) => stock.ticker === normalized.ticker) || stocks.length >= maxStocks) {
        loading.delete(normalized.ticker);
        return null;
      }
      publish([...stocks, normalized]);
      return stocks.find((stock) => stock.ticker === normalized.ticker) || null;
    }

    function finishAdd(ticker) {
      loading.delete(String(ticker || "").trim().toUpperCase());
    }

    function rememberRemovedColor(stock) {
      const ticker = String(stock?.ticker || "").trim().toUpperCase();
      const color = normalizeHexColor(stock?.color);
      if (!ticker || !color) return;
      removedColors.delete(ticker);
      removedColors.set(ticker, color);
      while (removedColors.size > maxRemovedColors) {
        removedColors.delete(removedColors.keys().next().value);
      }
    }

    function remove(ticker, removeOptions = {}) {
      const target = String(ticker || "").trim().toUpperCase();
      const removed = stocks.find((stock) => stock.ticker === target) || null;
      if (!removed) return null;
      if (removeOptions.rememberColor !== false) rememberRemovedColor(removed);
      loading.delete(target);
      publish(stocks.filter((stock) => stock.ticker !== target), { colorize: false });
      return removed;
    }

    function removeMany(tickers, removeOptions = {}) {
      const targets = new Set((tickers || []).map((ticker) => String(ticker || "").trim().toUpperCase()));
      if (!targets.size) return [];
      const removed = stocks.filter((stock) => targets.has(stock.ticker));
      if (!removed.length) return [];
      if (removeOptions.rememberColor !== false) removed.forEach(rememberRemovedColor);
      targets.forEach((ticker) => loading.delete(ticker));
      publish(stocks.filter((stock) => !targets.has(stock.ticker)), { colorize: false });
      return removed;
    }

    function select(scope = "all", isHidden = () => false) {
      const mode = ["visible", "hidden"].includes(scope) ? scope : "all";
      return stocks.filter((stock) => {
        const hidden = Boolean(isHidden(stock.ticker));
        return mode === "all" || (mode === "visible" ? !hidden : hidden);
      });
    }

    publish(options.initialStocks || []);
    return Object.freeze({
      beginAdd,
      commitAdd,
      find: (ticker) => stocks.find((stock) => stock.ticker === String(ticker || "").trim().toUpperCase()) || null,
      finishAdd,
      get: () => stocks,
      has: (ticker) => stocks.some((stock) => stock.ticker === String(ticker || "").trim().toUpperCase()),
      isLoading: (ticker) => loading.has(String(ticker || "").trim().toUpperCase()),
      loadingCount: () => loading.size,
      remove,
      removeMany,
      replace: (nextStocks) => publish(nextStocks),
      select,
    });
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
    const normalizeChartRightPaddingDays = options.normalizeChartRightPaddingDays || ((value) => (
      Math.max(0, Math.min(30, Math.round(Number(value) || 0)))
    ));

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
          chartRightPaddingDays: state.chartRightPaddingDays,
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
        state.chartRightPaddingDays = normalizeChartRightPaddingDays(persisted.chartRightPaddingDays);
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
    createCustomStockLifecycle,
    migrateAuxiliaryVisibility,
    normalizeHexColor,
    sanitizeCustomStocks,
  });
}(typeof self !== "undefined" ? self : globalThis));
