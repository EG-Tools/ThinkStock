import assert from "node:assert/strict";
import test from "node:test";
import { classifyChangedFiles, normalizeChangedFiles } from "../../scripts/test_scope.mjs";

test("affected test scope ignores local-only iPhone preview files", () => {
  assert.deepEqual(normalizeChangedFiles([
    "run_local_iphone13promax.bat",
    "scripts\\resize_preview_window.ps1",
  ]), []);
});

test("affected test scope selects WebKit smoke for shared app UI changes", () => {
  const scope = classifyChangedFiles(["docs/app.js", "docs/modules/ai-forecast-app.js"]);
  assert.equal(scope.runUnit, true);
  assert.equal(scope.runFullUnit, true);
  assert.equal(scope.runWebkitSmoke, true);
  assert.equal(scope.runServiceWorker, false);
});

test("affected test scope maps an isolated module to its focused unit test", () => {
  const scope = classifyChangedFiles(["docs/modules/runtime-series-merge.js"]);

  assert.equal(scope.runFullUnit, false);
  assert.deepEqual(scope.unitTests, ["tests/unit/runtime-series-merge.test.mjs"]);
  assert.equal(scope.runWebkitSmoke, true);
  assert.equal(scope.runWebBuild, true);
  assert.equal(scope.validationProfile, "focused");
});

test("ignores a generated bundle when its source module is also present", () => {
  const scope = classifyChangedFiles([
    "docs/modules/runtime-series-merge.js",
    "docs/assets/app.bundle.min.js",
  ]);
  assert.equal(scope.runFullUnit, false);
  assert.deepEqual(scope.files, ["docs/modules/runtime-series-merge.js"]);
});

test("still treats a standalone generated bundle change as full validation", () => {
  const scope = classifyChangedFiles(["docs/assets/app.bundle.min.js"]);
  assert.equal(scope.runFullUnit, true);
  assert.equal(scope.validationProfile, "full");
});

test("affected test scope keeps runtime bootstrap changes under WebKit smoke coverage", () => {
  const scope = classifyChangedFiles(["docs/modules/runtime-bootstrap.js"]);
  assert.equal(scope.runFullUnit, false);
  assert.equal(scope.runWebkitSmoke, true);
  assert.deepEqual(scope.unitTests, ["tests/unit/runtime-bootstrap.test.mjs"]);
});

test("affected test scope adds service-worker coverage only when needed", () => {
  const scope = classifyChangedFiles(["docs/sw.js"]);
  assert.equal(scope.runWebkitSmoke, false);
  assert.equal(scope.runServiceWorker, true);
});

test("server-only changes use focused tests without rebuilding the browser bundle", () => {
  const scope = classifyChangedFiles([
    "shared/dart-disclosure.mjs",
    "worker/src/index.mjs",
    "scripts/local_pages_server.mjs",
  ]);
  assert.equal(scope.runFullUnit, false);
  assert.equal(scope.runWebBuild, false);
  assert.deepEqual(scope.unitTests.sort(), [
    "tests/unit/dart-disclosure.test.mjs",
    "tests/unit/dart-worker.test.mjs",
    "tests/unit/local-pages-server.test.mjs",
  ]);
});

test("deployment workflow edits map to release contract tests", () => {
  const scope = classifyChangedFiles([".github/workflows/deploy-pages.yml"]);
  assert.equal(scope.runFullUnit, false);
  assert.equal(scope.runWebBuild, false);
  assert.deepEqual(scope.unitTests, ["tests/unit/release-script.test.mjs"]);
});
