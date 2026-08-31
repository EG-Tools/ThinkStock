import assert from "node:assert/strict";
import test from "node:test";
import { createScrollAffordance } from "../../docs/modules/control-state-view.mjs";

function createClassList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    contains: (item) => values.has(item),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    toggle(item, force) {
      if (force) values.add(item);
      else values.delete(item);
    },
  };
}

test("shared scroll affordance tracks hidden-scrollbar direction cues", () => {
  const frames = [];
  const listeners = new Map();
  const scope = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const container = {
    clientHeight: 100,
    scrollHeight: 260,
    scrollTop: 0,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const indicator = { classList: createClassList() };
  const affordance = createScrollAffordance(scope);

  affordance.bind(container, indicator);
  frames.shift()();
  assert.equal(indicator.classList.contains("ui-scroll-affordance"), true);
  assert.equal(indicator.classList.contains("can-scroll-up"), false);
  assert.equal(indicator.classList.contains("can-scroll-down"), true);

  container.scrollTop = 80;
  listeners.get("scroll")();
  frames.shift()();
  assert.equal(indicator.classList.contains("can-scroll-up"), true);
  assert.equal(indicator.classList.contains("can-scroll-down"), true);

  container.scrollTop = 160;
  listeners.get("scroll")();
  frames.shift()();
  assert.equal(indicator.classList.contains("can-scroll-up"), true);
  assert.equal(indicator.classList.contains("can-scroll-down"), false);

  affordance.detach();
  assert.equal(indicator.classList.contains("can-scroll-up"), false);
  assert.equal(indicator.classList.contains("can-scroll-down"), false);
  assert.equal(listeners.has("scroll"), false);
});
