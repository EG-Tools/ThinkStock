import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QLIB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runQlibCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: QLIB_ROOT,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

export async function qlibPythonExecutable() {
  const configured = String(process.env.THINKSTOCK_QLIB_PYTHON || "").trim();
  if (configured) return configured;
  const executable = process.platform === "win32"
    ? path.join(QLIB_ROOT, ".thinkstock-cache", "qlib-venv", "Scripts", "python.exe")
    : path.join(QLIB_ROOT, ".thinkstock-cache", "qlib-venv", "bin", "python");
  try {
    await access(executable);
    return executable;
  } catch (_) {
    throw new Error(
      "Qlib environment is missing. Run npm run backtest:qlib:setup before this offline experiment.",
    );
  }
}
