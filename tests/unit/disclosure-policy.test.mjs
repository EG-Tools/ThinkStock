import assert from "node:assert/strict";
import test from "node:test";
import * as policy from "../../docs/modules/disclosure-policy.mjs";


test("classifies market-moving disclosures", () => {
  assert.equal(policy.classifyDisclosureType("단일판매ㆍ공급계약체결"), "수주");
  assert.equal(policy.classifyDisclosureType("현금ㆍ현물배당 결정"), "배당");
  assert.equal(policy.classifyDisclosureType("주주총회소집공고"), "공시");
});

test("keeps important disclosures and rejects low-impact notices", () => {
  assert.equal(policy.shouldDisplayDisclosure("영업(잠정)실적"), true);
  assert.equal(policy.shouldDisplayDisclosure("주주총회소집공고"), false);
  assert.equal(policy.shouldDisplayDisclosure("일반 안내"), false);
});

test("sanitizes and caches disclosure data without loading the live DART client", () => {
  const values = new Map();
  let now = 1000;
  const service = policy.createDisclosureDataService({
    labelName: () => "삼성전자",
    refreshCacheKey: "refresh",
    refreshCacheTtlMs: 500,
    getStorage: () => ({
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
    }),
    now: () => now,
  });
  const rows = service.sanitizeRows([
    { ticker: "005930.ks", date: "2026-07-20", title: "현금배당 결정" },
    { ticker: "005930.KS", date: "2026-07-20", title: "주주총회소집공고" },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, "005930.KS");
  service.rememberRefresh("005930.KS", { added: 1, latestDate: "2026-07-20" });
  assert.equal(service.hasFreshRefresh("005930.KS"), true);
  now += 501;
  assert.equal(service.hasFreshRefresh("005930.KS"), false);
});

test("reports disclosure changes only when merged content actually differs", () => {
  const service = policy.createDisclosureDataService({
    classifyType: () => "important",
    shouldDisplay: () => true,
    labelName: () => "Samsung Electronics",
  });
  const existing = [{
    ticker: "005930.KS",
    date: "2026-08-12",
    title: "Material disclosure",
    summary: "initial",
  }];

  const duplicate = service.mergeRowsWithChange(existing, existing);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.added, 0);

  const corrected = service.mergeRowsWithChange(existing, [{
    ...existing[0],
    summary: "corrected",
  }]);
  assert.equal(corrected.changed, true);
  assert.equal(corrected.added, 0);
  assert.equal(corrected.rows[0].summary, "corrected");
});

test("ticker disclosure cache centralizes validation, touch and pruning", async () => {
  const records = new Map();
  let pruned = 0;
  const service = policy.createDisclosureDataService({
    classifyType: () => "important",
    shouldDisplay: () => true,
  });
  const cache = policy.createTickerDisclosureCache({
    schema: 3,
    now: () => 2000,
    sanitizeRows: service.sanitizeRows,
    readRecord: async (ticker) => records.get(ticker) || null,
    writeRecord: async (ticker, record) => { records.set(ticker, record); },
    recordIssue: (record, options) => (
      record.schema === options.schema && record.ticker === options.key ? "" : "invalid"
    ),
    shouldTouch: () => true,
    schedulePrune: () => { pruned += 1; },
  });
  const row = { ticker: "005930.KS", date: "2026-08-12", title: "Material disclosure" };
  assert.equal(await cache.write("005930.ks", [row]), true);
  assert.equal(pruned, 1);
  const restored = await cache.read("005930.KS");
  assert.equal(restored.rows.length, 1);
  assert.equal(restored.lastAccessed, 2000);
  assert.equal((await cache.read("000000.KS")), null);
});

test("disclosure state controller keeps memory, refresh state, and ticker cache consistent", async () => {
  let rows = [];
  let changed = 0;
  const records = new Map();
  const service = policy.createDisclosureDataService({
    classifyType: () => "important",
    shouldDisplay: () => true,
    refreshStore: {
      read: () => ({}),
      write: () => {},
    },
  });
  const cache = {
    read: async (ticker) => records.get(ticker) || null,
    write: async (ticker, tickerRows) => {
      records.set(ticker, { rows: tickerRows, latestDate: tickerRows.at(-1)?.date || "" });
      return true;
    },
  };
  const controller = policy.createDisclosureStateController({
    dataService: service,
    getRows: () => rows,
    setRows: (nextRows) => { rows = nextRows; },
    getTickerCache: () => cache,
    onChanged: () => { changed += 1; },
  });
  const row = { ticker: "005930.KS", date: "2026-08-21", title: "Material disclosure" };

  assert.equal(controller.merge([row]).added, 1);
  assert.equal(controller.merge([row]).changed, false);
  assert.equal(changed, 1);
  assert.equal(await controller.writeTicker("005930.KS"), true);
  rows = [];
  const restored = await controller.applyTickerCache("005930.KS");
  assert.equal(restored.applied, true);
  assert.equal(restored.added, 1);
  assert.equal(restored.latestDate, "2026-08-21");
  assert.equal(controller.rowsForTicker("005930.ks").length, 1);
});
