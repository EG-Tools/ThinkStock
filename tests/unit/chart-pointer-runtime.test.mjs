import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  createHoverIdleController,
  dispatchNativeHoverAtPoint,
  pointerEventInsideElement,
} from "../../docs/modules/chart-pointer-runtime.mjs";

const context = { clearTimeout, setTimeout };

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

test("render-time pointer leave keeps the cursor when the pointer is still inside", () => {
  const element = {
    getBoundingClientRect: () => ({ left: 10, right: 210, top: 20, bottom: 120 }),
  };
  assert.equal(pointerEventInsideElement({ clientX: 100, clientY: 80 }, element), true);
  assert.equal(pointerEventInsideElement({ clientX: 220, clientY: 80 }, element), false);
});

test("each chart uses one pointer-move pipeline for cursor and idle hover work", async () => {
  const source = await readFile(
    new URL("../../docs/modules/chart-pointer-runtime.mjs", import.meta.url),
    "utf8",
  );
  const bindings = source.match(/listen\(chartEl, "pointermove"/g) || [];
  assert.equal(bindings.length, 1);
  assert.equal(source.includes("onPointerHoverPreview"), false);
  assert.match(source, /hoverIdleController\.schedule\(\{[\s\S]*schedulePointerMove/);
});

test("viewport movement never replays a pointer sampled before the final render", async () => {
  const source = await readFile(
    new URL("../../docs/modules/chart-pointer-runtime.mjs", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("wheelPointerSample"), false);
  assert.equal(source.includes("settleViewportAndRestorePointer"), false);
  assert.equal(source.includes("lastEpsMarkerHoverHit"), false);
  assert.match(source, /onWaitStart:\s*\(\) => clearRenderedPointerHover\(mainEl\)/);
  assert.match(source, /classList\?\.remove\("is-event-marker-hovering", "is-ai-report-hovering"\)/);
  assert.match(source, /invalidateViewportPointerState\(sourceEl\);\s*clearPointerOwnedHover\(sourceEl\);\s*hideSyncedCursor\(\);/);
  const wheelSettleStart = source.indexOf(
    "wheelRangeTimer = setTimeout(() => {",
    source.indexOf("const onWheelRange ="),
  );
  const wheelSettleEnd = source.indexOf("}, 160);", wheelSettleStart);
  const wheelSettleBlock = source.slice(wheelSettleStart, wheelSettleEnd);
  assert.ok(wheelSettleBlock.indexOf("interactionState.wheelZooming = false") >= 0);
  assert.ok(
    wheelSettleBlock.indexOf("interactionState.wheelZooming = false")
      < wheelSettleBlock.indexOf("requestViewportRender?.()"),
  );
  assert.ok(
    wheelSettleBlock.indexOf("getChartNavigationController().finishWheelZoom()")
      < wheelSettleBlock.indexOf("requestViewportRender?.()"),
  );
  const movingBlock = source.slice(
    source.indexOf("const processPointerMove ="),
    source.indexOf("pointerMoveController = createPointerFrameController"),
  );
  assert.equal(movingBlock.includes("scheduleEventMarkerHoverHighlight"), false);
  assert.equal(movingBlock.includes("syncHoverToChart"), false);
});

test("destroy cancels the active wheel settlement before removing listeners", async () => {
  const source = await readFile(
    new URL("../../docs/modules/chart-pointer-runtime.mjs", import.meta.url),
    "utf8",
  );
  const destroyStart = source.indexOf("function destroy() {");
  const destroyEnd = source.indexOf("\n    function bind()", destroyStart);
  const destroyBlock = source.slice(destroyStart, destroyEnd);

  assert.ok(destroyStart >= 0 && destroyEnd > destroyStart);
  assert.match(destroyBlock, /clearActiveWheelInteraction\?\.\(\);/);
  assert.ok(
    destroyBlock.indexOf("clearActiveWheelInteraction?.();")
      < destroyBlock.indexOf("while (boundListeners.length)"),
  );
});
