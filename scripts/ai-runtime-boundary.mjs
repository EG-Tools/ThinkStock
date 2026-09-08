import path from "node:path";

import { build } from "esbuild";

const AI_RUNTIME_ROOT_FILES = Object.freeze([
  "docs/modules/ai-context-profile.js",
  "docs/modules/ai-forecast-calibration.mjs",
  "docs/modules/ai-forecast-math.js",
  "docs/modules/ai-forecast-model.js",
  "docs/modules/ai-forecast-scenarios.js",
  "docs/modules/ai-forecast.js",
  "docs/modules/ai-scenario-paths.js",
]);

async function collectAiRuntimeFiles(root) {
  const result = await build({
    absWorkingDir: root,
    bundle: true,
    entryPoints: [...AI_RUNTIME_ROOT_FILES],
    format: "esm",
    logLevel: "silent",
    metafile: true,
    outdir: path.join(root, ".thinkstock-cache", "ai-runtime-boundary"),
    platform: "browser",
    target: ["safari15"],
    write: false,
  });
  return Object.freeze(Object.keys(result.metafile.inputs || {})
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.startsWith("node_modules/"))
    .sort());
}

export { AI_RUNTIME_ROOT_FILES, collectAiRuntimeFiles };
