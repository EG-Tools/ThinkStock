import { expect, test } from "@playwright/test";


test("service worker registers and precaches the offline shell", async ({ context, page }) => {
  await context.route("https://**/*", (route) => route.abort("internetdisconnected"));
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator("#appVersionText")).toHaveText("0.85");
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
    "/vendor/plotly-basic-2.35.2.min.js",
  ]));

  const refreshResult = await page.evaluate(() => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data);
    navigator.serviceWorker.controller.postMessage("REFRESH_DATA", [channel.port2]);
  }));
  expect(refreshResult).toMatchObject({ ok: true, failed: 0 });
  expect(refreshResult.refreshed).toBeGreaterThan(0);

});
