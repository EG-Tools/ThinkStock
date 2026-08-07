(function initThinkStockAppUiBindings(globalScope) {
  "use strict";

  function rangeLabel(months) {
    const value = Math.max(1, Number(months) || 1);
    return value >= 12 && value % 12 === 0 ? `${value / 12}년` : `${value}개월`;
  }

  function bindRangeStepper(options) {
    const stepper = options.stepper;
    const expandButton = options.expandButton;
    const contractButton = options.contractButton;
    const controls = [expandButton, contractButton].filter(Boolean);
    const presets = [...new Set((options.presets || []).map(Number).filter(Number.isFinite))]
      .sort((left, right) => left - right);
    let busy = false;
    let rangeChangedWhileBusy = false;

    function nextMonths(direction) {
      const current = Number(options.getActiveMonths());
      if (direction > 0) return presets.find((months) => months > current) ?? current;
      return [...presets].reverse().find((months) => months < current) ?? current;
    }

    function sync() {
      const current = Number(options.getActiveMonths());
      const expandMonths = nextMonths(1);
      const contractMonths = nextMonths(-1);
      if (stepper) {
        stepper.dataset.months = String(current);
        stepper.title = `현재 차트 범위: ${rangeLabel(current)}`;
      }
      if (expandButton) {
        expandButton.disabled = expandMonths === current;
        expandButton.dataset.targetMonths = String(expandMonths);
        expandButton.title = expandMonths === current
          ? `최대 ${rangeLabel(presets.at(-1))} 범위입니다.`
          : `과거 범위 확대: ${rangeLabel(expandMonths)}`;
        expandButton.setAttribute?.("aria-label", expandButton.title);
      }
      if (contractButton) {
        contractButton.disabled = contractMonths === current;
        contractButton.dataset.targetMonths = String(contractMonths);
        contractButton.title = contractMonths === current
          ? `최소 ${rangeLabel(presets[0])} 범위입니다.`
          : `차트 범위 축소: ${rangeLabel(contractMonths)}`;
        contractButton.setAttribute?.("aria-label", contractButton.title);
      }
    }

    async function move(direction) {
      const previousMonths = Number(options.getActiveMonths());
      const targetMonths = nextMonths(direction);
      if (!Number.isFinite(targetMonths) || targetMonths === previousMonths) {
        sync();
        return;
      }

      options.setActiveMonths(targetMonths);
      options.clearPinnedRange();
      sync();
      if (busy) {
        rangeChangedWhileBusy = true;
        return;
      }

      const fallbackMonths = previousMonths;
      busy = true;
      try {
        while (true) {
          const requestedMonths = Number(options.getActiveMonths());
          if (requestedMonths > options.recentDataMonths && !options.isHistoricalDataLoaded()) {
            options.setMessage(["과거 데이터를 불러오는 중입니다."]);
            await options.ensureHistoricalDataLoaded();
            options.setMessage([]);
          }
          const renderingMonths = Number(options.getActiveMonths());
          rangeChangedWhileBusy = false;
          options.saveState();
          await options.requestChartRender(false);
          if (!rangeChangedWhileBusy && Number(options.getActiveMonths()) === renderingMonths) break;
        }
      } catch (error) {
        options.setActiveMonths(fallbackMonths);
        options.setMessage([`과거 데이터 로딩 오류: ${error.message}`], true);
      } finally {
        busy = false;
        rangeChangedWhileBusy = false;
        sync();
      }
    }

    expandButton?.addEventListener("click", () => move(1));
    contractButton?.addEventListener("click", () => move(-1));
    sync();
    return Object.freeze({ move, sync });
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
    bindRangeStepper,
    rangeLabel,
  });
}(typeof self !== "undefined" ? self : globalThis));
