import {
  expect,
  test,
  installDataRoutes,
  waitForChartRenderIdle,
} from "./helpers/thinkstock-fixture.mjs";

const PANELS = Object.freeze({
  adr: Object.freeze({ title: "ADR", series: ["adr_kospi", "adr_kosdaq"], pixels: 180 }),
  vkospi: Object.freeze({ title: "변동성", series: ["vkospi", "vix"], pixels: 85 }),
  fearGreed: Object.freeze({ title: "공포탐욕", series: ["fear_greed"], pixels: 85 }),
  newsSentiment: Object.freeze({ title: "뉴스심리", series: ["news_sentiment"], pixels: 85 }),
});

test("auxiliary panels remain painted across toggle combinations", async ({ page }) => {
  test.setTimeout(75_000);
  const simultaneousRuntimeDate = "2026-07-15";
  const continuousAuxiliaryDates = [
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
  ];
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    if (localStorage.getItem("thinkstock-v5")) return;
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      hiddenSeries: ["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit"],
      customStocks: [{ ticker: "005930.KS", name: "삼성전자" }],
      hoverShowPopup: true,
    }));
  });
  await installDataRoutes(page);
  await page.route("**/data/adr_data_recent.json*", async (route) => {
    await route.fulfill({ json: {
      format: "columnar-v1",
      series: ["adr_kospi", "adr_kosdaq", "fear_greed"],
      dates: continuousAuxiliaryDates,
      columns: {
        adr_kospi: [100, 74, 98, 126, 105],
        adr_kosdaq: [100, 72, 102, 130, 106],
        fear_greed: [50, 20, 55, 80, 50],
      },
    } });
  });
  await page.route("**/data/macro_data_recent.json*", async (route) => {
    await route.fulfill({ json: {
      format: "columnar-v1",
      series: ["leading_cycle", "news_sentiment"],
      dates: continuousAuxiliaryDates,
      columns: {
        leading_cycle: [100, 100, 100, 100, 100],
        news_sentiment: [50, 100, 100, 200, 100],
      },
    } });
  });
  await page.route("**/data/macro_data_history.json*", async (route) => {
    await route.fulfill({ json: {
      format: "columnar-v1",
      series: ["leading_cycle", "news_sentiment"],
      dates: [],
      columns: { leading_cycle: [], news_sentiment: [] },
    } });
  });
  await page.unroute("**/api/adr**");
  await page.route("**/api/adr**", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      cached: true,
      stale: false,
      latestDate: continuousAuxiliaryDates.at(-1),
      rows: continuousAuxiliaryDates.map((date, index) => ({
        date,
        adr_kospi: [100, 74, 98, 126, 105][index],
        adr_kosdaq: [100, 72, 102, 130, 106][index],
      })),
    } });
  });
  const crisisRoute = "https://thinkstock-api.keg0320.workers.dev/api/crisis-signal**";
  await page.unroute(crisisRoute);
  await page.route(crisisRoute, async (route) => {
    await route.fulfill({ json: {
      ok: true,
      records: [
        {
          date: "2026-07-14",
          score: 35,
          stage: "watch",
          curve: 24,
          labor: 10,
          credit: 11,
        },
        {
          date: simultaneousRuntimeDate,
          score: 55,
          stage: "warning",
          curve: 30,
          labor: 12,
          credit: 13,
        },
      ],
      vkospiRows: [{ date: simultaneousRuntimeDate, vkospi: 31.25 }],
      vixRows: [
        { date: "2026-06-30", vix: 18.2 },
        { date: "2026-07-07", vix: 19.4 },
        { date: simultaneousRuntimeDate, vix: 17.8 },
      ],
    } });
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await waitForChartRenderIdle(page);

  const chart = page.locator("#chart-adr");
  const panelToggle = (key) => page.locator(
    `.auxiliary-representative-toggle[data-auxiliary-panel="${key}"]`,
  );
  await expect.poll(() => chart.evaluate((element) => {
    const trace = (element.data || []).find(
      (item) => item?.meta?.auxiliarySeriesKey === "vkospi",
    );
    const points = (trace?.x || []).flatMap((date, index) => {
      const value = Number(trace?.y?.[index]);
      return Number.isFinite(value) ? [{ date: String(date).slice(0, 10), value }] : [];
    });
    return points.at(-1) || null;
  })).toEqual({ date: simultaneousRuntimeDate, value: 31.25 });
  const assertActivePanels = async (activeKeys) => {
    const expectedTitles = activeKeys.map((key) => PANELS[key].title);
    const expectedSeries = activeKeys.flatMap((key) => PANELS[key].series).sort();
    const expectedPaintedSeries = expectedSeries.filter((key) => key !== "vkospi");
    const expectedSeriesAxes = Object.fromEntries(activeKeys.flatMap((key, index) => (
      PANELS[key].series.map((seriesKey) => [seriesKey, index === 0 ? "y" : `y${index + 1}`])
    )));
    const expectedPanelHeights = Object.fromEntries(activeKeys.map((key) => [
      key,
      PANELS[key].pixels,
    ]));
    const expectedChartHeight = activeKeys.length
      ? 88 + Object.values(expectedPanelHeights).reduce((sum, value) => sum + value, 0)
        + Math.max(0, activeKeys.length - 1) * 18
      : 42;
    await expect.poll(() => chart.evaluate((element, expected) => {
      const activeSeries = new Set();
      const drawnSeries = new Set();
      const seriesAxes = {};
      (element.data || []).forEach((trace, traceIndex) => {
        const seriesKey = trace.meta?.auxiliarySeriesKey;
        if (!seriesKey) return;
        if (trace.y?.some(Number.isFinite)) {
          activeSeries.add(seriesKey);
          seriesAxes[seriesKey] = trace.yaxis || "y";
        }
        const uid = String(element._fullData?.[traceIndex]?.uid || "");
        const traceGroup = uid
          ? element.querySelector(`.scatterlayer .trace${CSS.escape(uid)}`)
          : null;
        const painted = [...(traceGroup?.querySelectorAll("path.js-line") || [])].some((path) => {
          const style = getComputedStyle(path);
          const rect = path.getBoundingClientRect();
          return style.stroke !== "none"
            && style.stroke !== "rgb(0, 0, 0)"
            && style.visibility === "visible"
            && Number(style.opacity) > 0
            && rect.width > 2;
        });
        if (painted) drawnSeries.add(seriesKey);
      });
      const headings = [...element.querySelectorAll(".auxiliary-panel-title")]
        .map((item) => item.textContent?.trim());
      const subplotCount = element.querySelectorAll(".cartesianlayer .subplot").length;
      const plotHeight = Number(element._fullLayout?._size?.h) || 0;
      const panelHeights = Object.fromEntries(expected.activeKeys.map((key, index) => {
        const axisKey = index === 0 ? "yaxis" : `yaxis${index + 1}`;
        const domain = element._fullLayout?.[axisKey]?.domain;
        return [key, Array.isArray(domain)
          ? Math.round((domain[1] - domain[0]) * plotHeight)
          : 0];
      }));
      const opaqueSubplotBackgrounds = [...element.querySelectorAll(".cartesianlayer .subplot rect.bg")]
        .filter((background) => {
          const fill = getComputedStyle(background).fill;
          if (!fill || fill === "none" || fill === "transparent") return false;
          const alphaMatch = fill.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/i);
          return !alphaMatch || Number(alphaMatch[1]) > 0.001;
        }).length;
      const axisTexts = [...element.querySelectorAll(".cartesianlayer text")]
        .map((item) => item.textContent?.trim())
        .filter(Boolean);
      return {
        activeSeries: [...activeSeries].sort(),
        // A two-point VKOSPI segment can be subpixel-wide on iPhone and visible on desktop.
        // VIX uses a wider three-point fixture and must remain painted.
        drawnSeries: [...drawnSeries].filter((key) => key !== "vkospi").sort(),
        seriesAxes,
        headings,
        subplotCount,
        panelHeights,
        chartHeight: Math.round(element.getBoundingClientRect().height),
        opaqueSubplotBackgrounds,
        emptyAxisTexts: expected.activeKeys.length ? [] : axisTexts,
      };
    }, {
      activeKeys,
      panels: PANELS,
    })).toEqual({
      activeSeries: expectedSeries,
      drawnSeries: expectedPaintedSeries,
      seriesAxes: expectedSeriesAxes,
      headings: expectedTitles,
      subplotCount: activeKeys.length,
      panelHeights: expectedPanelHeights,
      chartHeight: expectedChartHeight,
      opaqueSubplotBackgrounds: 0,
      emptyAxisTexts: [],
    });
  };

  const allPanels = ["adr", "vkospi", "fearGreed", "newsSentiment"];
  const volatilityReactivatedOrder = ["adr", "fearGreed", "newsSentiment", "vkospi"];
  await assertActivePanels(allPanels);
  await panelToggle("vkospi").click();
  await assertActivePanels(["adr", "fearGreed", "newsSentiment"]);
  await panelToggle("vkospi").click();
  await assertActivePanels(volatilityReactivatedOrder);
  expect(await chart.evaluate((element) => {
    const representative = element.querySelector(".auxiliary-representative-toggle");
    const panelTitle = element.querySelector(".auxiliary-panel-title");
    const styleOf = (button) => {
      const style = getComputedStyle(button);
      return {
        height: Math.round(button.getBoundingClientRect().height),
        fontSize: style.fontSize,
        borderWidth: style.borderTopWidth,
        borderRadius: style.borderRadius,
      };
    };
    return { representative: styleOf(representative), panelTitle: styleOf(panelTitle) };
  })).toEqual({
    representative: { height: 28, fontSize: "11px", borderWidth: "1px", borderRadius: "999px" },
    panelTitle: { height: 28, fontSize: "11px", borderWidth: "1px", borderRadius: "999px" },
  });
  expect(await chart.evaluate((element) => {
    const fills = (element.data || []).filter((trace) => (
      trace.fill === "toself" && trace.meta?.auxiliaryZoneFill
    ));
    const colorsFor = (zoneGroup) => fills
      .filter((trace) => trace.meta?.auxiliaryZoneGroup === zoneGroup)
      .map((trace) => trace.fillcolor);
    return Object.fromEntries([
      "adr",
      "fear_greed",
      "news_sentiment",
    ].map((zoneGroup) => [zoneGroup, colorsFor(zoneGroup)]));
  })).toEqual({
    adr: ["rgba(176,198,237,0.15)", "rgba(230,173,173,0.15)"],
    fear_greed: ["rgba(176,198,237,0.15)", "rgba(230,173,173,0.15)"],
    news_sentiment: ["rgba(176,198,237,0.15)", "rgba(230,173,173,0.15)"],
  });
  expect(await page.locator(
    '.auxiliary-series-toggle[data-auxiliary-series="vix"]',
  ).evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(28);
  for (const seriesKey of ["vkospi", "vix"]) {
    await page.locator(
      `.auxiliary-series-toggle[data-auxiliary-series="${seriesKey}"]`,
    ).click();
  }
  await expect(panelToggle("vkospi")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => chart.evaluate((element) => ({
    hasPanel: [...element.querySelectorAll(".auxiliary-panel-title")]
      .some((item) => item.dataset.panelKey === "vkospi"),
    visibleVolatilitySeries: (element.data || []).filter((trace) => (
      ["vkospi", "vix"].includes(trace.meta?.auxiliarySeriesKey)
    )).length,
  }))).toEqual({ hasPanel: true, visibleVolatilitySeries: 0 });
  for (const seriesKey of ["vkospi", "vix"]) {
    await page.locator(
      `.auxiliary-series-toggle[data-auxiliary-series="${seriesKey}"]`,
    ).click();
  }
  await page.locator('.auxiliary-series-toggle[data-auxiliary-series="vkospi"]').click();
  await page.locator('.auxiliary-series-toggle[data-auxiliary-series="vkospi"]').click();
  await expect.poll(() => chart.evaluate((element) => (
    (element.data || []).filter((trace) => (
      ["vkospi", "vix"].includes(trace.meta?.auxiliarySeriesKey)
        && !trace.meta?.auxiliaryZoneFill
        && trace.meta?.auxiliaryHoverProxy !== true
    )).map((trace) => trace.meta.auxiliarySeriesKey)
  ))).toEqual(["vix", "vkospi"]);
  await page.locator('.auxiliary-series-toggle[data-auxiliary-series="adr_kospi"]').click();
  await page.locator('.auxiliary-series-toggle[data-auxiliary-series="adr_kospi"]').click();
  await expect.poll(() => chart.evaluate((element) => (
    (element.data || []).filter((trace) => (
      ["adr_kospi", "adr_kosdaq"].includes(trace.meta?.auxiliarySeriesKey)
        && !trace.meta?.auxiliaryZoneFill
        && trace.meta?.auxiliaryHoverProxy !== true
    )).map((trace) => trace.meta.auxiliarySeriesKey)
  ))).toEqual(["adr_kosdaq", "adr_kospi"]);
  await assertActivePanels(volatilityReactivatedOrder);
  expect(await chart.evaluate((element) => {
    const adrHover = (element.data || []).find((trace) => trace.name === "ADR HOVER");
    const fearGreed = (element.data || []).find(
      (trace) => trace.meta?.auxiliarySeriesKey === "fear_greed"
        && trace.meta?.auxiliaryHoverProxy === true,
    );
    return {
      adrHasOnlyAdrValues: String(adrHover?.hovertemplate || "").includes("KOSPI")
        && !String(adrHover?.hovertemplate || "").includes("공포탐욕"),
      fearGreedHasOwnHover: fearGreed?.hoverinfo !== "skip"
        && String(fearGreed?.hovertemplate || "").includes("공포탐욕"),
    };
  })).toEqual({
    adrHasOnlyAdrValues: true,
    fearGreedHasOwnHover: true,
  });

  let currentMask = 15;
  let currentOrder = [...volatilityReactivatedOrder];
  for (let targetMask = 15; targetMask >= 0; targetMask -= 1) {
    for (let index = 0; index < allPanels.length; index += 1) {
      const bit = 1 << index;
      if ((currentMask & bit) === (targetMask & bit)) continue;
      const key = allPanels[index];
      await panelToggle(key).click();
      if (!(currentMask & bit) && (targetMask & bit)) {
        currentOrder = [...currentOrder.filter((candidate) => candidate !== key), key];
      }
      await expect(panelToggle(key)).toHaveAttribute(
        "aria-pressed",
        targetMask & bit ? "true" : "false",
      );
    }
    currentMask = targetMask;
    await assertActivePanels(currentOrder.filter((key) => (
      targetMask & (1 << allPanels.indexOf(key))
    )));
  }

  for (const key of allPanels) {
    await panelToggle(key).click();
    await expect(panelToggle(key)).toHaveAttribute("aria-pressed", "true");
  }
  currentOrder = [...allPanels];
  await assertActivePanels(allPanels);

  for (const key of allPanels) {
    await panelToggle(key).click();
    await expect(panelToggle(key)).toHaveAttribute("aria-pressed", "false");
  }
  await assertActivePanels([]);
  await panelToggle("vkospi").click();
  await assertActivePanels(["vkospi"]);
  await panelToggle("adr").click();
  await assertActivePanels(["vkospi", "adr"]);
  await page.evaluate(() => {
    ["vkospi", "adr", "fearGreed", "vkospi", "fearGreed", "adr"].forEach((key) => {
      document.querySelector(
        `.auxiliary-representative-toggle[data-auxiliary-panel="${key}"]`,
      )?.click();
    });
  });
  await assertActivePanels(["vkospi", "adr"]);
  const zoomRanges = await chart.evaluate((element) => {
    const dates = (element.data || []).find(
      (trace) => trace.meta?.auxiliarySeriesKey === "vkospi",
    )?.x?.filter(Boolean) || [];
    return [35, 140].map((span) => [
      dates[Math.max(0, dates.length - span)] || dates[0],
      dates.at(-1),
    ]);
  });
  for (const range of zoomRanges) {
    await page.locator("#chart").evaluate(async (element, nextRange) => {
      await globalThis.Plotly.relayout(element, {
        "xaxis.range[0]": nextRange[0],
        "xaxis.range[1]": nextRange[1],
      });
    }, range);
    await expect.poll(() => chart.evaluate((element) => {
      const xRange = element._fullLayout?.xaxis?.range?.map((value) => String(value).slice(0, 10));
      if (!xRange?.[0] || !xRange?.[1]) return {};
      return Object.fromEntries(["vkospi", "vix", "adr_kospi", "adr_kosdaq"].map((seriesKey) => {
        const traces = (element.data || []).filter(
          (trace) => trace.meta?.auxiliarySeriesKey === seriesKey,
        );
        if (!traces.length) return [seriesKey, false];
        const axisReference = traces[0].yaxis || "y";
        const axisKey = axisReference === "y" ? "yaxis" : `yaxis${axisReference.slice(1)}`;
        const yRange = element._fullLayout?.[axisKey]?.range?.map(Number);
        const values = traces.flatMap((trace) => (trace.x || []).flatMap((date, index) => {
          const rawValue = trace.y?.[index];
          if (rawValue === null || rawValue === undefined || rawValue === "") return [];
          const value = Number(rawValue);
          const day = String(date || "").slice(0, 10);
          return day >= xRange[0] && day <= xRange[1] && Number.isFinite(value) ? [value] : [];
        }));
        return [seriesKey, values.length > 0
          && Number.isFinite(yRange?.[0])
          && Number.isFinite(yRange?.[1])
          && Math.min(...values) >= Math.min(...yRange) - 0.001
          && Math.max(...values) <= Math.max(...yRange) + 0.001];
      }));
    })).toEqual({
      vkospi: true,
      vix: true,
      adr_kospi: true,
      adr_kosdaq: true,
    });
  }
  const mainRangeSpan = () => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout?.xaxis?.range?.map((value) => Date.parse(value));
    return range?.every(Number.isFinite) ? range[1] - range[0] : 0;
  });
  await waitForChartRenderIdle(page);
  const mainRenderGenerationBeforeWheel = await page.evaluate(
    () => window.ThinkStockE2E.getChartRenderGeneration(),
  );
  const spanBeforeWheel = await mainRangeSpan();
  await chart.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + (rect.width * 0.5),
      clientY: rect.top + (rect.height * 0.5),
      deltaY: -180,
    }));
  });
  await expect.poll(mainRangeSpan).toBeLessThan(spanBeforeWheel * 0.98);
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartRenderGeneration()))
    .toBe(mainRenderGenerationBeforeWheel);

  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem("thinkstock-v5") || "{}")?.auxiliaryPanelOrder?.slice(-2)
  ))).toEqual(["vkospi", "adr"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await waitForChartRenderIdle(page);
  await assertActivePanels(["vkospi", "adr"]);
  await page.locator('.auxiliary-panel-title[data-panel-key="vkospi"]').click();
  await expect(panelToggle("vkospi")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('.auxiliary-panel-title[data-panel-key="vkospi"]')).toHaveCount(0);
});
