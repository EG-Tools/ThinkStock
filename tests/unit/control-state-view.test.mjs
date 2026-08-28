import assert from "node:assert/strict";
import test from "node:test";


import * as view from "../../docs/modules/control-state-view.mjs";


function fakeControl(value = "") {
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset: { value },
    disabled: false,
    textContent: "",
    title: "",
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
  };
}


test("syncs toggle visuals and accessibility state in one operation", () => {
  const button = fakeControl();
  const state = view.syncControl(button, {
    active: true,
    pressed: true,
    busy: true,
    disabled: true,
    text: "AI",
    title: "계산 중",
    classes: { configured: true },
  });

  assert.deepEqual(state, { active: true, busy: true, disabled: true });
  assert.equal(button.textContent, "AI");
  assert.equal(button.title, "계산 중");
  assert.equal(button.classList.contains("configured"), true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
});


test("syncs a mutually exclusive control group", () => {
  const controls = [fakeControl("vertical"), fakeControl("horizontal"), fakeControl("cross")];
  assert.equal(view.syncChoiceControls(controls, "horizontal"), 3);
  assert.deepEqual(controls.map((control) => control.classList.contains("is-active")), [false, true, false]);
  assert.deepEqual(controls.map((control) => control.getAttribute("aria-pressed")), ["false", "true", "false"]);
});


test("renders escaped message lines through the shared feedback view", () => {
  const element = { innerHTML: "" };
  const count = view.renderMessage(element, ["A", "<B>"], {
    error: true,
    escape: (value) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  });
  assert.equal(count, 2);
  assert.equal(element.innerHTML, '<div class="message error">A<br>&lt;B&gt;</div>');
});

test("auxiliary panel controls own visibility, activation order, and persistence", () => {
  let persisted = 0;
  let changed = 0;
  const state = {
    auxiliaryPanelOrder: ["adr", "fearGreed", "newsSentiment", "vkospi"],
    hiddenAuxiliaryPanels: new Set(["vkospi"]),
    hiddenAuxiliarySeries: new Set(),
  };
  const controls = view.createAuxiliaryPanelControlView({
    document: { getElementById: () => null },
  }, {
    state,
    panelKeys: ["adr", "vkospi", "fearGreed", "newsSentiment"],
    persist: () => { persisted += 1; },
    onChange: () => { changed += 1; },
  });

  assert.deepEqual(controls.normalizeOrder(), ["adr", "vkospi", "fearGreed", "newsSentiment"]);
  controls.togglePanel("vkospi");
  assert.equal(controls.isPanelVisible("vkospi"), true);
  assert.equal(state.auxiliaryPanelOrder.at(-1), "vkospi");
  controls.toggleSeries("vix");
  assert.equal(state.hiddenAuxiliarySeries.has("vix"), true);
  assert.equal(persisted, 2);
  assert.equal(changed, 2);
});
