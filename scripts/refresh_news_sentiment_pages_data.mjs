import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "refresh_news_sentiment_pages_data.py");
const localDependencies = path.join(root, ".codex-ci-deps");
const bundledPython = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe",
);

function usableFile(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

const candidates = [
  ...(process.env.THINKSTOCK_PYTHON ? [[process.env.THINKSTOCK_PYTHON, []]] : []),
  ...(usableFile(bundledPython) ? [[bundledPython, []]] : []),
  ["python", []],
  ["python3", []],
  ["py", ["-3"]],
];

const selected = candidates.find(([command, prefix]) => (
  spawnSync(command, [...prefix, "--version"], { encoding: "utf8", windowsHide: true }).status === 0
));
if (!selected) {
  throw new Error("뉴스심리 갱신에 사용할 Python 3 실행환경을 찾지 못했습니다.");
}

const [command, prefix] = selected;
const pythonPath = [
  ...(usableFile(localDependencies) ? [localDependencies] : []),
  ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : []),
].join(path.delimiter);
const result = spawnSync(command, [...prefix, script], {
  cwd: root,
  env: { ...process.env, ...(pythonPath ? { PYTHONPATH: pythonPath } : {}) },
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
