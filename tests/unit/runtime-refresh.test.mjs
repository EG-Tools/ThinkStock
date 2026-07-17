import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const source = await readFile(path.resolve("docs/modules/runtime-refresh.js"), "utf8");
const context = {};
vm.runInNewContext(source, context);
const { runRefreshPhases } = context.ThinkStockRuntimeRefresh;


function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}


test("starts supplemental work before critical work finishes", async () => {
  const critical = deferred();
  const supplemental = deferred();
  const events = [];
  const task = runRefreshPhases({
    criticalTasks: [() => { events.push("critical-start"); return critical.promise; }],
    supplementalTasks: [() => { events.push("supplemental-start"); return supplemental.promise; }],
    onCritical: () => events.push("critical-ready"),
    onSupplemental: () => events.push("supplemental-ready"),
  });

  await Promise.resolve();
  assert.deepEqual(events, ["critical-start", "supplemental-start"]);
  supplemental.resolve("supplemental");
  await Promise.resolve();
  assert.deepEqual(events, ["critical-start", "supplemental-start"]);
  critical.resolve("critical");
  const result = await task;

  assert.deepEqual(events, [
    "critical-start",
    "supplemental-start",
    "critical-ready",
    "supplemental-ready",
  ]);
  assert.deepEqual(Array.from(result.criticalResults), ["critical"]);
  assert.deepEqual(Array.from(result.supplementalResults), ["supplemental"]);
});


test("does not run supplemental completion when critical work fails", async () => {
  let supplementalCompleted = false;
  await assert.rejects(runRefreshPhases({
    criticalTasks: [() => Promise.reject(new Error("critical failed"))],
    supplementalTasks: [() => Promise.resolve("done")],
    onSupplemental: () => { supplementalCompleted = true; },
  }), /critical failed/);
  assert.equal(supplementalCompleted, false);
});
