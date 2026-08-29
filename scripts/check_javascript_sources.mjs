import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".thinkstock-cache",
  "assets",
  "data",
  "node_modules",
  "playwright-report",
  "test-results",
  "vendor",
]);
const WEB_SCRIPT_FILES = new Set([
  "scripts/build_pages_bundle.mjs",
  "scripts/pages-entry.mjs",
]);
// Tighten this only after a classic module moves behind an ESM bundle boundary.
// A future feature must not silently expand the global registry again.
const LEGACY_DOCS_MODULE_GLOBAL_MAX = 7;
const LEGACY_DOCS_MODULE_GLOBAL_ALLOWLIST = new Set([
  "ThinkStockAiContextProfile",
  "ThinkStockAiForecast",
  "ThinkStockAiForecastMath",
  "ThinkStockAiForecastModel",
  "ThinkStockAiForecastScenarios",
  "ThinkStockAiScenarioPaths",
  "ThinkStockCacheRefreshPolicy",
]);
const SHARED_ESM_GLOBAL_ALLOWLIST = new Set([
  "ThinkStockAiNewsEvidence",
]);
// New modules require an explicit architecture decision instead of quietly
// growing the already broad browser module surface.
export const DOCS_ESM_MODULE_MAX = 96;
const APP_SOURCE_MAX_BYTES = 290000;

function isWebScript(relative) {
  return WEB_SCRIPT_FILES.has(relative) || relative.startsWith("scripts/feature-entries/");
}

function normalizedRelative(file) {
  return String(file || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function shouldIncludeSource(relativeFile, scope = "all") {
  const relative = normalizedRelative(relativeFile);
  if (!SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) return false;
  if (relative.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  if (scope === "web") {
    return relative.startsWith("docs/")
      || relative.startsWith("shared/")
      || isWebScript(relative);
  }
  if (scope === "runtime") {
    return relative.startsWith("worker/src/")
      || (relative.startsWith("scripts/") && !isWebScript(relative));
  }
  return relative.startsWith("docs/")
    || relative.startsWith("shared/")
    || relative.startsWith("scripts/")
    || relative.startsWith("worker/src/");
}

async function walk(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    const relative = normalizedRelative(path.relative(ROOT, target));
    if (entry.isDirectory()) {
      if (!EXCLUDED_SEGMENTS.has(entry.name)) await walk(target, output);
      return;
    }
    output.push(relative);
  }));
}

export async function collectSourceFiles(scope = "all") {
  const candidates = [];
  await Promise.all(["docs", "shared", "scripts", path.join("worker", "src")]
    .map((directory) => walk(path.join(ROOT, directory), candidates)));
  return candidates
    .filter((file) => shouldIncludeSource(file, scope))
    .sort((left, right) => left.localeCompare(right));
}

export function findUnreferencedTopLevelFunctions(source) {
  const text = String(source || "");
  const declarations = [...text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)]
    .map((match) => match[1]);
  return [...new Set(declarations)].filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...text.matchAll(new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, "g"))].length <= 1;
  });
}

export function findThinkStockGlobalAssignments(source) {
  return [...String(source || "").matchAll(
    /(?:globalScope|globalThis|self|window)\.(ThinkStock[A-Za-z0-9_]+)\s*=/g,
  )].map((match) => match[1]);
}

export function findDuplicateThinkStockGlobalOwners(entries) {
  const owners = new Map();
  (Array.isArray(entries) ? entries : []).forEach(({ file, source }) => {
    findThinkStockGlobalAssignments(source).forEach((name) => {
      if (!owners.has(name)) owners.set(name, new Set());
      owners.get(name).add(String(file || ""));
    });
  });
  return [...owners.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([name, files]) => ({ name, files: [...files].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findImportedClassicScripts(source) {
  const dependencies = [];
  for (const call of String(source || "").matchAll(/importScripts\s*\(([\s\S]*?)\)\s*;/g)) {
    for (const specifier of call[1].matchAll(/["'`]\.\/([A-Za-z0-9._/-]+\.js)[^"'`]*["'`]/g)) {
      dependencies.push(specifier[1]);
    }
  }
  return [...new Set(dependencies)];
}

export function hasIsolatedClassicScriptScope(source) {
  return /^\s*\(function(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(/.test(String(source || ""));
}

export function hasStaticEsmSyntax(source) {
  return /^\s*(?:import\s+(?!\()|export\s+)/m.test(String(source || ""));
}

export function findRelativeModuleSpecifiers(source) {
  const text = String(source || "");
  const specifiers = [];
  const patterns = [
    /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s+["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];
  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      specifiers.push({ specifier: match[1], index: Number(match.index) || 0 });
    }
  });
  specifiers.sort((left, right) => left.index - right.index);
  return [...new Set(specifiers.map(({ specifier }) => specifier))];
}

export function buildRelativeModuleGraph(entries) {
  const sources = Array.isArray(entries) ? entries : [];
  const knownFiles = new Set(sources.map(({ file }) => normalizedRelative(file)));
  return new Map(sources.map(({ file, source }) => {
    const owner = normalizedRelative(file);
    const dependencies = findRelativeModuleSpecifiers(source).map((specifier) => {
      const resolved = normalizedRelative(path.posix.normalize(
        path.posix.join(path.posix.dirname(owner), specifier.split(/[?#]/, 1)[0]),
      ));
      if (knownFiles.has(resolved)) return resolved;
      if (!path.posix.extname(resolved) && knownFiles.has(`${resolved}.mjs`)) return `${resolved}.mjs`;
      if (!path.posix.extname(resolved) && knownFiles.has(`${resolved}.js`)) return `${resolved}.js`;
      return null;
    }).filter(Boolean);
    return [owner, [...new Set(dependencies)].sort()];
  }));
}

export function findModuleCycles(graph) {
  const moduleGraph = graph instanceof Map ? graph : new Map();
  const state = new Map();
  const stack = [];
  const stackIndex = new Map();
  const cycles = new Map();

  const canonicalCycle = (cycle) => {
    const ring = cycle.slice(0, -1);
    if (!ring.length) return "";
    const rotations = ring.map((_, index) => [
      ...ring.slice(index),
      ...ring.slice(0, index),
    ]);
    rotations.sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
    return [...rotations[0], rotations[0][0]].join(" -> ");
  };

  const visit = (file) => {
    state.set(file, 1);
    stackIndex.set(file, stack.length);
    stack.push(file);
    (moduleGraph.get(file) || []).forEach((dependency) => {
      if (!moduleGraph.has(dependency)) return;
      if (!state.has(dependency)) {
        visit(dependency);
        return;
      }
      if (state.get(dependency) === 1) {
        const start = stackIndex.get(dependency);
        const cycle = [...stack.slice(start), dependency];
        cycles.set(canonicalCycle(cycle), cycle);
      }
    });
    stack.pop();
    stackIndex.delete(file);
    state.set(file, 2);
  };

  [...moduleGraph.keys()].sort().forEach((file) => {
    if (!state.has(file)) visit(file);
  });
  return [...cycles.keys()].filter(Boolean).sort();
}

function checkOne(relativeFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", path.join(ROOT, relativeFile)], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += String(chunk); });
    child.once("error", (error) => resolve({ file: relativeFile, error: error.message }));
    child.once("exit", (code) => resolve(code === 0
      ? null
      : { file: relativeFile, error: errorText.trim() || `node --check exited ${code}` }));
  });
}

export async function checkSourceFiles(files, options = {}) {
  const sourceFiles = Array.isArray(files) ? files : [];
  const concurrency = Math.max(1, Math.min(
    12,
    Number(options.concurrency) || Math.min(8, os.availableParallelism?.() || os.cpus().length || 4),
  ));
  const errors = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, sourceFiles.length) }, async () => {
    while (cursor < sourceFiles.length) {
      const index = cursor;
      cursor += 1;
      const result = await checkOne(sourceFiles[index]);
      if (result) errors.push(result);
    }
  }));
  return errors.sort((left, right) => left.file.localeCompare(right.file));
}

function requestedScope(argv) {
  const inline = argv.find((value) => value.startsWith("--scope="));
  const index = argv.indexOf("--scope");
  const value = inline?.slice("--scope=".length) || (index >= 0 ? argv[index + 1] : "all");
  return ["all", "runtime", "web"].includes(value) ? value : "all";
}

async function main() {
  const scope = requestedScope(process.argv.slice(2));
  const files = await collectSourceFiles(scope);
  const errors = await checkSourceFiles(files);
  if (errors.length) {
    errors.forEach(({ file, error }) => console.error(`\n${file}\n${error}`));
    throw new Error(`${errors.length} JavaScript source file(s) failed syntax validation`);
  }
  if (files.includes("docs/app.js")) {
    const appSource = await readFile(path.join(ROOT, "docs", "app.js"), "utf8");
    if (Buffer.byteLength(appSource, "utf8") > APP_SOURCE_MAX_BYTES) {
      throw new Error(
        `docs/app.js responsibility boundary grew beyond ${APP_SOURCE_MAX_BYTES} bytes`,
      );
    }
    const unreferenced = findUnreferencedTopLevelFunctions(appSource);
    if (unreferenced.length) {
      throw new Error(`Unreferenced docs/app.js functions: ${unreferenced.join(", ")}`);
    }
  }
  const docsModuleFiles = files.filter((file) => file.startsWith("docs/modules/"));
  const moduleSources = await Promise.all(docsModuleFiles.map(async (file) => ({
    file,
    source: await readFile(path.join(ROOT, file), "utf8"),
  })));
  const moduleSourceByFile = new Map(moduleSources.map(({ file, source }) => [file, source]));
  const docsEsmModuleCount = moduleSources.filter(({ file }) => path.extname(file) === ".mjs").length;
  if (docsEsmModuleCount > DOCS_ESM_MODULE_MAX) {
    throw new Error(
      `Browser ES module count requires an architecture review: ${docsEsmModuleCount} > ${DOCS_ESM_MODULE_MAX}`,
    );
  }
  const moduleCycles = findModuleCycles(buildRelativeModuleGraph(moduleSources));
  if (moduleCycles.length) {
    throw new Error(`Browser module cycles detected: ${moduleCycles.join(" | ")}`);
  }
  const misnamedEsmModules = moduleSources
    .filter(({ file, source }) => path.extname(file) === ".js" && hasStaticEsmSyntax(source))
    .map(({ file }) => file);
  if (misnamedEsmModules.length) {
    throw new Error(`ES modules must use the .mjs extension: ${misnamedEsmModules.join(", ")}`);
  }
  const unsafeWorkerDependencies = moduleSources.flatMap(({ file, source }) => (
    findImportedClassicScripts(source).flatMap((dependency) => {
      const dependencyFile = normalizedRelative(path.posix.join(path.posix.dirname(file), dependency));
      const dependencySource = moduleSourceByFile.get(dependencyFile);
      if (!dependencySource) return [`${file}->${dependencyFile} (missing)`];
      return !hasIsolatedClassicScriptScope(dependencySource)
        ? [`${file}->${dependencyFile}`]
        : [];
    })
  ));
  if (unsafeWorkerDependencies.length) {
    throw new Error(
      `Classic Worker dependencies must isolate top-level declarations: ${unsafeWorkerDependencies.join(", ")}`,
    );
  }
  const esmGlobals = moduleSources.flatMap(({ file, source }) => (
    path.extname(file) === ".mjs"
      ? findThinkStockGlobalAssignments(source).map((name) => `${file}:${name}`)
      : []
  ));
  if (esmGlobals.length) {
    throw new Error(`ES modules must not register ThinkStock globals: ${esmGlobals.join(", ")}`);
  }
  const sharedModuleFiles = files.filter((file) => file.startsWith("shared/") && path.extname(file) === ".mjs");
  const sharedSources = await Promise.all(sharedModuleFiles.map(async (file) => ({
    file,
    source: await readFile(path.join(ROOT, file), "utf8"),
  })));
  const unexpectedSharedGlobals = sharedSources.flatMap(({ file, source }) => (
    findThinkStockGlobalAssignments(source)
      .filter((name) => !SHARED_ESM_GLOBAL_ALLOWLIST.has(name))
      .map((name) => `${file}:${name}`)
  ));
  if (unexpectedSharedGlobals.length) {
    throw new Error(`Shared ES module globals require an explicit compatibility reason: ${unexpectedSharedGlobals.join(", ")}`);
  }
  const duplicateGlobals = findDuplicateThinkStockGlobalOwners(moduleSources);
  if (duplicateGlobals.length) {
    throw new Error(`ThinkStock globals have multiple owners: ${duplicateGlobals.map(({ name, files: owners }) => (
      `${name}=${owners.join("|")}`
    )).join(", ")}`);
  }
  const unexpectedLegacyGlobals = moduleSources.flatMap(({ file, source }) => (
    path.extname(file) === ".js"
      ? findThinkStockGlobalAssignments(source)
        .filter((name) => !LEGACY_DOCS_MODULE_GLOBAL_ALLOWLIST.has(name))
        .map((name) => `${file}:${name}`)
      : []
  ));
  if (unexpectedLegacyGlobals.length) {
    throw new Error(`Legacy ThinkStock globals require an explicit compatibility reason: ${unexpectedLegacyGlobals.join(", ")}`);
  }
  const legacyGlobalCount = moduleSources.reduce(
    (total, { source }) => total + findThinkStockGlobalAssignments(source).length,
    0,
  );
  if (legacyGlobalCount > LEGACY_DOCS_MODULE_GLOBAL_MAX) {
    throw new Error(
      `Legacy ThinkStock globals increased: ${legacyGlobalCount} > ${LEGACY_DOCS_MODULE_GLOBAL_MAX}`,
    );
  }
  console.log(`JavaScript syntax OK: ${files.length} files (${scope})`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
