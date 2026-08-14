(function initThinkStockChartNavigationApp(globalScope) {
  "use strict";

  function createChartNavigation(scope = globalScope, options = {}) {
    const viewport = options.viewport;
    if (!viewport?.centeredZoomRange || !viewport?.latestRange) {
      throw new Error("chart viewport helpers are required");
    }
    if (typeof options.getElement !== "function" || typeof options.applyRange !== "function") {
      throw new Error("chart element and range callbacks are required");
    }

    const dayMs = Math.max(1, Number(options.dayMs) || 86_400_000);
    const minimumSpan = Math.max(dayMs, Number(options.minimumSpan) || dayMs * 7);
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    const messages = {
      maximum: "\uAE30\uAC04\uC744 \uB354 \uC774\uC0C1 \uB298\uB9B4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
      minimum: "\uAE30\uAC04\uC744 \uB354 \uC774\uC0C1 \uC904\uC77C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
      ...(options.messages || {}),
    };

    let historyPromise = null;
    let messageTimer = 0;
    let messageFadeTimer = 0;
    let animationFrame = 0;
    let animationToken = 0;
    let animationActive = false;
    let wheelRange = null;
    let wheelRangeHistory = [];
    let wheelRangeTimer = 0;

    function clearWheelRange() {
      if (wheelRangeTimer) clearTimer?.(wheelRangeTimer);
      wheelRangeTimer = 0;
      wheelRange = null;
      wheelRangeHistory = [];
    }

    function rangesMatch(left, right) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || right.length < 2) return false;
      const tolerance = Math.max(1, Math.min(1000, dayMs * 0.001));
      return Math.abs(left[0] - right[0]) <= tolerance
        && Math.abs(left[1] - right[1]) <= tolerance;
    }

    function rememberWheelRange(range, observedRange) {
      if (!wheelRange) wheelRangeHistory = [];
      if (Array.isArray(observedRange)
        && !wheelRangeHistory.some((item) => rangesMatch(item, observedRange))) {
        wheelRangeHistory.push([...observedRange]);
      }
      wheelRange = Array.isArray(range) ? [...range] : null;
      if (wheelRange && !wheelRangeHistory.some((item) => rangesMatch(item, wheelRange))) {
        wheelRangeHistory.push([...wheelRange]);
      }
      if (wheelRangeHistory.length > 8) wheelRangeHistory = wheelRangeHistory.slice(-8);
      if (wheelRangeTimer) clearTimer?.(wheelRangeTimer);
      wheelRangeTimer = setTimer?.(() => {
        wheelRangeTimer = 0;
        wheelRange = null;
        wheelRangeHistory = [];
      }, 220) || 0;
    }

    function showMessage(message, durationMs = 3000) {
      const element = options.getMessageElement?.();
      if (!element) return;
      if (messageTimer) clearTimer?.(messageTimer);
      if (messageFadeTimer) clearTimer?.(messageFadeTimer);
      messageTimer = 0;
      messageFadeTimer = 0;
      element.textContent = String(message || "");
      element.hidden = !element.textContent;
      element.classList.remove("is-fading");
      if (!element.textContent) return;
      const visibleDuration = Math.max(450, Number(durationMs) || 3000);
      messageFadeTimer = setTimer?.(() => {
        messageFadeTimer = 0;
        element.classList.add("is-fading");
      }, Math.max(0, visibleDuration - 450));
      messageTimer = setTimer?.(() => {
        messageTimer = 0;
        element.hidden = true;
        element.classList.remove("is-fading");
      }, visibleDuration);
    }

    function historyReady() {
      return Boolean(options.isHistoryReady?.());
    }

    async function ensureHistoryReady() {
      if (historyReady()) return true;
      if (historyPromise) return historyPromise;
      options.captureNormalization?.();
      const visibleRange = options.getCurrentRange(options.getElement());
      historyPromise = Promise.resolve(options.loadHistory?.())
        .then(async () => {
          await options.afterHistoryLoaded?.(visibleRange);
          return true;
        })
        .catch((error) => {
          options.onError?.(error);
          return false;
        })
        .finally(() => { historyPromise = null; });
      return historyPromise;
    }

    function applyCenteredZoom(direction, source = "button-zoom", zoomOptions = {}) {
      const element = options.getElement();
      const observedCurrentRange = options.getCurrentRange(element);
      let currentRange = observedCurrentRange;
      if (source === "wheel-zoom" && wheelRange) {
        if (wheelRangeHistory.some((item) => rangesMatch(item, observedCurrentRange))) {
          currentRange = [...wheelRange];
        } else {
          clearWheelRange();
        }
      }
      const observedRange = options.getDataRange(element);
      if (!currentRange || !observedRange) return false;
      const currentSpan = currentRange[1] - currentRange[0];
      if (direction > 0 && currentSpan >= (observedRange[1] - observedRange[0]) * 0.995) {
        showMessage(messages.maximum);
        return false;
      }
      if (direction < 0 && currentSpan <= minimumSpan * 1.001) {
        showMessage(messages.minimum);
        return false;
      }
      const nextRange = viewport.centeredZoomRange(currentRange, observedRange, direction, {
        ratio: 0.2,
        minimumSpan,
        anchorRatio: zoomOptions.anchorRatio,
      });
      if (!nextRange) {
        showMessage(direction > 0 ? messages.maximum : messages.minimum);
        return false;
      }
      const applied = options.applyRange(nextRange[0], nextRange[1], {
        source,
        fit: false,
        liveFit: Boolean(options.isAutoScale?.()),
      });
      if (source === "wheel-zoom" && applied !== false) rememberWheelRange(nextRange, observedCurrentRange);
      else clearWheelRange();
      if (source !== "wheel-zoom") options.applyResetPolicy?.("viewport", 80);
      return true;
    }

    function zoom(direction, source = "button-zoom", zoomOptions = {}) {
      const zoomDirection = Math.sign(Number(direction));
      if (!zoomDirection) return true;
      if (zoomDirection > 0 && !historyReady()) {
        void ensureHistoryReady().then((loaded) => {
          if (loaded) applyCenteredZoom(zoomDirection, source, zoomOptions);
        });
        return true;
      }
      applyCenteredZoom(zoomDirection, source, zoomOptions);
      return true;
    }

    function cancelLatestAnimation() {
      clearWheelRange();
      const wasActive = animationActive;
      animationToken += 1;
      animationActive = false;
      if (animationFrame) cancelFrame?.(animationFrame);
      animationFrame = 0;
      if (wasActive) options.setViewportDragging?.(false);
      options.getElement()?.classList.remove("is-viewport-panning");
    }

    function showLatestPeriod(months, source = "range-preset") {
      const numericMonths = Number(months);
      if (!Number.isFinite(numericMonths) || numericMonths <= 0) return false;
      const requestedMonths = Math.max(1, Math.min(360, Math.round(numericMonths)));
      const element = options.getElement();
      const dataRange = options.getDataRange(element);
      if (!dataRange) return false;
      cancelLatestAnimation();
      const latestDate = new Date(dataRange[1]).toISOString().slice(0, 10);
      const requestedStart = Number(options.toMilliseconds(
        options.shiftMonths(latestDate, requestedMonths),
      ));
      const nextStart = Number.isFinite(requestedStart)
        ? Math.max(dataRange[0], requestedStart)
        : dataRange[0];
      options.updateActiveMonths?.(requestedMonths);
      options.applyRange(nextStart, dataRange[1], {
        source,
        fit: false,
        liveFit: Boolean(options.isAutoScale?.()),
      });
      options.applyResetPolicy?.("viewport", 80);
      return true;
    }

    function slideToLatest(source = "latest-slide") {
      const element = options.getElement();
      if (!element || options.isInteractionBusy?.()) return false;
      const currentRange = options.getCurrentRange(element);
      const dataRange = options.getDataRange(element);
      const targetRange = viewport.latestRange(currentRange, dataRange);
      if (!currentRange || !targetRange) return false;
      cancelLatestAnimation();

      const distance = Math.abs(targetRange[0] - currentRange[0]);
      if (distance <= 1000) {
        options.applyRange(targetRange[0], targetRange[1], {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
        });
        options.applyResetPolicy?.("viewport", 80);
        return true;
      }

      options.captureNormalization?.();
      options.setViewportPinned?.(true);
      options.setViewportDragging?.(true);
      animationActive = true;
      element.classList.add("is-viewport-panning");
      const token = ++animationToken;
      const currentSpan = currentRange[1] - currentRange[0];
      const screenDistance = distance / Math.max(dayMs, currentSpan);
      const duration = Math.min(850, 420 + (Math.log2(1 + screenDistance) * 90));
      let startedAt = null;

      const step = (timestamp) => {
        if (!animationActive || token !== animationToken) return;
        if (startedAt === null) startedAt = timestamp;
        const progress = Math.min(1, (timestamp - startedAt) / duration);
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - (((-2 * progress) + 2) ** 3) / 2;
        const start = currentRange[0] + ((targetRange[0] - currentRange[0]) * eased);
        const end = currentRange[1] + ((targetRange[1] - currentRange[1]) * eased);
        options.applyRange(start, end, {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
          userInitiated: false,
        });
        if (progress < 1) {
          animationFrame = requestFrame(step);
          return;
        }
        animationFrame = 0;
        animationActive = false;
        options.setViewportDragging?.(false);
        element.classList.remove("is-viewport-panning");
        options.applyRange(targetRange[0], targetRange[1], {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
        });
        options.applyResetPolicy?.("viewport", 80);
      };

      animationFrame = requestFrame(step);
      return true;
    }

    function dispose() {
      cancelLatestAnimation();
      if (messageTimer) clearTimer?.(messageTimer);
      if (messageFadeTimer) clearTimer?.(messageFadeTimer);
      if (wheelRangeTimer) clearTimer?.(wheelRangeTimer);
      messageTimer = 0;
      messageFadeTimer = 0;
      wheelRangeTimer = 0;
      wheelRange = null;
      wheelRangeHistory = [];
    }

    return Object.freeze({
      applyCenteredZoom,
      cancelLatestAnimation,
      dispose,
      ensureHistoryReady,
      isAnimating: () => animationActive,
      showLatestPeriod,
      showMessage,
      slideToLatest,
      zoom,
    });
  }

  globalScope.ThinkStockChartNavigationApp = Object.freeze({ createChartNavigation });
}(typeof self !== "undefined" ? self : globalThis));
