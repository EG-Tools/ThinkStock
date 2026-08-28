import assert from "node:assert/strict";
import test from "node:test";


import * as loaderModule from "../../docs/modules/data-seed-loader.mjs";


test("loads a recent segment before considering the full payload", async () => {
  const requests = [];
  const loader = loaderModule.createDataSeedLoader({
    appendCacheBust: (path) => `${path}?fresh=1`,
    fetchWithTimeout: async (path) => {
      requests.push(path);
      if (path.startsWith("./data/data_manifest.json")) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            format: "segmented-data-v1",
            revision: "fixture",
            datasets: {
              prices: { recent: { file: "prices-r1.json" } },
            },
          }),
        };
      }
      return { ok: true, text: async () => "recent" };
    },
  });

  const result = await loader.fetchSegmentedSeedText("./data/prices.json", "recent", true);

  assert.deepEqual(result, { text: "recent", usedFullFallback: false });
  assert.deepEqual(requests, [
    "./data/data_manifest.json?fresh=1",
    "./data/prices-r1.json?fresh=1",
  ]);
});


test("falls back to the stable full payload after refresh failures", async () => {
  const requests = [];
  const loader = loaderModule.createDataSeedLoader({
    appendCacheBust: (path) => `${path}?fresh=1`,
    fetchWithTimeout: async (path) => {
      requests.push(path);
      if (path === "./data/prices.json") return { ok: true, text: async () => "full" };
      throw new Error("offline");
    },
  });

  const result = await loader.fetchSegmentedSeedText("./data/prices.json", "history", true);

  assert.deepEqual(result, { text: "full", usedFullFallback: true });
  assert.deepEqual(requests, [
    "./data/data_manifest.json?fresh=1",
    "./data/data_manifest.json",
    "./data/prices_history.json?fresh=1",
    "./data/prices_history.json",
    "./data/prices.json?fresh=1",
    "./data/prices.json",
  ]);
});


test("reuses one seed parsing worker across recent and history payloads", async () => {
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.terminated = false;
      workers.push(this);
    }

    postMessage(message) {
      queueMicrotask(() => this.onmessage?.({
        data: {
          id: message.id,
          ok: true,
          result: { segment: message.texts.segment },
        },
      }));
    }

    terminate() {
      this.terminated = true;
    }
  }

  const parser = loaderModule.createSeedBundleParser({}, {
    workerUrl: "./modules/data-worker.mjs?v=2.78",
    createWorker: (url) => new FakeWorker(url),
    parseSync: (texts) => ({ fallback: texts.segment }),
  });

  assert.deepEqual(await parser.parse({ segment: "recent" }), { segment: "recent" });
  assert.deepEqual(await parser.parse({ segment: "history" }), { segment: "history" });
  assert.equal(workers.length, 1);
  assert.deepEqual(parser.stats(), { active: true, pending: 0 });
  parser.dispose();
  assert.equal(workers[0].terminated, true);
});


test("releases the seed parsing worker after its idle window", async () => {
  const timers = new Map();
  let timerSequence = 0;
  let terminated = false;
  class FakeWorker {
    postMessage(message) {
      queueMicrotask(() => this.onmessage?.({
        data: { id: message.id, ok: true, result: { parsed: true } },
      }));
    }

    terminate() {
      terminated = true;
    }
  }
  const parser = loaderModule.createSeedBundleParser({}, {
    createWorker: () => new FakeWorker(),
    parseSync: () => ({ parsed: false }),
    workerIdleMs: 5000,
    setTimer: (callback) => {
      const id = ++timerSequence;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });

  assert.deepEqual(await parser.parse({}), { parsed: true });
  assert.equal(parser.stats().active, true);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(terminated, true);
  assert.equal(parser.stats().active, false);
  parser.dispose();
});


test("falls back to synchronous parsing when a worker response fails", async () => {
  class FailingWorker {
    postMessage(message) {
      queueMicrotask(() => this.onmessage?.({
        data: { id: message.id, ok: false, error: "bad payload" },
      }));
    }
    terminate() {}
  }
  const parser = loaderModule.createSeedBundleParser({}, {
    createWorker: () => new FailingWorker(),
    parseSync: (texts) => ({ recovered: texts.value }),
  });

  assert.deepEqual(await parser.parse({ value: 7 }), { recovered: 7 });
  parser.dispose();
});


test("bundle loader fetches one coherent segment and parses it once", async () => {
  const calls = [];
  const loader = loaderModule.createSeedBundleLoader({
    seedLoader: {
      fetchSegmentedSeedText: async (path, segment, forceNetwork) => {
        calls.push(["segment", path, segment, forceNetwork]);
        return { text: `${path}:${segment}`, usedFullFallback: false };
      },
      fetchSeedText: async (path, forceNetwork) => {
        calls.push(["seed", path, forceNetwork]);
        return path;
      },
    },
    parser: {
      parse: async (texts) => ({ keys: Object.keys(texts).sort() }),
    },
  });

  const result = await loader.load({
    segment: "history",
    forceNetwork: true,
    includeDisclosures: false,
  });
  assert.equal(result.segment, "history");
  assert.equal(result.allCoreSeedsLoaded, true);
  assert.equal(result.allUsedFullFallback, false);
  assert.equal(calls.filter(([kind]) => kind === "segment").length, 4);
  assert.deepEqual(calls.filter(([kind]) => kind === "seed"), [
    ["seed", "./data/vkospi_data.json", true],
  ]);
  assert.deepEqual(result.parsed.keys, [
    "adrText",
    "creditText",
    "disclosureText",
    "macroText",
    "priceText",
    "vkospiText",
  ]);
});

test("sharded DART registry loads only the requested stock-code prefix", async () => {
  const requests = [];
  const registry = loaderModule.createShardedCorpCodeRegistry({
    runRequest: async (kind, identity, factory) => {
      requests.push([kind, identity]);
      return factory();
    },
    fetchText: async (path) => {
      if (path.endsWith("dart_corp_codes.json")) {
        return JSON.stringify({
          format: "stock-to-corp-shards-v1",
          prefix_length: 2,
          files: { "00": "data/dart_corp_codes_00.json" },
        });
      }
      return JSON.stringify({
        format: "stock-to-corp-shard-v1",
        codes: [{ stock_code: "005930", corp_code: "00126380", corp_name: "삼성전자" }],
      });
    },
  });

  assert.equal(await registry.ensure("005930"), true);
  assert.equal(registry.get("005930").corp_code, "00126380");
  assert.deepEqual(registry.loadedShards(), ["00"]);
  assert.deepEqual(requests, [["corp-manifest", "global"], ["corp-shard", "00"]]);
});

test("sharded DART registry accepts the legacy flat map seed", async () => {
  const registry = loaderModule.createShardedCorpCodeRegistry({
    runRequest: async (_kind, _identity, factory) => factory(),
    fetchText: async () => JSON.stringify({
      codes: { "218410": "01099940" },
    }),
  });

  assert.equal(await registry.ensure("218410"), true);
  assert.equal(registry.get("218410").corp_code, "01099940");
});
