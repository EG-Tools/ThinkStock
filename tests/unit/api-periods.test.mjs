import assert from "node:assert/strict";
import test from "node:test";
import * as apiPeriods from "../../docs/modules/api-periods.mjs";

test("keeps the KRX key and registered service periods in one source", () => {
  const module = apiPeriods;
  assert.equal(module.DEFAULT_PERIODS.length, 12);
  assert.deepEqual(
    { ...module.DEFAULT_PERIODS[0] },
    {
      id: "krx-auth-key",
      name: "KRX API",
      startDate: "2026-04-15",
      endDate: "2027-04-14",
    },
  );
  assert.equal(module.DEFAULT_PERIODS[1].name, "파생상품지수 시세정보");
  assert.equal(module.DEFAULT_PERIODS[1].endDate, "2027-08-11");
  assert.equal(module.DEFAULT_PERIODS[8].name, "한국은행");
  assert.equal(module.formatPeriodRange(module.DEFAULT_PERIODS[8]), "2026/04/19 ~ 2028/04/19");
  assert.equal(module.formatPeriodRange(module.DEFAULT_PERIODS[10]), "기간 제한 없음");
});

test("compacts matching API periods for the settings display", () => {
  const module = apiPeriods;
  const compacted = module.compactPeriodsForDisplay(module.DEFAULT_PERIODS);

  assert.equal(module.DEFAULT_PERIODS.length, 12);
  assert.equal(compacted.length, 8);
  assert.deepEqual(
    Array.from(compacted, (period) => period.name),
    [
      "KRX API",
      "파생상품지수 시세정보",
      "코스피·코스닥 지수 시세정보",
      "코스피·코스닥 일별매매정보",
      "코스피·코스닥 종목기본정보",
      "한국은행",
      "금융위원회",
      "DART·FRED",
    ],
  );
  assert.equal(module.formatPeriodRange(compacted[3]), "2026/04/17 ~ 2027/04/16");
  assert.equal(module.formatPeriodRange(compacted[7]), "기간 제한 없음");
});

test("shows expired API periods in settings without a reminder state", () => {
  const module = apiPeriods;
  assert.equal(
    module.formatPeriodRange(module.DEFAULT_PERIODS[0], "2027-04-14"),
    "2026/04/15 ~ 2027/04/14",
  );
  assert.equal(
    module.formatPeriodRange(module.DEFAULT_PERIODS[0], "2027-04-15"),
    "기간만료",
  );
  assert.equal(
    module.formatPeriodRange(module.DEFAULT_PERIODS[10], "2030-01-01"),
    "기간 제한 없음",
  );
});
