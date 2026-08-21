import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
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
  console.log(`JavaScript syntax OK: ${files.length} files (${scope})`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
