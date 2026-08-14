import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  app: path.join(root, "docs", "app.js"),
  html: path.join(root, "docs", "index.html"),
  worker: path.join(root, "docs", "sw.js"),
};

const [app, html, worker] = await Promise.all([
  readFile(files.app, "utf8"),
  readFile(files.html, "utf8"),
  readFile(files.worker, "utf8"),
]);
const appVersion = app.match(/const APP_VERSION = "([0-9]+\.[0-9]+)";/)?.[1];
const htmlVersion = html.match(/id="appVersionText">([0-9]+\.[0-9]+)</)?.[1];
const htmlVersionCopies = [...html.matchAll(/data-app-version-copy>([0-9]+\.[0-9]+)</g)]
  .map((match) => match[1]);
const workerVersion = worker.match(/const CACHE_NAME = "thinkstock-dev-([0-9]+\.[0-9]+)";/)?.[1];
if (!appVersion || appVersion !== htmlVersion || appVersion !== workerVersion
  || htmlVersionCopies.some((version) => version !== appVersion)) {
  throw new Error(`Version mismatch: app=${appVersion} html=${htmlVersion} sw=${workerVersion}`);
}

const requestedIndex = process.argv.indexOf("--set");
const requested = requestedIndex >= 0 ? String(process.argv[requestedIndex + 1] || "") : "";
const nextVersion = requested || (Math.round(Number(appVersion) * 100) + 1) / 100;
const normalizedVersion = Number(nextVersion).toFixed(2);
if (!/^[0-9]+\.[0-9]{2}$/.test(normalizedVersion)) throw new Error("Version must use the 0.00 format");

await Promise.all([
  writeFile(files.app, app.replace(
    `const APP_VERSION = "${appVersion}";`,
    `const APP_VERSION = "${normalizedVersion}";`,
  ), "utf8"),
  writeFile(files.html, html
    .replace(`build=${appVersion}`, `build=${normalizedVersion}`)
    .replace(`id="appVersionText">${appVersion}<`, `id="appVersionText">${normalizedVersion}<`)
    .replace(`data-app-version-copy>${appVersion}<`, `data-app-version-copy>${normalizedVersion}<`), "utf8"),
  writeFile(files.worker, worker.replace(
    `const CACHE_NAME = "thinkstock-dev-${appVersion}";`,
    `const CACHE_NAME = "thinkstock-dev-${normalizedVersion}";`,
  ), "utf8"),
]);

console.log(`ThinkStock ${appVersion} -> ${normalizedVersion}`);
