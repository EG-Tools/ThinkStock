import assert from "node:assert/strict";
import test from "node:test";

import * as view from "../../docs/modules/data-freshness-controller.mjs";

test("renders price freshness with its runtime source and warning", () => {
  const element = { innerHTML: "" };
  const markup = view.render(element, [{
    label: "가격",
    date: "2026-08-07",
    first: "2026-01-01",
    latest: "2026-08-07",
    isEmpty: false,
    isStale: false,
    ageDays: 0,
    anomalies: [],
  }], {
    labelName: (value) => value === "005930.KS" ? "삼성전자" : value,
    priceStatus: {
      ticker: "005930.KS",
      source: "NAVER_FALLBACK",
      latestDate: "2026-08-10",
      marketDate: "2026-08-07",
      expectedDate: "2026-08-07",
      warning: "<확인>",
    },
  });
  assert.equal(element.innerHTML, markup);
  assert.match(markup, /네이버 보완/);
  assert.match(markup, /2026-08-10/);
  assert.match(markup, /&lt;확인&gt;/);
});

test("marks stale cached data without requiring a price status", () => {
  const element = { innerHTML: "" };
  view.render(element, [{
    label: "ADR",
    date: "없음",
    isEmpty: true,
    isStale: true,
    ageDays: 12,
    anomalies: [{ key: "adr_kospi" }],
  }]);
  assert.match(element.innerHTML, /is-empty/);
  assert.match(element.innerHTML, /is-stale/);
  assert.match(element.innerHTML, /is-anomaly/);
});

test("summarizes multiple freshness rows into one source quality record", () => {
  const summary = view.summarizeQuality([
    {
      label: "선행",
      first: "2000-01-01",
      latest: "2026-06-01",
      isEmpty: false,
      isStale: true,
      anomalies: [{ key: "leading_cycle" }],
      gaps: [],
    },
    {
      label: "뉴스심리",
      first: "2005-01-01",
      latest: "2026-08-13",
      isEmpty: false,
      isStale: false,
      anomalies: [],
      gaps: [{ key: "news_sentiment" }],
    },
  ], { "선행": "macro", "뉴스심리": "macro" });

  assert.deepEqual(summary.macro, {
    firstDate: "2000-01-01",
    latestDate: "2026-08-13",
    isEmpty: false,
    isStale: true,
    anomalyCount: 1,
    gapCount: 1,
  });
});
