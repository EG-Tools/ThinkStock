import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/control-state-view.js");
const view = globalThis.ThinkStockControlStateView;


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
