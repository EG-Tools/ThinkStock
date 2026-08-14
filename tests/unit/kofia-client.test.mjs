import assert from "node:assert/strict";
import test from "node:test";

import {
  createKofiaClient,
  mergeCreditRows,
  parseFreesisPayload,
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

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /apis\.data\.go\.kr/);
  assert.match(requests[1].url, /freesis\.kofia\.or\.kr/);
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

test("Freesis parser keeps valid numbers and rejects masked payloads", () => {
  assert.equal(parseFreesisPayload('{"ds1":[{"TMPV3":123}]}').ds1[0].TMPV3, 123);
  assert.throws(
    () => parseFreesisPayload('{"ds1":[{"TMPV3":12####}]}'),
    /masked numeric values/,
  );
});
