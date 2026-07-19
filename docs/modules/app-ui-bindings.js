(function initThinkStockAppUiBindings(globalScope) {
  "use strict";

  function bindRangeButtons(options) {
    const buttons = [...(options.buttons || [])];
    buttons.forEach((button) => {
      button.addEventListener("click", async () => {
        const previousMonths = options.getActiveMonths();
        const nextMonths = Number(button.dataset.months);
        options.setActiveMonths(nextMonths);
        options.clearPinnedRange();
        options.syncButtons();
        if (nextMonths > options.recentDataMonths && !options.isHistoricalDataLoaded()) {
          buttons.forEach((item) => { item.disabled = true; });
          options.setMessage(["과거 데이터를 불러오는 중입니다."]);
          try {
            await options.ensureHistoricalDataLoaded();
            options.setMessage([]);
          } catch (error) {
            options.setActiveMonths(previousMonths);
            options.syncButtons();
            options.setMessage([`과거 데이터 로딩 오류: ${error.message}`], true);
            return;
          } finally {
            buttons.forEach((item) => { item.disabled = false; });
          }
        }
        options.saveState();
        options.requestChartRender(false);
      });
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
      if (!options.getEnabled()) options.hidePopover();
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
    bindRangeButtons,
  });
}(typeof self !== "undefined" ? self : globalThis));
