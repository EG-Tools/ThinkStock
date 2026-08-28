import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRelativeModuleGraph,
  collectSourceFiles,
  findModuleCycles,
  findDuplicateThinkStockGlobalOwners,
  findImportedClassicScripts,
  findRelativeModuleSpecifiers,
  findThinkStockGlobalAssignments,
  findUnreferencedTopLevelFunctions,
  hasIsolatedClassicScriptScope,
  hasStaticEsmSyntax,
  shouldIncludeSource,
} from "../../scripts/check_javascript_sources.mjs";

test("classifies web and runtime syntax-check scopes without generated bundles", () => {
  assert.equal(shouldIncludeSource("docs/app.js", "web"), true);
  assert.equal(shouldIncludeSource("shared/series-integrity.mjs", "web"), true);
  assert.equal(shouldIncludeSource("scripts/pages-entry.mjs", "web"), true);
  assert.equal(shouldIncludeSource("scripts/feature-entries/ai-feature.mjs", "web"), true);
  assert.equal(shouldIncludeSource("docs/assets/app.bundle.min.js", "web"), false);
  assert.equal(shouldIncludeSource("scripts/local_pages_server.mjs", "runtime"), true);
  assert.equal(shouldIncludeSource("scripts/feature-entries/ai-feature.mjs", "runtime"), false);
  assert.equal(shouldIncludeSource("worker/src/index.mjs", "runtime"), true);
  assert.equal(shouldIncludeSource("docs/app.js", "runtime"), false);
});

test("discovers newly added source modules automatically", async () => {
  const web = await collectSourceFiles("web");
  const runtime = await collectSourceFiles("runtime");

  assert.equal(web.includes("docs/modules/chart-display-sampler.mjs"), true);
  assert.equal(web.includes("docs/modules/chart-update-coordinator.mjs"), true);
  assert.equal(web.includes("docs/modules/chart-relayout-queue.js"), false);
  assert.equal(web.includes("shared/series-integrity.mjs"), true);
  assert.equal(runtime.includes("scripts/check_javascript_sources.mjs"), true);
  assert.equal(runtime.includes("worker/src/index.mjs"), true);
});

test("detects only unreferenced top-level app functions", () => {
  const source = [
    "function usedHelper() { return 1; }",
    "async function unusedHelper() { return 2; }",
    "const value = usedHelper();",
    "  function nestedCallback() { return 3; }",
  ].join("\n");
  assert.deepEqual(findUnreferencedTopLevelFunctions(source), ["unusedHelper"]);
});

test("detects legacy ThinkStock global registrations", () => {
  assert.deepEqual(findThinkStockGlobalAssignments([
    "globalScope.ThinkStockLegacy = api;",
    "globalThis.ThinkStockShared = Object.freeze({});",
    "const ThinkStockLocal = {};",
  ].join("\n")), ["ThinkStockLegacy", "ThinkStockShared"]);
});

test("detects globals owned by more than one classic module", () => {
  assert.deepEqual(findDuplicateThinkStockGlobalOwners([
    { file: "one.js", source: "globalThis.ThinkStockShared = {};" },
    { file: "two.js", source: "self.ThinkStockShared = api;" },
    { file: "three.js", source: "self.ThinkStockUnique = api;" },
  ]), [{ name: "ThinkStockShared", files: ["one.js", "two.js"] }]);
});

test("finds classic Worker dependencies and requires isolated script scopes", () => {
  const workerSource = [
    "importScripts(",
    "  `./first.js${versionQuery}` ,",
    "  './nested/second.js?v=dev',",
    ");",
  ].join("\n");

  assert.deepEqual(findImportedClassicScripts(workerSource), ["first.js", "nested/second.js"]);
  assert.equal(hasIsolatedClassicScriptScope("(function init(scope) {\n})(self);"), true);
  assert.equal(hasIsolatedClassicScriptScope("const globalScope = self;"), false);
});

test("distinguishes static ES modules from classic and dynamic-import scripts", () => {
  assert.equal(hasStaticEsmSyntax('import value from "./value.mjs";'), true);
  assert.equal(hasStaticEsmSyntax("export const value = 1;"), true);
  assert.equal(hasStaticEsmSyntax('import("./lazy.mjs");'), false);
  assert.equal(hasStaticEsmSyntax("(function init(scope) {})(self);"), false);
});

test("extracts static and dynamic relative module dependencies", () => {
  assert.deepEqual(findRelativeModuleSpecifiers([
    'import value from "./value.mjs";',
    'import "../setup.mjs";',
    'export { item } from "./shared.mjs";',
    'const lazy = import("./lazy.mjs");',
    'const external = import("https://example.com/module.mjs");',
  ].join("\n")), [
    "./value.mjs",
    "../setup.mjs",
    "./shared.mjs",
    "./lazy.mjs",
  ]);
});

test("detects browser module cycles while allowing an acyclic graph", () => {
  const entries = [
    { file: "docs/modules/a.mjs", source: 'import "./b.mjs";' },
    { file: "docs/modules/b.mjs", source: 'export { value } from "./c.mjs";' },
    { file: "docs/modules/c.mjs", source: 'const lazy = import("./a.mjs");' },
    { file: "docs/modules/leaf.mjs", source: "export const leaf = true;" },
  ];
  assert.deepEqual(findModuleCycles(buildRelativeModuleGraph(entries)), [
    "docs/modules/a.mjs -> docs/modules/b.mjs -> docs/modules/c.mjs -> docs/modules/a.mjs",
  ]);

  entries[2].source = 'import "./leaf.mjs";';
  assert.deepEqual(findModuleCycles(buildRelativeModuleGraph(entries)), []);
});
