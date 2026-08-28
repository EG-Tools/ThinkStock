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

test("new stock loads its own Cloudflare DART disclosures", async ({ page }) => {
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
  });
  let newStockDisclosureRequests = 0;
  const requestedDisclosureTickers = [];
  const forcedNewStockDisclosures = [];
  let newStockAnalysisRequests = 0;
  let releaseNewStockAnalysis;
  const newStockAnalysisGate = new Promise((resolve) => { releaseNewStockAnalysis = resolve; });
  await page.route("**/api/analysis**", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    if (ticker === "000660.KS") {
      newStockAnalysisRequests += 1;
      await newStockAnalysisGate;
    }
    await route.fulfill({ json: {
      ok: true,
      ticker,
      savedAt: Date.now(),
      consensus: { ticker, targetPrice: 250000, opinion: 4.1, institutions: 8 },
      financials: [
        { ticker, period: "2025-12", frequency: "annual", revenue: 1000, operatingProfit: 100 },
        { ticker, period: "2026-03", frequency: "quarter", revenue: 280, operatingProfit: 32 },
      ],
    } });
  });
  await page.route("**/api/dart/disclosures?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const ticker = requestUrl.searchParams.get("ticker") || "";
    requestedDisclosureTickers.push(ticker);
    if (ticker !== "000660.KS") {
      await route.fallback();
      return;
    }
    newStockDisclosureRequests += 1;
    forcedNewStockDisclosures.push(requestUrl.searchParams.get("force"));
    await route.fulfill({ json: {
      ok: true,
      ticker,
      records: [{
        date: "2026-04-14",
        ticker,
        name: "SK하이닉스",
        title: "단일판매ㆍ공급계약체결",
        url: "https://dart.fss.or.kr/example",
        source: "OpenDART",
      }],
    } });
  });
  await page.route("https://query2.finance.yahoo.com/v8/finance/chart/000660.KS**", async (route) => {
    await route.fulfill({ json: {
      chart: {
        result: [{
          meta: { gmtoffset: 0 },
          timestamp: [1768348800, 1776124800, 1783987200],
          indicators: { quote: [{ close: [180000, 210000, 240000] }] },
        }],
        error: null,
      },
    } });
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#resetHandles").click();
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "false");
  const lockedViewport = await page.locator("#chart").evaluate(async (element) => {
    const xRange = [...element._fullLayout.xaxis.range];
    const yRange = [0, 100];
    await window.Plotly.relayout(element, {
      "xaxis.range": xRange,
      "yaxis.range": yRange,
      "yaxis.autorange": false,
    });
    return { xRange, yRange };
  });
  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 10000 });
  const currentViewport = () => page.locator("#chart").evaluate((element) => ({
    xRange: [...element._fullLayout.xaxis.range],
    yRange: [...element._fullLayout.yaxis.range],
  }));
  await expect.poll(currentViewport, {
    message: "AI history preparation changed a locked viewport",
  }).toEqual(lockedViewport);
  await page.locator("#disclosureToggle").click();
  await expect(page.locator("#disclosureToggle")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(currentViewport, {
    message: "Disclosure visibility changed a locked viewport",
  }).toEqual(lockedViewport);

  await page.locator("#stockSearchInput").fill("SK하이닉스");
  const suggestion = page.locator(".stock-suggest-item").filter({ hasText: "SK하이닉스" });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.locator("#aiForecastProgress")).toBeVisible();
  await expect(page.locator("#aiForecastProgressText")).toContainText("SK하이닉스");
  await expect.poll(() => newStockAnalysisRequests).toBe(1);

  await expect(page.locator('[data-series="000660.KS"]')).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => ({
    stockVisible: (element.data || []).some((trace) => (
      trace?.meta?.seriesKey === "000660.KS" && trace.visible !== "legendonly"
    )),
    aiTraceCount: (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length,
  }))).toEqual({ stockVisible: true, aiTraceCount: 0 });
  await expect.poll(currentViewport).toEqual(lockedViewport);
  await expect.poll(() => newStockDisclosureRequests).toBe(1);
  expect(forcedNewStockDisclosures).toEqual([null]);
  expect([...new Set(requestedDisclosureTickers)]).toEqual(["000660.KS"]);
  await expect(page.locator("#disclosureToggle")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).some((trace) => trace?.meta?.isDisclosureTrace)
  ))).toBe(false);
  await page.locator("#disclosureToggle").click();
  await expect(page.locator("#disclosureToggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((candidate) => candidate?.meta?.isDisclosureTrace);
    return trace?.meta?.overlayKind === "disclosure"
      && String(trace?.mode || "").includes("text")
      && (trace?.text || []).includes("◆")
      ? trace.x?.length || 0
      : 0;
  })).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const stockTrace = (element.data || []).find((trace) => trace?.meta?.seriesKey === "000660.KS");
    const disclosureTrace = (element.data || []).find((trace) => trace?.meta?.isDisclosureTrace);
    const markerColors = disclosureTrace?.textfont?.color;
    return Array.isArray(markerColors) && markerColors.includes(stockTrace?.line?.color);
  })).toBe(true);
  await page.locator("#disclosureToggle").click();
  await page.locator("#disclosureToggle").click();
  await expect.poll(() => newStockDisclosureRequests).toBe(1);
  releaseNewStockAnalysis();
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 10000 });
});

test("late disclosure and insider data reconcile without toggling the stock", async ({ page }) => {
  await installDataRoutes(page);
  await page.unroute("**/api/dart/disclosures?*");
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 36,
      hiddenSeries: ["leading_cycle", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"],
      customStocks: [],
      showDisclosures: false,
      showInsiderTrades: true,
    }));
  });

  let releaseDisclosure;
  let releaseInsider;
  let disclosureRequests = 0;
  let insiderRequests = 0;
  const disclosureTickers = [];
  const insiderTickers = [];
  const disclosureGate = new Promise((resolve) => { releaseDisclosure = resolve; });
  const insiderGate = new Promise((resolve) => { releaseInsider = resolve; });

  await page.route("**/api/dart/disclosures?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    disclosureTickers.push(ticker);
    if (ticker !== "000660.KS") {
      await route.fulfill({ json: { ok: true, ticker, records: [] } });
      return;
    }
    disclosureRequests += 1;
    await disclosureGate;
    await route.fulfill({ json: {
      ok: true,
      ticker,
      records: [{
        date: "2026-04-14",
        ticker,
        name: "SK하이닉스",
        title: "유상증자 결정",
        url: "https://dart.fss.or.kr/example",
        source: "OpenDART",
      }],
      nextPage: null,
      complete: true,
    } });
  });
  await page.route("**/api/dart/insider-trades?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    insiderTickers.push(ticker);
    if (ticker !== "000660.KS") {
      await route.fallback();
      return;
    }
    insiderRequests += 1;
    await insiderGate;
    await route.fulfill({ json: {
      ok: true,
      ticker,
      records: [{
        ticker,
        date: "2026-04-14",
        side: "buy",
        reporter: "Test Director",
        role: "Director",
        sharesChanged: 300,
        receiptNo: "20260414000456",
      }],
    } });
  });
  await page.route("https://query2.finance.yahoo.com/v8/finance/chart/000660.KS**", async (route) => {
    await route.fulfill({ json: {
      chart: {
        result: [{
          meta: { gmtoffset: 0 },
          timestamp: [1768348800, 1776124800, 1783987200],
          indicators: { quote: [{ close: [180000, 210000, 240000] }] },
        }],
        error: null,
      },
    } });
  });

  const eventTraceCounts = () => page.locator("#chart").evaluate((element) => ({
    disclosure: (element.data || []).filter((trace) => trace?.meta?.isDisclosureTrace).length,
    insider: (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace).length,
  }));

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await page.locator("#stockSearchInput").fill("000660");
  await page.locator(".stock-suggest-item").first().click();
  await expect(page.locator('[data-series="000660.KS"]')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
  });
  await page.locator("#disclosureToggle").click();
  await expect(page.locator("#disclosureToggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => disclosureRequests).toBe(1);
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getDisclosureProgressState()))
    .toMatchObject({ enabled: true, active: 2, total: 2 });
  await expect(page.locator("#disclosureProgress")).toBeVisible();
  await expect(page.locator("#disclosureProgressText")).toContainText(/공시|내부거래/);
  await expect.poll(() => page.locator("#disclosureProgressBar").evaluate((element) => (
    Number.parseFloat(element.style.width) || 0
  ))).toBeGreaterThan(0);
  await expect.poll(eventTraceCounts).toEqual({ disclosure: 0, insider: 0 });

  releaseDisclosure();
  await expect.poll(() => eventTraceCounts().then((counts) => counts.disclosure)).toBe(1);
  await expect.poll(() => insiderRequests).toBe(1);
  await expect(page.locator("#disclosureProgress")).toBeVisible();
  await expect(page.locator("#disclosureProgressText")).toContainText("내부거래");
  releaseInsider();
  await expect.poll(() => eventTraceCounts().then((counts) => counts.insider)).toBe(1);
  await expect(page.locator("#disclosureProgress")).toBeHidden({ timeout: 5000 });
  expect([...new Set(disclosureTickers)]).toEqual(["000660.KS"]);
  expect([...new Set(insiderTickers)]).toEqual(["000660.KS"]);
  await expect(page.locator('[data-series="000660.KS"]')).toHaveClass(/is-on/);
});

test("general mode locks private analysis features", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      showInsiderTrades: true,
      showCoMovement: true,
      showRecessionSignals: true,
      showDisclosures: true,
      showEps: true,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  for (const id of ["disclosureToggle", "epsToggle", "insiderTradeToggle", "coMovementToggle", "recessionToggle", "aiForecastToggle"]) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.locator("#stockResearchBtn")).toBeDisabled();
  await expect(page.locator("#stockResearchBtn")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#coMovementPanel")).toBeHidden();
});

test("administrator code unlocks private analysis features", async ({ page }) => {
  const adminCode = "1234567890";
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.locator("#apiOptionsBtn").click();
  await page.locator("#adminAccessCodeInput").fill("1111111111");
  await page.locator("#adminAccessCodeBtn").click();
  await expect(page.locator("#adminAccessStatus")).toHaveText("접속코드가 틀렸습니다.");
  await expect(page.locator("#adminAccessStatus")).toHaveClass(/is-error/);
  await expect(page.locator("#aiForecastToggle")).toBeDisabled();
  await page.locator("#adminAccessCodeInput").fill(adminCode);
  await page.locator("#adminAccessCodeBtn").click();

  await expect(page.locator("#adminAccessStatus")).toContainText("관리자 모드");
  await expect(page.locator("#adminAccessStatus")).toHaveClass(/is-active/);
  await expect(page.locator("#adminAccessCodeInput")).toHaveValue(/^.{10}$/);
  expect(await page.locator("#adminAccessCodeInput").inputValue()).not.toBe(adminCode);
  for (const id of ["disclosureToggle", "epsToggle", "insiderTradeToggle", "coMovementToggle", "recessionToggle", "aiForecastToggle", "stockResearchBtn"]) {
    await expect(page.locator(`#${id}`)).toBeEnabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "false");
  }
  const storedSession = await page.evaluate(() => JSON.parse(
    localStorage.getItem("thinkstock-admin-session-v1") || "null",
  ));
  expect(storedSession?.sessionToken).toMatch(/^v1\./);
  expect(JSON.stringify(storedSession)).not.toContain(adminCode);
});

test("API settings save only a verified personal access token", async ({ page }) => {
  await installDataRoutes(page);
  await page.route("**/api/auth/check", async (route) => {
    const authorization = route.request().headers().authorization || "";
    await route.fulfill({
      status: authorization === "Bearer verified-token" ? 200 : 401,
      json: authorization === "Bearer verified-token"
        ? { ok: true }
        : { ok: false, error: "Think Stock 접속 코드가 올바르지 않습니다." },
    });
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.locator("#apiOptionsBtn").click();
  await page.locator("#dartGatewayTokenInput").fill("wrong-token");
  await page.locator("#dartGatewayTokenSaveBtn").click();

  await expect(page.locator("#apiSettingsModal")).toBeVisible();
  await expect(page.locator("#dartGatewayTokenStatus")).toHaveText("접속코드가 틀렸습니다.");
  await expect(page.locator("#dartGatewayTokenStatus")).toHaveClass(/is-error/);
  expect(await page.evaluate(() => JSON.parse(
    localStorage.getItem("thinkstock-dart-gateway-v1") || "{}",
  ).accessToken || "")).toBe("");

  await page.locator("#dartGatewayTokenInput").fill("verified-token");
  await page.locator("#dartGatewayTokenSaveBtn").click();
  await expect(page.locator("#apiSettingsModal")).toBeHidden();
  await expect(page.locator("#messageArea")).toContainText("확인된 Think Stock 접속 코드");
  expect(await page.evaluate(() => JSON.parse(
    localStorage.getItem("thinkstock-dart-gateway-v1"),
  ).accessToken)).toBe("verified-token");
});

test("new stock loads its deployed disclosure file without a gateway token", async ({ page }) => {
  await installDataRoutes(page);
  let requestedStaticDisclosure = false;
  let gatewayApiRequests = 0;
  await page.route("**/data/disclosures.json*", async (route) => {
    await route.fulfill({ json: {
      generated_at: "2026-07-21T00:00:00Z",
      source: "OpenDART",
      format: "by-ticker-v1",
      tickers: ["000660.KS"],
      files: { "000660.KS": "./data/disclosures/000660.KS.json" },
      counts: { "000660.KS": 1 },
      latest: { "000660.KS": "2026-04-14" },
      total: 1,
    } });
  });
  await page.route("**/data/disclosures/000660.KS.json*", async (route) => {
    requestedStaticDisclosure = true;
    await route.fulfill({ json: {
      generated_at: "2026-07-21T00:00:00Z",
      records: [{
        date: "2026-04-14",
        ticker: "000660.KS",
        name: "SK하이닉스",
        title: "단일판매ㆍ공급계약체결",
        url: "https://dart.fss.or.kr/example",
        source: "OpenDART",
      }],
    } });
  });
  await page.route("**/api/dart/disclosures?*", async (route) => {
    gatewayApiRequests += 1;
    await route.abort();
  });
  await page.route("https://query2.finance.yahoo.com/v8/finance/chart/000660.KS**", async (route) => {
    await route.fulfill({ json: {
      chart: {
        result: [{
          meta: { gmtoffset: 0 },
          timestamp: [1768348800, 1776124800, 1783987200],
          indicators: { quote: [{ close: [180000, 210000, 240000] }] },
        }],
        error: null,
      },
    } });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await page.locator("#stockSearchInput").fill("SK하이닉스");
  await page.locator(".stock-suggest-item").filter({ hasText: "SK하이닉스" }).click();

  await expect.poll(() => requestedStaticDisclosure).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((candidate) => candidate?.meta?.isDisclosureTrace);
    return trace?.meta?.overlayKind === "disclosure"
      && String(trace?.mode || "").includes("text")
      && (trace?.text || []).includes("◆")
      ? trace.x?.length || 0
      : 0;
  })).toBeGreaterThan(0);
  expect(gatewayApiRequests).toBe(0);
});

