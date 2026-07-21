import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DartGateway,
  isAllowedOrigin,
  isPrivateAddress,
  parseEnvText,
} from "../../scripts/local_pages_server.mjs";


test("parses the local environment without exposing values", () => {
  const parsed = parseEnvText("# local only\nDART_API_KEY='secret-value'\nEMPTY=\n");
  assert.equal(parsed.DART_API_KEY, "secret-value");
  assert.equal(parsed.EMPTY, "");
});

test("allows only local clients and app origins", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:192.168.0.10"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isAllowedOrigin("capacitor://localhost"), true);
  assert.equal(isAllowedOrigin("http://192.168.0.10:8787"), true);
  assert.equal(isAllowedOrigin("https://example.com"), false);
});

test("filters low-impact disclosures before returning them", () => {
  const important = DartGateway.recordFromItem("383220.KS", {
    rcept_dt: "20260721",
    report_nm: "단일판매ㆍ공급계약체결",
    rcept_no: "1",
  });
  const lowImpact = DartGateway.recordFromItem("383220.KS", {
    rcept_dt: "20260721",
    report_nm: "기업설명회(IR)개최",
    rcept_no: "2",
  });
  assert.ok(important);
  assert.equal(lowImpact, null);
});

test("uses the per-ticker disk cache after the first request", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "thinkstock-dart-"));
  try {
    const gateway = new DartGateway("test-key", { cacheDir, disclosureTtlMs: 3600000 });
    await gateway.initialize();
    let requests = 0;
    gateway.fetchDisclosures = async () => {
      requests += 1;
      return [{ ticker: "383220.KS", date: "2026-07-21", title: "중요 공시" }];
    };
    const first = await gateway.disclosures("383220.KS");
    const second = await gateway.disclosures("383220.KS");
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.records.length, 1);
    assert.equal(requests, 1);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("loads F&F's corp code from the local shard", async () => {
  const gateway = new DartGateway("test-key");
  assert.equal(await gateway.corpCode("383220"), "01568413");
});
