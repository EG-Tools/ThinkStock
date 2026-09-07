import assert from "node:assert/strict";
import test from "node:test";

import { createNumberStepperController } from "../../docs/modules/settings-panel-runtime.mjs";

function element() {
  const listeners = new Map();
  return {
    disabled: false,
    textContent: "",
    value: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      listeners.get("click")?.();
    },
  };
}

test("one number-stepper controller owns bounded, stepped, and discrete settings", () => {
  const decrease = element();
  const increase = element();
  const output = element();
  let offset = -2;
  const bounded = createNumberStepperController({
    decrease,
    increase,
    output,
    getValue: () => offset,
    setValue: (value) => { offset = Math.max(-10, Math.min(0, value)); },
    min: -10,
    max: 0,
  });

  assert.equal(bounded.bind(), -2);
  assert.equal(output.textContent, "-2");
  decrease.click();
  assert.equal(offset, -3);
  increase.click();
  assert.equal(offset, -2);
  offset = -10;
  assert.equal(bounded.sync(), -10);
  assert.equal(decrease.disabled, true);
  bounded.change(-1);
  assert.equal(offset, -10);
  offset = 0;
  assert.equal(bounded.sync(), 0);
  assert.equal(increase.disabled, true);
  bounded.change(1);
  assert.equal(offset, 0);

  let universe = 400;
  const stepped = createNumberStepperController({
    getValue: () => universe,
    setValue: (value) => { universe = value; },
    min: 100,
    max: 1000,
    step: 100,
  });
  stepped.change(1);
  assert.equal(universe, 500);

  let period = 20;
  const discrete = createNumberStepperController({
    getValue: () => period,
    setValue: (value) => { period = value; },
    values: [5, 10, 20, 30, 60],
  });
  discrete.change(1);
  assert.equal(period, 30);
  discrete.change(-1);
  assert.equal(period, 20);
});
