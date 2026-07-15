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
