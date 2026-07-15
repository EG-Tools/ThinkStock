import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const payloadSource = await readFile(path.resolve("docs/modules/data-payload.js"), "utf8");
const workerSource = await readFile(path.resolve("docs/modules/data-worker.js"), "utf8");


test("data worker imports and uses the shared payload parser", () => {
  let messageHandler = null;
  const messages = [];
  const context = vm.createContext({
    self: {
      addEventListener(type, handler) {
        if (type === "message") messageHandler = handler;
      },
      postMessage(message) {
        messages.push(message);
      },
    },
  });
  context.importScripts = (url) => {
    assert.match(url, /^\.\/data-payload\.js\?v=/);
    vm.runInContext(payloadSource, context);
  };

  vm.runInContext(workerSource, context);
  messageHandler({
    data: {
      id: "parse-1",
      type: "parseSeedBundle",
      texts: {
        priceText: '{"dates":["2026-07-13"],"series":["AAA"],"columns":{"AAA":[100]}}',
        macroText: '{"dates":["2026-07-13"],"series":["news_sentiment"],"columns":{"news_sentiment":[110.34]}}',
        creditText: '{"dates":[],"columns":{}}',
        adrText: '{"dates":[],"columns":{}}',
        disclosureText: '{"records":[]}',
      },
    },
  });

  assert.equal(messages[0].ok, true);
  assert.equal(messages[0].result.pricePayload.records[0].AAA, 100);
  assert.equal(messages[0].result.macroRows[0].news_sentiment, 110.34);
});
