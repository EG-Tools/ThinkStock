import assert from "node:assert/strict";
import test from "node:test";

import {
  DART_DISCLOSURE_MAX_PAGES,
  DART_DISCLOSURE_TYPES,
  mergeDartDisclosureRecords,
  recordFromDartItem,
} from "../../shared/dart-disclosure.mjs";

test("normalizes important DART disclosures for local and Worker callers", () => {
  const record = recordFromDartItem("218410.kq", {
    corp_name: "RFHIC",
    rcept_dt: "20260814",
    report_nm: "단일판매ㆍ공급계약체결",
    rcept_no: "20260814000123",
  });
  assert.equal(record.ticker, "218410.KQ");
  assert.equal(record.date, "2026-08-14");
  assert.match(record.url, /20260814000123$/);
  assert.equal(recordFromDartItem("218410.KQ", {
    rcept_dt: "20260814",
    report_nm: "기업설명회(IR)개최",
  }), null);
  assert.deepEqual(DART_DISCLOSURE_TYPES, ["A", "B", "C", "E", "I"]);
  assert.equal(DART_DISCLOSURE_MAX_PAGES, 100);
});

test("deduplicates revised DART disclosures by receipt number", () => {
  const oldRecord = {
    ticker: "005930.KS",
    date: "2026-08-13",
    title: "배당 결정",
    receiptNo: "1",
    name: "old",
  };
  const merged = mergeDartDisclosureRecords([oldRecord], [{ ...oldRecord, name: "new" }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "new");
});
