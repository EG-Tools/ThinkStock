import assert from "node:assert/strict";
import test from "node:test";

await import("../../shared/runtime-foundation.mjs");
const insiderTrades = await import("../../docs/modules/insider-trades.mjs");

test("normalizes DART ownership increases and decreases into buy and sell rows", () => {
  const rows = insiderTrades.sanitizeRows([
    {
      ticker: "218410.kq",
      rcept_dt: "20260731",
      repror: "홍길동",
      sp_stock_lmp_irds_cnt: "1,250",
      sp_stock_lmp_cnt: "10,000",
      rcept_no: "20260731000123",
    },
    {
      ticker: "218410.KQ",
      date: "2026-07-30",
      reporter: "김주주",
      sharesChanged: -500,
    },
    { ticker: "218410.KQ", date: "2026-07-29", sharesChanged: 0 },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].side, "buy");
  assert.equal(rows[0].sharesChanged, 1250);
  assert.equal(rows[0].date, "2026-07-31");
  assert.equal(rows[1].side, "sell");
});

test("builds red upward buy markers and blue downward sell markers", () => {
  const traces = insiderTrades.buildMarkerTraces([
    {
      ticker: "218410.KQ",
      name: "RFHIC",
      side: "buy",
      plotDate: "2026-07-31",
      y: 96,
      paired: true,
      events: [{
        date: "2026-07-31",
        reporter: "홍길동",
        sharesChanged: 1250,
        transactionMethod: "장내매수(+)",
      }],
    },
    {
      ticker: "218410.KQ",
      name: "RFHIC",
      side: "sell",
      plotDate: "2026-07-31",
      y: 96,
      paired: true,
      events: [{
        date: "2026-07-31",
        reporter: "김주주",
        sharesChanged: -500,
        transactionMethod: "기타(-)",
      }],
    },
  ]);

  assert.equal(traces.length, 2);
  assert.equal(traces[0].mode, "text");
  assert.equal(traces[0].text[0], "▲");
  assert.equal(traces[0].textfont.color, "#b91c1c");
  assert.equal(traces[0].textfont.size, 15);
  assert.equal(traces[1].mode, "text");
  assert.equal(traces[1].text[0], "▼");
  assert.equal(traces[1].textfont.color, "#1d4ed8");
  assert.equal(traces[1].textfont.size, 15);
  assert.equal(traces[0].yaxis, "y");
  assert.equal(traces[1].yaxis, "y");
  assert.equal(traces[0].x[0], traces[1].x[0]);
  assert.equal(traces[0].y[0], traces[1].y[0]);
  assert.equal(traces[0].customdata[0][2], true);
  assert.equal(traces[1].customdata[0][2], true);
  assert.equal(traces.every((trace) => trace.meta.overlayKind === "insider"), true);
  const buyDetail = traces[0].meta.hoverDetailTemplates[0];
  const sellDetail = traces[1].meta.hoverDetailTemplates[0];
  assert.match(buyDetail, /color:#b91c1c/);
  assert.match(buyDetail, /내부자거래 : 매수/);
  assert.match(buyDetail, /장내매수\(\+\)/);
  assert.match(sellDetail, /color:#1d4ed8/);
  assert.match(sellDetail, /내부자거래 : 매도/);
  assert.doesNotMatch(sellDetail, /기타\(-\)/);
  assert.doesNotMatch(buyDetail, /RFHIC|2026-07-31|▲|▼/);
  assert.doesNotMatch(sellDetail, /RFHIC|2026-07-31|▲|▼/);
  assert.equal(traces.every((trace) => trace.hoverinfo === "none"), true);
  assert.equal(traces.every((trace) => trace.hovertemplate === undefined), true);
  assert.equal(traces.every((trace) => trace.meta.hoverDetailTemplates[0].endsWith("<extra></extra>")), true);
  assert.equal(traces[0].meta.eventGroups[0].name, "RFHIC");
  assert.equal(traces[0].meta.eventGroups[0].plotDate, "2026-07-31");
  assert.match(traces[0].meta.eventGroups[0].events[0].title, /내부자거래 : 매수/);
  assert.equal(traces[0].meta.eventGroups[0].events[0].tone, "insider-buy");
  assert.match(traces[1].meta.eventGroups[0].events[0].title, /내부자거래 : 매도/);
  assert.equal(traces[1].meta.eventGroups[0].events[0].tone, "insider-sell");
});

test("keeps same-day buy and sell details from one major-holder receipt", () => {
  const rows = insiderTrades.mergeRows([], [
    {
      ticker: "218410.KQ",
      date: "2026-07-20",
      sharesChanged: -4767,
      sharesBefore: 1337773,
      sharesOwned: 1333006,
      reporter: "Morgan Stanley",
      receiptNo: "20260721001006",
      recordType: "major-holder-detail",
      transactionMethod: "장내매도(-)",
    },
    {
      ticker: "218410.KQ",
      date: "2026-07-20",
      sharesChanged: 13725,
      sharesBefore: 1333006,
      sharesOwned: 1346731,
      reporter: "Morgan Stanley",
      receiptNo: "20260721001006",
      recordType: "major-holder-detail",
      transactionMethod: "장내매수(+)",
    },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.side).sort(), ["buy", "sell"]);
});

test("retains prior insider rows and skips marker work for duplicate or empty responses", () => {
  const existing = [{
    ticker: "218410.KQ",
    date: "2026-07-20",
    reporter: "Morgan Stanley",
    sharesChanged: 13725,
    receiptNo: "20260721001006",
  }];

  const empty = insiderTrades.mergeRowsWithChange(existing, []);
  assert.equal(empty.changed, false);
  assert.equal(empty.rows.length, 1);

  const duplicate = insiderTrades.mergeRowsWithChange(existing, existing);
  assert.equal(duplicate.changed, false);

  const added = insiderTrades.mergeRowsWithChange(existing, [{
    ticker: "218410.KQ",
    date: "2026-07-21",
    reporter: "Morgan Stanley",
    sharesChanged: -500,
    receiptNo: "20260721001007",
  }]);
  assert.equal(added.changed, true);
  assert.equal(added.added, 1);
});

test("nets same-day buy and sell trades by the same reporter into one marker", () => {
  const rows = insiderTrades.sanitizeRows([
    {
      ticker: "218410.KQ",
      date: "2026-07-20",
      reporter: "Morgan Stanley",
      sharesChanged: -4767,
    },
    {
      ticker: "218410.KQ",
      date: "2026-07-20",
      reporter: "Morgan Stanley",
      sharesChanged: 13725,
    },
    {
      ticker: "218410.KQ",
      date: "2026-07-20",
      reporter: "Another Holder",
      sharesChanged: -500,
    },
  ]);

  const netted = insiderTrades.netSameReporterTrades(rows);

  assert.equal(netted.length, 2);
  assert.deepEqual(
    netted.map((row) => [row.reporter, row.side, row.sharesChanged]),
    [
      ["Morgan Stanley", "buy", 8958],
      ["Another Holder", "sell", -500],
    ],
  );
  assert.equal(netted[0].nettedTransactionCount, 2);
});

test("removes a same-reporter marker when same-day buys and sells net to zero", () => {
  const rows = insiderTrades.sanitizeRows([
    { ticker: "218410.KQ", date: "2026-07-20", reporter: "Same Holder", sharesChanged: 500 },
    { ticker: "218410.KQ", date: "2026-07-20", reporter: "Same Holder", sharesChanged: -500 },
  ]);

  assert.deepEqual(insiderTrades.netSameReporterTrades(rows), []);
});
