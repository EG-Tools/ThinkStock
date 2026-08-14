(function initThinkStockProgressView(globalScope) {
  "use strict";

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function createProgressView(scope = globalScope, options = {}) {
    const getRoot = options.getRoot || (() => null);
    const getText = options.getText || (() => null);
    const getBar = options.getBar || (() => null);

    function setVisible(visible) {
      const root = getRoot();
      if (root) root.hidden = !visible;
    }

    function setAnchor(anchor = "") {
      const root = getRoot();
      if (!root) return;
      const value = String(anchor || "").trim();
      if (root.dataset) {
        if (value) root.dataset.anchor = value;
        else delete root.dataset.anchor;
      } else if (value) {
        root.setAttribute?.("data-anchor", value);
      } else {
        root.removeAttribute?.("data-anchor");
      }
    }

    function paint(percent, text = "", optionsValue = {}) {
      const value = clampPercent(percent);
      const textElement = getText();
      const bar = getBar();
      if (optionsValue.visible != null) setVisible(Boolean(optionsValue.visible));
      if (textElement && text != null) textElement.textContent = String(text);
      if (bar?.style) bar.style.width = `${value}%`;
      return value;
    }

    function reset(optionsValue = {}) {
      paint(0, optionsValue.text ?? null);
      if (optionsValue.clearAnchor) setAnchor("");
      if (optionsValue.hide !== false) setVisible(false);
    }

    function snapshot() {
      const width = String(getBar()?.style?.width || "0");
      return {
        percent: clampPercent(width.replace("%", "")),
        visible: getRoot()?.hidden === false,
        text: String(getText()?.textContent || ""),
      };
    }

    return Object.freeze({ paint, reset, setAnchor, setVisible, snapshot });
  }

  globalScope.ThinkStockProgressView = Object.freeze({ clampPercent, createProgressView });
}(typeof self !== "undefined" ? self : globalThis));
