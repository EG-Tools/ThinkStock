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
    if (hasOwn(state, "expanded")) {
      button.setAttribute?.("aria-expanded", state.expanded ? "true" : "false");
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

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function createProgressView(scope = globalThis, options = {}) {
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

  function createAuxiliaryPanelControlView(scope = globalThis, options = {}) {
    const document = scope.document;
    const state = options.state;
    const panelKeys = [...(options.panelKeys || [])].map(String);
    const controlsSignature = options.controlsSignature || ((controls) => JSON.stringify(controls || []));
    if (!document || !state?.hiddenAuxiliaryPanels || !state?.hiddenAuxiliarySeries) {
      throw new Error("auxiliary panel control dependencies are incomplete");
    }
    let orderMigrated = false;

    function normalizeOrder() {
      const current = Array.isArray(state.auxiliaryPanelOrder) ? state.auxiliaryPanelOrder : [];
      const source = !orderMigrated
        && current.join(",") === "adr,fearGreed,newsSentiment,vkospi"
        ? panelKeys
        : current;
      orderMigrated = true;
      const normalized = [...new Set([...source, ...panelKeys])]
        .filter((key) => panelKeys.includes(key));
      state.auxiliaryPanelOrder = normalized;
      return normalized;
    }

    function isPanelVisible(panelKey) {
      return panelKeys.includes(panelKey) && !state.hiddenAuxiliaryPanels.has(panelKey);
    }

    function sync() {
      const element = document.getElementById("chart-adr");
      if (!element) return;
      element.querySelectorAll(".auxiliary-representative-toggle[data-auxiliary-panel]")
        .forEach((button) => {
          const active = isPanelVisible(button.dataset.auxiliaryPanel);
          syncControl(button, { active, pressed: active });
        });
      element.querySelectorAll(".auxiliary-series-toggle[data-auxiliary-series]")
        .forEach((button) => {
          const active = !state.hiddenAuxiliarySeries.has(button.dataset.auxiliarySeries);
          syncControl(button, { active, pressed: active });
        });
    }

    function publish() {
      options.persist?.();
      sync();
      options.onChange?.();
    }

    function toggleSeries(key) {
      const seriesKey = String(key || "");
      if (!seriesKey) return;
      if (state.hiddenAuxiliarySeries.has(seriesKey)) state.hiddenAuxiliarySeries.delete(seriesKey);
      else state.hiddenAuxiliarySeries.add(seriesKey);
      publish();
    }

    function togglePanel(panelKey) {
      if (!panelKeys.includes(panelKey)) return;
      if (state.hiddenAuxiliaryPanels.has(panelKey)) {
        state.hiddenAuxiliaryPanels.delete(panelKey);
        state.auxiliaryPanelOrder = [
          ...normalizeOrder().filter((key) => key !== panelKey),
          panelKey,
        ];
      } else {
        state.hiddenAuxiliaryPanels.add(panelKey);
      }
      publish();
    }

    function bindToggle(button, action) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail === 0) action();
      });
    }

    function syncRepresentativeToggles(element, controls = null) {
      if (!element) return null;
      const controlsProvided = Array.isArray(controls);
      const nextSignature = controlsProvided ? controlsSignature(controls) : "";
      const controlsChanged = controlsProvided
        && nextSignature !== String(element.auxiliaryRepresentativeControlsSignature || "");
      if (controlsChanged) {
        element.auxiliaryRepresentativeControls = controls.map((control) => ({ ...control }));
        element.auxiliaryRepresentativeControlsSignature = nextSignature;
      }
      const representativeControls = Array.isArray(element.auxiliaryRepresentativeControls)
        ? element.auxiliaryRepresentativeControls
        : [];
      let row = element.querySelector(":scope > .auxiliary-representative-toggles");
      if (!row) {
        row = document.createElement("div");
        row.className = "auxiliary-representative-toggles";
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", "보조지표 표시");
        element.append(row);
      }
      if (!controlsProvided || (!controlsChanged && row.childElementCount)) return row;

      const fragment = document.createDocumentFragment();
      representativeControls.forEach((control) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "auxiliary-representative-toggle";
        button.dataset.auxiliaryPanel = control.panelKey;
        syncControl(button, { active: control.active, pressed: control.active });
        button.setAttribute("aria-label", `${control.text} 보조지표 ${control.active ? "숨기기" : "표시"}`);
        button.disabled = control.available === false;
        button.style.setProperty("--auxiliary-series-color", control.color || "#ffffff");
        button.textContent = control.text;
        bindToggle(button, () => togglePanel(control.panelKey));
        fragment.append(button);
      });
      row.replaceChildren(fragment);
      return row;
    }

    return Object.freeze({
      bindToggle,
      isPanelVisible,
      normalizeOrder,
      sync,
      syncRepresentativeToggles,
      togglePanel,
      toggleSeries,
    });
  }

export {
    clampPercent,
    createAuxiliaryPanelControlView,
    createProgressView,
    renderMessage,
    syncChoiceControls,
    syncControl,
};
