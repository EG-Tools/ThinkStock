import assert from "node:assert/strict";
import test from "node:test";

import { coMovement } from "../../docs/modules/co-movement.mjs";

test("calculates directional agreement from non-flat common changes", () => {
  const result = coMovement.calculateDirectionalAgreement([
    { date: "2026-01-01", stock: 100, market: 100 },
    { date: "2026-01-02", stock: 102, market: 101 },
    { date: "2026-01-03", stock: 101, market: 100 },
    { date: "2026-01-04", stock: 103, market: 99 },
    { date: "2026-01-05", stock: 104, market: 100 },
  ], "stock", "market");

  assert.equal(result.samples, 4);
  assert.equal(result.matches, 3);
  assert.equal(result.rate, 75);
});

test("ignores missing and flat comparison changes", () => {
  const result = coMovement.calculateDirectionalAgreement([
    { date: "2026-01-01", stock: 100, market: 100 },
    { date: "2026-01-02", stock: 101, market: 100 },
    { date: "2026-01-03", stock: null, market: 101 },
    { date: "2026-01-04", stock: 102, market: 102 },
    { date: "2026-01-05", stock: 101, market: 101 },
    { date: "2026-01-06", stock: 103, market: 102 },
  ], "stock", "market");

  assert.equal(result.samples, 3);
  assert.equal(result.rate, 100);
});

test("uses the selected period when target history covers the window", () => {
  const rows = [
    { date: "2025-01-01", stock: 100 },
    { date: "2026-01-01", stock: 120 },
  ];

  assert.equal(coMovement.effectivePeriodLabel(rows, "stock", 12), "1년");
  assert.equal(coMovement.effectivePeriodLabel(rows, "stock", 3), "3개월");
});

test("formats a short visible trading window in days", () => {
  const fiveTradingDaysInMonths = 5 / (365.2425 / 12);
  assert.equal(coMovement.formatPeriod(fiveTradingDaysInMonths), "5일");
});

test("keeps a nearly complete twelve-month viewport labeled as one year", () => {
  assert.equal(coMovement.formatPeriod(11.99), "1년");
});

test("shortens a 30-year request to the target's actual history", () => {
  const rows = [
    { date: "1996-01-01", market: 100, stock: null },
    { date: "2010-01-01", market: 130, stock: 100 },
    { date: "2026-01-01", market: 180, stock: 220 },
  ];

  const summary = coMovement.buildSummary({
    rows,
    targetKey: "stock",
    targetName: "테스트종목",
    requestedMonths: 360,
    comparisons: [{ key: "market", label: "코스피" }],
  });

  assert.equal(summary.periodLabel, "16년");
  assert.equal(summary.targetName, "테스트종목");
});

test("slices a sorted long history to the visible viewport", () => {
  const rows = [
    { date: "2026-01-01", stock: 100 },
    { date: "2026-01-02", stock: 101 },
    { date: "2026-01-03", stock: 102 },
    { date: "2026-01-04", stock: 103 },
  ];
  assert.deepEqual(coMovement.sliceRowsByDateRange(rows, [
    Date.parse("2026-01-02T00:00:00Z"),
    Date.parse("2026-01-03T00:00:00Z"),
  ]), rows.slice(1, 3));
});

test("panel controller coalesces frames and skips unchanged calculations and DOM writes", () => {
  const queued = [];
  const canceled = [];
  const elements = [];
  const document = {
    createElement(tagName) {
      const element = {
        tagName,
        className: "",
        textContent: "",
        title: "",
        append(...items) {
          this.textContent += items.map((item) => (
            typeof item === "string" ? item : item.textContent
          )).join("");
        },
      };
      elements.push(element);
      return element;
    },
  };
  const panel = {
    hidden: true,
    childNodes: [],
    replaceChildren(...children) { this.childNodes = children; },
    setAttribute(name, value) { this[name] = String(value); },
  };
  let range = [
    Date.parse("2026-01-01T00:00:00Z"),
    Date.parse("2026-01-05T00:00:00Z"),
  ];
  const rows = [
    { date: "2026-01-01", stock: 100, market: 100 },
    { date: "2026-01-02", stock: 101, market: 101 },
    { date: "2026-01-03", stock: 102, market: 102 },
    { date: "2026-01-04", stock: 101, market: 101 },
    { date: "2026-01-05", stock: 103, market: 103 },
  ];
  const controller = coMovement.createPanelController({ document }, {
    document,
    panel,
    requestFrame: (callback) => { queued.push(callback); return queued.length; },
    cancelFrame: (frameId) => { canceled.push(frameId); },
    readState: () => ({
      enabled: true,
      targetKey: "stock",
      targetName: "테스트",
      rows,
      revision: "price:1",
      range,
      requestedMonths: 6,
      comparisons: [{ key: "market", label: "시장" }],
    }),
  });

  assert.equal(controller.request(), true);
  assert.equal(controller.request(), false);
  queued.shift()();
  assert.equal(panel.hidden, false);
  assert.equal(controller.stats().calculations, 1);
  assert.equal(controller.stats().renders, 1);

  controller.renderNow();
  assert.equal(controller.stats().calculations, 1);
  assert.equal(controller.stats().renders, 1);

  range = [range[0], Date.parse("2026-01-04T00:00:00Z")];
  controller.renderNow();
  assert.equal(controller.stats().calculations, 2);

  controller.request();
  range = [range[0], Date.parse("2026-01-03T00:00:00Z")];
  controller.flush();
  assert.deepEqual(canceled, [1]);
  assert.equal(controller.stats().pending, false);
  assert.equal(controller.stats().calculations, 3);
});

test("panel controller waits for the final viewport before recalculating", () => {
  const timers = [];
  const cleared = [];
  const frames = [];
  const document = {
    createElement: () => ({
      textContent: "",
      append(...items) {
        this.textContent += items.map((item) => (
          typeof item === "string" ? item : item.textContent
        )).join("");
      },
    }),
  };
  const panel = {
    hidden: true,
    childNodes: [],
    replaceChildren(...children) { this.childNodes = children; },
    setAttribute() {},
  };
  const controller = coMovement.createPanelController({ document }, {
    document,
    panel,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame() {},
    setTimer: (callback) => { timers.push(callback); return timers.length; },
    clearTimer: (timerId) => { cleared.push(timerId); },
    readState: () => ({
      enabled: true,
      targetKey: "stock",
      targetName: "테스트",
      rows: [
        { date: "2026-01-01", stock: 100, market: 100 },
        { date: "2026-01-02", stock: 101, market: 101 },
        { date: "2026-01-03", stock: 102, market: 102 },
        { date: "2026-01-04", stock: 103, market: 103 },
      ],
      revision: "price:1",
      range: [Date.parse("2026-01-01T00:00:00Z"), Date.parse("2026-01-04T00:00:00Z")],
      requestedMonths: 6,
      comparisons: [{ key: "market", label: "시장" }],
    }),
  });

  controller.requestDeferred();
  controller.requestDeferred();
  assert.deepEqual(cleared, [1]);
  assert.equal(controller.stats().pending, true);
  timers.at(-1)();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(controller.stats().calculations, 1);
  assert.equal(controller.stats().pending, false);
});
