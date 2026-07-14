import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(root, "capacitor.config.json"), "utf8"));
const webDir = String(config.webDir || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

if (webDir !== "docs") {
  console.error(`Expected Capacitor webDir to be docs, got ${JSON.stringify(webDir)}`);
  process.exit(1);
}

const result = spawnSync("npx", ["cap", "sync", "ios"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
