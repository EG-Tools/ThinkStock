import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/data-payload.js");
const payloadUtils = globalThis.ThinkStockDataPayload;


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
