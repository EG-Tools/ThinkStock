import assert from "node:assert/strict";
import test from "node:test";
import dataPayload from "../../docs/modules/data-payload.mjs";
import {
  attachDataWorker,
  createSeedBundleParser,
} from "../../docs/modules/data-worker-runtime.mjs";


test("data worker module uses the shared payload parser", () => {
  let messageHandler = null;
  const messages = [];
  const scope = {
    addEventListener(type, handler) {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener(type, handler) {
      if (type === "message" && handler === messageHandler) messageHandler = null;
    },
    postMessage(message) {
      messages.push(message);
    },
  };
  const worker = attachDataWorker(scope, dataPayload);
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

  worker.dispose();
  assert.equal(messageHandler, null);
});


test("seed parser rejects incomplete parser dependencies", () => {
  assert.throws(() => createSeedBundleParser({}), /payload module is unavailable/);
});
