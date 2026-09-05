import assert from "node:assert/strict";
import test from "node:test";
import payloadUtils from "../../docs/modules/data-payload.mjs";


test("shared payload parser normalizes columnar and legacy records", () => {
  const columnar = payloadUtils.rowsFromColumnarPayload({
    dates: ["2026-07-10", "2026-07-11"],
    series: ["news_sentiment"],
    columns: { news_sentiment: [110.72, "111.32"] },
  });
  const legacy = payloadUtils.normalizePayloadRecords([
    { date: "2026-07-11T12:00:00Z", news_sentiment: "111.32" },
  ]);

  assert.deepEqual(columnar, [
    { date: "2026-07-10", news_sentiment: 110.72 },
    { date: "2026-07-11", news_sentiment: 111.32 },
  ]);
  assert.deepEqual(legacy, [{ date: "2026-07-11", news_sentiment: 111.32 }]);
});

test("shared payload parser repairs NaN and sorts disclosure rows", () => {
  assert.deepEqual(payloadUtils.parseMacroPayload(
    '{"records":[{"date":"2026-07-10","value":NaN}]}'
  ), [{ date: "2026-07-10", value: null }]);

  const rows = payloadUtils.normalizeDisclosureRows([
    { date: "2026-07-11", ticker: "005930.ks", title: "B" },
    { date: "2026-07-10", ticker: "005930.ks", title: "A" },
  ]);
  assert.equal(rows[0].date, "2026-07-10");
  assert.equal(rows[0].ticker, "005930.KS");
});

test("seed bundle aligns the leading cycle to its publication month", () => {
  const parseBundle = payloadUtils.createSeedBundleParser();
  const parsed = parseBundle({
    macroText: JSON.stringify({
      dates: ["2026-07-01", "2026-09-01"],
      series: ["leading_cycle", "news_sentiment"],
      columns: {
        leading_cycle: [104.2, null],
        news_sentiment: [99, 101],
      },
    }),
  });

  assert.deepEqual(parsed.macroRows, [
    { date: "2026-07-01", news_sentiment: 99 },
    { date: "2026-09-01", news_sentiment: 101, leading_cycle: 104.2 },
  ]);
});

test("seed bundle does not expose interpolated leading-cycle values before publication", () => {
  const parseBundle = payloadUtils.createSeedBundleParser();
  const parsed = parseBundle({
    macroText: JSON.stringify({
      dates: ["2026-07-01", "2026-07-15", "2026-07-31"],
      series: ["leading_cycle"],
      columns: { leading_cycle: [104.2, 104.3, 104.4] },
    }),
  });

  assert.deepEqual(parsed.macroRows.filter((row) => Number.isFinite(row.leading_cycle)), [
    { date: "2026-09-01", leading_cycle: 104.2 },
  ]);
});
