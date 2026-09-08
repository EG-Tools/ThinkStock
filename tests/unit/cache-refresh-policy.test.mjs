import assert from "node:assert/strict";
import test from "node:test";


await import("../../docs/modules/cache-refresh-policy.js");
const policy = globalThis.ThinkStockCacheRefreshPolicy;


function entry(path) {
  return {
    cacheKey: `https://example.test${path}`,
    request: { url: `https://example.test${path}` },
  };
}


test("refreshes recent and disclosure data before history and full payloads", () => {
  const planned = policy.planDataRefreshRequests([
    entry("/data/prices.json"),
    entry("/data/prices_history.json"),
    entry("/data/build_report.json"),
    entry("/data/prices_recent.json"),
    entry("/data/disclosures/005930.json"),
  ]);

  assert.deepEqual(planned.map((item) => new URL(item.request.url).pathname), [
    "/data/disclosures/005930.json",
    "/data/prices_recent.json",
    "/data/prices_history.json",
    "/data/build_report.json",
    "/data/prices.json",
  ]);
});


test("limits background refresh concurrency without losing result order", async () => {
  let active = 0;
  let peak = 0;
  const results = await policy.runWithConcurrency([0, 1, 2, 3, 4], async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  }, 2);

  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.value), [0, 2, 4, 6, 8]);
});

test("shares one active refresh and starts a new task only after completion", async () => {
  let calls = 0;
  let release;
  const runRefresh = policy.createSharedTask(() => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  });

  const first = runRefresh();
  const second = runRefresh();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ revision: "first" });
  assert.deepEqual(await first, { revision: "first" });
  assert.deepEqual(await second, { revision: "first" });

  const third = runRefresh();
  await Promise.resolve();
  assert.equal(calls, 2);
  release({ revision: "second" });
  assert.deepEqual(await third, { revision: "second" });
});

test("aborts an expired shared refresh and lets the next attempt start cleanly", async () => {
  let calls = 0;
  const runRefresh = policy.createSharedTask(({ signal, didTimeout }) => {
    calls += 1;
    if (calls > 1) return { ok: true, generation: calls };
    return new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve({
        ok: false,
        aborted: true,
        timeout: didTimeout(),
      }), { once: true });
    });
  }, { timeoutMs: 5 });

  const first = runRefresh();
  assert.equal(runRefresh(), first);
  assert.deepEqual(await first, { ok: false, aborted: true, timeout: true });
  assert.equal(calls, 1);

  assert.deepEqual(await runRefresh(), { ok: true, generation: 2 });
  assert.equal(calls, 2);
});


test("builds hashed refresh entries from a segmented manifest", () => {
  const digest = "a".repeat(64);
  const entries = policy.manifestDataEntries({
    format: "segmented-data-v1",
    datasets: {
      prices: {
        recent: { file: "prices_recent.json", sha256: digest },
        history: { file: "prices_history.json", sha256: digest },
      },
    },
  }, "https://example.test/data/");

  assert.deepEqual(entries.map((item) => item.cacheKey), [
    "https://example.test/data/prices_recent.json",
    "https://example.test/data/prices_history.json",
  ]);
  assert.equal(policy.normalizeManifestRevision("AB-CD" + "1".repeat(20)), `abcd${"1".repeat(20)}`);
});


test("reuses only manifest segments whose SHA-256 is unchanged", () => {
  const sameDigest = "a".repeat(64);
  const oldDigest = "b".repeat(64);
  const newDigest = "c".repeat(64);
  const manifest = (recentDigest, historyDigest) => ({
    format: "segmented-data-v1",
    datasets: {
      prices: {
        recent: { file: "prices_recent.json", sha256: recentDigest },
        history: { file: "prices_history.json", sha256: historyDigest },
      },
    },
  });

  const planned = policy.planManifestRefreshEntries(
    manifest(sameDigest, oldDigest),
    manifest(sameDigest, newDigest),
    "https://example.test/data/",
  );

  assert.deepEqual(planned.map((entry) => ({
    name: new URL(entry.cacheKey).pathname.split("/").pop(),
    reuse: entry.reuse,
  })), [
    { name: "prices_recent.json", reuse: true },
    { name: "prices_history.json", reuse: false },
  ]);
});


test("keeps completed data revisions while replacing shell and staging caches", () => {
  const prefix = "thinkstock-data-v1-";
  assert.equal(policy.isPersistentDataCacheName(`${prefix}abc123`, prefix), true);
  assert.equal(policy.isPersistentDataCacheName(`${prefix}abc123-staging`, prefix), false);
  assert.equal(policy.isPersistentDataCacheName(`${prefix}abc123-staging-7`, prefix), false);
  assert.deepEqual(policy.planActivationCacheCleanup([
    "thinkstock-old-shell",
    "thinkstock-new-shell",
    `${prefix}abc123`,
    `${prefix}def456-staging`,
    `${prefix}def456-staging-7`,
    "unrelated-cache",
  ], "thinkstock-new-shell", prefix), [
    "thinkstock-old-shell",
    `${prefix}def456-staging`,
    `${prefix}def456-staging-7`,
    "unrelated-cache",
  ]);
});
