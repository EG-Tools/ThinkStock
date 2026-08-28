import assert from "node:assert/strict";
import test from "node:test";

import navigation from "../../docs/modules/stock-research-navigation.js";

test("retains the full configurable research universe for incremental reuse", () => {
  const state = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => {
    const market = index % 2 ? "KS" : "KQ";
    const code = String(index + 1).padStart(6, "0");
    return [`${code}.${market}`, {
      fingerprint: `price-${index}`,
      metadataFingerprint: `meta-${index}`,
      signalFingerprint: `signal-${index}`,
    }];
  }));

  const normalized = navigation.normalizeUniverseState(state);
  assert.equal(navigation.MAX_UNIVERSE_STATE, 1000);
  assert.equal(Object.keys(normalized).length, 1000);
  assert.equal(normalized["001000.KS"].signalFingerprint, "signal-999");
});
