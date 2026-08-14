import { spawnSync } from "node:child_process";
import { WEBKIT_SMOKE_PATTERN } from "./test_scope.mjs";

const mode = String(process.argv[2] || "smoke");
const requestedScope = String(process.argv[3] || "smoke");
const playwrightCli = "node_modules/@playwright/test/cli.js";
const ciTarget = ["mobile", "desktop", "sw"].includes(mode);
const workers = process.env.CI && ciTarget && mode !== "sw" && requestedScope === "full" ? "2" : "1";
const args = [playwrightCli, "test", `--workers=${workers}`];

if (mode === "service-worker" || mode === "sw") {
  args.push("--project=webkit-sw");
} else if (mode === "desktop") {
  args.push("--project=webkit-desktop");
  if (requestedScope === "smoke") args.push("--grep", WEBKIT_SMOKE_PATTERN);
} else if (mode === "mobile") {
  args.push("--project=webkit");
  if (requestedScope === "smoke") args.push("--grep", WEBKIT_SMOKE_PATTERN);
} else {
  args.push("--project=webkit", "--grep", WEBKIT_SMOKE_PATTERN);
}

const result = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: "inherit" });
process.exit(result.status ?? 1);
