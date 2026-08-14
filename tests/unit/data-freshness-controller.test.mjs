import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/data-freshness-controller.js");

test("freshness controller renders and records source quality only once per revision", () => {
  const rendered = [];
  const observed = [];
  const controller = globalThis.ThinkStockDataFreshnessController.createDataFreshnessController({
    dataHealth: {
      DEFAULT_SERIES_POLICIES: {},
      buildFreshnessItems: (groups) => groups.map((group) => ({
        label: group.label,
        first: group.rows?.[0]?.date || "",
        latest: group.rows?.at(-1)?.date || "",
        isEmpty: !group.rows?.length,
        anomalies: [],
        gaps: [],
      })),
    },
    view: {
      render: (_element, items) => rendered.push(items),
      summarizeQuality: (items, sourceByLabel) => Object.fromEntries(items.map((item) => [
        sourceByLabel[item.label],
        { firstDate: item.first, latestDate: item.latest, isEmpty: item.isEmpty },
      ])),
    },
    runtimeDataApp: {
      noteSourceQuality: (source, quality) => observed.push({ source, quality }),
    },
  });
  const model = {
    renderSignature: "revision-1",
    pricePayload: { series: ["^KS11"], records: [{ date: "2026-08-14", "^KS11": 3000 }] },
    macroRows: [],
    creditRows: [],
    adrRows: [],
    crisisRows: [],
    creditKeys: [],
    adrKeys: [],
    fearGreedKeys: [],
    volatilityKeys: [],
  };

  assert.equal(controller.render({}, model).rendered, true);
  assert.equal(controller.render({}, model).rendered, false);
  assert.equal(rendered.length, 1);
  assert.equal(observed.find((entry) => entry.source === "prices").quality.latestDate, "2026-08-14");
  assert.equal(observed.every((entry) => entry.quality.revision === "revision-1"), true);
});
