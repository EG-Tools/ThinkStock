import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  WEBKIT_DESKTOP_SMOKE_PATTERN,
  WEBKIT_SMOKE_PATTERN,
} from "./test_scope.mjs";

const mode = String(process.argv[2] || "smoke");
const requestedScope = String(process.argv[3] || "smoke");
const playwrightCli = "node_modules/@playwright/test/cli.js";
const ciTarget = ["mobile", "desktop", "sw", "release"].includes(mode);
const workers = process.env.CI && ciTarget && mode !== "sw" && requestedScope === "full" ? "2" : "1";
const baseArgs = [playwrightCli, "test", `--workers=${workers}`,
  `--reporter=${process.env.CI ? "github" : "line"},./scripts/webkit-timing-reporter.mjs`];
const invocations = [];

if (mode === "release") {
  if (requestedScope === "smoke") {
    invocations.push(["--project=webkit", "--grep", WEBKIT_SMOKE_PATTERN]);
    invocations.push(["--project=webkit-desktop", "--grep", WEBKIT_DESKTOP_SMOKE_PATTERN]);
    invocations.push(["--project=webkit-sw"]);
  } else {
    invocations.push(["--project=webkit", "--project=webkit-desktop", "--project=webkit-sw"]);
  }
} else if (mode === "service-worker" || mode === "sw") {
  invocations.push(["--project=webkit-sw"]);
} else if (mode === "desktop") {
  invocations.push([
    "--project=webkit-desktop",
    ...(requestedScope === "smoke" ? ["--grep", WEBKIT_DESKTOP_SMOKE_PATTERN] : []),
  ]);
} else if (mode === "mobile") {
  invocations.push([
    "--project=webkit",
    ...(requestedScope === "smoke" ? ["--grep", WEBKIT_SMOKE_PATTERN] : []),
  ]);
} else {
  invocations.push(["--project=webkit", "--grep", WEBKIT_SMOKE_PATTERN]);
}

for (const [index, invocation] of invocations.entries()) {
  const result = spawnSync(process.execPath, [...baseArgs, ...invocation], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      THINKSTOCK_WEBKIT_TIMINGS: path.resolve(".thinkstock-cache", "validation",
        `webkit-${mode}-${requestedScope}-${index + 1}.json`),
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
