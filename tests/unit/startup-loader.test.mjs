import assert from "node:assert/strict";
import test from "node:test";
import { createStartupLoader } from "../../docs/modules/app-bootstrap-orchestrator.mjs";

test("startup loader owns title progress and delayed completion state", () => {
  const classes = new Set();
  const attributes = new Map();
  const styles = new Map();
  const animationFrames = [];
  const timers = [];
  let completed = 0;
  const title = {
    textContent: "Think Stock",
    dataset: {},
    style: { setProperty: (key, value) => styles.set(key, value) },
    setAttribute: (key, value) => attributes.set(key, value),
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
    },
  };
  const scope = {
    performance: { now: () => 12 },
    document: { querySelector: () => title },
    requestAnimationFrame: (callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: () => {},
  };
  const loader = createStartupLoader(scope, {
    onComplete: ({ startedAt }) => {
      assert.equal(startedAt, 12);
      completed += 1;
    },
  });

  loader.show();
  assert.equal(classes.has("is-loading"), true);
  assert.equal(styles.get("--title-load"), "0.00%");
  assert.equal(title.dataset.title, "Think Stock");

  loader.setProgress(50);
  for (let index = 0; index < 100 && animationFrames.length; index += 1) {
    animationFrames.shift()();
  }
  assert.equal(attributes.get("aria-valuenow"), "50");

  loader.hide();
  assert.equal(classes.has("is-loading"), true);
  for (let index = 0; index < 100 && animationFrames.length; index += 1) {
    animationFrames.shift()();
  }
  assert.equal(loader.isComplete(), true);
  assert.equal(completed, 1);
  timers.shift()();
  assert.equal(classes.has("is-loading"), false);
});
