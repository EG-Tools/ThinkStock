import {
  expect,
  test,
  stubExternalRefreshes,
  waitForAppReady,
  waitForChartRenderIdle,
} from "./helpers/thinkstock-fixture.mjs";

async function openAiForecast(page) {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await waitForAppReady(page);
  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "ai-scenario").length
  )), { timeout: 30000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "false", {
    timeout: 30000,
  });
  await waitForChartRenderIdle(page);
}

test("AI hover selects the nearest forecast scenario", async ({ page }) => {
  await openAiForecast(page);
  const targets = await page.locator("#chart").evaluate((element) => {
    const traces = (element.data || []).filter((trace) => (
      trace?.meta?.overlayKind === "ai-scenario"
    ));
    const xAxis = element?._fullLayout?.xaxis;
    const yAxis = element?._fullLayout?.yaxis;
    const rect = element.getBoundingClientRect();
    if (traces.length < 3 || !xAxis || !yAxis) return [];

    let bestIndex = Math.max(1, Math.floor((traces[0].x?.length || 1) * 0.6));
    let bestSeparation = -1;
    for (let index = 1; index < (traces[0].x?.length || 1) - 1; index += 1) {
      const x = Number(xAxis.d2p?.(traces[0].x?.[index]));
      if (!Number.isFinite(x)
        || x > Number(xAxis._length || 0) - 180) continue;
      const pixels = traces.map((trace) => Number(yAxis.d2p?.(trace.y?.[index])));
      if (!pixels.every(Number.isFinite)) continue;
      const separation = Math.min(
        Math.abs(pixels[0] - pixels[1]),
        Math.abs(pixels[0] - pixels[2]),
        Math.abs(pixels[1] - pixels[2]),
      );
      if (separation > bestSeparation) {
        bestSeparation = separation;
        bestIndex = index;
      }
    }

    return traces.map((trace) => ({
      role: String(trace.meta.aiTraceRole || ""),
      label: String(trace.name || "").split(" AI ").at(-1),
      x: rect.left + Number(xAxis._offset || 0) + Number(xAxis.d2p?.(trace.x[bestIndex])),
      y: rect.top + Number(yAxis._offset || 0) + Number(yAxis.d2p?.(trace.y[bestIndex])),
    }));
  });
  expect(targets).toHaveLength(3);

  const popupContents = [];
  for (const target of targets) {
    await page.mouse.move(1, 1);
    await page.mouse.move(target.x, target.y);
    await expect.poll(() => page.locator("#chart .hoverlayer").evaluate((element) => (
      String(element.textContent || "").replace(/\s+/g, " ").trim()
    )), {
      message: `AI ${target.role} hover did not select its own scenario`,
    }).toContain(target.label);
    popupContents.push(await page.locator("#chart .hoverlayer").evaluate((element) => (
      String(element.textContent || "").replace(/\s+/g, " ").trim()
    )));
  }
  expect(new Set(popupContents).size).toBe(3);
});

test("AI toggle restores an unchanged wheel-zoomed viewport", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const initial = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const xAxis = element._fullLayout.xaxis;
    const yAxis = element._fullLayout.yaxis;
    const range = xAxis.range.map(Date.parse);
    return {
      x: rect.left + xAxis._offset + (xAxis._length * 0.25),
      y: rect.top + yAxis._offset + (yAxis._length * 0.5),
      span: range[1] - range[0],
    };
  });
  await page.locator("#chart").dispatchEvent("wheel", {
    deltaY: -120,
    clientX: initial.x,
    clientY: initial.y,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeLessThan(initial.span * 0.9);
  await page.waitForTimeout(220);
  const zoomedRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "ai-scenario").length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "false", {
    timeout: 30000,
  });
  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "ai-scenario").length
  ))).toBe(0);
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const actual = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  }, zoomedRange)).toBeLessThanOrEqual(1000);
});
