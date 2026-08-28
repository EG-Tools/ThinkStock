import assert from "node:assert/strict";
import test from "node:test";

import { createDataFreshnessController } from "../../docs/modules/data-freshness-controller.mjs";

test("freshness controller renders and records source quality only once per revision", () => {
  const rendered = [];
  const observed = [];
  const controller = createDataFreshnessController({
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

test("freshness controller coalesces scheduled renders and resolves the latest model", () => {
  const frames = new Map();
  const cancelled = [];
  const rendered = [];
  let frameSequence = 0;
  let revision = "revision-1";
  const controller = createDataFreshnessController({
    dataHealth: {
      DEFAULT_SERIES_POLICIES: {},
      buildFreshnessItems: () => [],
    },
    view: {
      render: (_element, items) => rendered.push(items),
      summarizeQuality: () => ({}),
    },
    requestFrame: (callback) => {
      const id = ++frameSequence;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      cancelled.push(id);
      frames.delete(id);
    },
    resolveElement: () => ({}),
    resolveModel: () => ({
      renderSignature: revision,
      pricePayload: { series: [], records: [] },
      macroRows: [],
      creditRows: [],
      adrRows: [],
      crisisRows: [],
    }),
  });

  assert.equal(controller.schedule(), true);
  assert.equal(controller.schedule(), false);
  assert.equal(controller.stats().pending, true);
  frames.get(1)();
  assert.equal(rendered.length, 1);
  assert.deepEqual(controller.stats(), {
    scheduled: 1,
    coalesced: 1,
    rendered: 1,
    skipped: 0,
    pending: false,
  });

  revision = "revision-2";
  controller.schedule();
  controller.renderNow();
  assert.equal(cancelled.includes(2), true);
  assert.equal(rendered.length, 2);
  assert.equal(controller.stats().pending, false);
});

test("freshness controller retries the same revision after a failed view render", () => {
  let attempts = 0;
  const controller = createDataFreshnessController({
    dataHealth: {
      DEFAULT_SERIES_POLICIES: {},
      buildFreshnessItems: () => [],
    },
    view: {
      render: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary render failure");
      },
      summarizeQuality: () => ({}),
    },
  });
  const model = { renderSignature: "same-revision", pricePayload: {}, macroRows: [] };

  assert.throws(() => controller.render({}, model), /temporary render failure/);
  assert.equal(controller.render({}, model).rendered, true);
  assert.equal(attempts, 2);
});
