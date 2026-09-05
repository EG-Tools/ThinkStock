"use strict";

  const MESSAGE_FADE_DURATION_MS = 2000;
  const WHEEL_ZOOM_ANIMATION_MS = 96;
  const MAX_WHEEL_RANGE_HISTORY = 32;

  function createChartNavigation(scope = globalThis, options = {}) {
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
    let pendingHistoryZoom = null;
    let historyZoomPromise = null;
    let messageTimer = 0;
    let messageFadeTimer = 0;
    let animationFrame = 0;
    let animationToken = 0;
    let animationActive = false;
    let rangeRenderPromise = Promise.resolve();
    let wheelRange = null;
    let wheelRangeHistory = [];
    let wheelAnimationFrame = 0;
    let wheelAnimationFrom = null;
    let wheelAnimationCurrent = null;
    let wheelAnimationTarget = null;
    let wheelAnimationStartedAt = null;
    const smoothWheelZoom = options.smoothWheelZoom === true
      && typeof requestFrame === "function";

    function cancelWheelAnimation() {
      if (wheelAnimationFrame) cancelFrame?.(wheelAnimationFrame);
      wheelAnimationFrame = 0;
      wheelAnimationFrom = null;
      wheelAnimationCurrent = null;
      wheelAnimationTarget = null;
      wheelAnimationStartedAt = null;
    }

    function clearWheelRange() {
      cancelWheelAnimation();
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
      rememberWheelRenderedRange(observedRange);
      wheelRange = Array.isArray(range) ? [...range] : null;
      rememberWheelRenderedRange(wheelRange);
    }

    function rememberWheelRenderedRange(range) {
      if (!Array.isArray(range) || range.length < 2) return;
      if (!wheelRangeHistory.some((item) => rangesMatch(item, range))) {
        wheelRangeHistory.push([...range]);
        if (wheelRangeHistory.length > MAX_WHEEL_RANGE_HISTORY) {
          // Preserve the gesture origin and only retain its newest requested ranges.
          wheelRangeHistory.splice(1, wheelRangeHistory.length - MAX_WHEEL_RANGE_HISTORY);
        }
      }
    }

    function applyWheelRange(range, observedRange, source) {
      if (!smoothWheelZoom) {
        return options.applyRange(range[0], range[1], {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
        });
      }
      const startRange = wheelAnimationCurrent || observedRange;
      if (!Array.isArray(startRange) || startRange.length < 2) return false;
      wheelAnimationFrom = startRange.slice(0, 2).map(Number);
      wheelAnimationCurrent = [...wheelAnimationFrom];
      wheelAnimationTarget = range.slice(0, 2).map(Number);
      wheelAnimationStartedAt = null;
      if (wheelAnimationFrame) return true;

      const step = (timestamp) => {
        wheelAnimationFrame = 0;
        if (!wheelAnimationFrom || !wheelAnimationTarget) return;
        const beginsInteraction = wheelAnimationStartedAt === null;
        if (beginsInteraction) wheelAnimationStartedAt = timestamp;
        const progress = Math.min(1, Math.max(0, (timestamp - wheelAnimationStartedAt) / WHEEL_ZOOM_ANIMATION_MS));
        const eased = 1 - ((1 - progress) ** 3);
        const nextRange = [
          wheelAnimationFrom[0] + ((wheelAnimationTarget[0] - wheelAnimationFrom[0]) * eased),
          wheelAnimationFrom[1] + ((wheelAnimationTarget[1] - wheelAnimationFrom[1]) * eased),
        ];
        wheelAnimationCurrent = nextRange;
        rememberWheelRenderedRange(nextRange);
        const complete = progress >= 1;
        options.applyRange(nextRange[0], nextRange[1], {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
          userInitiated: complete,
          beginsInteraction,
        });
        if (!complete) wheelAnimationFrame = requestFrame(step);
        else {
          wheelAnimationFrom = null;
          wheelAnimationCurrent = null;
          wheelAnimationTarget = null;
          wheelAnimationStartedAt = null;
        }
      };
      wheelAnimationFrame = requestFrame(step);
      return true;
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
      const solidDuration = Math.max(0, Number(durationMs) || 3000);
      messageFadeTimer = setTimer?.(() => {
        messageFadeTimer = 0;
        element.classList.add("is-fading");
      }, solidDuration);
      messageTimer = setTimer?.(() => {
        messageTimer = 0;
        element.hidden = true;
        element.classList.remove("is-fading");
      }, solidDuration + MESSAGE_FADE_DURATION_MS);
    }

    function historyReady() {
      return Boolean(options.isHistoryReady?.());
    }

    async function ensureHistoryReady(refreshView = false) {
      if (historyReady()) {
        if (refreshView) {
          await options.loadHistory?.();
          const visibleRange = options.getCurrentRange(options.getElement());
          await options.afterHistoryLoaded?.(visibleRange);
        }
        return true;
      }
      if (historyPromise) return historyPromise;
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

    function canZoomOutWithLoadedData(zoomOptions = {}) {
      const element = options.getElement();
      const currentRange = options.getCurrentRange(element);
      const dataRange = options.getDataRange(element);
      if (!currentRange || !dataRange) return false;
      return Boolean(viewport.centeredZoomRange(currentRange, dataRange, 1, {
        ratio: 0.2,
        minimumSpan,
        anchorRatio: zoomOptions.anchorRatio,
      }));
    }

    function queueHistoryZoom(direction, source, zoomOptions) {
      pendingHistoryZoom = { direction, source, zoomOptions };
      if (historyZoomPromise) return;
      historyZoomPromise = ensureHistoryReady()
        .then((loaded) => {
          const request = pendingHistoryZoom;
          pendingHistoryZoom = null;
          if (!loaded || !request) return false;
          const applied = applyCenteredZoom(request.direction, request.source, request.zoomOptions);
          if (request.source === "wheel-zoom") clearWheelRange();
          return applied;
        })
        .finally(() => { historyZoomPromise = null; });
    }

    function cancelPendingHistoryZoom() {
      pendingHistoryZoom = null;
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
      const applied = source === "wheel-zoom"
        ? applyWheelRange(nextRange, observedCurrentRange, source)
        : options.applyRange(nextRange[0], nextRange[1], {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
        });
      if (source === "wheel-zoom" && applied !== false) rememberWheelRange(nextRange, observedCurrentRange);
      else clearWheelRange();
      return true;
    }

    function zoom(direction, source = "button-zoom", zoomOptions = {}) {
      const zoomDirection = Math.sign(Number(direction));
      if (!zoomDirection) return true;
      if (zoomDirection < 0) cancelPendingHistoryZoom();
      if (zoomDirection > 0 && !historyReady() && !canZoomOutWithLoadedData(zoomOptions)) {
        queueHistoryZoom(zoomDirection, source, zoomOptions);
        return true;
      }
      applyCenteredZoom(zoomDirection, source, zoomOptions);
      return true;
    }

    function cancelLatestAnimation() {
      cancelPendingHistoryZoom();
      clearWheelRange();
      const wasActive = animationActive;
      animationToken += 1;
      animationActive = false;
      if (animationFrame) cancelFrame?.(animationFrame);
      animationFrame = 0;
      if (wasActive) options.setViewportDragging?.(false);
      options.getElement()?.classList.remove("is-viewport-panning");
    }

    function requestSettledRangeRender(
      range,
      source,
      updateClass = "viewport",
    ) {
      const requestedRange = Array.isArray(range) && range.length === 2
        ? Object.freeze(range.slice(0, 2).map(Number))
        : null;
      rangeRenderPromise = Promise.resolve(options.requestRender?.({
        preserveZoom: true,
        range: requestedRange,
        reason: source,
        updateClass,
      })).catch((error) => {
        options.onError?.(error);
      });
      return rangeRenderPromise;
    }

    function finalizeAnimatedRange(range, source, applied) {
      if (applied === false) return Promise.resolve();
      return requestSettledRangeRender(range, source, "viewport");
    }

    function showLatestPeriod(months, source = "range-preset") {
      const numericMonths = Number(months);
      if (!Number.isFinite(numericMonths) || numericMonths <= 0) return false;
      const requestedMonths = Math.max(1, Math.min(360, Math.round(numericMonths)));
      const element = options.getElement();
      const dataRange = options.getDataRange(element);
      if (!dataRange) return false;
      cancelLatestAnimation();
      const rightPaddingMs = Math.max(0, Number(options.getRightPaddingMs?.()) || 0);
      const latestAnchor = Math.max(dataRange[0], dataRange[1] - rightPaddingMs);
      const latestDate = new Date(latestAnchor).toISOString().slice(0, 10);
      const requestedStart = Number(options.toMilliseconds(
        options.shiftMonths(latestDate, requestedMonths),
      ));
      const nextStart = Number.isFinite(requestedStart)
        ? Math.max(dataRange[0], requestedStart)
        : dataRange[0];
      options.updateActiveMonths?.(requestedMonths);
      const applied = options.applyRange(nextStart, dataRange[1], {
        source,
        fit: false,
        liveFit: Boolean(options.isAutoScale?.()),
      });
      if (applied !== false) {
        // Presets can reveal data outside the auxiliary chart's buffered window.
        requestSettledRangeRender(
          [nextStart, dataRange[1]],
          source,
          "viewport-range",
        );
      }
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
        const applied = options.applyRange(targetRange[0], targetRange[1], {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
        });
        finalizeAnimatedRange(targetRange, source, applied);
        return true;
      }

      options.setViewportPinned?.(true);
      options.setViewportDragging?.(true);
      animationActive = true;
      element.classList.add("is-viewport-panning");
      const token = ++animationToken;
      const currentSpan = currentRange[1] - currentRange[0];
      const screenDistance = distance / Math.max(dayMs, currentSpan);
      const duration = Math.min(850, 420 + (Math.log2(1 + screenDistance) * 90));
      const requestedAt = Number(scope.performance?.now?.());
      let startedAt = Number.isFinite(requestedAt) ? requestedAt : null;

      const step = (timestamp) => {
        if (!animationActive || token !== animationToken) return;
        if (startedAt === null) startedAt = timestamp;
        const progress = Math.min(1, (timestamp - startedAt) / duration);
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - (((-2 * progress) + 2) ** 3) / 2;
        const start = currentRange[0] + ((targetRange[0] - currentRange[0]) * eased);
        const end = currentRange[1] + ((targetRange[1] - currentRange[1]) * eased);
        const complete = progress >= 1;
        const applied = options.applyRange(start, end, {
          source,
          fit: false,
          liveFit: Boolean(options.isAutoScale?.()),
          userInitiated: complete,
        });
        if (!complete) {
          animationFrame = requestFrame(step);
          return;
        }
        animationFrame = 0;
        animationActive = false;
        options.setViewportDragging?.(false);
        element.classList.remove("is-viewport-panning");
        finalizeAnimatedRange(targetRange, source, applied);
      };

      animationFrame = requestFrame(step);
      return true;
    }

    function dispose() {
      cancelLatestAnimation();
      if (messageTimer) clearTimer?.(messageTimer);
      if (messageFadeTimer) clearTimer?.(messageFadeTimer);
      cancelWheelAnimation();
      messageTimer = 0;
      messageFadeTimer = 0;
      wheelRange = null;
      wheelRangeHistory = [];
    }

    return Object.freeze({
      applyCenteredZoom,
      cancelPendingHistoryZoom,
      cancelLatestAnimation,
      dispose,
      ensureHistoryReady,
      finishWheelZoom: clearWheelRange,
      isAnimating: () => animationActive,
      whenRangeSettled: () => rangeRenderPromise,
      showLatestPeriod,
      showMessage,
      slideToLatest,
      zoom,
    });
  }

export { createChartNavigation };
