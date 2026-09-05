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
import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
} from "../../shared/company-analysis-contract.mjs";

async function expectMainAuxiliaryRangesLinked(page, toleranceMs = 86400000) {
  await expect.poll(() => page.evaluate(() => {
    const toMs = (value) => typeof value === "number" ? value : Date.parse(value);
    const main = document.getElementById("chart")?._fullLayout?.xaxis?.range?.map(toMs);
    if (!main?.every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const companions = ["chart-macd", "chart-adr"].flatMap((id) => {
      const element = document.getElementById(id);
      const range = element?._fullLayout?.xaxis?.range?.map(toMs);
      const hasVisibleData = (element?.data || []).some((trace) => (
        trace?.visible !== false
        && trace?.visible !== "legendonly"
        && Array.isArray(trace?.x)
        && trace.x.length > 0
      ));
      return element && !element.hidden && hasVisibleData && range?.every(Number.isFinite)
        ? [range]
        : [];
    });
    if (!companions.length) return Number.POSITIVE_INFINITY;
    return Math.max(...companions.flatMap((range) => [
      Math.abs(main[0] - range[0]),
      Math.abs(main[1] - range[1]),
    ]));
  })).toBeLessThanOrEqual(toleranceMs);
}

async function expectVisibleAuxiliaryDataCoversMainRange(page) {
  await expect.poll(() => page.evaluate(() => {
    const toMs = (value) => typeof value === "number" ? value : Date.parse(value);
    const mainRange = document.getElementById("chart")?._fullLayout?.xaxis?.range?.map(toMs);
    if (!mainRange?.every(Number.isFinite)) return [];
    const [rangeStart, rangeEnd] = [Math.min(...mainRange), Math.max(...mainRange)];
    const traceCoversRange = (trace) => {
      if (trace?.visible === false || trace?.visible === "legendonly") return false;
      return (trace.x || []).some((date, index) => {
        const time = toMs(date);
        return time >= rangeStart
          && time <= rangeEnd
          && Number.isFinite(Number(trace.y?.[index]));
      });
    };

    const covered = new Set();
    const macd = document.getElementById("chart-macd");
    if ((macd?.data || []).some((trace) => (
      trace?.meta?.macdSeriesKey && traceCoversRange(trace)
    ))) covered.add("macd");

    const panelBySeries = {
      adr_kospi: "adr",
      adr_kosdaq: "adr",
      fear_greed: "fearGreed",
      news_sentiment: "newsSentiment",
      vkospi: "vkospi",
      vix: "vkospi",
    };
    const auxiliary = document.getElementById("chart-adr");
    (auxiliary?.data || []).forEach((trace) => {
      const meta = trace?.meta || {};
      const panel = panelBySeries[meta.auxiliarySeriesKey];
      if (!panel || meta.auxiliaryHoverProxy || meta.auxiliaryZoneFill) return;
      if (traceCoversRange(trace)) covered.add(panel);
    });
    return [...covered].sort();
  })).toEqual(["adr", "fearGreed", "macd", "newsSentiment", "vkospi"]);
}

test("full reset restores the device default chart period", async ({ page, isMobile }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("thinkstock-device-reset-range-seeded") === "1") return;
    sessionStorage.setItem("thinkstock-device-reset-range-seeded", "1");
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 36,
      autoChartReset: false,
      customStocks: [],
      hiddenSeries: ["^KQ11"],
    }));
  });
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(36);

  await page.locator("#apiOptionsBtn").click();
  await page.locator("#appStateResetBtn").click();
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator("#appStateResetConfirmBtn").click(),
  ]);

  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getActiveMonths?.() ?? null
  )))
    .toBe(isMobile ? 6 : 12);
});

test("illiquid preferred stock can be added across long historical trading gaps", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
  });
  await installDataRoutes(page, {
    krxUniverseRecords: [
      { ticker: "019175.KS", code: "019175", name: "신풍제약우", market: "KOSPI" },
    ],
  });
  await page.route("**/api/research/history?*", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      schema: 1,
      ticker: "019175.KS",
      latestDate: "2026-08-21",
      fullRowCount: 8,
      partial: false,
      rows: [
        { date: "1997-11-05", close: 706, volume: 8000 },
        { date: "1997-12-15", close: 426, volume: 0 },
        { date: "1998-01-12", close: 125, volume: 1500 },
        { date: "1998-05-11", close: 120, volume: 900 },
        { date: "1998-05-21", close: 77, volume: 1000 },
        { date: "2026-08-20", close: 12700, volume: 1255 },
        { date: "2026-08-21", close: 12210, volume: 434 },
      ],
    } });
  });
  await page.unroute("**/api/prices?*");
  await page.route("**/api/prices?*", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      ticker: "019175.KS",
      source: "NAVER_FALLBACK",
      latestDate: "2026-08-24",
      records: [{ date: "2026-08-24", close: 15870 }],
    } });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.locator("#stockSearchInput").fill("신풍제약우");
  await page.locator(".stock-suggest-item").filter({ hasText: "신풍제약우" }).click();

  await expect(page.locator('[data-custom-series="019175.KS"]')).toHaveCount(1);
  await expect(page.locator('[data-series="019175.KS"]')).toHaveClass(/is-on/);
});

test("a hidden research stock revives an empty chart at the latest device range", async ({ page, isMobile }) => {
  const ticker = "460930.KQ";
  let historyRequestCount = 0;
  const rows = [];
  for (
    let cursor = new Date("2023-01-02T00:00:00Z"), index = 0;
    cursor <= new Date("2026-08-28T00:00:00Z");
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
    rows.push({
      date: cursor.toISOString().slice(0, 10),
      close: 12000 + index,
      volume: 100000 + index,
    });
    index += 1;
  }
  await page.addInitScript(({ ticker: stockTicker }) => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 36,
      autoChartReset: true,
      customStocks: [{ ticker: stockTicker, code: "460930", name: "현대힘스", market: "KOSDAQ" }],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
        stockTicker,
      ],
    }));
  }, { ticker });
  await installDataRoutes(page);
  await page.route("**/api/research/history?*", async (route) => {
    historyRequestCount += 1;
    await route.fulfill({ json: {
      ok: true,
      ticker,
      latestDate: "2026-08-28",
      fullRowCount: rows.length,
      partial: false,
      rows,
    } });
  });
  await page.unroute("**/api/prices?*");
  await page.route("**/api/prices?*", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      ticker,
      source: "KRX",
      latestDate: "2026-08-28",
      records: [{ date: "2026-08-28", close: rows.at(-1).close, volume: rows.at(-1).volume }],
    } });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  const button = page.locator(`[data-series="${ticker}"]`);
  await expect(button).toBeEnabled();
  await expect(button).toHaveClass(/is-off/);
  await button.click();
  await expect.poll(() => historyRequestCount).toBeGreaterThan(0);
  await expect(button).toHaveClass(/is-on/);
  const latest = Date.parse("2026-08-28T00:00:00Z");
  await expect.poll(() => page.locator("#chart").evaluate((element, seriesKey) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === seriesKey);
    const range = (element._fullLayout?.xaxis?.range || []).map(Date.parse);
    return {
      visible: Boolean(trace && trace.visible !== "legendonly" && trace.x?.length),
      latestSettled: Number.isFinite(range[1])
        && Math.abs(range[1] - Date.parse("2026-08-28T00:00:00Z")) <= 4 * 86400000,
    };
  }, ticker)).toMatchObject({
    visible: true,
    latestSettled: true,
  });
  const viewport = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));
  expect(Math.abs(viewport[1] - latest)).toBeLessThanOrEqual(4 * 86400000);
  const expectedMinimumDays = isMobile ? 165 : 330;
  const expectedMaximumDays = isMobile ? 200 : 400;
  expect(viewport[1] - viewport[0]).toBeGreaterThan(expectedMinimumDays * 86400000);
  expect(viewport[1] - viewport[0]).toBeLessThan(expectedMaximumDays * 86400000);
});

test("RFHIC EPS prioritizes quarterly values and rises through annual estimates", async ({ page, isMobile }) => {
  test.setTimeout(90000);
  const ticker = "218410.KQ";
  const researchMilestones = new Map([
    ["2025-12-31", 18500],
    ["2026-03-31", 20100],
    ["2026-06-30", 23600],
    ["2026-08-24", 25200],
  ]);
  const researchRows = [];
  for (
    let cursor = new Date("2022-01-03T00:00:00Z"), index = 0;
    cursor <= new Date("2026-08-24T00:00:00Z");
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
    const date = cursor.toISOString().slice(0, 10);
    const close = researchMilestones.get(date)
      ?? Math.round(14500 + (index * 14) + (Math.sin(index / 11) * 480));
    researchRows.push({ date, close, volume: 10000 + ((index % 12) * 350) });
    index += 1;
  }
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
  });
  await installDataRoutes(page, {
    krxUniverseRecords: [{ ticker, code: "218410", name: "RFHIC", market: "KOSDAQ" }],
  });
  await page.route("**/api/research/history?*", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      ticker,
      latestDate: "2026-08-24",
      fullRowCount: researchRows.length,
      partial: false,
      rows: researchRows,
    } });
  });
  await page.unroute("**/api/prices?*");
  await page.route("**/api/prices?*", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      ticker,
      source: "KRX",
      latestDate: "2026-08-24",
      records: [{ date: "2026-08-24", close: 25200, volume: 13000 }],
    } });
  });
  await page.route("**/api/analysis**", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      ticker,
      savedAt: Date.now(),
      analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
      financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
      consensus: null,
      news: [],
      financials: [
        { ticker, period: "2023-12", frequency: "annual", eps: 320, estimate: false },
        { ticker, period: "2024-12", frequency: "annual", eps: 400, estimate: false },
        { ticker, period: "2025-09", frequency: "quarter", eps: 100, estimate: false },
        { ticker, period: "2025-12", frequency: "quarter", eps: 120, estimate: false },
        { ticker, period: "2025-12", frequency: "annual", eps: 520, estimate: false },
        { ticker, period: "2026-03", frequency: "quarter", eps: 180, estimate: false },
        { ticker, period: "2026-06", frequency: "quarter", eps: 240, estimate: true },
        { ticker, period: "2026-12", frequency: "annual", eps: 1200, estimate: true },
        { ticker, period: "2027-12", frequency: "annual", eps: 1800, estimate: true },
      ],
    } });
  });
  await page.route("**/api/dart/eps-history?*", async (route) => {
    const year = Number(new URL(route.request().url()).searchParams.get("year"));
    await new Promise((resolve) => setTimeout(resolve, 75));
    await route.fulfill({ json: {
      ok: true,
      version: 1,
      ticker,
      businessYear: year,
      records: [],
      cached: true,
      startYear: 2016,
      endYear: 2025,
    } });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.locator("#stockSearchInput").fill("RFHIC");
  await page.locator(".stock-suggest-item").filter({ hasText: "RFHIC" }).click();
  await expect(page.locator('[data-series="218410.KQ"]')).toHaveClass(/is-on/);
  await page.locator("#chartRange6Months").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    return (end - start) / 86400000;
  })).toBeLessThan(190);
  const beforeEpsRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));
  if (await page.locator("#hoverToggle").getAttribute("aria-pressed") !== "true") {
    await page.locator("#hoverToggle").click();
  }
  await expect(page.locator("#hoverToggle")).toHaveClass(/is-active/);
  await page.locator("#epsToggle").click();
  await expect(page.locator("#epsToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#epsProgress")).toBeVisible({ timeout: 5000 });

  await expect.poll(() => page.locator("#chart").evaluate((element, entryRange) => {
    const eps = (element.data || []).find((trace) => trace?.meta?.overlayKind === "eps");
    const price = (element.data || []).find((trace) => trace?.meta?.seriesKey === "218410.KQ");
    const grouped = (element.data || []).find((trace) => (
      trace?.meta?.overlayKind === "grouped-hover" && trace.meta.hoverGroupTicker === "218410.KQ"
    ));
    const groupedOwner = (element.data || []).find((trace) => (
      trace?.meta?.isGroupedHoverOwnerTrace
    ));
    return eps ? {
      colorMatches: eps.line?.color === price?.line?.color,
      dash: eps.line?.dash,
      quarterMarkers: eps.marker?.size,
      quarterMarkersBlack: eps.marker?.color?.every((color) => color === "#000000"),
      dates: eps.x,
      historyStartPreserved: Math.abs(
        Date.parse(element._fullLayout?.xaxis?.range?.[0]) - entryRange[0]
      ) <= 86400000,
      futureVisible: Date.parse(element._fullLayout?.xaxis?.range?.[1]) >= Date.parse(eps.x.at(-1)),
      fitsYAxis: eps.y.every((value, index) => {
        const time = Date.parse(eps.x[index]);
        const [x0, x1] = element._fullLayout.xaxis.range.map(Date.parse);
        if (time < Math.min(x0, x1) || time > Math.max(x0, x1)) return true;
        return Number.isFinite(Number(value))
          && Number(value) >= Math.min(...element._fullLayout.yaxis.range.map(Number))
          && Number(value) <= Math.max(...element._fullLayout.yaxis.range.map(Number));
      }),
      futureRises: eps.y.at(-1) > eps.y[eps.x.indexOf("2026-12-31")],
      groupedTicker: grouped?.meta?.hoverGroupTicker || "",
      groupedEpsYAligned: (() => {
        const date = "2025-09-30";
        const groupedIndex = grouped?.x?.indexOf(date) ?? -1;
        const epsIndex = eps.x?.indexOf(date) ?? -1;
        return groupedIndex >= 0 && epsIndex >= 0 && grouped.y[groupedIndex] === eps.y[epsIndex];
      })(),
      groupedQuarterLabel: grouped?.text?.some((text) => String(text).includes("EPS · 4분기 120")),
      groupedNameRepeated: grouped?.text?.some((text) => String(text).includes("RFHIC EPS")),
      groupedIndent: groupedOwner?.hovertemplate === "%{text}<extra></extra>"
        && groupedOwner?.text?.some((text) => String(text).includes("<br>EPS"))
        && groupedOwner?.customdata?.every((text, index) => text === groupedOwner.text[index])
        && groupedOwner?.customdata?.every((text) => !String(text).includes("&nbsp;"))
        && groupedOwner?.meta?.pointHoverTemplate === "%{x|%Y.%-m.%-d}<br>%{customdata}<extra></extra>"
        && (grouped === groupedOwner || grouped?.hoverinfo === "skip"),
      epsOwnsPopup: eps.hoverinfo !== "skip" || Boolean(eps.hovertemplate),
      lastText: eps.text?.at(-1),
    } : null;
  }, beforeEpsRange), { timeout: 30000 }).toEqual({
    colorMatches: true,
    dash: "dot",
    quarterMarkers: Array(20).fill(12),
    quarterMarkersBlack: true,
    dates: [
      "2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31",
      "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
      "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31",
      "2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31",
      "2027-03-31", "2027-06-30", "2027-09-30", "2027-12-31",
    ],
    historyStartPreserved: true,
    futureVisible: true,
    fitsYAxis: true,
    futureRises: true,
    groupedTicker: ticker,
    groupedEpsYAligned: true,
    groupedQuarterLabel: true,
    groupedNameRepeated: false,
    groupedIndent: true,
    epsOwnsPopup: false,
    lastText: "2027년 4분기 전망 환산 EPS 450 · 연간 1,800",
  });
  await expect(page.locator('#y-handles [data-series-key="eps:218410.KQ"]')).toHaveCount(2);
  await expect(page.locator("#epsProgress")).toBeHidden({ timeout: 5000 });
  const epsHandle = page.locator('#y-handles .y-handle-right[data-series-key="eps:218410.KQ"]');
  await expect(epsHandle).toBeVisible();
  await expect(epsHandle).toHaveClass(/y-handle-eps/);
  await expect(epsHandle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  if (!isMobile) {
    const readHoverSummary = () => page.locator("#chart .hoverlayer").evaluate((hoverLayer) => {
      const datePattern = /^\d{4}\.\d{1,2}\.\d{1,2}$/;
      const pointLines = [...hoverLayer.querySelectorAll("text.nums > tspan.line")];
      const pointDate = pointLines.find((line) => datePattern.test(line.textContent?.trim() || ""));
      const unifiedDate = [...hoverLayer.querySelectorAll("text.legendtitletext")]
        .find((line) => datePattern.test(line.textContent?.trim() || ""));
      const dateLine = pointDate || unifiedDate;
      const contentLines = pointDate
        ? pointLines.filter((line) => line !== pointDate)
        : [...hoverLayer.querySelectorAll("text.legendtext")];
      const startX = (line) => {
        const matrix = line?.getScreenCTM?.();
        if (!line?.textContent?.length || !matrix) return Number.NaN;
        return line.getStartPositionOfChar(0).matrixTransform(matrix).x;
      };
      const dateLeft = startX(dateLine);
      const offsets = contentLines.map((line) => Math.round(startX(line) - dateLeft));
      const text = String(hoverLayer.textContent || "");
      return {
        contentIndented: offsets.length > 0
          && offsets.every((offset) => Number.isFinite(offset) && Math.abs(offset - 38) <= 1),
        date: dateLine?.textContent?.trim() || "",
        hasEps: text.includes("EPS"),
        hasTicker: text.includes("RFHIC"),
        kind: pointDate ? "point" : (unifiedDate ? "unified" : ""),
      };
    });
    const initialEpsHoverTarget = await page.locator("#chart").evaluate((element) => {
      const grouped = (element.data || []).find((trace) => (
        trace?.meta?.overlayKind === "grouped-hover" && trace.meta.hoverGroupTicker === "218410.KQ"
      ));
      const pointIndex = grouped?.x?.indexOf("2026-03-31") ?? -1;
      if (!grouped || pointIndex < 0) return null;
      const rect = element.getBoundingClientRect();
      const xa = element._fullLayout.xaxis;
      const ya = element._fullLayout.yaxis;
      return {
        x: rect.left + xa._offset + xa.d2p(grouped.x[pointIndex]),
        y: rect.top + ya._offset + ya.l2p(grouped.y[pointIndex]),
      };
    });
    expect(initialEpsHoverTarget).not.toBeNull();
    await page.mouse.move(initialEpsHoverTarget.x, initialEpsHoverTarget.y);
    await expect(page.locator("#chart .hoverlayer")).toContainText("EPS", { timeout: 3000 });
    const initialEpsHoverLines = await page.locator("#chart .hoverlayer text.nums > tspan.line")
      .allTextContents();
    expect(initialEpsHoverLines[0]).toBe("2026.3.31");
    expect(initialEpsHoverLines[1]?.trim()).toContain("RFHIC");
    expect(initialEpsHoverLines[2]?.trim()).toContain("EPS");
    await expect.poll(async () => {
      const offsets = await page.locator("#chart .hoverlayer text.nums > tspan.line")
        .evaluateAll((lines) => lines.slice(0, 3).flatMap((line) => {
          const matrix = line.getScreenCTM();
          if (!line.textContent?.length || !matrix) return [];
          return [line.getStartPositionOfChar(0).matrixTransform(matrix).x];
        }));
      return offsets.length === 3
        ? offsets.slice(1).map((left) => Math.round(left - offsets[0]))
        : [];
    }).toEqual([38, 38]);
    const initialEpsHoverOffsets = await page.locator("#chart .hoverlayer text.nums > tspan.line")
      .evaluateAll((lines) => lines.slice(0, 3).map((line) => (
        line.getStartPositionOfChar(0).matrixTransform(line.getScreenCTM()).x
      )));
    expect(Math.abs(initialEpsHoverOffsets[1] - initialEpsHoverOffsets[0] - 38)).toBeLessThanOrEqual(1);
    expect(Math.abs(initialEpsHoverOffsets[2] - initialEpsHoverOffsets[0] - 38)).toBeLessThanOrEqual(1);
    const initialEpsDetailHtml = await page.locator("#chart .hoverlayer text.nums > tspan.line")
      .nth(2)
      .evaluate((line) => line.innerHTML);
    expect(initialEpsDetailHtml).not.toContain("font-weight:bold");
    const pointHoverAppearance = await page.locator("#chart .hoverlayer > g.hovertext").evaluate((group) => {
      const background = group.querySelector(":scope > path");
      const text = group.querySelector("text.nums");
      const backgroundStyle = getComputedStyle(background);
      const textStyle = getComputedStyle(text);
      return {
        background: backgroundStyle.fill,
        border: backgroundStyle.stroke,
        borderWidth: backgroundStyle.strokeWidth,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        textColor: textStyle.fill,
      };
    });
    expect(pointHoverAppearance.fontSize).toBe("12px");
    expect(pointHoverAppearance.background).toBe("rgba(34, 34, 34, 0.45)");

    const priceHoverTarget = await page.locator("#chart").evaluate((element) => {
      const grouped = (element.data || []).find((trace) => (
        trace?.meta?.overlayKind === "grouped-hover" && trace.meta.hoverGroupTicker === "218410.KQ"
      ));
      const eps = (element.data || []).find((trace) => trace?.meta?.seriesKey === "eps:218410.KQ");
      const epsDates = new Set(eps?.x || []);
      const [rangeStart, rangeEnd] = (element._fullLayout?.xaxis?.range || []).map(Date.parse);
      const rangeMidpoint = (rangeStart + rangeEnd) / 2;
      const pointIndex = (grouped?.x || []).reduce((bestIndex, date, index) => {
        const time = Date.parse(date);
        if (epsDates.has(date)
          || time < Math.min(rangeStart, rangeEnd)
          || time > Math.max(rangeStart, rangeEnd)) return bestIndex;
        if (bestIndex < 0) return index;
        return Math.abs(time - rangeMidpoint) < Math.abs(Date.parse(grouped.x[bestIndex]) - rangeMidpoint)
          ? index
          : bestIndex;
      }, -1);
      if (!grouped || pointIndex < 0) return null;
      const rect = element.getBoundingClientRect();
      const xa = element._fullLayout.xaxis;
      const ya = element._fullLayout.yaxis;
      return {
        x: rect.left + xa._offset + xa.d2p(grouped.x[pointIndex]),
        y: rect.top + ya._offset + ya.l2p(grouped.y[pointIndex]),
        date: grouped.x[pointIndex],
      };
    });
    expect(priceHoverTarget).not.toBeNull();
    await page.mouse.move(priceHoverTarget.x, priceHoverTarget.y);
    const [priceYear, priceMonth, priceDay] = priceHoverTarget.date.split("-").map(Number);
    const priceDateLabel = `${priceYear}.${priceMonth}.${priceDay}`;
    await expect(page.locator("#chart .hoverlayer")).toContainText(priceDateLabel, { timeout: 3000 });
    const priceHoverText = await page.locator("#chart .hoverlayer").textContent();
    expect(priceHoverText?.match(new RegExp(priceDateLabel.replaceAll(".", "\\."), "g"))?.length || 0)
      .toBe(1);
    await expect.poll(async () => page.locator("#chart .hoverlayer").evaluate((hoverLayer) => {
      const date = hoverLayer.querySelector("text.legendtitletext");
      const content = hoverLayer.querySelector("text.legendtext");
      if (!date || !content) return null;
      const startX = (node) => node.getStartPositionOfChar(0).matrixTransform(node.getScreenCTM()).x;
      return Math.round(startX(content) - startX(date));
    })).toBe(38);
    const unifiedHoverAppearance = await page.locator("#chart .hoverlayer > g.legend").evaluate((group) => {
      const background = group.querySelector(":scope > rect.bg");
      const text = group.querySelector("text.legendtitletext");
      const backgroundStyle = getComputedStyle(background);
      const textStyle = getComputedStyle(text);
      return {
        background: backgroundStyle.fill,
        border: backgroundStyle.stroke,
        borderWidth: backgroundStyle.strokeWidth,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        textColor: textStyle.fill,
      };
    });
    expect(unifiedHoverAppearance).toEqual(pointHoverAppearance);
    await waitForChartRenderIdle(page);
    const hoverTarget = await page.locator("#chart").evaluate((element) => {
      const grouped = (element.data || []).find((trace) => (
        trace?.meta?.overlayKind === "grouped-hover" && trace.meta.hoverGroupTicker === "218410.KQ"
      ));
      const pointIndex = grouped?.x?.indexOf("2026-06-30") ?? -1;
      if (!grouped || pointIndex < 0) return null;
      const rect = element.getBoundingClientRect();
      const xa = element._fullLayout.xaxis;
      const ya = element._fullLayout.yaxis;
      return {
        x: rect.left + xa._offset + xa.d2p(grouped.x[pointIndex]) + 14,
        y: rect.top + ya._offset + ya.l2p(grouped.y[pointIndex]),
      };
    });
    expect(hoverTarget).not.toBeNull();
    await expect.poll(() => page.evaluate((target) => (
      window.ThinkStockE2E.getLineDragTargetAt(target.x, target.y)
    ), hoverTarget)).toMatchObject({
      seriesKey: "eps:218410.KQ",
    });
    await page.mouse.move(hoverTarget.x - 2, hoverTarget.y);
    await page.mouse.move(hoverTarget.x, hoverTarget.y);
    await expect.poll(readHoverSummary, { timeout: 8000 }).toMatchObject({
      contentIndented: true,
      date: "2026.6.30",
      hasEps: true,
      hasTicker: true,
    });
    const epsHoverText = await page.locator("#chart .hoverlayer").textContent();
    expect(epsHoverText?.match(/2026\.6\.30/g)?.length || 0).toBe(1);
    await expect(page.locator("#chart .trace.scatter.is-eps-point-highlighted")).toHaveCount(1);
    const highlightedEpsPoint = page.locator(
      "#chart .trace.scatter.is-eps-point-highlighted .points path.point",
    ).nth(2);
    await expect(highlightedEpsPoint).toHaveCSS("stroke-width", "3px");
    await expect(highlightedEpsPoint).toHaveCSS("transform", "none");

    const viewportBeforeHistoricalHover = await page.locator("#chart").evaluate((element) => (
      element._fullLayout.xaxis.range.map(Date.parse)
    ));
    const historicalHoverRange = [Date.parse("2024-01-01"), Date.parse("2024-06-30")];
    await page.evaluate((range) => window.ThinkStockE2E.setViewportRangeForTest(range), historicalHoverRange);
    await waitForChartRenderIdle(page);
    const historicalEpsHoverTarget = await page.locator("#chart").evaluate((element) => {
      const grouped = (element.data || []).find((trace) => (
        trace?.meta?.overlayKind === "grouped-hover" && trace.meta.hoverGroupTicker === "218410.KQ"
      ));
      const pointIndex = grouped?.x?.indexOf("2024-03-31") ?? -1;
      if (!grouped || pointIndex < 0) return null;
      const rect = element.getBoundingClientRect();
      const xa = element._fullLayout.xaxis;
      const ya = element._fullLayout.yaxis;
      return {
        x: rect.left + xa._offset + xa.d2p(grouped.x[pointIndex]),
        y: rect.top + ya._offset + ya.l2p(grouped.y[pointIndex]),
      };
    });
    expect(historicalEpsHoverTarget).not.toBeNull();
    await page.mouse.move(historicalEpsHoverTarget.x, historicalEpsHoverTarget.y);
    await expect(page.locator("#chart .hoverlayer")).toContainText("2024.3.31", { timeout: 3000 });
    await expect.poll(readHoverSummary, { timeout: 15000 }).toMatchObject({
      contentIndented: true,
      date: "2024.3.31",
      hasEps: true,
      hasTicker: true,
    });
    await page.evaluate((range) => window.ThinkStockE2E.setViewportRangeForTest(range), viewportBeforeHistoricalHover);
    await waitForChartRenderIdle(page);

    await page.evaluate(() => window.ThinkStockE2E?.getPerformanceApi?.()?.clear?.());
    const chartBox = await page.locator("#chart").boundingBox();
    expect(chartBox).not.toBeNull();
    for (let index = 0; index < 32; index += 1) {
      await page.mouse.move(
        chartBox.x + 40 + ((index % 16) / 15) * Math.max(1, chartBox.width - 80),
        chartBox.y + chartBox.height * (0.3 + ((index % 3) * 0.13)),
      );
    }
    await page.waitForTimeout(350);
    const epsPointerPerf = await page.evaluate(() => window.ThinkStockE2E.getPerformanceApi().summary());
    expect(epsPointerPerf.pointerMoves).toBeGreaterThanOrEqual(DESKTOP_PERF_BUDGET.minPointerMoves);
    expect(epsPointerPerf.p95PointerMove).toBeLessThan(DESKTOP_PERF_BUDGET.maxP95PointerMove);

    const dragTarget = await page.locator("#chart").evaluate((element) => {
      const trace = (element.data || []).find((candidate) => candidate?.meta?.overlayKind === "eps");
      const [rangeStart, rangeEnd] = (element._fullLayout?.xaxis?.range || []).map(Date.parse);
      const rangeMidpoint = (rangeStart + rangeEnd) / 2;
      const pointIndex = (trace?.x || []).reduce((bestIndex, date, index) => {
        const time = Date.parse(date);
        if (!Number.isFinite(time) || time < rangeStart || time > rangeEnd) return bestIndex;
        if (bestIndex < 0) return index;
        return Math.abs(time - rangeMidpoint)
          < Math.abs(Date.parse(trace.x[bestIndex]) - rangeMidpoint)
          ? index
          : bestIndex;
      }, -1);
      if (!trace || pointIndex < 0) return null;
      const rect = element.getBoundingClientRect();
      const xa = element._fullLayout.xaxis;
      const ya = element._fullLayout.yaxis;
      return {
        x: rect.left + xa._offset + xa.d2p(trace.x[pointIndex]),
        y: rect.top + ya._offset + ya.l2p(trace.y[pointIndex]),
        before: trace.y[pointIndex],
        pointIndex,
      };
    });
    expect(dragTarget).not.toBeNull();
    await expect.poll(() => page.evaluate((target) => (
      window.ThinkStockE2E.getLineDragTargetAt(target.x, target.y)
    ), dragTarget)).toMatchObject({ seriesKey: "eps:218410.KQ" });
    const generationBeforeEpsDrag = await page.evaluate(() => (
      window.ThinkStockE2E.getChartRenderGeneration()
    ));
    await page.mouse.move(dragTarget.x, dragTarget.y);
    await page.mouse.down();
    await page.mouse.move(dragTarget.x, dragTarget.y + 28, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => page.locator("#chart").evaluate((element, target) => {
      const trace = (element.data || []).find((candidate) => candidate?.meta?.overlayKind === "eps");
      return Math.abs(Number(trace?.y?.[target.pointIndex]) - Number(target.before));
    }, dragTarget)).toBeGreaterThan(0.1);
    expect(await page.evaluate(() => window.ThinkStockE2E.getChartRenderGeneration()))
      .toBe(generationBeforeEpsDrag);

    await page.locator('[data-series="218410.KQ"]').click();
    await page.locator('[data-series="218410.KQ"]').click();
    await expect.poll(() => page.evaluate(() => (
      window.ThinkStockE2E.getSeriesTransforms()
    ))).toEqual({ offsets: {}, scales: {} });
    await expect.poll(() => page.locator("#chart").evaluate((element, target) => {
      const trace = (element.data || []).find((candidate) => candidate?.meta?.overlayKind === "eps");
      return Math.abs(Number(trace?.y?.[target.pointIndex]) - Number(target.before));
    }, dragTarget)).toBeLessThan(0.1);
  }

  await page.locator("#epsToggle").click();
  await expect(page.locator("#epsToggle")).not.toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "eps").length
  ))).toBe(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const actualEnd = Date.parse(element._fullLayout.xaxis.range[1]);
    const observedEnd = Math.max(...(element.data || [])
      .filter((trace) => trace?.meta?.seriesKey === "218410.KQ"
        && trace?.meta?.overlayKind !== "eps"
        && trace?.meta?.overlayKind !== "ai-scenario")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite));
    return Math.abs(actualEnd - observedEnd);
  })).toBeLessThanOrEqual(86400000);

  const quickPresetExpectation = await page.locator("#chart").evaluate((element) => {
    const observedEnd = Math.max(...(element.data || [])
      .filter((trace) => trace?.meta?.seriesKey === "218410.KQ"
        && trace?.meta?.overlayKind !== "eps"
        && trace?.meta?.overlayKind !== "ai-scenario")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite));
    const start = new Date(observedEnd);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return { start: start.getTime(), observedEnd };
  });
  await page.locator("#chartRange1Year").click();
  await page.locator("#epsToggle").click();
  await expect(page.locator("#epsToggle")).toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const epsEnd = Math.max(...(element.data || [])
      .filter((trace) => trace?.meta?.overlayKind === "eps")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite));
    return {
      startPreserved: Math.abs(range[0] - expected.start) <= 86400000,
      futureVisible: Number.isFinite(epsEnd) && range[1] >= epsEnd,
    };
  }, quickPresetExpectation), { timeout: 30000 }).toEqual({
    startPreserved: true,
    futureVisible: true,
  });
  await page.locator("#epsToggle").click();
  await expect(page.locator("#epsToggle")).not.toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return {
      startRestored: Math.abs(range[0] - expected.start) <= 86400000,
      endRestored: Math.abs(range[1] - expected.observedEnd) <= 86400000,
    };
  }, quickPresetExpectation)).toEqual({ startRestored: true, endRestored: true });

  const futureOverlayState = () => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const traceEnd = (predicate) => Math.max(...(element.data || [])
      .filter(predicate)
      .flatMap((trace) => (trace.x || []).map(Date.parse).filter(Number.isFinite)));
    return {
      range,
      aiCount: (element.data || []).filter((trace) => trace?.meta?.overlayKind === "ai-scenario").length,
      epsCount: (element.data || []).filter((trace) => trace?.meta?.overlayKind === "eps").length,
      aiEnd: traceEnd((trace) => trace?.meta?.overlayKind === "ai-scenario"),
      epsEnd: traceEnd((trace) => trace?.meta?.overlayKind === "eps"),
    };
  });
  const preservesHistoryAndFuture = (state, historyStart, futureEnd) => (
    Math.abs(state.range[0] - historyStart) <= 86400000
    && Number.isFinite(futureEnd)
    && state.range[1] >= futureEnd
  );

  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastToggle")).toHaveClass(/is-active/);
  await expect.poll(async () => (await futureOverlayState()).aiCount, { timeout: 30000 }).toBeGreaterThan(0);
  const aiOnly = await futureOverlayState();
  expect(preservesHistoryAndFuture(aiOnly, quickPresetExpectation.start, aiOnly.aiEnd)).toBe(true);

  await page.locator("#epsToggle").click();
  await expect(page.locator("#epsToggle")).toHaveClass(/is-active/);
  await expect.poll(async () => (await futureOverlayState()).epsCount, { timeout: 30000 }).toBeGreaterThan(0);
  const aiWithEps = await futureOverlayState();
  expect(aiWithEps.aiCount).toBeGreaterThan(0);
  expect(preservesHistoryAndFuture(aiWithEps, aiOnly.range[0], aiWithEps.epsEnd)).toBe(true);

  await page.locator("#epsToggle").click();
  await expect(page.locator("#epsToggle")).not.toHaveClass(/is-active/);
  await expect.poll(async () => (await futureOverlayState()).epsCount).toBe(0);
  const aiAfterEps = await futureOverlayState();
  expect(aiAfterEps.aiCount).toBeGreaterThan(0);
  expect(preservesHistoryAndFuture(aiAfterEps, aiOnly.range[0], aiAfterEps.aiEnd)).toBe(true);

  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastToggle")).not.toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(range[0] - expected.start), Math.abs(range[1] - expected.observedEnd));
  }, quickPresetExpectation)).toBeLessThanOrEqual(86400000);

  await page.locator("#epsToggle").click();
  await expect.poll(async () => (await futureOverlayState()).epsCount, { timeout: 30000 }).toBeGreaterThan(0);
  const epsOnly = await futureOverlayState();
  await page.locator("#aiForecastToggle").click();
  await expect.poll(async () => (await futureOverlayState()).aiCount, { timeout: 30000 }).toBeGreaterThan(0);
  const epsWithAi = await futureOverlayState();
  expect(epsWithAi.epsCount).toBeGreaterThan(0);
  expect(preservesHistoryAndFuture(epsWithAi, epsOnly.range[0], epsWithAi.epsEnd)).toBe(true);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(async () => (await futureOverlayState()).aiCount).toBe(0);
  const epsAfterAi = await futureOverlayState();
  expect(epsAfterAi.epsCount).toBeGreaterThan(0);
  expect(preservesHistoryAndFuture(epsAfterAi, epsOnly.range[0], epsAfterAi.epsEnd)).toBe(true);
  await page.locator("#epsToggle").click();
  await expect.poll(async () => (await futureOverlayState()).epsCount).toBe(0);

  const historicalRange = [Date.parse("2025-12-31"), Date.parse("2026-03-31")];
  await page.evaluate((range) => window.ThinkStockE2E.setViewportRangeForTest(range), historicalRange);
  await page.locator("#epsToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "eps").length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const actual = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  }, historicalRange)).toBeLessThanOrEqual(1000);
  await page.locator("#epsToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "eps").length
  ))).toBe(0);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const actual = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  }, historicalRange)).toBeLessThanOrEqual(1000);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#epsToggle")).not.toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "eps").length
  ))).toBe(0);
});

test("main chart allows more than five visible stocks and indices", async ({ page }) => {
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const visibleMainSeriesCount = () => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.seriesKey
      && trace?.meta?.overlayKind !== "ai-scenario"
      && trace.visible !== "legendonly"
    )).length
  ));

  await page.locator('[data-series="^KQ11"]').click();
  await page.locator('[data-series="customer_deposit"]').click();
  await page.locator('[data-series="kospi_credit"]').click();
  await expect.poll(visibleMainSeriesCount).toBe(4);

  await page.locator('[data-series="kosdaq_credit"]').click();
  await expect(page.locator('[data-series="kosdaq_credit"]')).toHaveClass(/is-on/);
  await expect.poll(visibleMainSeriesCount).toBe(5);

  await page.locator("#stockSearchInput").fill("삼성전자");
  await page.locator(".stock-suggest-item").filter({ hasText: "삼성전자" }).click();
  const samsungToggle = page.locator('[data-series="005930.KS"]');
  await expect(samsungToggle).toBeVisible();
  await expect(samsungToggle).toHaveClass(/is-on/);
  await expect.poll(visibleMainSeriesCount).toBe(6);

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
  await expect.poll(visibleMainSeriesCount).toBe(5);
  await samsungToggle.click();
  await expect(samsungToggle).toHaveClass(/is-off/);
  await expect.poll(visibleMainSeriesCount).toBe(4);

  await samsungToggle.click();
  await expect(samsungToggle).toHaveClass(/is-on/);
  await expect.poll(visibleMainSeriesCount).toBe(5);

  await samsungToggle.click();
  await samsungToggle.click();
  await expect(samsungToggle).toHaveClass(/is-on/);
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

test("main information rows follow activation order and stack long macro values", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      autoChartReset: true,
      hoverShowPopup: true,
      customStocks: [],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, { includeMacroSpreads: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  const hoverState = () => page.locator("#chart").evaluate((element) => {
    const grouped = (element.data || []).filter((trace) => trace?.meta?.overlayKind === "grouped-hover");
    return {
      order: grouped.map((trace) => trace.meta.hoverGroupTicker),
      text: Object.fromEntries(grouped.map((trace) => [
        trace.meta.hoverGroupTicker,
        String(trace.text?.find(Boolean) || ""),
      ])),
    };
  });

  await page.locator('[data-series="^KS11"]').click();
  await waitForChartRenderIdle(page);
  await page.locator('[data-series="leading_cycle"]').click();
  await waitForChartRenderIdle(page);
  await expect.poll(hoverState).toMatchObject({ order: ["^KS11", "leading_cycle"] });
  await expect(page.locator('[data-series="leading_cycle"]')).toHaveAttribute(
    "title",
    "한국은행 선행지수 순환변동치\n공개일 기준",
  );
  await expect(page.locator('[data-series="t10y1y"]')).toHaveAttribute(
    "title",
    "미국채 10년/1년 금리차",
  );
  await expect(page.locator('[data-series="us_credit_spread"]')).toHaveAttribute(
    "title",
    "미국 회사채(투자등급) 1-3년/미국채 3년 금리차\n최근 일별 · 과거 월간",
  );
  for (const series of ["customer_deposit", "kospi_credit", "kosdaq_credit"]) {
    await expect(page.locator(`[data-series="${series}"]`)).toHaveAttribute("title", "2일 후행");
  }
  await expect(page.locator('[data-series="^KS11"]')).not.toHaveAttribute("title", /.+/);
  await expect(page.locator(".credit-offset-wrap")).toHaveAttribute("title", "2일 후행");
  let state = await hoverState();
  expect(state.text["^KS11"]).toContain("</b> · 가격");
  expect(state.text.leading_cycle).toContain("한국 선행지수 순환변동치</b><br>가격");

  await page.locator('[data-series="us_credit_spread"]').click();
  await waitForChartRenderIdle(page);
  state = await hoverState();
  expect(state.text.us_credit_spread).toContain("미국 회사채 3년/국채 3년 금리차</b><br>가격");
  await page.locator('[data-series="us_credit_spread"]').click();
  await waitForChartRenderIdle(page);

  await page.locator('[data-series="^KS11"]').click();
  await page.locator('[data-series="^KS11"]').click();
  await waitForChartRenderIdle(page);
  state = await hoverState();
  expect(state.order).toEqual(["leading_cycle", "^KS11"]);
});

test("main information popup follows the closest price line without reordering rows", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop pointer hover regression");
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      autoChartReset: true,
      hoverShowPopup: true,
      customStocks: [],
      mainHoverSeriesOrder: ["^KS11", "t10y1y"],
      hiddenSeries: [
        "leading_cycle",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, { includeMacroSpreads: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.overlayKind === "grouped-hover")
      .map((trace) => trace.meta.hoverGroupTicker)
  ))).toEqual(["^KS11", "t10y1y"]);

  const target = await page.locator("#chart").evaluate((element) => {
    const traces = Object.fromEntries((element.data || [])
      .filter((trace) => trace?.meta?.overlayKind === "price")
      .map((trace) => [trace.meta.seriesKey, trace]));
    const first = traces["^KS11"];
    const second = traces.t10y1y;
    const rect = element.getBoundingClientRect();
    const xAxis = element._fullLayout.xaxis;
    const yAxis = element._fullLayout.yaxis;
    const secondByDate = new Map(second.x.map((date, index) => [String(date), index]));
    return first.x.reduce((best, date, firstIndex) => {
      const secondIndex = secondByDate.get(String(date));
      if (!Number.isInteger(secondIndex)) return best;
      const localX = Number(xAxis._offset) + Number(xAxis.d2p(date));
      if (localX < Number(xAxis._offset) + 120
        || localX > Number(xAxis._offset) + Number(xAxis._length) - 140) return best;
      const firstLocalY = Number(yAxis._offset) + Number(yAxis.d2p(first.y[firstIndex]));
      const secondLocalY = Number(yAxis._offset) + Number(yAxis.d2p(second.y[secondIndex]));
      const separation = Math.abs(firstLocalY - secondLocalY);
      return separation > Number(best?.separation || -1) ? {
        clientX: rect.left + localX,
        firstClientY: rect.top + firstLocalY,
        secondClientY: rect.top + secondLocalY,
        firstLocalY,
        secondLocalY,
        separation,
      } : best;
    }, null);
  });
  expect(target.separation).toBeGreaterThan(12);

  const hoverAndMeasure = async (clientY) => {
    await page.mouse.move(target.clientX - 3, clientY);
    await page.mouse.move(target.clientX, clientY);
    await expect(page.locator("#chart")).not.toHaveClass(/is-hover-waiting/);
    const popup = page.locator(
      "#chart .hoverlayer > g.legend, #chart .hoverlayer > g.hovertext",
    ).first();
    await expect(popup).toBeVisible({ timeout: 3000 });
    return popup.evaluate((element) => {
      const popupRect = element.getBoundingClientRect();
      return {
        anchorLocalY: Number(element.getAttribute("data-thinkstock-anchor-local-y")),
        popupTop: popupRect.top,
        text: element.textContent || "",
      };
    });
  };

  await expect.poll(() => page.evaluate((point) => (
    window.ThinkStockE2E.getLineDragTargetAt(point.clientX, point.secondClientY)
  ), target)).toMatchObject({ seriesKey: "t10y1y" });
  const secondPopup = await hoverAndMeasure(target.secondClientY);
  expect(Math.abs(secondPopup.anchorLocalY - target.secondLocalY)).toBeLessThan(3);
  expect(Math.abs(secondPopup.popupTop - target.secondClientY))
    .toBeLessThan(Math.abs(secondPopup.popupTop - target.firstClientY));
  expect(secondPopup.text.indexOf("코스피")).toBeLessThan(
    secondPopup.text.indexOf("미국채 10년/1년 금리차"),
  );

  const pointerOffset = Math.min(6, target.separation / 4);
  const offsetPopup = await hoverAndMeasure(target.secondClientY + pointerOffset);
  expect(Math.abs(
    offsetPopup.anchorLocalY - (target.secondLocalY + pointerOffset),
  )).toBeLessThan(3);

  await expect.poll(() => page.evaluate((point) => (
    window.ThinkStockE2E.getLineDragTargetAt(point.clientX, point.firstClientY)
  ), target)).toMatchObject({ seriesKey: "^KS11" });
  const firstPopup = await hoverAndMeasure(target.firstClientY);
  expect(Math.abs(firstPopup.anchorLocalY - target.firstLocalY)).toBeLessThan(3);
  expect(Math.abs(firstPopup.popupTop - target.firstClientY))
    .toBeLessThan(Math.abs(firstPopup.popupTop - target.secondClientY));
});

test("auto scale fits every active macro line before and after a fifth series joins", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      autoChartReset: true,
      showChartHandles: true,
      customStocks: [],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, { includeMacroSpreads: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  const fitState = () => page.locator("#chart").evaluate((element) => {
    const [xStart, xEnd] = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const low = Math.min(...yRange);
    const high = Math.max(...yRange);
    const visibleSeries = new Set();
    const values = [];
    (element.data || []).forEach((trace) => {
      if (!trace?.meta?.seriesKey
        || !Number.isFinite(trace?.meta?.sourcePointCount)
        || trace.visible === "legendonly"
        || !String(trace.mode || "").includes("lines")) return;
      visibleSeries.add(trace.meta.seriesKey);
      (trace.x || []).forEach((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        if (time >= xStart && time <= xEnd && Number.isFinite(value)) values.push(value);
      });
    });
    const dataLow = values.length ? Math.min(...values) : NaN;
    const dataHigh = values.length ? Math.max(...values) : NaN;
    const axisSpan = high - low;
    const chartRect = element.getBoundingClientRect();
    const handles = [...document.querySelectorAll(".y-handle-left, .y-handle-right")]
      .filter((handle) => visibleSeries.has(handle.dataset.seriesKey))
      .filter((handle) => getComputedStyle(handle).display !== "none");
    const handlesInside = handles.every((handle) => {
      const rect = handle.getBoundingClientRect();
      return rect.top >= chartRect.top - 2 && rect.bottom <= chartRect.bottom + 2;
    });
    return {
      handlesInside,
      handleCount: handles.length,
      inside: values.length > 0 && dataLow >= low && dataHigh <= high,
      series: [...visibleSeries].sort(),
      utilization: axisSpan > 0 ? (dataHigh - dataLow) / axisSpan : 0,
    };
  });

  const enabledSeries = [];
  for (const series of ["leading_cycle", "t10y1y", "us_credit_spread", "customer_deposit"]) {
    await page.locator(`[data-series="${series}"]`).click();
    await waitForChartRenderIdle(page);
    enabledSeries.push(series);
    await expect.poll(fitState).toMatchObject({
      handlesInside: true,
      inside: true,
      series: [...enabledSeries].sort(),
    });
    const state = await fitState();
    expect(state.handleCount).toBeGreaterThanOrEqual(enabledSeries.length);
    expect(state.utilization).toBeGreaterThan(0.7);
  }

  await page.locator('[data-series="^KS11"]').click();
  await waitForChartRenderIdle(page);
  await expect.poll(fitState).toMatchObject({
    handlesInside: true,
    inside: true,
    series: ["^KS11", "customer_deposit", "leading_cycle", "t10y1y", "us_credit_spread"],
  });
  expect((await fitState()).handleCount).toBeGreaterThanOrEqual(5);
  expect((await fitState()).utilization).toBeGreaterThan(0.7);
});

test("auto scale keeps every macro line fitted when a stock is added later", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      autoChartReset: true,
      customStocks: [],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, { includeMacroSpreads: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  const macroSeries = ["leading_cycle", "t10y1y", "us_credit_spread", "customer_deposit"];
  for (const series of macroSeries) {
    await page.locator(`[data-series="${series}"]`).click();
    await waitForChartRenderIdle(page);
  }

  await page.locator("#stockSearchInput").fill("삼성전자");
  await page.locator(".stock-suggest-item").filter({ hasText: "삼성전자" }).click();
  await expect(page.locator('[data-series="005930.KS"]')).toHaveClass(/is-on/);
  await waitForChartRenderIdle(page);

  const expectedSeries = [...macroSeries, "005930.KS"];
  const fitState = () => page.locator("#chart").evaluate((element, seriesKeys) => {
    const [xStart, xEnd] = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const axisSpan = Math.abs(yRange[1] - yRange[0]);
    const utilization = Object.fromEntries(seriesKeys.map((seriesKey) => {
      const trace = (element.data || []).find((item) => (
        item?.meta?.seriesKey === seriesKey
          && Number.isFinite(item?.meta?.sourcePointCount)
          && String(item.mode || "").includes("lines")
          && item.visible !== "legendonly"
      ));
      const values = (trace?.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace?.y?.[index]);
        return time >= xStart && time <= xEnd && Number.isFinite(value) ? [value] : [];
      });
      const span = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
      return [seriesKey, axisSpan > 0 ? span / axisSpan : 0];
    }));
    return {
      series: [...new Set((element.data || [])
        .filter((trace) => (
          trace?.meta?.seriesKey
          && Number.isFinite(trace?.meta?.sourcePointCount)
          && trace.visible !== "legendonly"
          && String(trace.mode || "").includes("lines")
        ))
        .map((trace) => trace.meta.seriesKey))].sort(),
      utilization,
    };
  }, expectedSeries);

  await expect.poll(async () => (await fitState()).series).toEqual([...expectedSeries].sort());
  await expect.poll(async () => Math.min(...Object.values((await fitState()).utilization)), {
    timeout: 5000,
  }).toBeGreaterThan(0.55);
});

test("auto scale gives quiet and multibagger stocks equal visual height", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      autoChartReset: true,
      customStocks: [
        { ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" },
        { ticker: "000660.KS", code: "000660", name: "SK하이닉스", market: "KOSPI" },
      ],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, {
    payloadOverrides: {
      "prices_recent.json": columnar(
        ["^KS11", "^KQ11", "005930.KS", "000660.KS"],
        recentDates,
        {
          "^KS11": [2800, 2900, 3000, 3100, 3200],
          "^KQ11": [780, 800, 820, 840, 860],
          "005930.KS": [90, 80, 85, 110, 100],
          "000660.KS": [9, 20, 45, 75, 100],
        },
      ),
    },
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await waitForChartRenderIdle(page);

  await expect.poll(async () => Math.min(
    await visibleTracePixelSpan(page, "005930.KS"),
    await visibleTracePixelSpan(page, "000660.KS"),
  )).toBeGreaterThan(100);
  const quietSpan = await visibleTracePixelSpan(page, "005930.KS");
  const multibaggerSpan = await visibleTracePixelSpan(page, "000660.KS");
  const verticalRanges = await page.locator("#chart").evaluate((element) => Object.fromEntries(
    ["005930.KS", "000660.KS"].map((seriesKey) => {
      const trace = (element.data || []).find((item) => (
        item?.meta?.seriesKey === seriesKey
          && Number.isFinite(item?.meta?.sourcePointCount)
          && String(item.mode || "").includes("lines")
      ));
      const values = (trace?.y || []).filter(Number.isFinite);
      return [seriesKey, [Math.min(...values), Math.max(...values)]];
    }),
  ));
  expect(quietSpan).toBeGreaterThan(100);
  expect(multibaggerSpan).toBeGreaterThan(100);
  expect(Math.abs(quietSpan - multibaggerSpan)).toBeLessThan(3);
  expect(Math.abs(verticalRanges["005930.KS"][0] - verticalRanges["000660.KS"][0])).toBeLessThan(0.02);
  expect(Math.abs(verticalRanges["005930.KS"][1] - verticalRanges["000660.KS"][1])).toBeLessThan(0.02);
});

test("auto scale keeps its live macro fit after historical panning ends", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse viewport fitting is covered on desktop.");
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks: [],
      showDisclosures: false,
      showInsiderTrades: false,
      showRecessionSignals: false,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, { includeMacroSpreads: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await waitForChartRenderIdle(page);

  const series = ["leading_cycle", "t10y1y", "us_credit_spread"];
  for (const key of series) {
    await page.locator(`[data-series="${key}"]`).click();
    await waitForChartRenderIdle(page);
  }
  await page.evaluate(() => globalThis.ThinkStockE2E.setActiveMonthsForTest(6));
  await waitForChartRenderIdle(page);

  const initialStart = await page.locator("#chart").evaluate((element) => (
    Date.parse(element._fullLayout.xaxis.range[0])
  ));
  const drag = await page.locator("#chart").evaluate(async (element) => {
    await globalThis.Plotly.relayout(element, {
      "yaxis.range[0]": -10000,
      "yaxis.range[1]": 10000,
      "yaxis.autorange": false,
    });
    const rect = element.getBoundingClientRect();
    const xAxis = element._fullLayout.xaxis;
    const yAxis = element._fullLayout.yaxis;
    const startX = rect.left + xAxis._offset + xAxis._length * 0.25;
    const blankY = [0.9, 0.8, 0.7, 0.3, 0.2]
      .map((ratio) => rect.top + yAxis._offset + yAxis._length * ratio)
      .find((clientY) => !globalThis.ThinkStockE2E.getLineDragTargetAt(startX, clientY));
    return {
      startX,
      endX: rect.left + xAxis._offset + xAxis._length * 0.85,
      y: blankY ?? (rect.top + yAxis._offset + yAxis._length * 0.95),
    };
  });
  await page.mouse.move(drag.startX, drag.y);
  await page.mouse.down();
  await expect(page.locator("#chart")).toHaveClass(/is-viewport-panning/);
  await page.mouse.move(drag.endX, drag.y, { steps: 8 });
  await expect.poll(() => page.locator("#chart").evaluate((element, previousStart) => ({
    moved: Date.parse(element._fullLayout.xaxis.range[0]) < previousStart,
    fitted: Math.abs(
      Number(element._fullLayout.yaxis.range[1]) - Number(element._fullLayout.yaxis.range[0]),
    ) < 20000,
  }), initialStart)).toEqual({ moved: true, fitted: true });
  const duringDrag = await page.locator("#chart").evaluate((element) => ({
    start: Date.parse(element._fullLayout.xaxis.range[0]),
    ySpan: Math.abs(
      Number(element._fullLayout.yaxis.range[1]) - Number(element._fullLayout.yaxis.range[0]),
    ),
  }));
  expect(duringDrag.start).toBeLessThan(initialStart);
  expect(duringDrag.ySpan).toBeLessThan(20000);
  await page.mouse.up();

  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element._fullLayout.xaxis.range[0])
  ))).toBeLessThan(initialStart);
  await page.waitForTimeout(350);
  const afterRelease = await page.locator("#chart").evaluate((element) => ({
    start: Date.parse(element._fullLayout.xaxis.range[0]),
    ySpan: Math.abs(
      Number(element._fullLayout.yaxis.range[1]) - Number(element._fullLayout.yaxis.range[0]),
    ),
  }));
  expect(afterRelease.start).toBeLessThan(initialStart);
  expect(afterRelease.ySpan).toBeCloseTo(duringDrag.ySpan, 3);
  const seriesUtilization = () => page.locator("#chart").evaluate((element, keys) => {
    const [xStart, xEnd] = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const axisSpan = Math.abs(yRange[1] - yRange[0]);
    return Object.fromEntries(keys.map((key) => {
      const trace = (element.data || []).find((item) => (
        item?.meta?.seriesKey === key
          && Number.isFinite(item?.meta?.sourcePointCount)
          && String(item.mode || "").includes("lines")
      ));
      const values = (trace?.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace?.y?.[index]);
        return time >= xStart && time <= xEnd && Number.isFinite(value) ? [value] : [];
      });
      const span = values.length >= 2 ? Math.max(...values) - Math.min(...values) : 0;
      return [key, axisSpan > 0 ? span / axisSpan : 0];
    }));
  }, series);
  await expect.poll(async () => Math.min(...Object.values(await seriesUtilization())), {
    timeout: 5000,
  }).toBeGreaterThan(0.25);

  await page.locator("#chartJumpLatest").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element.classList.contains("is-viewport-panning")
  ))).toBe(false);
  await waitForChartRenderIdle(page);
  await expect.poll(async () => Math.min(...Object.values(await seriesUtilization())), {
    timeout: 5000,
  }).toBeGreaterThan(0.25);
});

test("repeated historical panning never leaves the visible main window without line data", async ({ page, isMobile }) => {
  test.skip(isMobile, "Repeated mouse panning is covered on desktop.");
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks: [],
      showDisclosures: false,
      showInsiderTrades: false,
      showRecessionSignals: false,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, { includeMacroSpreads: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  const expectedSeries = ["leading_cycle", "t10y1y", "us_credit_spread"];
  for (const key of expectedSeries) {
    await page.locator(`[data-series="${key}"]`).click();
    await waitForChartRenderIdle(page);
  }
  await page.locator("#chartRange6Months").click();
  await waitForChartRenderIdle(page);
  const readVisibleState = () => page.locator("#chart").evaluate((element, keys) => {
    const xRange = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const visibleCounts = Object.fromEntries(keys.map((key) => {
      const trace = (element.data || []).find((item) => (
        item?.meta?.seriesKey === key
        && Number.isFinite(item?.meta?.sourcePointCount)
        && String(item.mode || "").includes("lines")
      ));
      const count = (trace?.x || []).reduce((total, date, index) => {
        const timestamp = Date.parse(date);
        return total + Number(
          timestamp >= xRange[0]
          && timestamp <= xRange[1]
          && Number.isFinite(Number(trace?.y?.[index])),
        );
      }, 0);
      return [key, count];
    }));
    return { visibleCounts, xRange, yRange };
  }, expectedSeries);
  const expectVisibleState = async () => {
    const state = await readVisibleState();
    expect(state.xRange.every(Number.isFinite)).toBe(true);
    expect(state.yRange.every(Number.isFinite)).toBe(true);
    expect(Math.min(...Object.values(state.visibleCounts))).toBeGreaterThan(0);
  };

  for (let pass = 0; pass < 6; pass += 1) {
    const drag = await page.locator("#chart").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const xAxis = element._fullLayout.xaxis;
      const yAxis = element._fullLayout.yaxis;
      const startX = rect.left + xAxis._offset + xAxis._length * 0.25;
      const blankY = [0.92, 0.82, 0.72, 0.28, 0.18]
        .map((ratio) => rect.top + yAxis._offset + yAxis._length * ratio)
        .find((clientY) => !globalThis.ThinkStockE2E.getLineDragTargetAt(startX, clientY));
      return {
        startX,
        endX: rect.left + xAxis._offset + xAxis._length * 0.86,
        y: blankY ?? (rect.top + yAxis._offset + yAxis._length * 0.95),
      };
    });
    await page.mouse.move(drag.startX, drag.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      const x = drag.startX + ((drag.endX - drag.startX) * step) / 8;
      await page.mouse.move(x, drag.y);
      await page.waitForTimeout(16);
      await expectVisibleState();
    }
    await page.mouse.up();
    // Inspect the next visible frame rather than waiting for a background
    // viewport-window rebuild to hide a transient blank chart.
    await page.waitForTimeout(32);

    await expectVisibleState();
  }
  await waitForChartRenderIdle(page);
});

test("historical panning refits series whose volatility regimes reverse", async ({ page, isMobile }) => {
  test.skip(isMobile, "Repeated mouse panning is covered on desktop.");
  const dates = Array.from({ length: 132 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, 1 + (index * 7)));
    return date.toISOString().slice(0, 10);
  });
  const values = dates.map((_, index) => {
    const wave = Math.sin(index * 0.72);
    const recent = index >= 92;
    return {
      kospi: 1000 + (wave * (recent ? 260 : 6)),
      kosdaq: 1000 + (wave * (recent ? 6 : 260)),
    };
  });
  const split = 88;
  const payload = (range) => columnar(
    ["^KS11", "^KQ11"],
    range.map((index) => dates[index]),
    {
      "^KS11": range.map((index) => values[index].kospi),
      "^KQ11": range.map((index) => values[index].kosdaq),
    },
  );
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks: [],
      showDisclosures: false,
      showInsiderTrades: false,
      showRecessionSignals: false,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page, {
    payloadOverrides: {
      "prices_history.json": payload(Array.from({ length: split }, (_, index) => index)),
      "prices_recent.json": payload(Array.from(
        { length: dates.length - split },
        (_, index) => index + split,
      )),
    },
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await waitForChartRenderIdle(page);
  await page.locator("#chartRange6Months").click();
  await waitForChartRenderIdle(page);

  const readVisibleFit = () => page.locator("#chart").evaluate((element, keys) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    const yRange = element._fullLayout.yaxis.range.map(Number);
    const axisSpan = Math.abs(yRange[1] - yRange[0]);
    return Object.fromEntries(keys.map((key) => {
      const trace = (element.data || []).find((item) => item?.meta?.seriesKey === key);
      const visible = (trace?.x || []).flatMap((date, index) => {
        const timestamp = Date.parse(date);
        const value = Number(trace?.y?.[index]);
        return timestamp >= start && timestamp <= end && Number.isFinite(value) ? [value] : [];
      });
      const span = visible.length > 1 ? Math.max(...visible) - Math.min(...visible) : 0;
      return [key, axisSpan > 0 ? span / axisSpan : 0];
    }));
  }, ["^KS11", "^KQ11"]);

  for (let pass = 0; pass < 3; pass += 1) {
    const drag = await page.locator("#chart").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const xAxis = element._fullLayout.xaxis;
      const yAxis = element._fullLayout.yaxis;
      const startX = rect.left + xAxis._offset + (xAxis._length * 0.25);
      return {
        startX,
        endX: rect.left + xAxis._offset + (xAxis._length * 0.85),
        // Start in the plot's top margin so a late auto-fit cannot move a line
        // under the pointer and turn this viewport gesture into a line drag.
        y: rect.top + Math.max(4, yAxis._offset - 10),
      };
    });
    if (pass === 0) {
      await page.locator("#chart").evaluate((element) => {
        element.addEventListener("pointerdown", (event) => {
          globalThis.__thinkstockTestPointerId = event.pointerId;
        }, { capture: true, once: true });
      });
    }
    await page.mouse.move(drag.startX, drag.y);
    await page.mouse.down();
    await expect(page.locator("#chart")).toHaveClass(/is-viewport-panning/);
    await page.mouse.move(drag.endX, drag.y, { steps: 10 });
    if (pass === 0) {
      await page.evaluate(({ clientX, clientY }) => {
        globalThis.dispatchEvent(new PointerEvent("pointercancel", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          isPrimary: true,
          pointerId: globalThis.__thinkstockTestPointerId,
          pointerType: "mouse",
        }));
      }, { clientX: drag.endX, clientY: drag.y });
      await page.mouse.up();
      await expect(page.locator("#chart")).not.toHaveClass(/is-viewport-panning/);
    } else {
      await page.mouse.up();
    }
    await waitForChartRenderIdle(page);
    const fitted = await readVisibleFit();
    expect(Math.min(...Object.values(fitted))).toBeGreaterThan(0.25);
  }

  await page.locator("#chartJumpLatest").click();
  await expect(page.locator("#chart")).toHaveClass(/is-viewport-panning/);
  await expect(page.locator("#chart")).not.toHaveClass(/is-viewport-panning/);
  await waitForChartRenderIdle(page);
  const latestFit = await readVisibleFit();
  expect(Math.min(...Object.values(latestFit))).toBeGreaterThan(0.25);
});

test("ten visible stocks remain interactive and the eleventh starts disabled", async ({ page }) => {
  const stocks = Array.from({ length: 10 }, (_, index) => {
    const code = String(100001 + index).padStart(6, "0");
    return { ticker: `${code}.KS`, code, name: `테스트종목${index + 1}`, market: "KOSPI" };
  });
  await page.addInitScript((customStocks) => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  }, stocks);
  await installDataRoutes(page);
  await page.unroute("**/api/prices?*");
  await page.route("**/api/prices?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    const base = 10000 + Number(ticker.slice(0, 6));
    await route.fulfill({ json: {
      ok: true,
      ticker,
      source: "KRX",
      latestDate: recentDates.at(-1),
      historyCoverage: "full",
      records: recentDates.map((date, index) => ({
        date,
        close: base + (index * 100),
        volume: 100000 + index,
      })),
    } });
  });
  await page.unroute("https://query2.finance.yahoo.com/**");
  await page.route("https://query2.finance.yahoo.com/**", async (route) => {
    const ticker = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() || "");
    const base = 10000 + Number(ticker.slice(0, 6));
    await route.fulfill({ json: {
      chart: { result: [{
        meta: { gmtoffset: 0 },
        timestamp: recentDates.map((date) => Date.parse(`${date}T00:00:00Z`) / 1000),
        indicators: { quote: [{
          close: recentDates.map((_, index) => base + (index * 100)),
          volume: recentDates.map((_, index) => 100000 + index),
        }] },
      }] },
    } });
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const visibleStockCount = () => page.locator("#chart").evaluate((element) => (
    new Set((element.data || [])
      .filter((trace) => /^\d{6}\.(KS|KQ)$/.test(trace?.meta?.seriesKey || "")
        && trace.visible !== "legendonly"
        && trace?.meta?.overlayKind !== "ai-scenario")
      .map((trace) => trace.meta.seriesKey)).size
  ));
  await expect.poll(visibleStockCount, { timeout: 20000 }).toBe(10);

  const firstToggle = page.locator(`[data-series="${stocks[0].ticker}"]`);
  await firstToggle.click();
  await expect.poll(visibleStockCount).toBe(9);
  await firstToggle.click();
  await expect.poll(visibleStockCount).toBe(10);

  await page.locator("#stockSearchInput").fill("SK하이닉스");
  await page.locator(".stock-suggest-item").filter({ hasText: "SK하이닉스" }).click();
  await expect(page.locator('[data-series="000660.KS"]')).toHaveClass(/is-off/);
  await expect(page.locator("#chartNavigationMessage")).toHaveText("최대 10개 까지만 추가됩니다.");
  await expect.poll(visibleStockCount).toBe(10);
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
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({ showRecessionSignals: false }));
  });
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

test("the first series enabled after an all-off state restores its price and viewport", async ({ page, isMobile }) => {
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks: [],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
      showDisclosures: false,
      showInsiderTrades: false,
      showRecessionSignals: false,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const visiblePriceKeys = () => page.locator("#chart").evaluate((element) => (
    (element.data || []).flatMap((trace) => (
      trace?.meta?.overlayKind === "price"
        && trace.visible !== "legendonly"
        && (trace.x || []).length
        ? [trace.meta.seriesKey]
        : []
    ))
  ));
  await expect.poll(visiblePriceKeys).toEqual(["^KS11", "^KQ11"]);

  await page.locator('.series-toggle-btn[data-series="^KS11"]').click();
  await page.locator('.series-toggle-btn[data-series="^KQ11"]').click();
  await expect.poll(visiblePriceKeys).toEqual([]);
  await waitForChartRenderIdle(page);
  await page.locator("#chart").evaluate(async (element) => {
    await globalThis.Plotly.relayout(element, {
      "xaxis.range": ["1990-01-01", "1990-07-01"],
      "yaxis.range": [5000, 6000],
    });
  });

  await page.locator('.series-toggle-btn[data-series="^KS11"]').click();
  await expect.poll(async () => {
    const state = await page.locator("#chart").evaluate((element) => {
      const trace = (element.data || []).find((item) => (
        item?.meta?.overlayKind === "price" && item.meta.seriesKey === "^KS11"
      ));
      const range = element?._fullLayout?.xaxis?.range?.map(Date.parse) || [];
      const yRange = element?._fullLayout?.yaxis?.range?.map(Number) || [];
      const points = (trace?.x || []).map(Date.parse).filter(Number.isFinite);
      const visibleValues = (trace?.y || []).filter((value, index) => (
        Number.isFinite(Number(value))
        && Number.isFinite(points[index])
        && points[index] >= range[0]
        && points[index] <= range[1]
      )).map(Number);
      return {
        visible: trace?.visible !== "legendonly" && points.length > 0,
        overlapsViewport: range.length === 2
          && points.some((value) => value >= range[0] && value <= range[1]),
        spanDays: range.length === 2 ? Math.round((range[1] - range[0]) / 86400000) : 0,
        fitsScale: yRange.length === 2 && visibleValues.length > 0
          && Math.min(...visibleValues) >= Math.min(...yRange)
          && Math.max(...visibleValues) <= Math.max(...yRange),
      };
    });
    return state;
  }).toEqual({
    visible: true,
    overlapsViewport: true,
    spanDays: isMobile ? 181 : 365,
    fitsScale: true,
  });
  expect(await page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(isMobile ? 6 : 12);
});

test("adding a fresher stock advances a stale credit viewport that was at its latest edge", async ({ page }) => {
  await installDataRoutes(page, { staleCreditTail: true });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator('[data-series="customer_deposit"]').click();
  await page.locator('[data-series="kospi_credit"]').click();
  await waitForChartRenderIdle(page);
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
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const stock = (element.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    const range = (element._fullLayout?.xaxis?.range || []).map(Date.parse);
    const latest = Math.max(...(stock?.x || []).map(Date.parse).filter(Number.isFinite));
    return {
      endsAtStockLatest: Math.abs(range[1] - latest) <= 1000,
      spanMs: Math.round(range[1] - range[0]),
    };
  })).toEqual({
    endsAtStockLatest: true,
    spanMs: staleViewport.span,
  });
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
      statusFollowsTools: status?.parentElement === tools,
      statusRight: statusRect.right,
    } : null;
  });
  expect(rangeControlLayout?.buttonTops?.[0]).toBeGreaterThanOrEqual(rangeControlLayout?.refreshBottom || 0);
  expect(rangeControlLayout?.buttonTops?.slice(1).every((top, index) => (
    top >= rangeControlLayout.buttonBottoms[index]
  ))).toBe(true);
  expect(rangeControlLayout?.rightSpread).toBeLessThanOrEqual(1);
  expect(rangeControlLayout?.contentFits).toBe(true);
  expect(rangeControlLayout?.statusFollowsTools).toBe(true);
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
  const paddingBaseline = await page.locator("#chart").evaluate((element) => ({
    xRange: (element._fullLayout?.xaxis?.range || []).map(Date.parse),
    yRange: [...(element._fullLayout?.yaxis?.range || [])].map(Number),
  }));
  await page.locator("#chartRightPaddingIncrease").evaluate((button) => {
    for (let index = 0; index < 10; index += 1) button.click();
  });
  await expect(page.locator("#chartRightPaddingValue")).toHaveText("10");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element._fullLayout?.xaxis?.range || []).map(Date.parse)
  ))).toEqual([
    paddingBaseline.xRange[0],
    paddingBaseline.xRange[1] + (10 * 24 * 60 * 60 * 1000),
  ]);
  const paddedViewport = await page.locator("#chart").evaluate((element) => ({
    yRange: [...(element._fullLayout?.yaxis?.range || [])].map(Number),
  }));
  expect(paddedViewport.yRange).toHaveLength(paddingBaseline.yRange.length);
  paddedViewport.yRange.forEach((value, index) => {
    expect(Math.abs(value - paddingBaseline.yRange[index])).toBeLessThan(0.001);
  });
  await page.locator("#chartRightPaddingIncrease").evaluate((button) => {
    for (let index = 0; index < 25; index += 1) button.click();
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
  await waitForChartRenderIdle(page);
  await page.evaluate(() => window.ThinkStockE2E.applyNewsSentimentForTest([
    { date: "2026-07-14", news_sentiment: 101 },
  ]));
  const oneDayNewsAverage = page.locator('[data-news-sentiment-average-days="1"]');
  await expect(oneDayNewsAverage).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => oneDayNewsAverage.evaluate((button) => {
    const hitArea = button.getBoundingClientRect();
    const circle = button.querySelector("span")?.getBoundingClientRect();
    return {
      hitAreaReady: hitArea.width >= 28,
      circleReady: (circle?.width || 0) > 0,
      circleInsideHitArea: (circle?.width || 0) < hitArea.width,
    };
  })).toEqual({
    hitAreaReady: true,
    circleReady: true,
    circleInsideHitArea: true,
  });
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
  await waitForChartRenderIdle(page);

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
    return ["resetHandles", "coMovementToggle", "insiderTradeToggle", "disclosureToggle", "recessionToggle", "epsToggle", "aiForecastToggle"].map((id) => {
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
  await waitForChartRenderIdle(page);
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
  await waitForChartRenderIdle(page);
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
  // A fast frame can already reach the latest boundary before this sample.
  expect(middleEnd).toBeLessThanOrEqual(prepared.dataEnd);

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
    const visibleLines = (element.data || []).filter((trace) => (
      trace?.meta?.seriesKey
      && trace.visible !== "legendonly"
      && String(trace.mode || "").includes("lines")
      && trace?.meta?.overlayKind !== "ai-scenario"
      && !String(trace?.meta?.seriesKey || "").startsWith("eps:")
    ));
    const counts = visibleLines.map((trace) => (trace.x || []).reduce((count, date, index) => {
        const timestamp = Date.parse(date);
        const value = Number(trace.y?.[index]);
        return count + (timestamp >= start && timestamp <= end && Number.isFinite(value) ? 1 : 0);
      }, 0));
    const values = visibleLines.flatMap((trace) => (trace.x || []).flatMap((date, index) => {
      const timestamp = Date.parse(date);
      const value = Number(trace.y?.[index]);
      return timestamp >= start && timestamp <= end && Number.isFinite(value) ? [value] : [];
    }));
    const dataSpan = values.length ? Math.max(...values) - Math.min(...values) : 0;
    const axisSpan = Math.abs(element._fullLayout.yaxis.range[1] - element._fullLayout.yaxis.range[0]);
    return {
      allVisible: visibleLines.length > 0 && counts.every((count) => count > 0),
      fill: axisSpan > 0 ? dataSpan / axisSpan : 0,
    };
  })).toEqual({ allVisible: true, fill: expect.any(Number) });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    const values = (element.data || []).flatMap((trace) => (trace.x || []).flatMap((date, index) => {
      const timestamp = Date.parse(date);
      const value = Number(trace.y?.[index]);
      return timestamp >= start && timestamp <= end && Number.isFinite(value) ? [value] : [];
    }));
    const axisSpan = Math.abs(element._fullLayout.yaxis.range[1] - element._fullLayout.yaxis.range[0]);
    return axisSpan > 0 && values.length ? (Math.max(...values) - Math.min(...values)) / axisSpan : 0;
  })).toBeGreaterThan(0.5);
  const latestReleasedYRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.range.map(Number)
  ));
  await waitForChartRenderIdle(page);
  await page.waitForTimeout(250);
  const latestSettledYRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.range.map(Number)
  ));
  const latestReleasedSpan = Math.max(1, Math.abs(latestReleasedYRange[1] - latestReleasedYRange[0]));
  expect(Math.max(
    Math.abs(latestSettledYRange[0] - latestReleasedYRange[0]),
    Math.abs(latestSettledYRange[1] - latestReleasedYRange[1]),
  ) / latestReleasedSpan).toBeLessThan(0.005);
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
    const hoverToggle = page.locator("#hoverToggle");
    if (await hoverToggle.getAttribute("aria-pressed") !== "true") await hoverToggle.click();
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
    const doubleTap = async (firstPointerId, point = initial) => page.locator("#chart").evaluate((element, args) => {
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
    }, { point, firstPointerId });
    await doubleTap(101);
    await expect.poll(() => page.locator("#chart").evaluate((element) => {
      const range = element._fullLayout.xaxis.range.map(Date.parse);
      const dates = (element.data || [])
        .filter((trace) => trace?.meta?.seriesKey && trace?.meta?.overlayKind !== "ai-scenario")
        .flatMap((trace) => trace.x || [])
        .map(Date.parse)
        .filter(Number.isFinite);
      return Math.max(Math.abs(range[0] - Math.min(...dates)), Math.abs(range[1] - Math.max(...dates)));
    })).toBeLessThanOrEqual(1000);
    await page.waitForTimeout(350);
    const restoreTapPoint = await page.locator("#chart").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const xAxis = element._fullLayout.xaxis;
      const yAxis = element._fullLayout.yaxis;
      return {
        centerX: rect.left + xAxis._offset + xAxis._length / 2,
        tapY: rect.top + yAxis._offset + 2,
      };
    });
    await doubleTap(103, restoreTapPoint);
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
    await expectMainAuxiliaryRangesLinked(page);
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
        .filter((trace) => trace?.meta?.seriesKey && trace?.meta?.overlayKind !== "ai-scenario")
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
        .filter((trace) => trace?.meta?.seriesKey && trace?.meta?.overlayKind !== "ai-scenario")
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
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);
  await page.mouse.move(scaleBox.x + scaleBox.width / 2, scaleBox.y + scaleBox.height / 2 + 28);
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().scales).length
  ))).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);

  const offsetHandle = page.locator("#y-handles .y-handle-left").last();
  const offsetBox = await waitForBoundingBox(offsetHandle);
  await offsetHandle.hover();
  await page.mouse.down();
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);
  await page.mouse.move(offsetBox.x + offsetBox.width / 2, offsetBox.y + offsetBox.height / 2 + 28);
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().offsets).length
  ))).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);

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
      customStocks: [{ ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" }],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  expect(await page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(6);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.seriesKey && trace.visible !== "legendonly" && String(trace.mode || "").includes("lines")
    )).length
  ))).toBeGreaterThanOrEqual(2);

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
  await page.waitForTimeout(50);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeGreaterThan(initial.span);
  await expectMainAuxiliaryRangesLinked(page);
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: 120, clientX: wheelPoint });
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: 120, clientX: wheelPoint });
  expect(await page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(6);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeGreaterThan(initial.span * 1.15);
  await expectMainAuxiliaryRangesLinked(page);
  await page.waitForTimeout(250);
  const wheelReleasedYRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.range.map(Number)
  ));
  await waitForChartRenderIdle(page);
  await page.waitForTimeout(250);
  const wheelSettledYRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.range.map(Number)
  ));
  const wheelReleasedSpan = Math.max(1, Math.abs(wheelReleasedYRange[1] - wheelReleasedYRange[0]));
  expect(Math.max(
    Math.abs(wheelSettledYRange[0] - wheelReleasedYRange[0]),
    Math.abs(wheelSettledYRange[1] - wheelReleasedYRange[1]),
  ) / wheelReleasedSpan).toBeLessThan(0.005);
  const zoomedOut = await page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return { span: range[1] - range[0], center: (range[0] + range[1]) / 2 };
  });
  expect(zoomedOut.center).toBeLessThan(initial.center);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const dates = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace?.meta?.overlayKind !== "ai-scenario")
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    return Math.abs(range[1] - Math.max(...dates));
  })).toBeLessThanOrEqual(1000);

  await page.evaluate(() => window.ThinkStockE2E.loadHistoricalDataForTest());
  await waitForChartRenderIdle(page);
  const fullRange = await page.locator("#chart").evaluate((element) => {
    const traces = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace?.meta?.overlayKind !== "ai-scenario");
    const timestamps = traces.flatMap((trace) => trace.x || [])
      .map((value) => Date.parse(value)).filter(Number.isFinite);
    const starts = traces.map((trace) => Number(trace?.meta?.fullDataStartMs)).filter(Number.isFinite);
    const ends = traces.map((trace) => Number(trace?.meta?.fullDataEndMs)).filter(Number.isFinite);
    const start = Math.min(...timestamps, ...starts);
    const end = Math.max(...timestamps, ...ends);
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
      .filter((trace) => trace?.meta?.seriesKey && trace?.meta?.overlayKind !== "ai-scenario")
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
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map((value) => (
      typeof value === "number" ? value : Date.parse(value)
    ))
  ))).toEqual(minimumRange);
  await page.locator("#chart").dispatchEvent("wheel", { deltaY: -120, clientX: wheelPoint });
  await expect(page.locator("#chartNavigationMessage")).toHaveText("기간을 더 이상 줄일 수 없습니다.");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map((value) => (
      typeof value === "number" ? value : Date.parse(value)
    ))
  ))).toEqual(minimumRange);
});

test("one wheel input schedules one linked viewport target", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse wheel behavior is desktop-only.");
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await waitForChartRenderIdle(page);

  const before = await page.evaluate(() => (
    window.ThinkStockE2E.getChartWorkerStats().rangeSync?.scheduled || 0
  ));
  const wheelPoint = await page.locator("#chart").evaluate((element) => {
    const axis = element._fullLayout.xaxis;
    const rect = element.getBoundingClientRect();
    return rect.left + axis._offset + (axis._length * 0.5);
  });
  await page.locator("#chart").dispatchEvent("wheel", {
    deltaY: -120,
    clientX: wheelPoint,
  });
  await expect.poll(() => page.evaluate(() => {
    const rangeSync = window.ThinkStockE2E.getChartWorkerStats().rangeSync;
    return Boolean(rangeSync && !rangeSync.pending && !rangeSync.running);
  })).toBe(true);
  const after = await page.evaluate(() => (
    window.ThinkStockE2E.getChartWorkerStats().rangeSync?.scheduled || 0
  ));

  expect(after - before).toBe(1);
});

test("the first desktop zoom-out uses the loaded recent window before history finishes", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse wheel behavior is desktop-only.");
  await installDataRoutes(page);
  await page.route("**/data/*_history.json*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fallback();
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      showRecessionSignals: false,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const chart = page.locator("#chart");
  const initialSpan = await chart.evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  });
  const wheelPoint = await chart.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    return rect.left + axis._offset + (axis._length * 0.5);
  });

  await chart.dispatchEvent("wheel", { deltaY: 120, clientX: wheelPoint });
  await expect.poll(() => chart.evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  }), { timeout: 1000 }).toBeGreaterThan(initialSpan * 1.1);
});

test("rapid wheel zoom-in keeps accumulating while chart updates are still pending", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse wheel behavior is desktop-only.");
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await waitForChartRenderIdle(page);

  const initialSpan = await page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    const clientX = rect.left + axis._offset + (axis._length * 0.5);
    const clientY = rect.top + element._fullLayout.yaxis._offset + 20;
    for (let index = 0; index < 10; index += 1) {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        deltaY: -120,
      }));
    }
    return range[1] - range[0];
  });

  await expect.poll(() => page.evaluate(() => {
    const rangeSync = window.ThinkStockE2E.getChartWorkerStats().rangeSync;
    return Boolean(rangeSync && !rangeSync.pending && !rangeSync.running);
  })).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeLessThan(initialSpan * 0.2);
});

test("desktop main-chart drag commits the same range to auxiliary charts", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse drag behavior is desktop-only.");
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      customStocks: [{ ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" }],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
    }));
  });
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-macd .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.seriesKey && trace.visible !== "legendonly" && String(trace.mode || "").includes("lines")
    )).length
  ))).toBeGreaterThanOrEqual(2);
  await page.locator("#chartRange6Months").click();

  const drag = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    const range = axis.range.map(Date.parse);
    return {
      beforeCenter: (range[0] + range[1]) / 2,
      startX: rect.left + axis._offset + axis._length * 0.3,
      endX: rect.left + axis._offset + axis._length * 0.5,
      y: rect.top + element._fullLayout.yaxis._offset + element._fullLayout.yaxis._length * 0.95,
    };
  });

  await page.mouse.move(drag.startX, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.endX, drag.y, { steps: 5 });
  await expectMainAuxiliaryRangesLinked(page);
  await page.mouse.up();

  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return (range[0] + range[1]) / 2;
  })).not.toBe(drag.beforeCenter);
  await expectMainAuxiliaryRangesLinked(page);
  const releasedYRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.range.map(Number)
  ));
  await waitForChartRenderIdle(page);
  await page.waitForTimeout(250);
  const settledYRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.range.map(Number)
  ));
  const releasedSpan = Math.max(1, Math.abs(releasedYRange[1] - releasedYRange[0]));
  expect(Math.max(
    Math.abs(settledYRange[0] - releasedYRange[0]),
    Math.abs(settledYRange[1] - releasedYRange[1]),
  ) / releasedSpan).toBeLessThan(0.005);
});

test("auxiliary drag and wheel control the shared viewport owner", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop auxiliary input is covered separately from touch pinch.");
  await stubExternalRefreshes(page);
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await page.locator("#chartRange6Months").click();
  await waitForChartRenderIdle(page);

  const drag = await page.locator("#chart-adr").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    const mainRange = document.getElementById("chart")._fullLayout.xaxis.range.map(Date.parse);
    return {
      beforeCenter: (mainRange[0] + mainRange[1]) / 2,
      startX: rect.left + axis._offset + axis._length * 0.3,
      endX: rect.left + axis._offset + axis._length * 0.5,
      y: rect.top + 4,
    };
  });
  await page.mouse.move(drag.startX, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.endX, drag.y, { steps: 5 });
  await expectMainAuxiliaryRangesLinked(page);
  await page.mouse.up();
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return (range[0] + range[1]) / 2;
  })).not.toBe(drag.beforeCenter);

  const beforeWheelSpan = await page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  });
  await page.locator("#chart-adr").dispatchEvent("wheel", {
    deltaY: -120,
    clientX: drag.endX,
    clientY: drag.y,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeLessThan(beforeWheelSpan);
  await expectMainAuxiliaryRangesLinked(page);
});

test("wheel zoom followed by panning keeps every visible auxiliary panel populated", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop wheel and mouse panning are covered separately from touch pinch.");
  const denseDates = [];
  for (
    let cursor = Date.UTC(2024, 0, 2);
    cursor <= Date.UTC(2026, 6, 14);
    cursor += 24 * 60 * 60 * 1000
  ) {
    const date = new Date(cursor);
    if (date.getUTCDay() > 0 && date.getUTCDay() < 6) {
      denseDates.push(date.toISOString().slice(0, 10));
    }
  }
  const values = (base, step, wave = 0) => denseDates.map((_, index) => (
    base + index * step + Math.sin(index / 2) * wave
  ));
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks: [
        { ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" },
      ],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
      hiddenAuxiliaryPanels: [],
      hiddenAuxiliarySeries: [],
    }));
  });
  await installDataRoutes(page, {
    payloadOverrides: {
      "prices_recent.json": columnar(
        ["^KS11", "^KQ11", "005930.KS"],
        denseDates,
        {
          "^KS11": values(2500, 20, 70),
          "^KQ11": values(700, 5, 25),
          "005930.KS": values(55000, 700, 4200),
        },
      ),
      "macro_data_recent.json": columnar(
        ["leading_cycle", "news_sentiment"],
        denseDates,
        {
          leading_cycle: values(98, 0.08, 0.7),
          news_sentiment: values(95, 0.25, 8),
        },
      ),
      "adr_data_recent.json": columnar(
        ["adr_kospi", "adr_kosdaq", "fear_greed"],
        denseDates,
        {
          adr_kospi: values(92, 0.5, 12),
          adr_kosdaq: values(88, 0.6, 14),
          fear_greed: values(42, 0.4, 18),
        },
      ),
      "vkospi_data.json": {
        format: "records-v1",
        generated_at: "2026-07-15T00:00:00Z",
        source: "KRX 파생상품지수 시세정보",
        records: denseDates.map((date, index) => ({
          date,
          vkospi: 20 + Math.sin(index / 2) * 4,
        })),
      },
    },
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-macd .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await page.locator("#chartRange6Months").click();
  await waitForChartRenderIdle(page);
  await expectVisibleAuxiliaryDataCoversMainRange(page);

  const chartBox = await waitForBoundingBox(page.locator("#chart"));
  const pointerX = chartBox.x + chartBox.width * 0.52;
  const pointerY = chartBox.y + chartBox.height * 0.14;
  await page.locator("#chart").dispatchEvent("wheel", {
    deltaY: -120,
    clientX: pointerX,
    clientY: pointerY,
  });
  await waitForChartRenderIdle(page);

  for (let index = 0; index < 4; index += 1) {
    await page.mouse.move(chartBox.x + chartBox.width * 0.3, pointerY);
    await page.mouse.down();
    await page.mouse.move(chartBox.x + chartBox.width * 0.62, pointerY, { steps: 5 });
    await page.mouse.up();
  }
  await waitForChartRenderIdle(page);
  await expectMainAuxiliaryRangesLinked(page);
  await expectVisibleAuxiliaryDataCoversMainRange(page);
});

test("restored chart pans immediately without a toggle or zoom warm-up", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse blank-area panning is desktop-only.");
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 6,
      autoChartReset: true,
      customStocks: [],
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
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
  expect(await page.evaluate(() => window.ThinkStockE2E.loadHistoricalDataForTest())).toBe(true);
  await waitForChartRenderIdle(page);

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
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
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

test("auto scale reset clears live transforms while preserving the historical viewport", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse handle transforms are covered by the desktop viewport project.");
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 120,
      autoChartReset: true,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "customer_deposit",
        "kospi_credit",
        "^KQ11",
        "kosdaq_credit",
      ],
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
  await page.locator('.series-toggle-btn[data-series="kospi_credit"]').click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly").length
  ))).toBe(1);
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
  await waitForChartRenderIdle(page);
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
  await expect.poll(() => page.evaluate(() => {
    const rangeSync = window.ThinkStockE2E.getChartWorkerStats().rangeSync;
    return Boolean(rangeSync?.pending || rangeSync?.running);
  })).toBe(false);
  await waitForChartRenderIdle(page);
  const autoResetXRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));
  const autoResetScaleHandle = page.locator('.y-handle-right[data-series-key="^KS11"]');
  const autoResetHandleBox = await waitForBoundingBox(autoResetScaleHandle);
  const scaleHandleCenterY = autoResetHandleBox.y + autoResetHandleBox.height / 2;
  const scaleTargetY = scaleHandleCenterY + 35;
  await autoResetScaleHandle.hover();
  const scaleSpanBefore = await visibleTracePixelSpan(page, "^KS11");
  await page.mouse.down();
  await page.mouse.move(
    autoResetHandleBox.x + autoResetHandleBox.width / 2,
    scaleTargetY,
  );
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().scales).length
  ))).toBeGreaterThan(0);
  await expect.poll(() => visibleTracePixelSpan(page, "^KS11")).toBeLessThan(scaleSpanBefore * 0.9);
  const scaleSpanDuringDrag = await visibleTracePixelSpan(page, "^KS11");
  await page.mouse.up();
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
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().offsets).length
  ))).toBeGreaterThan(0);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().offsets).length
  ))).toBeGreaterThan(0);
  const transformedTracePoints = await page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "^KS11");
    return (trace?.x || []).map((date, index) => [date, Number(trace?.y?.[index])]);
  });
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
  await expect.poll(() => page.locator("#chart").evaluate((element, transformedPoints) => {
    const transformedByDate = new Map(transformedPoints);
    const resetTrace = (element.data || []).find((trace) => trace?.meta?.seriesKey === "^KS11");
    return (resetTrace?.x || []).some((date, index) => {
      const value = Number(resetTrace?.y?.[index]);
      const transformedValue = Number(transformedByDate.get(date));
      return Number.isFinite(value)
        && Number.isFinite(transformedValue)
        && Math.abs(value - transformedValue) > 0.01;
    });
  }, transformedTracePoints)).toBe(true);
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
