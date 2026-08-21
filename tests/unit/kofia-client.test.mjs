import assert from "node:assert/strict";
import test from "node:test";

import {
  creditCacheFreshThrough,
  creditCacheRefreshDecision,
  createKofiaClient,
  expectedLatestKofiaDate,
  fetchKofiaCreditAndDepositRows,
  mergeCreditRows,
  parseFreesisPayload,
  parseIndexergoLatestPoint,
} from "../../worker/src/kofia-client.mjs";

function textResponse(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

test("falls back to Freesis when the authenticated KOFIA response is malformed", async () => {
  const requests = [];
  const client = createKofiaClient({
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("apis.data.go.kr")) {
        return textResponse('{"response":{"header":{"resultCode":"00"},');
      }
      if (String(url).includes("indexergo.com")) return textResponse("blocked", 403);
      return textResponse(JSON.stringify({
        ds1: [{
          TMPV1: "20260808",
          TMPV3: "21,500,000,000,000",
          TMPV4: "5,800,000,000,000",
        }],
      }));
    },
    timeoutSignal: () => undefined,
    wait: async () => {},
  });

  const rows = await client.fetchCreditRows("encoded-key");

  const openApiRequest = requests.find(({ url }) => url.includes("apis.data.go.kr"));
  const freesisRequest = requests.find(({ url }) => url.includes("freesis.kofia.or.kr"));
  const mirrorRequests = requests.filter(({ url }) => url.includes("indexergo.com"));
  assert.ok(openApiRequest);
  assert.equal(openApiRequest.init.cache, "no-store");
  assert.match(freesisRequest.url, /[?&]_=/);
  assert.equal(freesisRequest.init.cache, "no-store");
  assert.equal(freesisRequest.init.headers.Referer, "https://freesis.kofia.or.kr/");
  assert.equal(mirrorRequests.length, 0);
  assert.deepEqual(rows, [{
    date: "2026-08-08",
    kospi_credit: 21.5,
    kosdaq_credit: 5.8,
  }]);
});

test("merges a newer Freesis day into successful but delayed Open API rows", async () => {
  const client = createKofiaClient({
    fetch: async (url, init = {}) => {
      if (String(url).includes("apis.data.go.kr")) {
        return textResponse(JSON.stringify({
          response: {
            header: { resultCode: "00" },
            body: {
              items: {
                item: [{
                  basDt: "20260806",
                  crdTrFingScrs: "22,868,500,000,000",
                  crdTrFingKosdaq: "5,925,500,000,000",
                }],
              },
            },
          },
        }));
      }
      if (String(url).includes("indexergo.com")) return textResponse("blocked", 403);
      assert.equal(init.method, "POST");
      return textResponse(JSON.stringify({
        ds1: [{
          TMPV1: "20260807",
          TMPV3: "23,100,000,000,000",
          TMPV4: "6,000,000,000,000",
        }],
      }));
    },
    timeoutSignal: () => undefined,
    wait: async () => {},
  });

  assert.deepEqual(await client.fetchCreditRows("key"), [
    { date: "2026-08-06", kospi_credit: 22.8685, kosdaq_credit: 5.9255 },
    { date: "2026-08-07", kospi_credit: 23.1, kosdaq_credit: 6 },
  ]);
});

test("reports both upstream failures when Open API and Freesis are unusable", async () => {
  const client = createKofiaClient({
    fetch: async (url) => String(url).includes("apis.data.go.kr")
      ? textResponse("upstream down", 503)
      : textResponse('{"ds1":[{"TMPV3":12####}]}'),
    timeoutSignal: () => undefined,
    wait: async () => {},
  });

  await assert.rejects(
    () => client.fetchCreditRows("key"),
    /신용 잔고 조회 실패: KOFIA Open API HTTP 503.*masked numeric values/,
  );
});

test("reports a delayed Freesis source while preserving valid Open API rows", async () => {
  const client = createKofiaClient({
    fetch: async (url) => String(url).includes("apis.data.go.kr")
      ? textResponse(JSON.stringify({
        response: {
          header: { resultCode: "00" },
          body: { items: { item: [{
            basDt: "20260812",
            crdTrFingScrs: "24198820770037",
            crdTrFingKosdaq: "6219932204840",
            invrDpsgAmt: "99976500000000",
          }] } },
        },
      }))
      : textResponse("upstream down", 503),
    timeoutSignal: () => undefined,
    wait: async () => {},
  });

  const result = await fetchKofiaCreditAndDepositRows(client, "key");

  assert.equal(result.rows.at(-1).date, "2026-08-12");
  assert.equal(result.componentWarnings.length, 2);
  assert.match(result.componentWarnings.join(" / "), /Freesis 지연/);
});

test("uses a newer INDEXerGO point but preserves same-day official precision", async () => {
  const client = createKofiaClient({
    enableIndexergo: true,
    fetch: async (url) => {
      const source = String(url);
      if (source.includes("apis.data.go.kr")) {
        return textResponse(JSON.stringify({
          response: {
            header: { resultCode: "00" },
            body: { items: { item: [{
              basDt: "20260812",
              crdTrFingScrs: "24198820770037",
              crdTrFingKosdaq: "6219932204840",
            }] } },
          },
        }));
      }
      if (source.includes("detailId=20215")) {
        return textResponse('<h1 class="visually-hidden">2026.08.13 마감 기준 신용거래융자: 24.53조원</h1>');
      }
      if (source.includes("detailId=20315")) {
        return textResponse('<h1 class="visually-hidden">2026.08.13 마감 기준 신용거래융자: 6.39조원</h1>');
      }
      return textResponse(JSON.stringify({
        ds1: [{ TMPV1: "20260812", TMPV3: "24198820770037", TMPV4: "6219932204840" }],
      }));
    },
    timeoutSignal: () => undefined,
    wait: async () => {},
  });

  assert.deepEqual(await client.fetchCreditRows("key"), [
    { date: "2026-08-12", kospi_credit: 24.1988, kosdaq_credit: 6.2199 },
    { date: "2026-08-13", kospi_credit: 24.53, kosdaq_credit: 6.39 },
  ]);
});

test("skips fallback sources when official rows reach the expected publication date", async () => {
  const requests = [];
  const client = createKofiaClient({
    enableIndexergo: true,
    officialFreshThrough: "2026-08-19",
    fetchIndexergoHtml: async () => {
      throw new Error("INDEXerGO should not be called");
    },
    fetch: async (url) => {
      requests.push(String(url));
      if (!String(url).includes("apis.data.go.kr")) throw new Error("Freesis should not be called");
      return textResponse(JSON.stringify({
        response: {
          header: { resultCode: "00" },
          body: { items: { item: [{
            basDt: "20260819",
            crdTrFingScrs: "24487400000000",
            crdTrFingKosdaq: "6824600000000",
          }] } },
        },
      }));
    },
    timeoutSignal: () => undefined,
  });

  assert.deepEqual(await client.fetchCreditRows("key"), [{
    date: "2026-08-19",
    kospi_credit: 24.4874,
    kosdaq_credit: 6.8246,
  }]);
  assert.equal(requests.length, 1);
});

test("skips fallback sources when the saved mirror already covers the expected date", async () => {
  let fallbackCalls = 0;
  const client = createKofiaClient({
    enableIndexergo: true,
    officialFreshThrough: "2026-08-19",
    cachedFreshThrough: { credit: "2026-08-19" },
    fetchIndexergoHtml: async () => {
      fallbackCalls += 1;
      throw new Error("INDEXerGO should not be called");
    },
    fetch: async (url) => {
      if (!String(url).includes("apis.data.go.kr")) {
        fallbackCalls += 1;
        throw new Error("Freesis should not be called");
      }
      return textResponse(JSON.stringify({
        response: {
          header: { resultCode: "00" },
          body: { items: { item: [{
            basDt: "20260818",
            crdTrFingScrs: "24300000000000",
            crdTrFingKosdaq: "6700000000000",
          }] } },
        },
      }));
    },
    timeoutSignal: () => undefined,
  });

  assert.equal((await client.fetchCreditRows("key")).at(-1).date, "2026-08-18");
  assert.equal(fallbackCalls, 0);
});

test("derives the expected KOFIA publication date around the 09:31 cutoff", () => {
  assert.equal(expectedLatestKofiaDate(new Date("2026-08-20T00:30:00Z")), "2026-08-18");
  assert.equal(expectedLatestKofiaDate(new Date("2026-08-20T00:31:00Z")), "2026-08-19");
  assert.equal(expectedLatestKofiaDate(new Date("2026-08-18T01:00:00Z")), "2026-08-14");
});

test("credit row merging ignores unpublished zero values", () => {
  assert.deepEqual(mergeCreditRows(
    [{ date: "2026-08-07", kospi_credit: 21.4, kosdaq_credit: 5.7 }],
    [{ date: "2026-08-07", kospi_credit: 0, kosdaq_credit: 5.8, customer_deposit: 0 }],
  ), [{
    date: "2026-08-07",
    kospi_credit: 21.4,
    kosdaq_credit: 5.8,
  }]);
});

test("credit cache skips a forced refresh when both components cover the expected date", () => {
  const cached = {
    schema: 5,
    lastCheckedWindow: "2026-08-20",
    rows: [
      { date: "2026-08-19", kospi_credit: 24.4, kosdaq_credit: 6.8 },
      { date: "2026-08-19", customer_deposit: 99.1 },
    ],
  };
  assert.deepEqual(creditCacheFreshThrough(cached.rows), {
    credit: "2026-08-19",
    deposit: "2026-08-19",
  });
  assert.equal(creditCacheRefreshDecision({
    cached,
    expectedDate: "2026-08-19",
    refresh: true,
    requiredSchema: 5,
    windowDate: "2026-08-20",
  }).needsRefresh, false);
});

test("credit cache refreshes when either credit or deposit is behind", () => {
  const decision = creditCacheRefreshDecision({
    cached: {
      schema: 5,
      lastCheckedWindow: "2026-08-19",
      rows: [
        { date: "2026-08-18", customer_deposit: 98.7 },
        { date: "2026-08-19", kospi_credit: 24.4, kosdaq_credit: 6.8 },
      ],
    },
    expectedDate: "2026-08-19",
    requiredSchema: 5,
    windowDate: "2026-08-20",
  });
  assert.equal(decision.needsRefresh, true);
  assert.deepEqual(decision.freshThrough, {
    credit: "2026-08-19",
    deposit: "2026-08-18",
  });
});

test("Freesis parser keeps valid numbers and rejects masked payloads", () => {
  assert.equal(parseFreesisPayload('{"ds1":[{"TMPV3":123}]}').ds1[0].TMPV3, 123);
  assert.throws(
    () => parseFreesisPayload('{"ds1":[{"TMPV3":12####}]}'),
    /masked numeric values/,
  );
});

test("INDEXerGO parser reads the accessible latest daily point", () => {
  assert.deepEqual(
    parseIndexergoLatestPoint(
      '<h1 class="visually-hidden">2026.08.13 마감 기준 투자자예탁금: 100.07조원</h1>',
    ),
    { date: "2026-08-13", value: 100.07 },
  );
  assert.throws(() => parseIndexergoLatestPoint("no data"), /latest point was not found/);
});
