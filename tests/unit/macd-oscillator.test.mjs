import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/macd-oscillator.js");
const { buildMacdOscillator, thinMacdPoints } = globalThis.ThinkStockMacdOscillator;

test("builds a standard 12-26-9 MACD oscillator without changing source alignment", () => {
  const dates = Array.from({ length: 80 }, (_, index) => `2026-01-${String(index + 1).padStart(2, "0")}`);
  const prices = dates.map((_, index) => 100 * Math.exp((index * index) / 18000));
  const model = buildMacdOscillator({ dates, prices });

  assert.equal(model.dates.length, 80);
  assert.deepEqual(model.periods, { fast: 12, slow: 26, signal: 9 });
  assert.equal(model.oscillator.findIndex(Number.isFinite), 33);
  assert.ok(model.normalized.at(-1) > 0);
  assert.ok(model.signal > 0);
});

test("returns no oscillator when MACD warm-up history is insufficient", () => {
  assert.equal(buildMacdOscillator({
    dates: Array.from({ length: 33 }, (_, index) => String(index)),
    prices: Array.from({ length: 33 }, (_, index) => 100 + index),
  }), null);
});

test("thinning preserves first, last, and local histogram extremes", () => {
  const dates = Array.from({ length: 200 }, (_, index) => String(index));
  const values = dates.map((_, index) => Math.sin(index / 3));
  values[87] = -9;
  values[133] = 8;
  const thinned = thinMacdPoints(dates, values, 40);

  assert.ok(thinned.dates.length <= 40);
  assert.equal(thinned.dates[0], "0");
  assert.equal(thinned.dates.at(-1), "199");
  assert.ok(thinned.values.includes(-9));
  assert.ok(thinned.values.includes(8));
});
