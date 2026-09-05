import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintRuntimeBundleEntries } from "../../scripts/runtime-bundle-fingerprint.mjs";

test("runtime fingerprint changes when any lazy feature bundle changes", () => {
  const original = [
    { name: "app.bundle.min.js", content: "app" },
    { name: "auxiliary-chart-feature.bundle.min.js", content: "macd-old" },
    { name: "market-timing-feature.bundle.min.js", content: "signal-old" },
  ];
  const changed = original.map((entry) => (
    entry.name === "auxiliary-chart-feature.bundle.min.js"
      ? { ...entry, content: "macd-new" }
      : entry
  ));

  assert.notEqual(
    fingerprintRuntimeBundleEntries(original),
    fingerprintRuntimeBundleEntries(changed),
  );
  assert.equal(
    fingerprintRuntimeBundleEntries(original),
    fingerprintRuntimeBundleEntries([...original].reverse()),
  );
});
