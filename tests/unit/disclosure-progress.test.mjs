import assert from "node:assert/strict";
import test from "node:test";

const { createDisclosureProgress } = await import("../../docs/modules/task-progress-runtime.mjs");

test("disclosure progress aggregates real per-ticker completion and avoids instant flashes", () => {
  const root = { hidden: true };
  const text = { textContent: "" };
  const bar = { style: { width: "0%" } };
  const timers = new Map();
  let nextTimer = 0;
  const setTimer = (callback) => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const runTimer = (id) => {
    const callback = timers.get(id);
    timers.delete(id);
    callback?.();
  };
  const progress = createDisclosureProgress(globalThis, {
    getRoot: () => root,
    getText: () => text,
    getBar: () => bar,
    setTimer,
    clearTimer,
    revealDelayMs: 100,
    hideDelayMs: 100,
  });

  progress.begin("005930.KS", "삼성전자 공시");
  progress.begin("000660.KS", "SK하이닉스 공시");
  assert.equal(root.hidden, true);
  runTimer(1);
  assert.equal(root.hidden, false);

  progress.update("005930.KS", 0.5);
  assert.equal(progress.snapshot().percent, 25);
  progress.complete("005930.KS");
  assert.equal(progress.snapshot().percent, 50);
  progress.update("000660.KS", 0.5);
  assert.equal(progress.snapshot().percent, 75);
  progress.complete("000660.KS");
  assert.equal(progress.snapshot().percent, 100);
  assert.equal(bar.style.width, "100%");

  runTimer(2);
  assert.equal(root.hidden, true);
  assert.deepEqual(progress.snapshot(), { active: 0, total: 0, percent: 0, visible: false });
});

test("cancelling one DART layer keeps the other layer progress visible", () => {
  const root = { hidden: false };
  const text = { textContent: "" };
  const bar = { style: { width: "0%" } };
  const progress = createDisclosureProgress(globalThis, {
    getRoot: () => root,
    getText: () => text,
    getBar: () => bar,
    setTimer: () => 1,
    clearTimer: () => {},
  });

  progress.begin("disclosure:005930.KS", "삼성전자 공시");
  progress.begin("insider:005930.KS", "삼성전자 내부거래");
  progress.update("insider:005930.KS", 0.4);
  progress.cancel("disclosure:005930.KS");

  assert.deepEqual(progress.snapshot(), {
    active: 1,
    total: 1,
    percent: 40,
    visible: true,
  });
  assert.match(text.textContent, /내부거래/);
});

test("progress stays beside the DART layer that started the shared loading session", () => {
  const root = { hidden: false, dataset: {} };
  const text = { textContent: "" };
  const bar = { style: { width: "0%" } };
  const progress = createDisclosureProgress(globalThis, {
    getRoot: () => root,
    getText: () => text,
    getBar: () => bar,
    setTimer: () => 1,
    clearTimer: () => {},
  });

  progress.begin("insider:005930.KS", "삼성전자 내부거래");
  progress.begin("disclosure:005930.KS", "삼성전자 공시");
  assert.equal(root.dataset.anchor, "insider");

  progress.cancel("insider:005930.KS");
  assert.equal(root.dataset.anchor, "disclosure");
  progress.cancel("disclosure:005930.KS");
  assert.equal(root.dataset.anchor, undefined);

  progress.begin("disclosure:000660.KS", "SK하이닉스 공시");
  progress.begin("insider:000660.KS", "SK하이닉스 내부거래");
  assert.equal(root.dataset.anchor, "disclosure");
});
