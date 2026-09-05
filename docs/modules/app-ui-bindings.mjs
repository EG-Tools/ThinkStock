import { syncControl } from "./control-state-view.mjs";

"use strict";

  function filterStockUniverse(items, keyword, limit = 12) {
    const query = String(keyword || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!query) return [];
    return (Array.isArray(items) ? items : [])
      .flatMap((item) => {
        const name = String(item?.name || "").toLowerCase().replace(/\s+/g, "");
        const code = String(item?.code || "").toLowerCase();
        const ticker = String(item?.ticker || "").toLowerCase();
        let score = -1;
        if (name.startsWith(query)) score = 0;
        else if (name.includes(query)) score = 1;
        else if (code.startsWith(query)) score = 2;
        else if (code.includes(query) || ticker.includes(query)) score = 3;
        return score < 0 ? [] : [{ item, score }];
      })
      .sort((left, right) => (
        left.score - right.score
        || String(left.item?.name || "").localeCompare(String(right.item?.name || ""), "ko")
      ))
      .slice(0, Math.max(1, Number(limit) || 12))
      .map((entry) => entry.item);
  }

  function bindChartRangeControls(options = {}) {
    const rangeButtons = Array.isArray(options.rangeButtons) ? options.rangeButtons : [];
    const selectMonths = (months) => options.selectMonths?.(months, "range-preset") === true;
    rangeButtons.forEach((button) => {
      if (!button) return;
      button.addEventListener("click", () => selectMonths(Number(button.dataset?.months)));
    });
    options.latestButton?.addEventListener("click", () => {
      options.jumpLatest?.("latest-slide");
    });
    return Object.freeze({
      selectMonths,
      jumpLatest: () => options.jumpLatest?.("latest-slide") === true,
    });
  }

  function bindChartToolsToggle(options = {}) {
    const button = options.button;
    const container = options.container;
    const applyState = () => {
      const enabled = Boolean(options.getEnabled?.());
      container?.classList.toggle("tools-hidden", !enabled);
      syncControl(button, {
        active: enabled,
        pressed: enabled,
        title: enabled
          ? "메인차트 도구를 숨깁니다."
          : "메인차트 도구를 표시합니다.",
      });
      options.onApplied?.(enabled);
      return enabled;
    };

    applyState();
    button?.addEventListener("click", () => {
      options.setEnabled?.(!options.getEnabled?.());
      applyState();
      options.saveState?.();
    });
    return Object.freeze({ applyState });
  }

  function bindMainChartToolActions(options = {}) {
    const state = options.state;
    if (!state) throw new Error("main chart tool state is required");

    options.scaleButton?.addEventListener("click", () => {
      options.setAutoScale?.(!state.autoChartReset);
      options.syncScale?.();
      options.saveState?.();
      if (state.autoChartReset) options.requestChartRender?.();
    });

    options.coMovementButton?.addEventListener("click", () => {
      if (!options.canUseCoMovement?.()) return;
      state.showCoMovement = !state.showCoMovement;
      options.saveState?.();
      options.syncCoMovement?.();
      options.renderCoMovement?.();
    });

    options.handlesButton?.addEventListener("click", () => {
      const visibleRange = options.getVisibleRange?.();
      if (Array.isArray(visibleRange) && visibleRange.length === 2) {
        state.pinnedXRange = visibleRange.map((value) => new Date(value).toISOString());
      }
      state.showChartHandles = !state.showChartHandles;
      options.saveState?.();
      Promise.resolve(options.applyHandlesLayout?.())
        .catch((error) => options.onHandlesError?.(error));
    });
  }

  function createMainChartControlView(scope = globalThis, options = {}) {
    const document = scope.document;
    const state = options.state;
    const view = options.controlStateView;
    if (!document || !state || !view) throw new Error("main chart control view dependencies are incomplete");
    const element = (id) => document.getElementById(id);

    function syncScale() {
      return view.syncControl(element("resetHandles"), {
        active: state.autoChartReset,
        pressed: state.autoChartReset,
        title: state.autoChartReset
          ? "차트 변경 시 자동으로 세로 범위를 맞춥니다."
          : "차트 변경 시 현재 화면 비율을 유지합니다.",
      });
    }

    function syncCursorLine() {
      const mode = options.normalizeCursorLineMode?.(state.cursorLineMode) || "vertical";
      const quickButton = element("chartCursorModeBtn");
      if (quickButton) {
        quickButton.dataset.chartCursorMode = mode;
        quickButton.title = `${options.cursorLineLabels?.[mode] || mode} 사용 중. 눌러서 변경`;
        quickButton.setAttribute("aria-label", quickButton.title);
      }
      view.syncChoiceControls(
        document.querySelectorAll(".cursor-line-mode-btn[data-chart-cursor-mode]"),
        mode,
        { readValue: (button) => button.dataset.chartCursorMode },
      );
      return mode;
    }

    function syncNewsMovingAverage() {
      const days = options.normalizeNewsMovingAverageDays?.(state.newsSentimentMovingAverageDays)
        || Number(state.newsSentimentMovingAverageDays)
        || 1;
      const value = element("newsSentimentMovingAverageValue");
      if (value) {
        value.value = String(days);
        value.textContent = String(days);
      }
      const decrease = element("newsSentimentMovingAverageDecrease");
      const increase = element("newsSentimentMovingAverageIncrease");
      if (decrease) decrease.disabled = days <= (Number(options.newsMovingAverageMinDays) || 1);
      if (increase) increase.disabled = days >= (Number(options.newsMovingAverageMaxDays) || 20);
      view.syncChoiceControls(
        document.querySelectorAll("[data-news-sentiment-average-days]"),
        days,
        { readValue: (button) => Number(button.dataset.newsSentimentAverageDays) },
      );
      return days;
    }

    function syncHandles() {
      const result = view.syncControl(element("chartHandlesToggle"), {
        active: state.showChartHandles,
        pressed: state.showChartHandles,
        title: state.showChartHandles
          ? "차트 좌우 조절 핸들을 숨깁니다."
          : "차트 좌우 조절 핸들을 표시합니다.",
      });
      options.applyHandlesContainer?.(document.querySelector(".main-chart-wrap"), state.showChartHandles);
      if (!state.showChartHandles) element("y-handles")?.remove();
      return result;
    }

    function syncSignal() {
      const counts = options.getSignalCounts?.() || {};
      return view.syncControl(element("recessionToggle"), {
        active: state.showRecessionSignals,
        pressed: state.showRecessionSignals,
        title: state.showRecessionSignals
          ? `타이밍 켜짐 · 매수 ${Number(counts.buy) || 0} · 매도 ${Number(counts.sell) || 0} · 침체 ${Number(counts.recession) || 0}`
          : "복합 매수 타이밍과 경기침체 위기신호",
      });
    }

    function syncCoMovement() {
      const targetKey = options.resolveCoMovementTarget?.() || "";
      return view.syncControl(element("coMovementToggle"), {
        active: state.showCoMovement,
        pressed: state.showCoMovement,
        title: state.showCoMovement
          ? (targetKey ? `${options.labelName?.(targetKey) || targetKey} 동행율 켜짐` : "표시 중인 종목이 없습니다.")
          : "마지막 표시 종목 동행율",
      });
    }

    return Object.freeze({
      syncCoMovement,
      syncCursorLine,
      syncHandles,
      syncNewsMovingAverage,
      syncScale,
      syncSignal,
    });
  }

  function bindHoverToggle(options) {
    const button = options.button;
    const applyState = () => {
      const enabled = Boolean(options.getEnabled());
      const hidden = !enabled;
      (options.chartElements || []).forEach((element) => {
        element?.classList.toggle("no-hover-popup", hidden);
      });
      syncControl(button, { active: enabled, pressed: enabled });
    };
    if (!button) return applyState;
    applyState();
    button.addEventListener("click", () => {
      options.setEnabled(!options.getEnabled());
      applyState();
      options.saveState();
      options.requestChartRender();
    });
    return applyState;
  }

  function bindDisclosureToggle(options) {
    const button = options.button;
    if (!button) return;
    options.syncButton(options.markerCount());
    button.addEventListener("click", () => {
      options.setEnabled(!options.getEnabled());
      options.syncButton(options.markerCount());
      if (!options.getEnabled()) {
        options.hidePopover();
        options.onDisabled?.();
      } else {
        Promise.resolve(options.onEnabled?.()).catch((error) => options.onError?.(error));
      }
      options.saveState();
      if (!options.applyFastState()) options.requestChartRender();
    });
  }

  function bindPreparedToggle(options = {}) {
    const button = options.button;
    if (!button || button.dataset?.bound === "1") return false;
    if (button.dataset) button.dataset.bound = "1";
    options.syncButton?.();
    button.onclick = async () => {
      if (options.canToggle && !options.canToggle()) return;
      if (button.getAttribute?.("aria-busy") === "true") return;
      const nextEnabled = !options.getEnabled?.();
      if (nextEnabled && options.canEnable && !options.canEnable()) return;
      const hasAsyncWork = nextEnabled && (
        options.prepare || options.beforeEnable || options.onEnabled
      );
      if (hasAsyncWork) syncControl(button, { busy: true });
      try {
        if (nextEnabled) {
          await options.prepare?.();
          await options.beforeEnable?.();
        }
      } catch (error) {
        if (hasAsyncWork) syncControl(button, { busy: false });
        options.onError?.(error, "prepare");
        return;
      } finally {
        if (hasAsyncWork && !options.onEnabled) syncControl(button, { busy: false });
      }

      options.setEnabled?.(nextEnabled);
      options.syncButton?.();
      options.saveState?.();
      try {
        if (nextEnabled) await options.onEnabled?.();
        else await options.onDisabled?.();
      } catch (error) {
        options.onError?.(error, nextEnabled ? "enable" : "disable");
      } finally {
        if (hasAsyncWork) syncControl(button, { busy: false });
        options.onChanged?.(nextEnabled);
      }
    };
    return true;
  }

  function bindCreditOffsetInput(options) {
    const input = options.input;
    if (!input) return;
    input.value = -options.getOffsetDays();
    input.addEventListener("change", () => {
      const value = parseInt(input.value, 10);
      if (!Number.isFinite(value)) return;
      options.setOffsetDays(Math.abs(value));
      options.saveState();
      options.requestChartRender();
    });
  }

  function bindManualRefresh(options) {
    const button = options.button;
    if (!button) return;
    button.addEventListener("click", async () => {
      if (button.classList.contains("spinning")) return;
      button.classList.add("spinning");
      try {
        if (!options.hasRuntimeDataLoaded()) {
          const restored = await options.loadLastRuntimeSnapshot();
          if (restored) await options.renderChart(false);
          else await options.loadData(true);
        }
        // The active in-memory view is refreshed first. Updating the static
        // service-worker cache afterwards prepares the next boot without
        // reparsing every seed bundle before the user sees current prices.
        await options.refreshRuntimeData({ forceNetwork: true, reconcileViewport: true });
        if (options.hasServiceWorkerController()) {
          await options.requestServiceWorkerDataRefresh();
        }
      } catch (error) {
        options.setMessage(`데이터 갱신 중 오류: ${error.message}`, true);
      } finally {
        button.classList.remove("spinning");
      }
    });
  }

  function bindChartApplicationControls(scope = globalThis, options = {}) {
    const document = scope.document;
    if (!document?.getElementById) throw new Error("chart application controls require a document");
    const element = (id) => document.getElementById(id);
    const bindings = {};

    if (options.range) {
      bindings.range = bindChartRangeControls({
        ...options.range,
        rangeButtons: [
          element("chartRange6Months"),
          element("chartRange1Year"),
          element("chartRange3Years"),
        ],
        latestButton: element("chartJumpLatest"),
      });
    }
    if (typeof options.cycleCursorLineMode === "function") {
      element("chartCursorModeBtn")?.addEventListener("click", options.cycleCursorLineMode);
    }
    if (options.mainTools) {
      bindMainChartToolActions({
        ...options.mainTools,
        scaleButton: element("resetHandles"),
        coMovementButton: element("coMovementToggle"),
        handlesButton: element("chartHandlesToggle"),
      });
    }
    if (options.signal) {
      bindPreparedToggle({ ...options.signal, button: element("recessionToggle") });
    }
    if (options.ai) {
      bindPreparedToggle({ ...options.ai, button: element("aiForecastToggle") });
    }
    if (options.hover) {
      bindings.hover = bindHoverToggle({
        ...options.hover,
        button: element("hoverToggle"),
        chartElements: [element("chart"), element("chart-macd"), element("chart-adr")],
      });
    }
    if (options.disclosure) {
      bindDisclosureToggle({ ...options.disclosure, button: element("disclosureToggle") });
    }
    if (options.eps) {
      bindPreparedToggle({ ...options.eps, button: element("epsToggle") });
    }
    if (options.insider) {
      bindPreparedToggle({ ...options.insider, button: element("insiderTradeToggle") });
    }
    if (options.creditOffset) {
      bindCreditOffsetInput({ ...options.creditOffset, input: element("creditOffset") });
    }
    if (options.refresh) {
      bindManualRefresh({ ...options.refresh, button: element("refreshData") });
    }
    return Object.freeze(bindings);
  }

  function createStockSelectionView(scope = globalThis, options = {}) {
    const document = scope.document;
    const container = options.container || document?.getElementById?.("customStockButtons");
    const suggestionList = options.suggestionList || document?.getElementById?.("stockSuggestList");
    const escapeHtml = typeof options.escapeHtml === "function"
      ? options.escapeHtml
      : (value) => String(value ?? "");
    const seriesColor = typeof options.seriesColor === "function"
      ? options.seriesColor
      : () => "#9ca3af";
    let suggestionItems = [];
    let activeSuggestionIndex = -1;
    let suggestionHandler = typeof options.onSuggestion === "function" ? options.onSuggestion : null;

    function setActiveSuggestion(index) {
      const maxIndex = suggestionItems.length - 1;
      if (!suggestionList || maxIndex < 0) {
        activeSuggestionIndex = -1;
        return -1;
      }
      let next = Number(index);
      if (!Number.isFinite(next)) next = -1;
      activeSuggestionIndex = Math.max(-1, Math.min(maxIndex, next));
      suggestionList.querySelectorAll?.(".stock-suggest-item").forEach((node, nodeIndex) => {
        const isActive = nodeIndex === activeSuggestionIndex;
        node.classList.toggle("is-active", isActive);
        node.setAttribute("aria-selected", isActive ? "true" : "false");
        if (isActive) node.scrollIntoView?.({ block: "nearest" });
      });
      return activeSuggestionIndex;
    }

    function hideSuggestions() {
      if (suggestionList) {
        suggestionList.hidden = true;
        suggestionList.innerHTML = "";
      }
      suggestionItems = [];
      activeSuggestionIndex = -1;
    }

    function renderSuggestions(items) {
      suggestionItems = Array.isArray(items) ? [...items] : [];
      activeSuggestionIndex = -1;
      if (!suggestionList || !suggestionItems.length) {
        hideSuggestions();
        return 0;
      }
      suggestionList.innerHTML = suggestionItems.map((item, index) => `
        <button type="button" class="stock-suggest-item" data-suggest-idx="${index}" aria-selected="false">
          <span class="stock-suggest-name">${escapeHtml(item.name)}</span>
          <span class="stock-suggest-meta">${escapeHtml(item.code)} / ${escapeHtml(item.market)}</span>
        </button>
      `).join("");
      suggestionList.hidden = false;
      return suggestionItems.length;
    }

    function moveSuggestion(direction) {
      if (!suggestionItems.length) return -1;
      const delta = Number(direction) < 0 ? -1 : 1;
      const next = activeSuggestionIndex < 0
        ? (delta < 0 ? suggestionItems.length - 1 : 0)
        : (activeSuggestionIndex + delta + suggestionItems.length) % suggestionItems.length;
      return setActiveSuggestion(next);
    }

    function renderStocks(stocks) {
      if (!container) return 0;
      const items = Array.isArray(stocks) ? stocks : [];
      container.innerHTML = items.map((item) => {
        const ticker = String(item?.ticker || "");
        const name = String(item?.name || ticker);
        const color = seriesColor(ticker);
        return `
          <div class="custom-stock-chip" data-custom-series="${escapeHtml(ticker)}">
            <button class="series-toggle-btn custom-stock-toggle-btn" data-series="${escapeHtml(ticker)}" style="--series-color:${escapeHtml(color)}">${escapeHtml(name)}</button>
            <button class="stock-remove-btn" type="button" data-remove-series="${escapeHtml(ticker)}" aria-label="${escapeHtml(name)} remove">&times;</button>
          </div>
        `;
      }).join("");
      return items.length;
    }

    container?.addEventListener("click", (event) => {
      const removeButton = event.target?.closest?.("[data-remove-series]");
      if (!removeButton || !container.contains?.(removeButton)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      const ticker = String(removeButton.dataset?.removeSeries || "");
      if (ticker) options.onRemove?.(ticker);
    });

    suggestionList?.addEventListener("mousemove", (event) => {
      const button = event.target?.closest?.("[data-suggest-idx]");
      if (!button || !suggestionList.contains?.(button)) return;
      setActiveSuggestion(Number(button.dataset?.suggestIdx));
    });
    suggestionList?.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-suggest-idx]");
      if (!button || !suggestionList.contains?.(button)) return;
      const index = setActiveSuggestion(Number(button.dataset?.suggestIdx));
      const item = suggestionItems[index];
      if (item) suggestionHandler?.(item, index);
    });

    return Object.freeze({
      activeSuggestion: (fallbackToFirst = false) => (
        suggestionItems[activeSuggestionIndex >= 0 ? activeSuggestionIndex : (fallbackToFirst ? 0 : -1)] || null
      ),
      containsSuggestionTarget: (target) => Boolean(suggestionList?.contains?.(target)),
      hideSuggestions,
      moveSuggestion,
      renderStocks,
      renderSuggestions,
      setSuggestionHandler: (handler) => {
        suggestionHandler = typeof handler === "function" ? handler : null;
      },
      setActiveSuggestion,
      suggestionCount: () => suggestionItems.length,
    });
  }

  function bindStockSearchPanel(scope = globalThis, options = {}) {
    const document = scope.document;
    const input = options.input || document?.getElementById?.("stockSearchInput");
    const suggestionList = options.suggestionList || document?.getElementById?.("stockSuggestList");
    const view = options.view;
    if (!input || !suggestionList || !view || input.dataset?.bound === "1") return null;
    if (input.dataset) input.dataset.bound = "1";

    let searchSequence = 0;

    async function refreshSuggestions() {
      const keyword = String(input.value || "").trim();
      if (!keyword) {
        view.hideSuggestions();
        return 0;
      }
      const requestSequence = ++searchSequence;
      try {
        await options.loadUniverse?.();
        if (requestSequence !== searchSequence) return 0;
        const items = options.filterUniverse?.(keyword) || [];
        return view.renderSuggestions(items);
      } catch (error) {
        if (requestSequence !== searchSequence) return 0;
        view.hideSuggestions();
        options.onError?.(error);
        return 0;
      }
    }

    async function submitSuggestion(item) {
      if (!item) return false;
      try {
        await options.onSubmit?.(item);
        return true;
      } finally {
        input.value = "";
        view.hideSuggestions();
      }
    }

    view.setSuggestionHandler((item) => { submitSuggestion(item); });
    input.addEventListener("input", () => { refreshSuggestions(); });
    input.addEventListener("focus", () => {
      if (String(input.value || "").trim()) refreshSuggestions();
    });
    input.addEventListener("click", () => {
      if (String(input.value || "").trim() && suggestionList.hidden) refreshSuggestions();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!view.suggestionCount()) return;
        event.preventDefault?.();
        view.moveSuggestion(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Escape") {
        view.hideSuggestions();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault?.();
      submitSuggestion(view.activeSuggestion(true));
    });
    document?.addEventListener?.("click", (event) => {
      const target = event.target;
      if (target === input || view.containsSuggestionTarget(target)) return;
      view.hideSuggestions();
    });

    return Object.freeze({ refreshSuggestions, submitSuggestion });
  }

export {
  bindChartApplicationControls,
  bindChartRangeControls,
  bindChartToolsToggle,
  bindCreditOffsetInput,
  bindDisclosureToggle,
  bindHoverToggle,
  bindMainChartToolActions,
  bindManualRefresh,
  bindPreparedToggle,
  bindStockSearchPanel,
  createMainChartControlView,
  createStockSelectionView,
  filterStockUniverse,
};
