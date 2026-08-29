import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchNaverLiveResearchUniverse,
  naverResearchUniverseUrl,
  normalizeNaverResearchUniverseRows,
  normalizeResearchUniverseSize,
} from "../../shared/research-universe-live.mjs";

function page(market, pageIndex, count = 100) {
  const marketOffset = market === "KOSDAQ" ? 500000 : 100000;
  return Array.from({ length: count }, (_, index) => {
    const rank = pageIndex * 100 + index;
    const code = String(marketOffset + rank).slice(-6).padStart(6, "0");
    return {
      itemcode: code,
      itemname: `${market}-${rank}`,
      nowPrice: String(10000 + rank),
      tradeVolume: String(100000 + rank),
      tradeAmount: String(1000000000 + rank),
      marketSum: String(1000000000000 - rank),
      marketStatus: "OPEN",
    };
  });
}

test("normalizes current Naver market rows for research timing", () => {
  const rows = normalizeNaverResearchUniverseRows([{
    itemcode: "001210",
    itemname: "금호전기",
    nowPrice: "12,340",
    tradeVolume: "1,234,567",
    tradeAmount: "15,000,000,000",
    marketSum: "250,000,000,000",
    marketStatus: "OPEN",
  }], "KOSPI", "2026-08-13");
  assert.deepEqual(rows[0], {
    ticker: "001210.KS",
    code: "001210",
    name: "금호전기",
    market: "KOSPI",
    marketCap: 250000000000,
    tradeValue: 15000000000,
    volume: 1234567,
    close: 12340,
    baseDate: "2026-08-13",
    priceSource: "NAVER_LIVE",
    marketStatus: "OPEN",
    rank: 1,
  });
});

test("loads KOSPI and KOSDAQ top 200 with four requests", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const parsed = new URL(url);
    const market = parsed.searchParams.get("marketType");
    const pageIndex = Number(parsed.searchParams.get("startIdx"));
    return new Response(JSON.stringify(page(market, pageIndex)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const result = await fetchNaverLiveResearchUniverse(fetchImpl, "2026-08-13");
  assert.equal(requested.length, 4);
  assert.equal(result.records.length, 400);
  assert.equal(result.records.filter((row) => row.market === "KOSPI").length, 200);
  assert.equal(result.records.filter((row) => row.market === "KOSDAQ").length, 200);
  assert.equal(result.records[0].baseDate, "2026-08-13");
  assert.equal(result.priceMode, "realtime");
  assert.equal(result.records[0].priceMode, "realtime");
  assert.match(naverResearchUniverseUrl("KOSDAQ", 1), /marketType=KOSDAQ.*startIdx=1.*pageSize=100/);
});

test("marks a post-close Naver universe as settled", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    return new Response(JSON.stringify(page(
      parsed.searchParams.get("marketType"),
      Number(parsed.searchParams.get("startIdx")),
    )), { status: 200 });
  };
  const result = await fetchNaverLiveResearchUniverse(fetchImpl, "2026-08-13", {
    priceMode: "settled",
  });
  assert.equal(result.source, "NAVER_CLOSE");
  assert.equal(result.priceMode, "settled");
  assert.equal(result.records.every((row) => row.priceMode === "settled"), true);
});

test("expands a 400-stock universe by fetching only the extra rank pages", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const parsed = new URL(url);
    const market = parsed.searchParams.get("marketType");
    const pageIndex = Number(parsed.searchParams.get("startIdx"));
    return new Response(JSON.stringify(page(market, pageIndex)), { status: 200 });
  };
  const result = await fetchNaverLiveResearchUniverse(fetchImpl, "2026-08-13", {
    totalLimit: 600,
  });

  assert.equal(requested.length, 6);
  assert.equal(result.records.length, 600);
  assert.deepEqual(result.selection, { KOSPI: 300, KOSDAQ: 300 });
  assert.equal(result.records.filter((row) => row.market === "KOSPI").length, 300);
});

test("backfills filtered preferred shares to complete a 300 plus 300 universe", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const parsed = new URL(url);
    const market = parsed.searchParams.get("marketType");
    const pageIndex = Number(parsed.searchParams.get("startIdx"));
    const rows = page(market, pageIndex);
    if (pageIndex < 3) rows[0].itemcode = `00A${pageIndex}01`;
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  const result = await fetchNaverLiveResearchUniverse(fetchImpl, "2026-08-13", {
    totalLimit: 600,
  });

  assert.equal(requested.length, 8);
  assert.equal(result.records.length, 600);
  assert.deepEqual(result.selection, { KOSPI: 300, KOSDAQ: 300 });
});

test("normalizes research universe size to 100-stock steps", () => {
  assert.equal(normalizeResearchUniverseSize(null), 400);
  assert.equal(normalizeResearchUniverseSize(149), 100);
  assert.equal(normalizeResearchUniverseSize(551), 600);
  assert.equal(normalizeResearchUniverseSize(2000), 1000);
});

test("rejects an incomplete live page so KRX can remain the fallback", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const market = parsed.searchParams.get("marketType");
    const pageIndex = Number(parsed.searchParams.get("startIdx"));
    return new Response(JSON.stringify(page(market, pageIndex, pageIndex === 1 ? 99 : 100)), { status: 200 });
  };
  await assert.rejects(
    fetchNaverLiveResearchUniverse(fetchImpl, "2026-08-13"),
    /incomplete/,
  );
});
