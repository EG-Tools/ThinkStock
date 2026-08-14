(function initThinkStockStartupLoader(globalScope) {
  function createStartupLoader(scope = globalScope, options = {}) {
    const selector = String(options.selector || ".hero h1");
    const hideDelayMs = Math.max(0, Number(options.hideDelayMs) || 460);
    let hideTimer = 0;
    let rafId = 0;
    let displayProgress = 100;
    let targetProgress = 100;

    function ensureElement() {
      const element = scope.document?.querySelector(selector) || null;
      if (!element) return null;
      if (!element.dataset.title) {
        element.dataset.title = String(element.textContent || "Think Stock").trim() || "Think Stock";
      }
      return element;
    }

    function renderProgress(value) {
      const element = ensureElement();
      if (!element) return;
      const clamped = Math.max(0, Math.min(100, value));
      element.style.setProperty("--title-load", `${clamped.toFixed(2)}%`);
      element.setAttribute("aria-valuemin", "0");
      element.setAttribute("aria-valuemax", "100");
      element.setAttribute("aria-valuenow", String(Math.round(clamped)));
    }

    function tween() {
      const difference = targetProgress - displayProgress;
      if (Math.abs(difference) < 0.28) {
        displayProgress = targetProgress;
        renderProgress(displayProgress);
        rafId = 0;
        return;
      }
      displayProgress += difference * 0.16;
      renderProgress(displayProgress);
      rafId = scope.requestAnimationFrame(tween);
    }

    function setProgress(percent, _label = "") {
      if (!ensureElement()) return;
      targetProgress = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
      if (!rafId) rafId = scope.requestAnimationFrame(tween);
    }

    function show() {
      if (hideTimer) {
        scope.clearTimeout(hideTimer);
        hideTimer = 0;
      }
      if (rafId) {
        scope.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      const element = ensureElement();
      if (!element) return;
      element.classList.add("is-loading");
      displayProgress = 0;
      targetProgress = 0;
      renderProgress(0);
    }

    function hide() {
      const element = ensureElement();
      if (!element) return;
      setProgress(100);
      if (hideTimer) scope.clearTimeout(hideTimer);
      hideTimer = scope.setTimeout(() => {
        element.classList.remove("is-loading");
        hideTimer = 0;
      }, hideDelayMs);
    }

    return Object.freeze({ show, hide, setProgress, renderProgress });
  }

  globalScope.ThinkStockStartupLoader = Object.freeze({ createStartupLoader });
}(typeof self !== "undefined" ? self : globalThis));
