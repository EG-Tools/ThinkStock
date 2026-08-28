import assert from "node:assert/strict";
import test from "node:test";
import { granularRecordIssue } from "../../docs/modules/cache-lifecycle-policy.mjs";

test("accepts a current granular cache record", () => {
  assert.equal(granularRecordIssue({
    schema: 2,
    ticker: "005930.KS",
    savedAt: 1000,
    latestDate: "2026-08-10",
  }, {
    schema: 2,
    key: "005930.KS",
    contentCount: 12,
    now: 2000,
  }), "");
});

test("identifies records that should be removed and rebuilt", () => {
  const base = {
    schema: 2,
    ticker: "005930.KS",
    savedAt: 1000,
    latestDate: "2026-08-10",
  };
  assert.equal(granularRecordIssue({ ...base, schema: 1 }, {
    schema: 2, key: "005930.KS", contentCount: 1, now: 2000,
  }), "schema-mismatch");
  assert.equal(granularRecordIssue(base, {
    schema: 2, key: "005930.KS", contentCount: 0, now: 2000,
  }), "empty-content");
  assert.equal(granularRecordIssue({ ...base, ticker: "000660.KS" }, {
    schema: 2, key: "005930.KS", contentCount: 1, now: 2000,
  }), "key-mismatch");
  assert.equal(granularRecordIssue({ ...base, contentFingerprint: "old" }, {
    schema: 2,
    key: "005930.KS",
    contentCount: 1,
    contentFingerprint: "new",
    now: 2000,
  }), "content-mismatch");
});
