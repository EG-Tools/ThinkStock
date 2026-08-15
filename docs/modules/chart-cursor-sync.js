(function initThinkStockChartCursorSync(globalScope) {
  "use strict";

  function xValueToLocalPixel(element, xValue) {
    const axis = element?._fullLayout?.xaxis;
    if (!axis) return null;
    let plotPixel = null;
    try {
      if (typeof axis.d2p === "function") plotPixel = axis.d2p(xValue);
      else if (typeof axis.r2p === "function") plotPixel = axis.r2p(xValue);
    } catch (_) {
      plotPixel = null;
    }
    const localPixel = Number(axis._offset) + Number(plotPixel);
    return Number.isFinite(localPixel) ? localPixel : null;
  }

  function createCursorSyncController(scope = globalScope, options = {}) {
    const className = String(options.className || "synced-cursor-line");
    const horizontalClassName = String(
      options.horizontalClassName || "synced-cursor-horizontal-line",
    );
    const getTargets = typeof options.getTargets === "function" ? options.getTargets : () => [];
    const getMode = typeof options.getMode === "function" ? options.getMode : () => "vertical";
    const requestFrame = options.requestFrame || scope.requestAnimationFrame?.bind(scope);
    const cancelFrame = options.cancelFrame || scope.cancelAnimationFrame?.bind(scope);
    const now = options.now || (() => scope.performance?.now?.() || Date.now());
    const geometryTtlMs = Math.max(0, Number(options.geometryTtlMs) || 240);
    if (typeof requestFrame !== "function") throw new Error("requestAnimationFrame is required");
    const lineCache = new WeakMap();
    let rectCache = new WeakMap();
    let frameId = 0;
    let pending = null;
    let lastApplied = null;

    function mode() {
      const value = getMode();
      return ["vertical", "horizontal", "cross"].includes(value) ? value : "vertical";
    }

    function ensureLine(element, orientation = "vertical") {
      if (!element) return null;
      const targetClassName = orientation === "horizontal" ? horizontalClassName : className;
      const cached = lineCache.get(element)?.[orientation] || null;
      let line = cached && (!("parentNode" in cached) || cached.parentNode === element)
        ? cached
        : (element.querySelector?.(`.${targetClassName}`) || null);
      if (!line) {
        const documentRef = element.ownerDocument || scope.document;
        line = documentRef?.createElement?.("div") || null;
        if (!line) return null;
        line.className = targetClassName;
        element.appendChild?.(line);
      }
      const entry = lineCache.get(element) || {};
      entry[orientation] = line;
      lineCache.set(element, entry);
      return line;
    }

    function hideOrientation(element, orientation) {
      const line = ensureLine(element, orientation);
      if (line && line.style.opacity !== "0") line.style.opacity = "0";
    }

    function hide(element) {
      hideOrientation(element, "vertical");
      hideOrientation(element, "horizontal");
    }

    function showVertical(element, localPixel) {
      const line = ensureLine(element, "vertical");
      const axis = element?._fullLayout?.xaxis;
      const minimum = Number(axis?._offset);
      const maximum = minimum + Number(axis?._length);
      if (!line || !Number.isFinite(localPixel) || !Number.isFinite(minimum) || !Number.isFinite(maximum)
        || localPixel < minimum || localPixel > maximum) {
        hideOrientation(element, "vertical");
        return false;
      }
      const transform = `translateX(${localPixel.toFixed(2)}px)`;
      if (line.style.opacity !== "1") line.style.opacity = "1";
      if (line.style.transform !== transform) line.style.transform = transform;
      return true;
    }

    function showHorizontal(element, localPixel) {
      const line = ensureLine(element, "horizontal");
      const size = element?._fullLayout?._size;
      const axis = element?._fullLayout?.yaxis;
      const minimum = Number.isFinite(Number(size?.t)) ? Number(size.t) : Number(axis?._offset);
      const length = Number.isFinite(Number(size?.h)) ? Number(size.h) : Number(axis?._length);
      const maximum = minimum + length;
      if (!line || !Number.isFinite(localPixel) || !Number.isFinite(minimum) || !Number.isFinite(maximum)
        || localPixel < minimum || localPixel > maximum) {
        hideOrientation(element, "horizontal");
        return false;
      }
      const transform = `translateY(${localPixel.toFixed(2)}px)`;
      if (line.style.opacity !== "1") line.style.opacity = "1";
      if (line.style.transform !== transform) line.style.transform = transform;
      return true;
    }

    const show = showVertical;

    function targets() {
      return (getTargets() || []).filter(Boolean);
    }

    function rectFor(element) {
      if (!element) return null;
      const timestamp = now();
      const cached = rectCache.get(element);
      if (cached && timestamp - cached.at <= geometryTtlMs) return cached.rect;
      const rect = element.getBoundingClientRect?.() || null;
      rectCache.set(element, { at: timestamp, rect });
      return rect;
    }

    function invalidateGeometry(element = null) {
      if (element) rectCache.delete(element);
      else rectCache = new WeakMap();
    }

    function previewClientX(clientX) {
      const screenX = Number(clientX);
      if (!Number.isFinite(screenX)) return 0;
      if (mode() === "horizontal") {
        targets().forEach((element) => hideOrientation(element, "vertical"));
        return 0;
      }
      let shown = 0;
      const placements = targets().map((element) => {
        const rect = rectFor(element);
        return { element, localPixel: screenX - Number(rect?.left) };
      });
      placements.forEach(({ element, localPixel }) => {
        if (showVertical(element, localPixel)) shown += 1;
      });
      return shown;
    }

    function previewClientPoint(sourceElement, clientX, clientY) {
      const activeMode = mode();
      const currentTargets = targets();
      const screenX = Number(clientX);
      const screenY = Number(clientY);
      let shown = 0;
      currentTargets.forEach((element) => {
        const rect = rectFor(element);
        if (activeMode === "horizontal" || !Number.isFinite(screenX)) {
          hideOrientation(element, "vertical");
        } else if (showVertical(element, screenX - Number(rect?.left))) {
          shown += 1;
        }

        if (activeMode === "vertical" || element !== sourceElement || !Number.isFinite(screenY)) {
          hideOrientation(element, "horizontal");
          return;
        }
        const localPixel = screenY - Number(rect?.top);
        if (showHorizontal(element, localPixel)) shown += 1;
      });
      return shown;
    }

    function apply(state) {
      const currentTargets = targets();
      lastApplied = state || null;
      if (state?.xValue == null) {
        currentTargets.forEach(hide);
        return;
      }
      const activeMode = mode();
      const showVerticalLine = activeMode !== "horizontal";
      const showHorizontalLine = activeMode !== "vertical";
      currentTargets.forEach((element) => {
        if (showVerticalLine && element?._fullLayout?.xaxis) {
          if (element === state.sourceElement && Number.isFinite(state.sourceLocalPixel)) {
            showVertical(element, state.sourceLocalPixel);
          } else if (element === state.sourceElement && Number.isFinite(state.sourceClientX)) {
            const rect = rectFor(element);
            showVertical(element, Number(state.sourceClientX) - Number(rect?.left));
          } else {
            showVertical(element, xValueToLocalPixel(element, state.xValue));
          }
        } else {
          hideOrientation(element, "vertical");
        }

        if (showHorizontalLine && element === state.sourceElement) {
          if (Number.isFinite(state.sourceLocalYPixel)) {
            showHorizontal(element, state.sourceLocalYPixel);
          } else if (Number.isFinite(state.sourceClientY)) {
            const rect = rectFor(element);
            showHorizontal(element, Number(state.sourceClientY) - Number(rect?.top));
          } else {
            hideOrientation(element, "horizontal");
          }
        } else {
          hideOrientation(element, "horizontal");
        }
      });
    }

    function schedule(state) {
      pending = state;
      if (frameId) return;
      frameId = requestFrame(() => {
        frameId = 0;
        const next = pending;
        pending = null;
        if (next) apply(next);
      });
    }

    function prepare(elements = targets()) {
      (elements || []).filter(Boolean).forEach((element) => {
        ensureLine(element, "vertical");
        ensureLine(element, "horizontal");
      });
    }

    function cancel() {
      pending = null;
      if (frameId && typeof cancelFrame === "function") cancelFrame(frameId);
      frameId = 0;
    }

    function dispose() {
      cancel();
      lastApplied = null;
      targets().forEach(hide);
    }

    function refresh() {
      if (lastApplied) apply(lastApplied);
      else targets().forEach(hide);
    }

    return Object.freeze({
      apply,
      cancel,
      dispose,
      hide,
      invalidateGeometry,
      isBusy: () => Boolean(frameId || pending),
      prepare,
      previewClientX,
      previewClientPoint,
      refresh,
      schedule,
      show,
      showHorizontal,
    });
  }

  globalScope.ThinkStockChartCursorSync = Object.freeze({
    createCursorSyncController,
    xValueToLocalPixel,
  });
}(typeof self !== "undefined" ? self : globalThis));
