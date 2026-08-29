import { expect, test } from "@playwright/test";


test("service worker registers and precaches the offline shell", async ({ context, page }) => {
  test.setTimeout(90_000);
  await context.route("https://**/*", (route) => route.abort("internetdisconnected"));
  await page.goto("/?e2e=1&sw=1", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator("#appVersionText")).toHaveText(/^\d+\.\d+$/);
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  // Auxiliary traces are viewport-virtualized, so request the cached long range
  // before checking that the offline data shell contains historical coverage.
  await page.evaluate(() => window.ThinkStockE2E.setActiveMonthsForTest(360));
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const counts = Object.fromEntries((element.data || [])
      .filter((trace) => ["fear_greed", "vix"].includes(trace?.meta?.auxiliarySeriesKey))
      .map((trace) => [trace.meta.auxiliarySeriesKey, trace.x?.length || 0]));
    return Math.min(counts.fear_greed || 0, counts.vix || 0);
  })).toBeGreaterThan(250);
  const bundledIndicatorHistory = await page.locator("#chart-adr").evaluate((element) => Object.fromEntries(
    (element.data || [])
      .filter((trace) => ["fear_greed", "vix"].includes(trace?.meta?.auxiliarySeriesKey))
      .map((trace) => [trace.meta.auxiliarySeriesKey, trace.x?.length || 0]),
  ));
  expect(bundledIndicatorHistory.fear_greed).toBeGreaterThan(250);
  expect(bundledIndicatorHistory.vix).toBeGreaterThan(250);

  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = (element.data || []).find((item) => (
      item?.meta?.auxiliarySeriesKey === "news_sentiment"
    ));
    return Number(String(trace?.x?.find(Boolean) || "").slice(0, 10).replaceAll("-", ""));
  })).toBeLessThan(20060101);

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
    "/data/vkospi_data.json",
    "/assets/app.bundle.min.js",
    "/modules/cache-refresh-policy.js",
    "/modules/data-worker.mjs",
    "/modules/chart-model-worker.mjs",
    "/modules/chart-model-worker-runtime.mjs",
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

  const obsoleteShell = "thinkstock-obsolete-shell";
  const obsoleteStaging = `thinkstock-data-v1-${"c".repeat(24)}-staging`;
  await page.evaluate(async ({ obsoleteShell, obsoleteStaging }) => {
    const shell = await caches.open(obsoleteShell);
    await shell.put("./data/macro_data_history.json", new Response(JSON.stringify({
      dates: ["2015-01-01"],
      columns: { news_sentiment: [100] },
    }), { headers: { "Content-Type": "application/json" } }));
    await caches.open(obsoleteStaging);
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }, { obsoleteShell, obsoleteStaging });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await page.evaluate(() => window.ThinkStockE2E.setActiveMonthsForTest(360));
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = (element.data || []).find((item) => (
      item?.meta?.auxiliarySeriesKey === "news_sentiment"
    ));
    return Number(String(trace?.x?.find(Boolean) || "").slice(0, 10).replaceAll("-", ""));
  })).toBeLessThan(20060101);

  const upgradedCacheNames = await page.evaluate(() => caches.keys());
  expect(upgradedCacheNames).not.toContain(obsoleteShell);
  expect(upgradedCacheNames).not.toContain(obsoleteStaging);
  expect(upgradedCacheNames).toContain(`thinkstock-data-v1-${refreshResult.revision}`);
});
