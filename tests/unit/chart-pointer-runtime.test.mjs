import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("docs/modules/chart-pointer-runtime.js"), "utf8");
const context = { clearTimeout, setTimeout };
vm.runInNewContext(source, context);
const {
  createHoverIdleController,
  dispatchNativeHoverAtPoint,
} = context.ThinkStockChartPointerRuntime;

function fakeElement() {
  const classes = new Set();
  return {
    classes,
    classList: {
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
    },
  };
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("hover popup waits for pointer idle and uses only the latest sample", async () => {
  const element = fakeElement();
  const samples = [];
  const controller = createHoverIdleController(context, {
    delayMs: 20,
    getElements: () => [element],
    onIdle: (sample) => samples.push(sample),
  });

  controller.schedule({ x: 1 });
  await wait(8);
  controller.schedule({ x: 2 });
  assert.equal(element.classes.has("is-hover-waiting"), true);
  await wait(28);

  assert.deepEqual(samples, [{ x: 2 }]);
  assert.equal(element.classes.has("is-hover-waiting"), false);
});

test("cancel removes the waiting state without showing a stale popup", async () => {
  const element = fakeElement();
  let idleCalls = 0;
  const controller = createHoverIdleController(context, {
    delayMs: 10,
    getElements: () => [element],
    onIdle: () => { idleCalls += 1; },
  });

  controller.schedule({ x: 1 });
  controller.cancel();
  await wait(18);

  assert.equal(idleCalls, 0);
  assert.equal(element.classes.has("is-hover-waiting"), false);
});

test("waiting hides an existing native popup without clearing its content", async () => {
  const element = fakeElement();
  let waitStarts = 0;
  const controller = createHoverIdleController(context, {
    delayMs: 10,
    getElements: () => [element],
    onWaitStart: () => { waitStarts += 1; },
  });

  controller.schedule({ x: 1 });
  controller.schedule({ x: 2 });
  assert.equal(waitStarts, 1);
  assert.equal(element.classes.has("is-hover-waiting"), true);
  await wait(18);
  assert.equal(element.classes.has("is-hover-waiting"), false);
});

test("idle hover replays one native mouse move at the last pointer position", () => {
  const events = [];
  const target = { dispatchEvent: (event) => events.push(event) };
  const source = {
    contains: (candidate) => candidate === target,
    querySelector: () => null,
  };
  class MouseEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  const scope = {
    MouseEvent,
    document: { elementFromPoint: () => target },
  };

  assert.equal(dispatchNativeHoverAtPoint(scope, source, 120, 240), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "mousemove");
  assert.equal(events[0].clientX, 120);
  assert.equal(events[0].clientY, 240);
});
