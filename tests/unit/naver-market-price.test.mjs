import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateNaverPriceFallback,
  parseNaverPriceSeries,
  validateNaverPriceTail,
} from "../../shared/naver-market-price.mjs";

test("parses decimal indices and integer stock closes from Naver", () => {
  assert.deepEqual(parseNaverPriceSeries(`[
    ["20260807", 1, 2, 3, 6258.77, 10],
    ["20260810", 1, 2, 3, 6318.05, 20]
  ]`), [
    { date: "2026-08-07", close: 6258.77, volume: 10 },
    { date: "2026-08-10", close: 6318.05, volume: 20 },
  ]);
});

test("requires a matching overlap before accepting a newer point", () => {
  assert.equal(evaluateNaverPriceFallback(
    { date: "2026-08-07", close: 6258.77 },
    [
      { date: "2026-08-07", close: 6258.77 },
      { date: "2026-08-10", close: 6318.05 },
    ],
  ).accepted, true);
  assert.equal(evaluateNaverPriceFallback(
    { date: "2026-08-07", close: 6258.77 },
    [
      { date: "2026-08-07", close: 5000 },
      { date: "2026-08-10", close: 6318.05 },
    ],
  ).status, "mismatch");
});

test("accepts a newer point when matching volume proves the overlap is the same session", () => {
  const evaluation = evaluateNaverPriceFallback(
    { date: "2026-09-14", close: 49600, volume: 420104 },
    [
      { date: "2026-09-14", close: 48550, volume: 420104 },
      { date: "2026-09-15", close: 49350, volume: 223177 },
    ],
  );
  assert.deepEqual(evaluation, {
    accepted: true,
    status: "matched-newer",
    point: { date: "2026-09-15", close: 49350, volume: 223177 },
    overlapRatio: 49600 / 48550,
    jumpRatio: 49350 / 48550,
    verification: "volume",
  });
});

test("does not bypass an overlap mismatch when volume also differs", () => {
  const evaluation = evaluateNaverPriceFallback(
    { date: "2026-09-14", close: 49600, volume: 420104 },
    [
      { date: "2026-09-14", close: 48550, volume: 420105 },
      { date: "2026-09-15", close: 49350, volume: 223177 },
    ],
  );
  assert.equal(evaluation.accepted, false);
  assert.equal(evaluation.status, "mismatch");
});

test("returns only a validated missing daily tail", () => {
  const reference = { date: "2026-08-10", close: 6318.05 };
  const points = [
    { date: "2026-08-05", close: 6100 },
    { date: "2026-08-06", close: 6200 },
    { date: "2026-08-07", close: 6258.77 },
    { date: "2026-08-10", close: 6318.05 },
  ];
  assert.deepEqual(validateNaverPriceTail(reference, points, { since: "2026-08-07" }), {
    accepted: true,
    status: "matched",
    points: points.slice(2),
    overlapRatio: 1,
  });
  assert.equal(validateNaverPriceTail(
    reference,
    points.map((point) => point.date === reference.date ? { ...point, close: 5000 } : point),
    { since: "2026-08-07" },
  ).status, "mismatch");
});

test("accepts an adjusted-price tail when overlap volume matches exactly", () => {
  const result = validateNaverPriceTail(
    { date: "2026-09-14", close: 49600, volume: 420104 },
    [
      { date: "2026-09-14", close: 48550, volume: 420104 },
      { date: "2026-09-15", close: 49350, volume: 223177 },
    ],
    { since: "2026-09-14" },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.verification, "volume");
  assert.equal(result.points.at(-1).date, "2026-09-15");
});
