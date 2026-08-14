import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "http://127.0.0.1:8787/";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForLocalPages(options = {}) {
  const url = String(options.url || DEFAULT_URL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 90000);
  const pollMs = Math.max(25, Number(options.pollMs) || 250);
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL("/api/health", url).href;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch (_) {
      // The server is still starting; retry until the bounded deadline.
    }
    await sleepImpl(pollMs);
  }
  return false;
}

export function openLocalPages(url = DEFAULT_URL, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const target = new URL(String(url || DEFAULT_URL));
  target.searchParams.set("local_start", String(Date.now()));
  const commands = process.platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", target.href] }
    : (process.platform === "darwin"
      ? { command: "open", args: [target.href] }
      : { command: "xdg-open", args: [target.href] });
  const child = spawnImpl(commands.command, commands.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref?.();
  return target.href;
}

async function main() {
  const url = String(process.argv[2] || DEFAULT_URL);
  const ready = await waitForLocalPages({ url });
  if (!ready) throw new Error("ThinkStock local server did not become ready within 90 seconds.");
  openLocalPages(url);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
