import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDartEpsYearRecords,
  buildDartFinancialQueryPlan,
  completedDartEpsYearRange,
  fetchDartEpsYear,
  mergeDartFinancialRows,
  parseDartMajorAccountPayload,
  parseDartEpsReportPayload,
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

test("parses basic EPS ahead of diluted EPS and keeps won units", () => {
  const row = parseDartEpsReportPayload({
    status: "000",
    list: [
      account("희석주당이익", "875", { account_id: "ifrs-full_DilutedEarningsLossPerShare" }),
      account("기본주당이익", "900", { account_id: "ifrs-full_BasicEarningsLossPerShare" }),
    ],
  }, { ticker: "005930.KS", businessYear: 2026, reportCode: "11013" });

  assert.equal(row.current, 900);
  assert.equal(row.period, "2026-03");
  assert.equal(row.ticker, "005930.KS");
});

test("builds quarterly EPS and derives fourth quarter from annual cumulative EPS", () => {
  const records = buildDartEpsYearRecords([
    { ticker: "005930.KS", businessYear: 2025, reportCode: "11013", current: 100, cumulative: 100, reportDate: "2025-05-15" },
    { ticker: "005930.KS", businessYear: 2025, reportCode: "11012", current: 120, cumulative: 220, reportDate: "2025-08-14" },
    { ticker: "005930.KS", businessYear: 2025, reportCode: "11014", current: null, cumulative: 360, reportDate: "2025-11-14" },
    { ticker: "005930.KS", businessYear: 2025, reportCode: "11011", current: 520, cumulative: null, reportDate: "2026-03-31" },
  ]);

  assert.deepEqual(records.filter((row) => row.frequency === "quarter").map((row) => row.eps), [100, 120, 140, 160]);
  assert.equal(records.find((row) => row.frequency === "quarter" && row.period === "2025-12").epsDerived, true);
  assert.equal(records.find((row) => row.frequency === "annual").eps, 520);
});

test("targets ten completed financial years after annual filings become available", () => {
  assert.deepEqual(completedDartEpsYearRange({ asOf: "2026-08-24" }), {
    startYear: 2016,
    endYear: 2025,
    years: 10,
  });
  assert.deepEqual(completedDartEpsYearRange({ asOf: "2027-02-01" }), {
    startYear: 2016,
    endYear: 2025,
    years: 10,
  });
});

test("falls back to separate statements only when consolidated EPS is unavailable", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const query = new URL(url).searchParams;
    requests.push(`${query.get("reprt_code")}:${query.get("fs_div")}`);
    const reportCode = query.get("reprt_code");
    const fsDivision = query.get("fs_div");
    if (fsDivision === "CFS") return new Response(JSON.stringify({ status: "013", message: "no data" }));
    return new Response(JSON.stringify({
      status: "000",
      list: [account("기본주당이익", reportCode === "11011" ? "400" : "100", {
        reprt_code: reportCode,
        bsns_year: "2025",
        fs_div: "OFS",
        account_id: "ifrs-full_BasicEarningsLossPerShare",
        thstrm_add_amount: reportCode === "11012" ? "200" : (reportCode === "11014" ? "300" : "100"),
      })],
    }));
  };

  const result = await fetchDartEpsYear({
    apiKey: "test-key",
    corpCode: "00126380",
    ticker: "005930.KS",
    businessYear: 2025,
    fetchImpl,
  });
  assert.equal(requests.length, 8);
  assert.equal(result.records.filter((row) => row.frequency === "quarter").length, 4);
});
