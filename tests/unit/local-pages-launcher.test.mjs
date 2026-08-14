import assert from "node:assert/strict";
import test from "node:test";

import {
  openLocalPages,
  waitForLocalPages,
} from "../../scripts/open_local_pages_when_ready.mjs";

test("waits for local health before opening the browser", async () => {
  let requests = 0;
  const ready = await waitForLocalPages({
    url: "http://127.0.0.1:8787/",
    fetchImpl: async (url) => {
      requests += 1;
      assert.equal(url, "http://127.0.0.1:8787/api/health");
      return new Response("", { status: requests < 3 ? 503 : 200 });
    },
    sleepImpl: async () => {},
    pollMs: 25,
  });

  assert.equal(ready, true);
  assert.equal(requests, 3);
});

test("opens a cache-busted local URL in a detached browser process", () => {
  let launch = null;
  const openedUrl = openLocalPages("http://127.0.0.1:8787/", {
    spawnImpl: (command, args, options) => {
      launch = { command, args, options };
      return { unref() {} };
    },
  });

  assert.match(openedUrl, /^http:\/\/127\.0\.0\.1:8787\/\?local_start=\d+$/);
  assert.equal(launch.options.detached, true);
  assert.equal(launch.options.windowsHide, true);
  assert.ok(launch.args.includes(openedUrl));
});
