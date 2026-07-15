import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "plotly.js-basic-dist-min", "plotly-basic.min.js");
const targetDir = path.join(root, "docs", "vendor");
const target = path.join(targetDir, "plotly-basic-2.35.2.min.js");

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);

const info = await stat(target);
if (info.size > 1_500_000) {
  throw new Error(`Plotly basic bundle is unexpectedly large: ${info.size} bytes`);
}

console.log(`Synced Plotly basic bundle (${info.size} bytes)`);
