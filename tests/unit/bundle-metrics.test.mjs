import assert from "node:assert/strict";
import test from "node:test";

import { createBundleReport, summarizeBundle } from "../../scripts/bundle-metrics.mjs";

function metafile(output, inputs) {
  return {
    inputs: Object.fromEntries(Object.keys(inputs).map((input) => [input, { bytes: inputs[input] }])),
    outputs: {
      [output]: {
        inputs: Object.fromEntries(Object.entries(inputs).map(([input, bytes]) => [input, {
          bytesInOutput: bytes,
        }])),
      },
    },
  };
}

test("bundle metrics reports compact contributors and cross-bundle overlap", () => {
  const root = process.cwd();
  const app = summarizeBundle({
    root,
    name: "app",
    file: `${root}/docs/assets/app.js`,
    bytes: 120,
    gzipBytes: 60,
    metafile: metafile("app.js", {
      "docs/app.js": 80,
      "docs/modules/shared.mjs": 20,
    }),
  });
  const feature = summarizeBundle({
    root,
    name: "feature",
    file: `${root}/docs/assets/feature.js`,
    bytes: 70,
    gzipBytes: 35,
    metafile: metafile("feature.js", {
      "docs/modules/feature.mjs": 40,
      "docs/modules/shared.mjs": 10,
    }),
  });
  const report = createBundleReport({
    appVersion: "3.16",
    generatedAt: "2026-08-26T00:00:00.000Z",
    bundles: [app, feature],
  });

  assert.equal(report.appVersion, "3.16");
  assert.deepEqual(report.totals, { bytes: 190, gzipBytes: 95 });
  assert.deepEqual(report.sharedInputs, [{
    input: "docs/modules/shared.mjs",
    bytes: 30,
    bundles: ["app", "feature"],
  }]);
  assert.equal(report.bundles[0].contributors[0].input, "docs/app.js");
});

test("bundle metrics selects the requested output from a shared build", () => {
  const root = process.cwd();
  const sharedMetafile = {
    outputs: {
      "build/first.js": { inputs: { "docs/first.mjs": { bytesInOutput: 20 } } },
      "build/second.js": { inputs: { "docs/second.mjs": { bytesInOutput: 30 } } },
    },
  };
  const summary = summarizeBundle({
    root,
    name: "second",
    file: `${root}/build/second.js`,
    metafile: sharedMetafile,
    metafileOutput: `${root}/build/second.js`,
  });

  assert.deepEqual(summary.contributors, [{ input: "docs/second.mjs", bytes: 30 }]);
});
