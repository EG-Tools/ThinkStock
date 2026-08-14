(function initThinkStockControlStateView(globalScope) {
  "use strict";

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function syncControl(button, state = {}) {
    if (!button) return null;
    const activeClass = String(state.activeClass || "is-active");
    if (hasOwn(state, "active")) button.classList?.toggle(activeClass, Boolean(state.active));
    if (hasOwn(state, "pressed")) {
      button.setAttribute?.("aria-pressed", state.pressed ? "true" : "false");
    }
    if (hasOwn(state, "busy")) {
      button.setAttribute?.("aria-busy", state.busy ? "true" : "false");
    }
    if (hasOwn(state, "disabled")) button.disabled = Boolean(state.disabled);
    if (hasOwn(state, "text")) button.textContent = String(state.text ?? "");
    if (hasOwn(state, "title")) button.title = String(state.title ?? "");
    Object.entries(state.classes || {}).forEach(([name, enabled]) => {
      if (name) button.classList?.toggle(name, Boolean(enabled));
    });
    return Object.freeze({
      active: button.classList?.contains?.(activeClass) === true,
      busy: button.getAttribute?.("aria-busy") === "true" || button["aria-busy"] === "true",
      disabled: Boolean(button.disabled),
    });
  }

  function syncChoiceControls(controls, selectedValue, options = {}) {
    const list = Array.from(controls || []);
    const readValue = typeof options.readValue === "function"
      ? options.readValue
      : (control) => control?.dataset?.value;
    list.forEach((control) => {
      const active = readValue(control) === selectedValue;
      syncControl(control, { active, pressed: active });
    });
    return list.length;
  }

  function renderMessage(element, lines, options = {}) {
    if (!element) return 0;
    const escape = typeof options.escape === "function"
      ? options.escape
      : (value) => String(value ?? "");
    const list = (Array.isArray(lines) ? lines : [lines])
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    if (!list.length) {
      element.innerHTML = "";
      return 0;
    }
    const className = `message${options.error ? " error" : ""}`;
    element.innerHTML = `<div class="${className}">${list.map(escape).join("<br>")}</div>`;
    return list.length;
  }

  globalScope.ThinkStockControlStateView = Object.freeze({
    renderMessage,
    syncChoiceControls,
    syncControl,
  });
}(typeof self !== "undefined" ? self : globalThis));
