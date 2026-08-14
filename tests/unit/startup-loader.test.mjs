import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";


const source = await readFile(new URL("../../docs/modules/startup-loader.js", import.meta.url), "utf8");

test("startup loader owns title progress and delayed completion state", () => {
  const classes = new Set();
  const attributes = new Map();
  const styles = new Map();
  const animationFrames = [];
  const timers = [];
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
  const context = vm.createContext({
    ...scope,
    self: scope,
    globalThis: scope,
    Object,
    String,
    Number,
    Math,
  });
  vm.runInContext(source, context);
  const loader = scope.ThinkStockStartupLoader.createStartupLoader(scope);

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
  timers.shift()();
  assert.equal(classes.has("is-loading"), false);
});
