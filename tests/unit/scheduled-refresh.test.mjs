import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MARKET_REFRESH_CRON,
  SHARED_REFRESH_CRON,
  planScheduledRefresh,
  runScheduledRefresh,
} from "../../worker/src/scheduled-refresh.mjs";

test("plans market and shared preparation by UTC time and weekday", () => {
  assert.deepEqual(planScheduledRefresh("2026-09-21T00:05:00Z", MARKET_REFRESH_CRON),
    ["indices", "adr", "crisis"]);
  assert.deepEqual(planScheduledRefresh("2026-09-21T08:05:00Z", MARKET_REFRESH_CRON),
    ["indices", "adr", "crisis"]);
  assert.deepEqual(planScheduledRefresh("2026-09-21T05:05:00Z", MARKET_REFRESH_CRON),
    ["indices", "adr", "crisis"]);
  assert.deepEqual(planScheduledRefresh("2026-09-20T00:05:00Z", MARKET_REFRESH_CRON), []);
  assert.deepEqual(planScheduledRefresh("2026-09-20T00:10:00Z", SHARED_REFRESH_CRON), []);
  assert.deepEqual(planScheduledRefresh("2026-09-21T00:10:00Z", SHARED_REFRESH_CRON),
    ["macro", "credit"]);
  assert.deepEqual(planScheduledRefresh("2026-09-21T12:10:00Z", SHARED_REFRESH_CRON),
    ["macro", "credit"]);
  assert.deepEqual(planScheduledRefresh("invalid", MARKET_REFRESH_CRON), []);
  assert.deepEqual(planScheduledRefresh("2026-09-21T00:05:00Z", "unknown"), []);
});

test("configured Cron triggers match the shared schedule contract", async () => {
  const config = JSON.parse(await readFile(new URL("../../worker/wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, [MARKET_REFRESH_CRON, SHARED_REFRESH_CRON]);
});

test("a partial response or fallback is reported as incomplete without stopping other sources", async () => {
  const events = [];
  const payload = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const results = await runScheduledRefresh("2026-09-21T12:10:00Z", SHARED_REFRESH_CRON, {
    macro: async () => payload({ ok: true, stale: true, componentLatestDates: {
      leading_cycle: "2026-09-01", news_sentiment: "2026-09-18",
    } }),
    credit: async () => payload({ ok: true, warning: "old deposit series", latestDate: "2026-09-18" }),
  }, {
    info: (line) => events.push(JSON.parse(line)),
    warn: (line) => events.push(JSON.parse(line)),
  });
  assert.deepEqual(results.map((item) => item.ok), [false, false]);
  assert.deepEqual(events.map((item) => item.source), ["macro", "credit"]);
  assert.equal(results[0].latestDate, "2026-09-18");
  assert.deepEqual(results[0].componentLatestDates, {
    leading_cycle: "2026-09-01", news_sentiment: "2026-09-18",
  });
});

test("one provider failure does not prevent another source from preparing", async () => {
  const attempts = [];
  const results = await runScheduledRefresh("2026-09-21T00:10:00Z", SHARED_REFRESH_CRON, {
    macro: async () => { throw new Error("ECOS unavailable"); },
    credit: async () => {
      attempts.push("credit");
      return new Response(JSON.stringify({ ok: true, latestDate: "2026-09-18" }));
    },
  }, { info() {}, warn() {} });
  assert.deepEqual(attempts, ["credit"]);
  assert.deepEqual(results.map((item) => item.ok), [false, true]);
  assert.match(results[0].error, /ECOS unavailable/);
});

test("scheduled refresh fills a freed slot without waiting for the slower source", async () => {
  const started = [];
  let finishIndices;
  let finishAdr;
  const pending = runScheduledRefresh("2026-09-21T00:05:00Z", MARKET_REFRESH_CRON, {
    indices: () => new Promise((resolve) => {
      started.push("indices");
      finishIndices = () => resolve(Response.json({ ok: true, latestDate: "2026-09-18" }));
    }),
    adr: () => new Promise((resolve) => {
      started.push("adr");
      finishAdr = () => resolve(Response.json({ ok: true, latestDate: "2026-09-18" }));
    }),
    crisis: async () => {
      started.push("crisis");
      return Response.json({ ok: true, latestDate: "2026-09-18" });
    },
  }, { info() {}, warn() {} });
  assert.deepEqual(started, ["indices", "adr"]);
  finishIndices();
  for (let attempt = 0; attempt < 20 && started.length < 3; attempt += 1) await new Promise(setImmediate);
  assert.deepEqual(started, ["indices", "adr", "crisis"]);
  finishAdr();
  assert.deepEqual((await pending).map((item) => item.source), ["indices", "adr", "crisis"]);
});
