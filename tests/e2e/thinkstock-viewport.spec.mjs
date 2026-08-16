import {
  expect,
  test,
  recentDates,
  historyDates,
  DESKTOP_PERF_BUDGET,
  setChartRangeMonths,
  waitForBoundingBox,
  waitForChartRenderIdle,
  visibleTracePixelSpan,
  columnar,
  stubExternalRefreshes,
  installDataRoutes,
} from "./helpers/thinkstock-fixture.mjs";

test("main chart allows more than five visible stocks and indices", async ({ page }) => {
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const visibleMainSeriesCount = () => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.seriesKey
      && !trace?.meta?.isAiForecastTrace
      && trace.visible !== "legendonly"
    )).length
  ));

  await page.locator('[data-series="^KQ11"]').click();
  await page.locator('[data-series="customer_deposit"]').click();
  await page.locator('[data-series="kospi_credit"]').click();
  await expect.poll(visibleMainSeriesCount).toBe(5);

  await page.locator('[data-series="kosdaq_credit"]').click();
  await expect(page.locator('[data-series="kosdaq_credit"]')).toHaveClass(/is-on/);
  await expect.poll(visibleMainSeriesCount).toBe(6);

  await page.locator("#stockSearchInput").fill("삼성전자");
  await page.locator(".stock-suggest-item").filter({ hasText: "삼성전자" }).click();
  const samsungToggle = page.locator('[data-series="005930.KS"]');
  await expect(samsungToggle).toBeVisible();
  await expect(samsungToggle).toHaveClass(/is-on/);
  await expect.poll(visibleMainSeriesCount).toBe(7);

  const storedStocks = await page.evaluate(() => (
    JSON.parse(localStorage.getItem("thinkstock-v5") || "{}").customStocks || []
  ));
  expect(storedStocks.map((item) => item.ticker)).toContain("005930.KS");
  const firstStockColor = storedStocks.find((item) => item.ticker === "005930.KS")?.color;
  expect(firstStockColor).toMatch(/^#[0-9a-f]{6}$/);
  expect([
    "#999999", "#f59e0b", "#4ade80", "#60a5fa", "#f87171", "#a78bfa",
  ]).not.toContain(firstStockColor);

  await page.locator('[data-series="^KQ11"]').click();
  await expect.poll(visibleMainSeriesCount).toBe(6);
  await samsungToggle.click();
  await expect(samsungToggle).toHaveClass(/is-off/);
  await expect.poll(visibleMainSeriesCount).toBe(5);

  await page.locator('.stock-remove-btn[data-remove-series="005930.KS"]').click();
  await expect(samsungToggle).toHaveCount(0);
  await page.route("https://query2.finance.yahoo.com/**", async (route) => {
    await route.fulfill({ json: {
      chart: { result: [{
        meta: { gmtoffset: 0 },
        timestamp: [Date.parse(`${recentDates.at(-1)}T00:00:00Z`) / 1000],
        indicators: { quote: [{ close: [78000], volume: [123456] }] },
      }] },
    } });
  });
  await page.locator("#stockSearchInput").fill("005930");
  await page.locator(".stock-suggest-item").first().click();
  await expect(samsungToggle).toBeVisible();
  const readdedStockColor = await page.evaluate(() => (
    (JSON.parse(localStorage.getItem("thinkstock-v5") || "{}").customStocks || [])
      .find((item) => item.ticker === "005930.KS")?.color
  ));
  expect(readdedStockColor).toMatch(/^#[0-9a-f]{6}$/);
  expect(readdedStockColor).not.toBe(firstStockColor);
});

test("mobile stock remove control keeps a forgiving touch target", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit", "touch target coverage is mobile-only");
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      customStocks: [
        { ticker: "005930.KS", code: "005930", name: "Samsung", market: "KOSPI" },
      ],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  const removeButton = page.locator('.stock-remove-btn[data-remove-series="005930.KS"]');
  await expect(removeButton).toBeVisible();
  const box = await removeButton.boundingBox();
  expect(box).not.toBeNull();

  // Tap left of the visible circle, inside the expanded hit target and over the stock toggle.
  await page.touchscreen.tap(box.x - 7, box.y + (box.height / 2));
  await expect(removeButton).toHaveCount(0);
  await expect(page.locator('[data-series="005930.KS"]')).toHaveCount(0);
});

test("re-enabling a recently hidden series reuses the chart model", async ({ page }) => {
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  const kosdaqToggle = page.locator('[data-series="^KQ11"]');

  await kosdaqToggle.click();
  await expect(kosdaqToggle).toHaveClass(/is-on/);
  await waitForChartRenderIdle(page);
  await kosdaqToggle.click();
  await expect(kosdaqToggle).toHaveClass(/is-off/);
  await waitForChartRenderIdle(page);
  const beforeRestore = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());

  await kosdaqToggle.click();
  await expect(kosdaqToggle).toHaveClass(/is-on/);
  await waitForChartRenderIdle(page);
  const afterRestore = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());

  expect(afterRestore.dispatchByType.buildMainChartModel || 0)
    .toBe(beforeRestore.dispatchByType.buildMainChartModel || 0);
  expect(afterRestore.modelCache.hits).toBeGreaterThan(beforeRestore.modelCache.hits);
});

test("adding a fresher stock advances a stale credit viewport that was at its latest edge", async ({ page }) => {
  await installDataRoutes(page, { staleCreditTail: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator('[data-series="customer_deposit"]').click();
  await page.locator('[data-series="kospi_credit"]').click();
  await waitForChartRenderIdle(page);
  await page.locator('[data-series="leading_cycle"]').click();
  await page.locator('[data-series="^KS11"]').click();
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    [...new Set((element.data || [])
      .filter((trace) => (
        trace?.meta?.seriesKey
        && trace.visible !== "legendonly"
        && String(trace.mode || "").includes("lines")
      ))
      .map((trace) => trace.meta.seriesKey))].sort()
  ))).toEqual(["customer_deposit", "kospi_credit"]);

  const staleViewport = await page.locator("#chart").evaluate(async (element) => {
    const visible = (element.data || []).filter((trace) => (
      trace?.meta?.seriesKey
      && trace.visible !== "legendonly"
      && String(trace.mode || "").includes("lines")
    ));
    const latest = Math.max(...visible.flatMap((trace) => (
      (trace.x || []).map(Date.parse).filter(Number.isFinite)
    )));
    const span = 60 * 24 * 60 * 60 * 1000;
    await globalThis.Plotly.relayout(element, {
      "xaxis.range[0]": new Date(latest - span).toISOString(),
      "xaxis.range[1]": new Date(latest).toISOString(),
    });
    return { latest, span };
  });
  const defaultFundOffsetMs = 2 * 24 * 60 * 60 * 1000;
  expect(staleViewport.latest).toBe(Date.parse(recentDates.at(-2)) - defaultFundOffsetMs);

  await page.locator("#stockSearchInput").fill("삼성전자");
  await page.locator(".stock-suggest-item").filter({ hasText: "삼성전자" }).click();
  await expect(page.locator('[data-series="005930.KS"]')).toHaveClass(/is-on/);
  await expect.poll(() => page.locator("#chart").evaluate((element, expectedSpan) => {
    const stock = (element.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    const range = (element._fullLayout?.xaxis?.range || []).map(Date.parse);
    const latest = Math.max(...(stock?.x || []).map(Date.parse).filter(Number.isFinite));
    return {
      endsAtStockLatest: Math.abs(range[1] - latest) <= 1000,
      preservesSpan: Math.abs((range[1] - range[0]) - expectedSpan) <= 1000,
    };
  }, staleViewport.span)).toEqual({ endsAtStockLatest: true, preservesSpan: true });
});

test("bundled recent data boots through the chart worker", async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#appVersionText")).toHaveText(/^\d+\.\d+$/);
  await expect(page.locator(".data-attribution")).toContainText("한국거래소 통계정보");
  expect(await page.evaluate(() => window.ThinkStockE2E.applyDartCorpCodesForTest({
    format: "stock-to-corp-v2",
    codes: {
      "005930": "00126380",
      "218410": "01035674",
    },
  }))).toBe(2);
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await expect(page.locator(".range-btn")).toHaveCount(0);
  await expect(page.locator("#chartZoomOut, #chartZoomIn")).toHaveCount(0);
  await expect(page.locator("#chartRange6Months")).toHaveText("6m");
  await expect(page.locator("#chartRange1Year")).toHaveText("1y");
  await expect(page.locator("#chartRange3Years")).toHaveText("3y");
  await expect(page.locator("#chartJumpLatest .chart-latest-symbol")).toBeVisible();
  await expect(page.locator("#chartCursorModeBtn")).toHaveAttribute(
    "data-chart-cursor-mode",
    "vertical",
  );
  expect(await page.evaluate(() => window.ThinkStockE2E.getActiveMonths()))
    .toBe(testInfo.project.name === "webkit" ? 6 : 12);
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#resetHandles")).toHaveClass(/is-active/);
  const rangeControlLayout = await page.locator(".chart-refresh-tools").evaluate((tools) => {
    const refresh = tools.querySelector("#refreshData")?.getBoundingClientRect();
    const buttons = [
      "chartCursorModeBtn",
      "chartRange6Months",
      "chartRange1Year",
      "chartRange3Years",
      "chartJumpLatest",
    ].map((id) => tools.querySelector(`#${id}`)?.getBoundingClientRect());
    const status = tools.parentElement?.querySelector("#runtimeRefreshStatus");
    const wasHidden = status?.hidden;
    if (status) status.hidden = false;
    const statusRect = status?.getBoundingClientRect();
    if (status) status.hidden = wasHidden;
    return refresh && buttons.every(Boolean) && statusRect ? {
      refreshBottom: refresh.bottom,
      refreshLeft: refresh.left,
      buttonTops: buttons.map((button) => button.top),
      buttonBottoms: buttons.map((button) => button.bottom),
      rightSpread: Math.max(refresh.right, ...buttons.map((button) => button.right))
        - Math.min(refresh.right, ...buttons.map((button) => button.right)),
      contentFits: [...tools.querySelectorAll(".chart-range-btn")]
        .every((button) => button.scrollWidth <= button.clientWidth),
      statusRight: statusRect.right,
    } : null;
  });
  expect(rangeControlLayout?.buttonTops?.[0]).toBeGreaterThanOrEqual(rangeControlLayout?.refreshBottom || 0);
  expect(rangeControlLayout?.buttonTops?.slice(1).every((top, index) => (
    top >= rangeControlLayout.buttonBottoms[index]
  ))).toBe(true);
  expect(rangeControlLayout?.rightSpread).toBeLessThanOrEqual(1);
  expect(rangeControlLayout?.contentFits).toBe(true);
  expect(rangeControlLayout?.statusRight).toBeLessThanOrEqual(rangeControlLayout?.refreshLeft || 0);

  const chartLineState = () => page.locator("#chart").evaluate((element) => ({
    x: Boolean(element._fullLayout?.xaxis?.showspikes),
    y: Boolean(element._fullLayout?.yaxis?.showspikes),
  }));
  await expect.poll(chartLineState).toEqual({ x: false, y: false });
  await page.locator("#chartCursorModeBtn").click();
  await expect(page.locator("#chartCursorModeBtn")).toHaveAttribute(
    "data-chart-cursor-mode",
    "horizontal",
  );
  await expect.poll(chartLineState).toEqual({ x: false, y: false });
  const mainCursorPoint = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const xAxis = element._fullLayout.xaxis;
    const yAxis = element._fullLayout.yaxis;
    return {
      x: rect.left + xAxis._offset + xAxis._length * 0.55,
      y: rect.top + yAxis._offset + yAxis._length * 0.45,
    };
  });
  await page.locator("#chart").dispatchEvent("pointermove", {
    pointerId: 71,
    pointerType: "mouse",
    isPrimary: true,
    clientX: mainCursorPoint.x,
    clientY: mainCursorPoint.y,
  });
  await expect(page.locator("#chart .synced-cursor-line")).toHaveCSS("opacity", "0");
  await expect(page.locator("#chart .synced-cursor-horizontal-line")).toHaveCSS("opacity", "1");
  await expect(page.locator("#chart .synced-cursor-horizontal-line")).toHaveCSS("height", "1px");
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    Object.keys(element._fullLayout || {})
      .filter((key) => /^yaxis\d*$/.test(key))
      .every((key) => element._fullLayout[key]?.showspikes === false)
  ))).toBe(true);
  await page.locator("#chartCursorModeBtn").click();
  await expect(page.locator("#chartCursorModeBtn")).toHaveAttribute(
    "data-chart-cursor-mode",
    "cross",
  );
  await expect.poll(chartLineState).toEqual({ x: false, y: false });
  await page.locator("#chart").dispatchEvent("pointermove", {
    pointerId: 72,
    pointerType: "mouse",
    isPrimary: true,
    clientX: mainCursorPoint.x,
    clientY: mainCursorPoint.y,
  });
  await expect(page.locator("#chart .synced-cursor-line")).toHaveCSS("opacity", "1");
  await expect(page.locator("#chart .synced-cursor-horizontal-line")).toHaveCSS("opacity", "1");
  await page.locator("#apiOptionsBtn").click();
  await expect(page.locator(".chart-right-padding-setting .cursor-line-setting-label"))
    .toHaveText("차트 우측 여백");
  await expect(page.locator(".chart-cursor-mode-setting .cursor-line-setting-label"))
    .toHaveText("차트선 방식");
  expect(await page.locator("#apiSettingsModal").evaluate((modal) => (
    Boolean(modal.querySelector(".chart-cursor-mode-setting")?.compareDocumentPosition(
      modal.querySelector(".api-local-server-field"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING)
  ))).toBe(true);
  await expect(page.locator("#chartRightPaddingValue")).toHaveText("0");
  await expect(page.locator("#chartRightPaddingDecrease")).toBeDisabled();
  await page.locator("#chartRightPaddingIncrease").evaluate((button) => {
    for (let index = 0; index < 35; index += 1) button.click();
  });
  await expect(page.locator("#chartRightPaddingValue")).toHaveText("30");
  await expect(page.locator("#chartRightPaddingIncrease")).toBeDisabled();
  await page.locator('.cursor-line-mode-btn[data-chart-cursor-mode="vertical"]').click();
  await expect(page.locator("#chartCursorModeBtn")).toHaveAttribute(
    "data-chart-cursor-mode",
    "vertical",
  );
  await expect.poll(chartLineState).toEqual({ x: false, y: false });
  await expect(page.locator("#newsSentimentMovingAverageValue")).toHaveText("1");
  await page.locator("#newsSentimentMovingAverageIncrease").click();
  await page.locator("#newsSentimentMovingAverageIncrease").click();
  await expect(page.locator("#newsSentimentMovingAverageValue")).toHaveText("3");
  await page.locator("#newsSentimentMovingAverageDecrease").click();
  await page.locator("#newsSentimentMovingAverageDecrease").click();
  await expect(page.locator("#newsSentimentMovingAverageValue")).toHaveText("1");
  await expect(page.locator("#newsSentimentMovingAverageDecrease")).toBeDisabled();
  await expect(page.locator("#stockResearchUniverseValue")).toHaveText("400");
  await page.locator("#stockResearchUniverseIncrease").click();
  await page.locator("#stockResearchUniverseIncrease").click();
  await expect(page.locator("#stockResearchUniverseValue")).toHaveText("600");
  await expect(page.locator("#stockResearchDisclaimer")).toContainText("300+300");
  await page.locator("#apiSettingsCloseBtn").click();
  await page.evaluate(() => window.ThinkStockE2E.applyNewsSentimentForTest([
    { date: "2026-07-14", news_sentiment: 101 },
  ]));
  const oneDayNewsAverage = page.locator('[data-news-sentiment-average-days="1"]');
  await expect(oneDayNewsAverage).toHaveAttribute("aria-pressed", "true");
  const oneDayNewsTouchTarget = await oneDayNewsAverage.evaluate((button) => {
    const hitArea = button.getBoundingClientRect();
    const circle = button.querySelector("span")?.getBoundingClientRect();
    return {
      hitWidth: hitArea.width,
      circleWidth: circle?.width || 0,
    };
  });
  expect(oneDayNewsTouchTarget.hitWidth).toBeGreaterThanOrEqual(28);
  expect(oneDayNewsTouchTarget.circleWidth).toBeGreaterThan(0);
  expect(oneDayNewsTouchTarget.circleWidth).toBeLessThan(oneDayNewsTouchTarget.hitWidth);
  await page.locator('[data-news-sentiment-average-days="5"]').click();
  await expect(page.locator('[data-news-sentiment-average-days="5"]'))
    .toHaveAttribute("aria-pressed", "true");
  await page.locator("#apiOptionsBtn").click();
  await expect(page.locator("#chartRightPaddingValue")).toHaveText("30");
  await expect(page.locator("#newsSentimentMovingAverageValue")).toHaveText("5");
  await expect(page.locator("#stockResearchUniverseValue")).toHaveText("600");
  await page.locator("#stockResearchUniverseDecrease").click();
  await page.locator("#stockResearchUniverseDecrease").click();
  await expect(page.locator("#stockResearchUniverseValue")).toHaveText("400");
  await expect(page.locator("#stockResearchDisclaimer")).toContainText("200+200");
  await page.locator("#apiSettingsCloseBtn").click();
  const toolsToggle = page.locator("#chartToolsToggle");
  await expect(toolsToggle).toHaveAttribute("aria-pressed", "true");
  await toolsToggle.click();
  await expect(toolsToggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#resetHandles")).toBeHidden();
  await expect(page.locator("#refreshData")).toBeHidden();
  await expect(toolsToggle).toBeVisible();
  await toolsToggle.click();
  await expect(toolsToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#resetHandles")).toBeVisible();

  const [chartBox, resetBox, refreshBox] = await Promise.all([
    page.locator("#chart").boundingBox(),
    page.locator("#resetHandles").boundingBox(),
    page.locator("#refreshData").boundingBox(),
  ]);
  expect(chartBox).not.toBeNull();
  expect(resetBox).not.toBeNull();
  expect(refreshBox).not.toBeNull();
  expect(resetBox.x).toBeGreaterThanOrEqual(chartBox.x);
  expect(resetBox.y).toBeGreaterThanOrEqual(chartBox.y);
  expect(resetBox.x + resetBox.width).toBeLessThan(chartBox.x + chartBox.width);
  expect(resetBox.y + resetBox.height).toBeLessThan(chartBox.y + chartBox.height);
  expect(Math.abs(refreshBox.y - resetBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(refreshBox.height - resetBox.height)).toBeLessThanOrEqual(2);
  const expectedRefreshInset = await page.locator(".main-chart-wrap").evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).getPropertyValue("--chart-control-right"))
  ));
  expect(Math.abs(
    (chartBox.x + chartBox.width) - (refreshBox.x + refreshBox.width) - expectedRefreshInset,
  )).toBeLessThanOrEqual(1);
  const chartControlLayout = await page.locator(".main-chart-wrap").evaluate((container) => {
    const chartRect = container.querySelector("#chart").getBoundingClientRect();
    return ["resetHandles", "coMovementToggle", "insiderTradeToggle", "disclosureToggle", "recessionToggle", "aiForecastToggle"].map((id) => {
      const button = document.getElementById(id);
      const rect = button.getBoundingClientRect();
      return {
        id,
        insideChart: rect.left >= chartRect.left && rect.right <= chartRect.right,
        contentFits: button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight,
        whiteSpace: getComputedStyle(button).whiteSpace,
      };
    });
  });
  expect(chartControlLayout.every((item) => item.insideChart)).toBe(true);
  expect(chartControlLayout.every((item) => item.contentFits)).toBe(true);
  expect(chartControlLayout.every((item) => item.whiteSpace === "nowrap")).toBe(true);
  await page.locator("#stockSearchInput").fill("SK하이닉스");
  await expect(page.locator(".stock-suggest-item")).toContainText("SK하이닉스");
  await page.locator("#stockSearchInput").press("Escape");
  expect(await page.evaluate(() => window.ThinkStockE2E?.getChartModelSource?.())).toBe("worker");
  expect(await page.evaluate(() => window.ThinkStockE2E?.getAuxiliaryChartModelSource?.())).toBe("worker");
  const chartTimeline = await page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "^KS11");
    return {
      firstData: Date.parse(trace?.x?.[0]),
      lastData: Date.parse(trace?.x?.at(-1)),
      view: element._fullLayout.xaxis.range.map(Date.parse),
    };
  });
  expect(chartTimeline.firstData).toBeLessThan(chartTimeline.view[0]);
  expect(chartTimeline.view[1] - chartTimeline.lastData).toBe(30 * 24 * 60 * 60 * 1000);
  expect(pageErrors).toEqual([]);
});

test("range presets end at the latest date and the latest control slides there", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#chartRange3Years").click();
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(36);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const dataEnd = Math.max(...(element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite));
    const days = (range[1] - range[0]) / 86400000;
    return Math.abs(range[1] - dataEnd) <= 1000 && days > 1000 && days < 1120;
  })).toBe(true);
  const threeYearRange = await page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return { days: (range[1] - range[0]) / 86400000 };
  });
  expect(threeYearRange.days).toBeGreaterThan(1000);
  expect(threeYearRange.days).toBeLessThan(1120);

  await page.locator("#chartRange6Months").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const dataEnd = Math.max(...(element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite));
    const days = (range[1] - range[0]) / 86400000;
    return Math.abs(range[1] - dataEnd) <= 1000 && days > 170 && days < 190;
  })).toBe(true);
  const sixMonthDays = await page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return (range[1] - range[0]) / 86400000;
  });
  expect(sixMonthDays).toBeGreaterThan(170);
  expect(sixMonthDays).toBeLessThan(190);
  const prepared = await page.locator("#chart").evaluate(async (element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const dates = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    const dataStart = Math.min(...dates);
    const dataEnd = Math.max(...dates);
    const span = range[1] - range[0];
    const shift = Math.min(span * 2, Math.max(0, range[0] - dataStart));
    const oldRange = [range[0] - shift, range[1] - shift];
    await globalThis.Plotly.relayout(element, {
      "xaxis.range[0]": new Date(oldRange[0]).toISOString(),
      "xaxis.range[1]": new Date(oldRange[1]).toISOString(),
      "yaxis.range[0]": -10000,
      "yaxis.range[1]": 10000,
      "yaxis.autorange": false,
    });
    return { oldRange, dataEnd, span };
  });
  expect(prepared.oldRange[1]).toBeLessThan(prepared.dataEnd);

  await page.locator("#chartJumpLatest").click();
  await expect(page.locator("#chart")).toHaveClass(/is-viewport-panning/);
  await page.waitForTimeout(180);
  const middleEnd = await page.locator("#chart").evaluate((element) => (
    Date.parse(element._fullLayout.xaxis.range[1])
  ));
  expect(middleEnd).toBeGreaterThan(prepared.oldRange[1]);
  expect(middleEnd).toBeLessThan(prepared.dataEnd);

  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return {
      endGap: Math.abs(range[1] - expected.dataEnd),
      spanGap: Math.abs((range[1] - range[0]) - expected.span),
      panning: element.classList.contains("is-viewport-panning"),
    };
  }, prepared)).toEqual({ endGap: 0, spanGap: 0, panning: false });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    const values = (element.data || []).flatMap((trace) => {
      if (!trace?.meta?.seriesKey || trace.visible === "legendonly") return [];
      return (trace.x || []).flatMap((date, index) => {
        const timestamp = Date.parse(date);
        const value = Number(trace.y?.[index]);
        return timestamp >= start && timestamp <= end && Number.isFinite(value) ? [value] : [];
      });
    });
    const dataSpan = values.length ? Math.max(...values) - Math.min(...values) : 0;
    const axisSpan = Math.abs(element._fullLayout.yaxis.range[1] - element._fullLayout.yaxis.range[0]);
    return axisSpan > 0 ? dataSpan / axisSpan : 0;
  })).toBeGreaterThan(0.5);
});

test("chart dates stay synchronized while desktop drag and iPhone pinch zoom", async ({ page, isMobile }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();

  await expect(page.locator("#chartHandlesToggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => ({
    main: Number(document.getElementById("chart")?._fullLayout?.margin?.l),
    auxiliary: Number(document.getElementById("chart-adr")?._fullLayout?.margin?.l),
  }))).toEqual({ main: 36, auxiliary: 36 });
  await expect.poll(() => page.locator("#y-handles .y-handle").count()).toBeGreaterThan(0);
  await page.locator("#chartHandlesToggle").click();
  await expect(page.locator("#chartHandlesToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#y-handles")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    main: Number(document.getElementById("chart")?._fullLayout?.margin?.l),
    auxiliary: Number(document.getElementById("chart-adr")?._fullLayout?.margin?.l),
  }))).toEqual({ main: 36, auxiliary: 36 });
  const handleFreeCursorPoint = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    return {
      x: rect.left + axis._offset + axis._length * 0.63,
      y: rect.top + 4,
    };
  });
  await page.locator("#chart").dispatchEvent("pointermove", {
    pointerId: 80,
    pointerType: "mouse",
    isPrimary: true,
    clientX: handleFreeCursorPoint.x,
    clientY: handleFreeCursorPoint.y,
  });
  await expect.poll(() => page.evaluate(() => {
    const screenX = (id) => {
      const element = document.getElementById(id);
      const line = element?.querySelector(".synced-cursor-line");
      const pixel = Number(/translateX\(([-\d.]+)px\)/.exec(line?.style?.transform || "")?.[1]);
      return Number.isFinite(pixel) ? element.getBoundingClientRect().left + pixel : Number.NaN;
    };
    return Math.abs(screenX("chart") - screenX("chart-adr"));
  })).toBeLessThanOrEqual(1);
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const chartRect = element.getBoundingClientRect();
    const statusLabels = new Set(["80%", "120%", "공포", "탐욕", "부정", "긍정"]);
    const labels = [...element.querySelectorAll(".annotation-text")]
      .filter((node) => statusLabels.has(node.textContent?.trim()));
    const ticks = [...element.querySelectorAll(".yaxislayer-above text")];
    const isInside = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= chartRect.left - 6 && rect.right <= chartRect.right + 6;
    };
    return labels.length > 0
      && labels.every(isInside)
      && ticks.length > 0
      && ticks.every(isInside);
  })).toBe(true);
  await page.locator("#chartHandlesToggle").click();
  await expect(page.locator("#chartHandlesToggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#y-handles .y-handle").count()).toBeGreaterThan(0);

  const cursorPoint = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    return {
      x: rect.left + axis._offset + (axis._length * 0.63),
      y: rect.top + 4,
    };
  });
  await page.locator("#chart").dispatchEvent("pointermove", {
    pointerId: 81,
    pointerType: "mouse",
    isPrimary: true,
    clientX: cursorPoint.x,
    clientY: cursorPoint.y,
  });
  await expect.poll(() => page.evaluate(() => {
    const readDate = (id) => {
      const element = document.getElementById(id);
      const axis = element?._fullLayout?.xaxis;
      const line = element?.querySelector(".synced-cursor-line");
      const pixel = Number(/translateX\(([-\d.]+)px\)/.exec(line?.style?.transform || "")?.[1]);
      if (!axis || !Number.isFinite(pixel) || typeof axis.p2d !== "function") return null;
      return Date.parse(axis.p2d(pixel - axis._offset));
    };
    const main = readDate("chart");
    const auxiliary = readDate("chart-adr");
    return Number.isFinite(main) && Number.isFinite(auxiliary) ? Math.abs(main - auxiliary) : Infinity;
  })).toBeLessThanOrEqual(86400000);

  const initial = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    const yAxis = element._fullLayout.yaxis;
    const range = axis.range.map(Date.parse);
    return {
      range,
      span: range[1] - range[0],
      centerX: rect.left + axis._offset + axis._length / 2,
      y: rect.top + 4,
      tapY: rect.top + yAxis._offset + yAxis._length * 0.95,
      touchAction: getComputedStyle(element).touchAction,
    };
  });

  if (isMobile) {
    expect(initial.touchAction).toBe("pan-y");
    await page.locator("#hoverToggle").click();
    await expect.poll(() => page.locator("#chart").evaluate((element) => element._fullLayout?.hovermode))
      .toBe("x unified");
    await waitForChartRenderIdle(page);
    await page.locator("#chart").evaluate((element, point) => {
      const send = (type, pointerId) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "touch",
        isPrimary: true,
        buttons: type === "pointerdown" ? 1 : 0,
        clientX: point.centerX,
        clientY: point.tapY,
      }));
      send("pointerdown", 89);
      send("pointerup", 89);
    }, initial);
    await expect(page.locator("#chart .synced-cursor-line")).toHaveCSS("opacity", "1");
    await expect.poll(() => page.locator("#chart .hoverlayer > g").count()).toBeGreaterThan(0);
    await page.waitForTimeout(350);

    const beforeFullLifetime = await page.locator("#chart").evaluate((element) => (
      element._fullLayout.xaxis.range.map(Date.parse)
    ));
    const doubleTap = async (firstPointerId) => page.locator("#chart").evaluate((element, args) => {
      const sendTap = (pointerId) => {
        const init = {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: true,
          clientX: args.point.centerX,
          clientY: args.point.tapY,
        };
        element.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
        element.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
      };
      sendTap(args.firstPointerId);
      sendTap(args.firstPointerId + 1);
    }, { point: initial, firstPointerId });
    await doubleTap(101);
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      const dates = (element.data || [])
        .filter((trace) => trace?.meta?.seriesKey && !trace?.meta?.isAiForecastTrace)
        .flatMap((trace) => trace.x || [])
        .map(Date.parse)
        .filter(Number.isFinite);
      return Math.max(Math.abs(range[0] - Math.min(...dates)), Math.abs(range[1] - Math.max(...dates)));
    })).toBeLessThanOrEqual(1000);
    await page.waitForTimeout(350);
    await doubleTap(103);
    await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return Math.max(Math.abs(range[0] - expected[0]), Math.abs(range[1] - expected[1]));
    }, beforeFullLifetime)).toBeLessThanOrEqual(86400000);

    const auxiliaryPinch = await page.locator("#chart-adr").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const xAxis = element._fullLayout.xaxis;
      const yAxis = element._fullLayout.yaxis;
      return {
        centerX: rect.left + xAxis._offset + xAxis._length / 2,
        y: rect.top + yAxis._offset + yAxis._length / 2,
        touchAction: getComputedStyle(element).touchAction,
      };
    });
    expect(auxiliaryPinch.touchAction).toBe("pan-y");
    await page.locator("#chart-adr").evaluate((element, point) => {
      const send = (type, pointerId, x, primary, buttons) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "touch",
        isPrimary: primary,
        buttons,
        clientX: x,
        clientY: point.y,
      }));
      send("pointerdown", 91, point.centerX - 45, true, 1);
      send("pointerdown", 92, point.centerX + 45, false, 1);
      send("pointermove", 91, point.centerX - 90, true, 1);
      send("pointermove", 92, point.centerX + 90, false, 1);
      send("pointerup", 91, point.centerX - 90, true, 0);
      send("pointerup", 92, point.centerX + 90, false, 0);
    }, auxiliaryPinch);
    const zoomedSpan = await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    })).toBeLessThan(initial.span * 0.7);
    void zoomedSpan;
    await expect.poll(() => page.locator("#chart").evaluate((element, expectedEnd) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return Math.abs(range[1] - expectedEnd);
    }, initial.range[1])).toBeLessThanOrEqual(2 * 86400000);

    const beforeOut = await page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    });
    await page.locator("#chart").evaluate((element, point) => {
      const send = (type, pointerId, x, primary, buttons) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "touch",
        isPrimary: primary,
        buttons,
        clientX: x,
        clientY: point.y,
      }));
      send("pointerdown", 93, point.centerX - 90, true, 1);
      send("pointerdown", 94, point.centerX + 90, false, 1);
      send("pointermove", 93, point.centerX - 45, true, 1);
      send("pointermove", 94, point.centerX + 45, false, 1);
      send("pointerup", 93, point.centerX - 45, true, 0);
      send("pointerup", 94, point.centerX + 45, false, 0);
    }, initial);
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    })).toBeGreaterThan(beforeOut * 1.5);
    await expect.poll(() => page.locator("#chart").evaluate((element, expectedEnd) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return Math.abs(range[1] - expectedEnd);
    }, initial.range[1])).toBeLessThanOrEqual(2 * 86400000);
  } else {
    await page.locator("#chartRange6Months").click();
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    })).toBeLessThan(initial.span * 0.85);
    const zoomed = await page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return { range, span: range[1] - range[0], center: (range[0] + range[1]) / 2 };
    });
    expect(zoomed.span).toBeLessThan(initial.span * 0.85);
    const drag = await page.locator("#chart").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const axis = element._fullLayout.xaxis;
      const yAxis = element._fullLayout.yaxis;
      return {
        startX: rect.left + axis._offset + axis._length * 0.3,
        endX: rect.left + axis._offset + axis._length * 0.5,
        endLocalX: axis._offset + axis._length * 0.5,
        y: rect.top + yAxis._offset + yAxis._length * 0.95,
      };
    });
    await page.locator("#chart").evaluate(async (element) => {
      await globalThis.Plotly.relayout(element, {
        "yaxis.range[0]": -10000,
        "yaxis.range[1]": 10000,
        "yaxis.autorange": false,
      });
    });
    await page.mouse.move(drag.startX, drag.y);
    await page.mouse.down();
    await expect(page.locator("#chart")).toHaveClass(/is-viewport-panning/);
    await page.mouse.move(drag.endX, drag.y, { steps: 4 });
    await expect(page.locator("#chart .synced-cursor-line")).toHaveCSS("opacity", "0");
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
      const values = (element.data || []).flatMap((trace) => {
        if (!trace?.meta?.seriesKey || trace.visible === "legendonly") return [];
        return (trace.x || []).flatMap((date, index) => {
          const timestamp = Date.parse(date);
          const value = Number(trace.y?.[index]);
          return timestamp >= start && timestamp <= end && Number.isFinite(value) ? [value] : [];
        });
      });
      const yRange = element._fullLayout.yaxis.range.map(Number);
      const dataSpan = values.length ? Math.max(...values) - Math.min(...values) : 0;
      const axisSpan = Math.abs(yRange[1] - yRange[0]);
      return axisSpan > 0 ? dataSpan / axisSpan : 0;
    })).toBeGreaterThan(0.5);
    await expect(page.locator("#chart")).toHaveClass(/is-viewport-panning/);
    await page.mouse.up();
    await expect.poll(() => page.locator("#chart").evaluate((element, expectedPixel) => {
      const line = element.querySelector(".synced-cursor-line");
      const pixel = Number(/translateX\(([-\d.]+)px\)/.exec(line?.style?.transform || "")?.[1]);
      return line?.style?.opacity === "1" && Number.isFinite(pixel)
        ? Math.abs(pixel - expectedPixel)
        : Number.POSITIVE_INFINITY;
    }, drag.endLocalX)).toBeLessThanOrEqual(1);
    await expect(page.locator("#chart")).not.toHaveClass(/is-viewport-panning/);
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return (range[0] + range[1]) / 2;
    })).toBeLessThan(zoomed.center);
    const panned = await page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return { span: range[1] - range[0], center: (range[0] + range[1]) / 2 };
    });
    expect(panned.span).toBeCloseTo(zoomed.span, -3);
    expect(panned.center).toBeLessThan(zoomed.center);
    const beforePreset = await page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    });
    await page.locator("#chartRange1Year").click();
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    })).toBeGreaterThan(beforePreset * 1.7);
    const oneYearSpan = await page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    });
    await page.locator("#chartRange6Months").click();
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    })).toBeLessThan(oneYearSpan * 0.65);
    const beforeFullLifetime = await page.locator("#chart").evaluate((element) => (
      element._fullLayout.xaxis.range.map(Date.parse)
    ));
    await page.mouse.dblclick(drag.startX, drag.y);
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      const dates = (element.data || [])
        .filter((trace) => trace?.meta?.seriesKey && !trace?.meta?.isAiForecastTrace)
        .flatMap((trace) => trace.x || [])
        .map(Date.parse)
        .filter(Number.isFinite);
      return Math.max(
        Math.abs(range[0] - Math.min(...dates)),
        Math.abs(range[1] - Math.max(...dates)),
      );
    })).toBeLessThanOrEqual(1000);
    await page.mouse.dblclick(drag.startX, drag.y);
    await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return Math.max(Math.abs(range[0] - expected[0]), Math.abs(range[1] - expected[1]));
    }, beforeFullLifetime)).toBeLessThanOrEqual(86400000);

    const auxiliaryZoom = await page.locator("#chart-adr").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const axis = element._fullLayout.xaxis;
      const yAxis = element._fullLayout.yaxis;
      const range = axis.range.map(Date.parse);
      return {
        x: rect.left + axis._offset + axis._length * 0.35,
        y: rect.top + yAxis._offset + yAxis._length * 0.5,
        span: range[1] - range[0],
      };
    });
    await page.locator("#chart-adr").dispatchEvent("wheel", {
      deltaY: -120,
      clientX: auxiliaryZoom.x,
      clientY: auxiliaryZoom.y,
    });
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return range[1] - range[0];
    })).toBeLessThan(auxiliaryZoom.span * 0.9);
    await page.waitForTimeout(220);

    const beforeAuxiliaryPan = await page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return (range[0] + range[1]) / 2;
    });
    await page.locator("#chart-adr").dispatchEvent("pointerdown", {
      pointerId: 96,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: auxiliaryZoom.x,
      clientY: auxiliaryZoom.y,
    });
    await expect(page.locator("#chart-adr")).toHaveClass(/is-viewport-panning/);
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 96, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: x + 80, clientY: y,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 96, pointerType: "mouse", isPrimary: true, button: 0, clientX: x + 80, clientY: y,
      }));
    }, auxiliaryZoom);
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      return (range[0] + range[1]) / 2;
    })).toBeLessThan(beforeAuxiliaryPan);

    await page.locator("#chart-adr").dispatchEvent("dblclick", {
      button: 0,
      clientX: auxiliaryZoom.x,
      clientY: auxiliaryZoom.y,
    });
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      const dates = (element.data || [])
        .filter((trace) => trace?.meta?.seriesKey && !trace?.meta?.isAiForecastTrace)
        .flatMap((trace) => trace.x || [])
        .map(Date.parse)
        .filter(Number.isFinite);
      return Math.max(
        Math.abs(range[0] - Math.min(...dates)),
        Math.abs(range[1] - Math.max(...dates)),
      );
    })).toBeLessThanOrEqual(1000);
  }

  await expect.poll(() => page.evaluate(() => {
    const main = document.getElementById("chart")?._fullLayout?.xaxis?.range?.map(Date.parse);
    const auxiliary = document.getElementById("chart-adr")?._fullLayout?.xaxis?.range?.map(Date.parse);
    if (!main || !auxiliary) return Infinity;
    return Math.max(Math.abs(main[0] - auxiliary[0]), Math.abs(main[1] - auxiliary[1]));
  })).toBeLessThanOrEqual(86400000);
});

test("restored chart handles adjust position and scale and can be hidden", async ({ page, isMobile }) => {
  test.skip(isMobile, "Handle drag behavior is covered on desktop.");
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#y-handles .y-handle-right").count()).toBeGreaterThan(0);

  const scaleHandle = page.locator("#y-handles .y-handle-right").last();
  const scaleBox = await waitForBoundingBox(scaleHandle);
  await scaleHandle.hover();
  await page.mouse.down();
  await page.mouse.move(scaleBox.x + scaleBox.width / 2, scaleBox.y + scaleBox.height / 2 + 28);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().scales).length
  ))).toBeGreaterThan(0);

  const offsetHandle = page.locator("#y-handles .y-handle-left").last();
  const offsetBox = await waitForBoundingBox(offsetHandle);
  await offsetHandle.hover();
  await page.mouse.down();
  await page.mouse.move(offsetBox.x + offsetBox.width / 2, offsetBox.y + offsetBox.height / 2 + 28);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().offsets).length
  ))).toBeGreaterThan(0);

  await page.locator("#chartHandlesToggle").click();
  await expect(page.locator("#y-handles")).toHaveCount(0);
  await page.locator("#chartHandlesToggle").click();
  await expect.poll(() => page.locator("#y-handles .y-handle").count()).toBeGreaterThan(0);
});

test("desktop wheel anchors the latest edge and keeps pointer anchoring in history", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse wheel behavior is desktop-only.");
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      hiddenSeries: ["leading_cycle", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  expect(await page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(6);

  const initial = await page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return { span: range[1] - range[0], center: (range[0] + range[1]) / 2 };
  });
  const wheelPoint = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    return rect.left + axis._offset + axis._length * 0.25;
  });
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: 120, clientX: wheelPoint });
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: 120, clientX: wheelPoint });
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: 120, clientX: wheelPoint });
  expect(await page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(6);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeGreaterThan(initial.span * 1.15);
  const zoomedOut = await page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return { span: range[1] - range[0], center: (range[0] + range[1]) / 2 };
  });
  expect(zoomedOut.center).toBeLessThan(initial.center);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const dates = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && !trace?.meta?.isAiForecastTrace)
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    return Math.abs(range[1] - Math.max(...dates));
  })).toBeLessThanOrEqual(1000);

  const fullRange = await page.locator("#chart").evaluate((element) => {
    const timestamps = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && !trace?.meta?.isAiForecastTrace)
      .flatMap((trace) => trace.x || [])
      .map((value) => Date.parse(value))
      .filter(Number.isFinite);
    const start = Math.min(...timestamps);
    const end = Math.max(...timestamps);
    return [start, end];
  });
  await page.evaluate((range) => window.ThinkStockE2E.setViewportRangeForTest(range), fullRange);
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: 120, clientX: wheelPoint });
  await expect(page.locator("#chartNavigationMessage")).toHaveText("기간을 더 이상 늘릴 수 없습니다.");
  await expect(page.locator("#chartNavigationMessage")).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ))).toEqual(fullRange);
  await expect(page.locator("#chartNavigationMessage")).toBeHidden({ timeout: 6000 });

  await page.locator("#chart").dispatchEvent("wheel", { deltaY: -120, clientX: wheelPoint });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeLessThan((fullRange[1] - fullRange[0]) * 0.85);
  await expect.poll(() => page.locator("#chart").evaluate((element, latestEnd) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.abs(range[1] - latestEnd);
  }, fullRange[1])).toBeLessThanOrEqual(2 * 86400000);

  const historicalRange = await page.locator("#chart").evaluate((element, pointerRatio) => {
    const timestamps = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && !trace?.meta?.isAiForecastTrace)
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    const dataStart = Math.min(...timestamps);
    const dataEnd = Math.max(...timestamps);
    const span = (dataEnd - dataStart) * 0.35;
    const start = dataStart + ((dataEnd - dataStart) * 0.15);
    const end = start + span;
    return {
      range: [start, end],
      anchor: start + (span * pointerRatio),
    };
  }, 0.25);
  await page.evaluate((range) => window.ThinkStockE2E.setViewportRangeForTest(range), historicalRange.range);
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: -120, clientX: wheelPoint });
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const anchor = range[0] + ((range[1] - range[0]) * 0.25);
    return Math.abs(anchor - expected);
  }, historicalRange.anchor)).toBeLessThanOrEqual(2 * 86400000);
  await expect.poll(() => page.locator("#chart").evaluate((element, latestEnd) => (
    latestEnd - Date.parse(element._fullLayout.xaxis.range[1])
  ), fullRange[1])).toBeGreaterThan(30 * 86400000);

  const minimumRange = await page.locator("#chart").evaluate((element) => {
    const dataRange = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    const end = Math.max(...dataRange);
    const start = end - (7 * 86400000);
    return [start, end];
  });
  await page.evaluate((range) => window.ThinkStockE2E.setViewportRangeForTest(range), minimumRange);
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: -120, clientX: wheelPoint });
  await expect(page.locator("#chartNavigationMessage")).toHaveText("기간을 더 이상 줄일 수 없습니다.");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ))).toEqual(minimumRange);
});

test("restored chart pans immediately without a toggle or zoom warm-up", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse blank-area panning is desktop-only.");
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks: [],
      hiddenSeries: ["leading_cycle", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"],
      showDisclosures: false,
      showInsiderTrades: false,
      showRecessionSignals: false,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const initial = await page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "^KS11");
    const view = element._fullLayout.xaxis.range.map(Date.parse);
    const data = (trace?.x || []).map(Date.parse).filter(Number.isFinite);
    return { view, data: [Math.min(...data), Math.max(...data)] };
  });
  expect(initial.data[0]).toBeLessThan(initial.view[0]);

  const chartBox = await waitForBoundingBox(page.locator("#chart"));
  const startX = chartBox.x + chartBox.width * 0.45;
  const endX = chartBox.x + chartBox.width * 0.68;
  const pointerY = chartBox.y + chartBox.height * 0.12;
  const dragEarlier = async (previousStart) => {
    await page.mouse.move(startX, pointerY);
    await page.mouse.down();
    await page.mouse.move(endX, pointerY, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.locator("#chart").evaluate((element) => (
      Date.parse(element._fullLayout.xaxis.range[0])
    ))).toBeLessThan(previousStart);
    return page.locator("#chart").evaluate((element) => (
      Date.parse(element._fullLayout.xaxis.range[0])
    ));
  };

  let previousStart = await dragEarlier(initial.view[0]);
  await page.evaluate(() => window.ThinkStockE2E.loadHistoricalDataForTest());
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "^KS11");
    return Math.min(...(trace?.x || []).map(Date.parse).filter(Number.isFinite));
  })).toBeLessThan(initial.data[0]);

  // Cross the initially bundled range without requiring a zoom or visibility toggle.
  for (let index = 0; index < 7; index += 1) {
    previousStart = await dragEarlier(previousStart);
  }
});

test("auto scale fits the full lifetime of the longest remaining visible series", async ({ page }) => {
  await installDataRoutes(page, { shortStockHistory: true });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 360,
      autoChartReset: true,
      customStocks: [
        { ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" },
      ],
      hiddenSeries: ["leading_cycle", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly").length
  ))).toBe(2);

  const originalStart = await page.locator("#chart").evaluate((element) => (
    Date.parse(element._fullLayout.xaxis.range[0])
  ));
  await page.locator('.series-toggle-btn[data-series="^KS11"]').click();
  await expect.poll(() => page.locator("#chart").evaluate((element, previousStart) => {
    const visible = (element.data || []).filter((trace) => (
      trace?.meta?.seriesKey && trace.visible !== "legendonly" && String(trace.mode || "").includes("lines")
    ));
    const timestamps = visible.flatMap((trace) => (trace.x || []).map(Date.parse).filter(Number.isFinite));
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return {
      visibleCount: visible.length,
      startGap: Math.abs(range[0] - Math.min(...timestamps)),
      endGap: Math.abs(range[1] - Math.max(...timestamps)),
      movedStart: range[0] > previousStart,
    };
  }, originalStart)).toEqual({ visibleCount: 1, startGap: 0, endGap: 0, movedStart: true });
});

test("auto scale reset clears live transforms while preserving the historical viewport", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 120,
      autoChartReset: true,
      hiddenSeries: ["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit"],
      seriesOffsets: { kospi_credit: 42 },
      seriesScales: { kospi_credit: 0.1 },
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#y-handles .y-handle").count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).toEqual({
    offsets: {},
    scales: {},
  });
  await page.locator('.series-toggle-btn[data-series="kospi_credit"]').click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).some((trace) => trace?.meta?.seriesKey === "kospi_credit")
  ))).toBe(true);
  expect(await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).toEqual({
    offsets: {},
    scales: {},
  });
  const zoomSpan = await page.locator("#chart").evaluate(async (element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const span = range[1] - range[0];
    const center = (range[0] + range[1]) / 2;
    await globalThis.Plotly.relayout(element, {
      "xaxis.range[0]": new Date(center - span * 0.2).toISOString(),
      "xaxis.range[1]": new Date(center + span * 0.2).toISOString(),
    });
    return span;
  });
  await page.locator("#chartRange6Months").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    return end - start;
  })).toBeLessThan(zoomSpan * 0.4);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    const values = [];
    (element.data || []).forEach((trace) => {
      if (!trace?.meta?.seriesKey || trace.visible === "legendonly") return;
      (trace.x || []).forEach((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        if (time >= start && time <= end && Number.isFinite(value)) values.push(value);
      });
    });
    const dataSpan = values.length ? Math.max(...values) - Math.min(...values) : 0;
    const axisSpan = Math.abs(element._fullLayout.yaxis.range[1] - element._fullLayout.yaxis.range[0]);
    return axisSpan > 0 ? dataSpan / axisSpan : 0;
  })).toBeGreaterThan(0.7);
  const beforeHistoricalPan = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));
  const chartBox = await waitForBoundingBox(page.locator("#chart"));
  const panY = chartBox.y + chartBox.height * 0.14;
  await page.mouse.move(chartBox.x + chartBox.width * 0.46, panY);
  await page.mouse.down();
  await page.mouse.move(chartBox.x + chartBox.width * 0.7, panY, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.locator("#chart").evaluate((element, previousStart) => (
    Date.parse(element._fullLayout.xaxis.range[0]) < previousStart
  ), beforeHistoricalPan[0])).toBe(true);
  const autoResetXRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));
  const scaleSpanBefore = await visibleTracePixelSpan(page, "^KS11");
  const autoResetScaleHandle = page.locator('.y-handle-right[data-series-key="^KS11"]');
  const autoResetHandleBox = await waitForBoundingBox(autoResetScaleHandle);
  await page.mouse.move(
    autoResetHandleBox.x + autoResetHandleBox.width / 2,
    autoResetHandleBox.y + autoResetHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    autoResetHandleBox.x + autoResetHandleBox.width / 2,
    autoResetHandleBox.y + autoResetHandleBox.height / 2 + 35,
  );
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().scales).length
  ))).toBeGreaterThan(0);
  await expect.poll(() => visibleTracePixelSpan(page, "^KS11")).toBeLessThan(scaleSpanBefore * 0.9);
  const scaleSpanDuringDrag = await visibleTracePixelSpan(page, "^KS11");
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().scales).length
  ))).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs(
    (await visibleTracePixelSpan(page, "^KS11")) - scaleSpanDuringDrag,
  )).toBeLessThan(2);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const values = (element.data || []).flatMap((trace) => {
      if (!trace?.meta?.seriesKey || trace.visible === "legendonly") return [];
      return (trace.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        return time >= start && time <= end && Number.isFinite(value) ? [value] : [];
      });
    });
    return values.length > 0
      && yRange[0] < Math.min(...values)
      && yRange[1] > Math.max(...values);
  })).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ))).toEqual(autoResetXRange);
  const autoResetOffsetHandle = page.locator('.y-handle-left[data-series-key="^KS11"]');
  const autoResetOffsetHandleBox = await waitForBoundingBox(autoResetOffsetHandle);
  await page.mouse.move(
    autoResetOffsetHandleBox.x + autoResetOffsetHandleBox.width / 2,
    autoResetOffsetHandleBox.y + autoResetOffsetHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    autoResetOffsetHandleBox.x + autoResetOffsetHandleBox.width / 2,
    autoResetOffsetHandleBox.y + autoResetOffsetHandleBox.height / 2 + 35,
  );
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().offsets).length
  ))).toBeGreaterThan(0);
  const transformedTraceValues = await page.locator("#chart").evaluate((element) => (
    (element.data || []).find((trace) => trace?.meta?.seriesKey === "^KS11")?.y?.map(Number) || []
  ));
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const values = (element.data || []).flatMap((trace) => {
      if (!trace?.meta?.seriesKey || trace.visible === "legendonly") return [];
      return (trace.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        return time >= start && time <= end && Number.isFinite(value) ? [value] : [];
      });
    });
    return values.length > 0
      && yRange[0] < Math.min(...values)
      && yRange[1] > Math.max(...values);
  })).toBe(true);
  await page.locator("#resetHandles").click();
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#resetHandles").click();
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).toEqual({
    offsets: {},
    scales: {},
  });
  await expect.poll(() => page.locator("#chart").evaluate((element, expectedRange) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range.length === 2
      && range.every((value, index) => Math.abs(value - expectedRange[index]) <= 24 * 60 * 60 * 1000);
  }, autoResetXRange)).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element, transformedValues) => {
    const resetValues = (element.data || [])
      .find((trace) => trace?.meta?.seriesKey === "^KS11")?.y?.map(Number) || [];
    return resetValues.length === transformedValues.length
      && resetValues.some((value, index) => (
        Number.isFinite(value)
        && Number.isFinite(transformedValues[index])
        && Math.abs(value - transformedValues[index]) > 0.01
      ));
  }, transformedTraceValues)).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const values = (element.data || []).flatMap((trace) => {
      if (!trace?.meta?.seriesKey || trace.visible === "legendonly") return [];
      return (trace.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        return time >= start && time <= end && Number.isFinite(value) ? [value] : [];
      });
    });
    return values.length > 0
      && yRange[0] < Math.min(...values)
      && yRange[1] > Math.max(...values);
  })).toBe(true);
});
