import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const source = await readFile(path.resolve("docs/modules/dart-disclosure.js"), "utf8");
const context = { URLSearchParams };
vm.runInNewContext(source, context);
const { createDartDisclosureService } = context.ThinkStockDartDisclosure;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function createService(overrides = {}) {
  return createDartDisclosureService({
    classifyType: (title) => title.includes("중요") ? "실적" : "공시",
    shouldDisplay: (title) => title.includes("중요"),
    labelName: (ticker) => `회사-${ticker}`,
    baseUrl: "https://example.test/list.json",
    today: () => "2026-07-15",
    ...overrides,
  });
}

test("sanitizes, filters, and merges disclosure rows", () => {
  const service = createService();
  const existing = [{
    ticker: "005930.ks",
    date: "2026-07-10",
    title: "중요 기존 공시",
    type: "공시",
    url: "https://example.test/old",
  }];
  const incoming = [
    { ...existing[0], ticker: "005930.KS", url: "https://example.test/new" },
    { ticker: "005930.KS", date: "2026-07-11", title: "일반 안내" },
    { ticker: "000660.KS", date: "2026-07-12", title: "중요 신규 공시" },
  ];

  const rows = plain(service.mergeRows(existing, incoming));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ticker, "005930.KS");
  assert.equal(rows[0].type, "실적");
  assert.equal(rows[0].url, "https://example.test/new");
  assert.equal(rows[1].name, "회사-000660.KS");
});

test("loads all configured DART market pages and maps records to tickers", async () => {
  const requestedPages = [];
  const service = createService({
    runtimePageBatch: 2,
    fetchJson: async (url) => {
      const query = new URL(url).searchParams;
      const page = Number(query.get("page_no"));
      requestedPages.push(page);
      assert.equal(query.get("corp_cls"), "Y");
      assert.equal(query.get("bgn_de"), "20260414");
      if (page === 1) {
        return {
          status: "000",
          total_page: 2,
          list: [{ stock_code: "005930", report_nm: "중요 1분기 실적", rcept_dt: "20260714", rcept_no: "1" }],
        };
      }
      return {
        status: "000",
        list: [{ stock_code: "000660", report_nm: "중요 공급 계약", rcept_dt: "20260713", rcept_no: "2" }],
      };
    },
  });

  const rows = plain(await service.fetchForMarkets(
    "test-key",
    new Map([["005930", "005930.KS"], ["000660", "000660.KS"]]),
    ["Y"],
  ));
  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(rows.map((row) => row.ticker), ["000660.KS", "005930.KS"]);
  assert.equal(rows[1].url, "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1");
});

test("expires per-ticker refresh cache entries after the configured TTL", () => {
  const storage = createMemoryStorage();
  let clock = 1_000_000;
  const service = createService({
    getStorage: () => storage,
    refreshCacheKey: "dart-cache",
    refreshCacheTtlMs: 1000,
    now: () => clock,
  });

  service.rememberRefresh("005930.ks", { fetched: 3, added: 2, latestDate: "2026-07-15" });
  assert.equal(service.hasFreshRefresh("005930.KS"), true);
  assert.equal(service.getRefreshCacheEntry("005930.KS").added, 2);
  clock += 1001;
  assert.equal(service.hasFreshRefresh("005930.KS"), false);
});

test("forwards cancellation to active DART page requests", async () => {
  let requestSignal = null;
  const service = createService({
    fetchJson: (_url, init) => new Promise((_resolve, reject) => {
      requestSignal = init?.signal || null;
      requestSignal?.addEventListener("abort", () => reject(requestSignal.reason), { once: true });
    }),
  });
  const controller = new AbortController();
  const request = service.fetchForMarkets(
    "test-key",
    new Map([["005930", "005930.KS"]]),
    ["Y"],
    { signal: controller.signal },
  );
  await Promise.resolve();
  controller.abort();

  await assert.rejects(request, (error) => error?.name === "AbortError");
  assert.equal(requestSignal, controller.signal);
});
