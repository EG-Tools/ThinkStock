(function initThinkStockAppUiBindings(globalScope) {
  "use strict";

  function rangeLabel(months) {
    const value = Math.max(1, Number(months) || 1);
    return value >= 12 && value % 12 === 0 ? `${value / 12}년` : `${value}개월`;
  }

  function shiftUtcMonths(date, monthOffset) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || "").slice(0, 10));
    if (!match) return "";
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const first = new Date(Date.UTC(year, month + Number(monthOffset || 0), 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, lastDay));
    return first.toISOString().slice(0, 10);
  }

  function resolveHistoryWindow(options = {}) {
    const minDate = String(options.minDate || "").slice(0, 10);
    const maxDate = String(options.maxDate || "").slice(0, 10);
    const months = Math.max(1, Number(options.months) || 1);
    const position = Math.max(0, Math.min(1, Number(options.position) || 0));
    const minMs = Date.parse(`${minDate}T00:00:00Z`);
    const maxMs = Date.parse(`${maxDate}T00:00:00Z`);
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= minMs) {
      return { start: minDate || maxDate, end: maxDate || minDate, position: 1, canNavigate: false };
    }
    const earliestFullEnd = shiftUtcMonths(minDate, months);
    const earliestFullEndMs = Math.min(maxMs, Math.max(minMs, Date.parse(`${earliestFullEnd}T00:00:00Z`)));
    const canNavigate = earliestFullEndMs < maxMs;
    const endMs = canNavigate
      ? earliestFullEndMs + ((maxMs - earliestFullEndMs) * position)
      : maxMs;
    const end = new Date(endMs).toISOString().slice(0, 10);
    const start = shiftUtcMonths(end, -months);
    return {
      start: start < minDate ? minDate : start,
      end,
      position: canNavigate ? position : 1,
      canNavigate,
    };
  }

  function bindHistorySlider(options) {
    const slider = options.slider;
    if (!slider) return null;
    const maximum = 1000;
    let historyPromise = null;
    slider.min = "0";
    slider.max = String(maximum);
    slider.step = "1";

    const sync = (state = {}) => {
      const position = Math.max(0, Math.min(1, Number(state.position ?? options.getPosition()) || 0));
      slider.value = String(Math.round(position * maximum));
      slider.disabled = state.canNavigate === false;
      const period = state.start && state.end ? `${state.start} ~ ${state.end}` : "과거 차트 이동";
      slider.title = period;
      slider.setAttribute?.("aria-label", `차트 기간 이동: ${period}`);
    };

    const ensureHistory = () => {
      if (options.isHistoricalDataLoaded() || historyPromise) return historyPromise;
      historyPromise = Promise.resolve(options.ensureHistoricalDataLoaded())
        .then(() => options.requestChartRender(false))
        .catch((error) => options.setMessage([`과거 데이터 로딩 오류: ${error.message}`], true))
        .finally(() => { historyPromise = null; });
      return historyPromise;
    };

    slider.addEventListener("pointerdown", ensureHistory);
    slider.addEventListener("input", () => {
      const position = Number(slider.value) / maximum;
      if (options.panViewport?.(position)) return;
      options.setPosition(position);
      options.clearPinnedRange();
      ensureHistory();
      options.requestChartRender(false);
    });
    slider.addEventListener("change", () => options.saveState());
    sync();
    return Object.freeze({ sync, ensureHistory });
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
          : `우측 끝 기준 축소: ${rangeLabel(expandMonths)}`;
        expandButton.setAttribute?.("aria-label", expandButton.title);
      }
      if (contractButton) {
        contractButton.disabled = contractMonths === current;
        contractButton.dataset.targetMonths = String(contractMonths);
        contractButton.title = contractMonths === current
          ? `최소 ${rangeLabel(presets[0])} 범위입니다.`
          : `우측 끝 기준 확대: ${rangeLabel(contractMonths)}`;
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
      options.anchorLatest?.();
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
    bindHistorySlider,
    bindManualRefresh,
    bindRangeStepper,
    rangeLabel,
    resolveHistoryWindow,
  });
}(typeof self !== "undefined" ? self : globalThis));
