import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const source = await readFile(path.resolve("docs/modules/disclosure-policy.js"), "utf8");
const context = {};
vm.runInNewContext(source, context);
const policy = context.ThinkStockDisclosurePolicy;


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
