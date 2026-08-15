import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDartFinancialQueryPlan,
  mergeDartFinancialRows,
  parseDartMajorAccountPayload,
} from "../../shared/dart-financial-history.mjs";

function account(accountName, amount, extra = {}) {
  return {
    rcept_no: "20260515001234",
    reprt_code: "11013",
    bsns_year: "2026",
    corp_code: "00126380",
    stock_code: "005930",
    fs_div: "CFS",
    sj_div: "IS",
    account_nm: accountName,
    thstrm_amount: amount,
    ...extra,
  };
}

test("parses consolidated DART major accounts into point-in-time financial rows", () => {
  const rows = parseDartMajorAccountPayload({
    status: "000",
    list: [
      account("매출액", "7,000,000,000"),
      account("영업이익", "(500,000,000)"),
      account("당기순이익(손실)", "300,000,000"),
      account("매출액", "9,000,000,000", { fs_div: "OFS" }),
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, "005930");
  assert.equal(rows[0].period, "2026-03");
  assert.equal(rows[0].frequency, "quarter");
  assert.equal(rows[0].reportDate, "2026-05-15");
  assert.equal(rows[0].revenue, 70);
  assert.equal(rows[0].operatingProfit, -5);
  assert.equal(rows[0].netIncome, 3);
});

test("keeps report revisions and computes YoY against evidence available then", () => {
  const rows = mergeDartFinancialRows([
    { ticker: "005930", period: "2025-03", frequency: "quarter", reportDate: "2025-05-15", revenue: 50, operatingProfit: 5 },
    { ticker: "005930", period: "2026-03", frequency: "quarter", reportDate: "2026-05-15", revenue: 75, operatingProfit: 10 },
    { ticker: "005930", period: "2026-03", frequency: "quarter", reportDate: "2026-06-01", revenue: 80, operatingProfit: 12 },
  ]);

  assert.equal(rows.length, 3);
  assert.equal(rows[1].revenueYoy, 50);
  assert.equal(rows[2].revenueYoy, 60);
  assert.equal(rows[2].operatingProfitYoy, 140);
});

test("requests only financial reports that could have been public by the cutoff", () => {
  const plans = buildDartFinancialQueryPlan({ startYear: 2025, asOf: "2026-08-15" });
  assert.deepEqual(plans.map((item) => `${item.businessYear}:${item.reportCode}`), [
    "2025:11013",
    "2025:11012",
    "2025:11014",
    "2025:11011",
    "2026:11013",
    "2026:11012",
  ]);
});
