import { expect, test } from "@playwright/test";


test("service worker registers and precaches the offline shell", async ({ context, page }) => {
  await context.route("https://**/*", (route) => route.abort("internetdisconnected"));
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator("#appVersionText")).toHaveText(/^\d+\.\d+$/);
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const cachedPaths = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((key) => key.startsWith("thinkstock-")) || "");
    const requests = await cache.keys();
    return requests.map((request) => new URL(request.url).pathname).sort();
  });
  expect(cachedPaths).toEqual(expect.arrayContaining([
    "/data/prices_recent.json",
    "/data/macro_data_recent.json",
    "/data/credit_data_recent.json",
    "/data/adr_data_recent.json",
    "/assets/app.bundle.min.js",
    "/modules/cache-refresh-policy.js",
    "/modules/data-worker.js",
    "/modules/chart-model-worker.js",
    "/vendor/plotly-thinkstock-2.35.2.min.js",
  ]));

  const refreshResult = await page.evaluate(() => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data);
    navigator.serviceWorker.controller.postMessage("REFRESH_DATA", [channel.port2]);
  }));
  expect(refreshResult).toMatchObject({ ok: true, failed: 0 });
  expect(refreshResult.refreshed).toBeGreaterThan(0);
  expect(refreshResult.reused).toBeGreaterThan(0);
  expect(refreshResult.revision).toMatch(/^[a-f0-9]{24}$/);

  const revisionCaches = await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.filter((key) => key.includes("-data-"));
  });
  expect(revisionCaches).toContainEqual(expect.stringContaining(refreshResult.revision));
  expect(revisionCaches.some((key) => key.endsWith("-staging"))).toBe(false);

  const revisionManifest = await page.evaluate(async (revision) => {
    const cache = await caches.open(`thinkstock-data-v1-${revision}`);
    const requests = await cache.keys();
    const manifestRequest = requests.find((request) => (
      new URL(request.url).pathname.endsWith("/data/data_manifest.json")
    ));
    return manifestRequest ? (await cache.match(manifestRequest))?.json() : null;
  }, refreshResult.revision);
  expect(revisionManifest).toMatchObject({
    format: "segmented-data-v1",
    revision: refreshResult.revision,
  });

  const previousRevision = "b".repeat(24);
  await page.evaluate(async ({ currentRevision, previousRevision }) => {
    const currentName = `thinkstock-data-v1-${currentRevision}`;
    const previousName = `thinkstock-data-v1-${previousRevision}`;
    const currentCache = await caches.open(currentName);
    const previousCache = await caches.open(previousName);
    for (const request of await currentCache.keys()) {
      const response = await currentCache.match(request);
      if (!response) continue;
      if (new URL(request.url).pathname.endsWith("/data/data_manifest.json")) {
        const manifest = await response.clone().json();
        manifest.revision = previousRevision;
        manifest.generated_at = "2026-07-14T00:00:00Z";
        await previousCache.put(request, new Response(JSON.stringify(manifest), {
          headers: { "Content-Type": "application/json" },
        }));
      } else {
        await previousCache.put(request, response);
      }
    }
    await caches.delete(currentName);
  }, { currentRevision: refreshResult.revision, previousRevision });

  const migratedResult = await page.evaluate(() => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data);
    navigator.serviceWorker.controller.postMessage("REFRESH_DATA", [channel.port2]);
  }));
  expect(migratedResult).toMatchObject({
    ok: true,
    failed: 0,
    revision: refreshResult.revision,
  });
  expect(migratedResult.reused).toBeGreaterThan(0);
  const migratedCacheNames = await page.evaluate(() => caches.keys());
  expect(migratedCacheNames).toContain(`thinkstock-data-v1-${refreshResult.revision}`);
  expect(migratedCacheNames).not.toContain(`thinkstock-data-v1-${previousRevision}`);
});
