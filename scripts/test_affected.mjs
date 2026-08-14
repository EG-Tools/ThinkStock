import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { classifyChangedFiles } from "./test_scope.mjs";

function gitLines(args) {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

const files = [
  ...gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
  ...gitLines(["ls-files", "--others", "--exclude-standard"]),
];
const scope = classifyChangedFiles(files);

if (!scope.runUnit) {
  process.stdout.write("No application changes require validation.\n");
  process.exit(0);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this command through npm: npm run test:affected");

const existingUnitTests = scope.unitTests.filter((file) => existsSync(file));
const runFullUnit = scope.runFullUnit || existingUnitTests.length !== scope.unitTests.length || !existingUnitTests.length;
process.stdout.write(`Affected validation: ${scope.files.length} files, ${runFullUnit ? "full unit" : `${existingUnitTests.length} focused unit`}${scope.runWebBuild ? ", web build" : ", source check"}${scope.runWebkitSmoke ? ", WebKit smoke" : ""}${scope.runServiceWorker ? ", service worker" : ""}.\n`);
if (runFullUnit) {
  run(process.execPath, [npmCli, "test"]);
} else {
  if (scope.runWebBuild) run(process.execPath, [npmCli, "run", "build:web"]);
  else run(process.execPath, ["scripts/check_javascript_sources.mjs", "--scope", "all"]);
  run(process.execPath, ["--test", ...existingUnitTests]);
  if (scope.runWebBuild) run(process.execPath, ["scripts/validate_pages_app.mjs"]);
}
if (scope.runWebkitSmoke) run(process.execPath, ["scripts/run_webkit_scope.mjs", "smoke"]);
if (scope.runServiceWorker) run(process.execPath, ["scripts/run_webkit_scope.mjs", "service-worker"]);
