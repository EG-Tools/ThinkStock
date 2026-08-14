(function initThinkStockAppUiBindings(globalScope) {
  "use strict";

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
      button?.classList.toggle("is-active", enabled);
      button?.setAttribute("aria-pressed", String(enabled));
      if (button) {
        button.title = enabled
          ? "메인차트 도구를 숨깁니다."
          : "메인차트 도구를 표시합니다.";
      }
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

  function createMainChartControlView(scope = globalScope, options = {}) {
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
      const hidden = !options.getEnabled();
      (options.chartElements || []).forEach((element) => {
        element?.classList.toggle("no-hover-popup", hidden);
      });
    };
    if (!button) return applyState;
    button.classList.toggle("is-active", options.getEnabled());
    applyState();
    button.addEventListener("click", () => {
      options.setEnabled(!options.getEnabled());
      button.classList.toggle("is-active", options.getEnabled());
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
      options.setMessage([]);
      try {
        let serviceWorkerRefresh = null;
        if (options.hasServiceWorkerController()) {
          serviceWorkerRefresh = await options.requestServiceWorkerDataRefresh();
        }
        const forceSeedNetwork = serviceWorkerRefresh?.ok !== true;
        if (options.hasRuntimeDataLoaded()) {
          await options.loadData(forceSeedNetwork, { mergeWithExisting: true });
        } else {
          const restored = await options.loadLastRuntimeSnapshot();
          if (restored) await options.renderChart(false);
          else await options.loadData(forceSeedNetwork);
        }
        await options.refreshRuntimeData({ forceNetwork: true });
      } catch (error) {
        options.setMessage(`데이터 갱신 중 오류: ${error.message}`, true);
      } finally {
        button.classList.remove("spinning");
      }
    });
  }

  globalScope.ThinkStockAppUiBindings = Object.freeze({
    bindCreditOffsetInput,
    bindDisclosureToggle,
    bindHoverToggle,
    bindManualRefresh,
    bindChartRangeControls,
    bindChartToolsToggle,
    bindMainChartToolActions,
    createMainChartControlView,
  });
}(typeof self !== "undefined" ? self : globalThis));
