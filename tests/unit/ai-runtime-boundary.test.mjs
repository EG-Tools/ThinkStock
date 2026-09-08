import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectAiRuntimeFiles } from "../../scripts/ai-runtime-boundary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("AI runtime boundary includes transitive prediction dependencies", async () => {
  const files = await collectAiRuntimeFiles(root);

  assert.ok(files.includes("docs/modules/ai-forecast-calibration.mjs"));
  assert.ok(files.includes("shared/ai-context-classifier.mjs"));
  assert.ok(files.includes("shared/runtime-foundation.mjs"));
});
