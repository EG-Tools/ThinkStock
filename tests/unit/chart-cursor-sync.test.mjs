import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/chart-cursor-sync.js");
const cursorSync = globalThis.ThinkStockChartCursorSync;

function fakeChart(offset, length, left = 0) {
  const lines = new Map();
  return {
    _fullLayout: {
      _size: { t: 10, h: 180 },
      xaxis: {
        _offset: offset,
        _length: length,
        d2p: (value) => Number(value) * length / 100,
      },
    },
    ownerDocument: {
      createElement: () => ({ className: "", style: {} }),
    },
    querySelector: (selector) => lines.get(String(selector).replace(/^\./, "")) || null,
    appendChild: (element) => { lines.set(element.className, element); },
    getBoundingClientRect: () => ({ left, top: 50 }),
    get line() { return lines.get("synced-cursor-line") || null; },
    get horizontalLine() { return lines.get("synced-cursor-horizontal-line") || null; },
  };
}

function pixelFromTransform(value) {
  return Number(/translateX\(([-\d.]+)px\)/.exec(String(value || ""))?.[1]);
}

test("cursor sync maps one date value through each chart's own margins", () => {
  const main = fakeChart(18, 964);
  const auxiliary = fakeChart(42, 916);
  const mainPixel = cursorSync.xValueToLocalPixel(main, 65);
  const auxiliaryPixel = cursorSync.xValueToLocalPixel(auxiliary, 65);

  assert.notEqual(mainPixel, auxiliaryPixel);
  assert.equal((mainPixel - 18) / 964 * 100, 65);
  assert.equal((auxiliaryPixel - 42) / 916 * 100, 65);
});

test("cursor controller coalesces pointer moves and preserves the shared date", () => {
  const main = fakeChart(18, 964);
  const auxiliary = fakeChart(42, 916);
  let frame = null;
  const controller = cursorSync.createCursorSyncController({}, {
    getTargets: () => [main, auxiliary],
    requestFrame: (callback) => {
      frame = callback;
      return 1;
    },
    cancelFrame: () => {},
  });

  controller.schedule({ xValue: 25 });
  controller.schedule({ xValue: 65 });
  assert.equal(controller.isBusy(), true);
  frame();

  const mainPixel = pixelFromTransform(main.line.style.transform);
  const auxiliaryPixel = pixelFromTransform(auxiliary.line.style.transform);
  assert.ok(Math.abs(((mainPixel - 18) / 964 * 100) - 65) < 0.01);
  assert.ok(Math.abs(((auxiliaryPixel - 42) / 916 * 100) - 65) < 0.01);
  assert.equal(controller.isBusy(), false);
});

test("cursor preview paints every chart synchronously before a frame is requested", () => {
  const main = fakeChart(18, 964, 100);
  const auxiliary = fakeChart(42, 916, 120);
  let requestedFrames = 0;
  const controller = cursorSync.createCursorSyncController({}, {
    getTargets: () => [main, auxiliary],
    requestFrame: () => {
      requestedFrames += 1;
      return 1;
    },
    cancelFrame: () => {},
  });

  assert.equal(controller.previewClientX(400), 2);
  assert.equal(pixelFromTransform(main.line.style.transform), 300);
  assert.equal(pixelFromTransform(auxiliary.line.style.transform), 280);
  assert.equal(main.line.style.opacity, "1");
  assert.equal(auxiliary.line.style.opacity, "1");
  assert.equal(requestedFrames, 0);
});

test("cursor modes hide the vertical line in horizontal mode and avoid cross-chart y projection", () => {
  const main = fakeChart(18, 964, 100);
  const auxiliary = fakeChart(42, 916, 120);
  let activeMode = "horizontal";
  const controller = cursorSync.createCursorSyncController({}, {
    getMode: () => activeMode,
    getTargets: () => [main, auxiliary],
    requestFrame: (callback) => {
      callback();
      return 1;
    },
    cancelFrame: () => {},
  });

  controller.apply({
    xValue: 50,
    sourceElement: main,
    sourceLocalPixel: 500,
    sourceLocalYPixel: 90,
  });
  assert.equal(main.line.style.opacity, "0");
  assert.equal(auxiliary.line.style.opacity, "0");
  assert.equal(main.horizontalLine.style.opacity, "1");
  assert.equal(main.horizontalLine.style.transform, "translateY(90.00px)");
  assert.equal(auxiliary.horizontalLine.style.opacity, "0");

  activeMode = "cross";
  controller.refresh();
  assert.equal(main.line.style.opacity, "1");
  assert.equal(auxiliary.line.style.opacity, "1");
  assert.equal(main.horizontalLine.style.opacity, "1");
  assert.equal(auxiliary.horizontalLine.style.opacity, "0");

  activeMode = "vertical";
  controller.refresh();
  assert.equal(main.line.style.opacity, "1");
  assert.equal(auxiliary.line.style.opacity, "1");
  assert.equal(main.horizontalLine.style.opacity, "0");
});
