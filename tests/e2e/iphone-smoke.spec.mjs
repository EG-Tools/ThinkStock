import { expect, test } from "@playwright/test";

const recentDates = ["2025-07-14", "2025-10-14", "2026-01-14", "2026-04-14", "2026-07-14"];
const historyDates = ["1998-07-14", "2005-07-14", "2012-07-14"];
const DESKTOP_PERF_BUDGET = Object.freeze({
  minPointerMoves: 20,
  minFrames: 20,
  maxP95PointerMove: 20,
  maxPointerMove: 50,
  maxP95FrameGap: 180,
  maxLongFrameRatio: 0.65,
  maxP95RenderChart: 2000,
  maxP95AuxiliaryRender: 1200,
  maxAppStartup: 4500,
});

function columnar(series, dates, columns) {
  return {
    generated_at: "2026-07-15T00:00:00Z",
    format: "columnar-v1",
    series,
    display_names: {
      "^KS11": "코스피",
      "^KQ11": "코스닥",
      "005930.KS": "삼성전자",
      leading_cycle: "선행순환변동",
      news_sentiment: "뉴스심리",
      customer_deposit: "고객예탁금",
      kospi_credit: "코스피 신용",
      kosdaq_credit: "코스닥 신용",
    },
    dates,
    columns,
  };
}

async function stubExternalRefreshes(page, { stubFearGreed = true } = {}) {
  const unavailable = (route) => route.fulfill({
    status: 503,
    headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
    body: "{}",
  });
  await page.route("https://query2.finance.yahoo.com/**", unavailable);
  await page.route("https://corsproxy.io/**", unavailable);
  if (stubFearGreed) {
    await page.route("https://kospi.feargreedchart.com/**", unavailable);
  }
}

async function installDataRoutes(page) {
  let historyRequests = 0;
  const pricesRecent = columnar(
    ["^KS11", "^KQ11", "005930.KS"],
    recentDates,
    {
      "^KS11": [2800, 2900, 3000, 3100, 3200],
      "^KQ11": [780, 800, 820, 840, 860],
      "005930.KS": [70000, 72000, 74000, 76000, 78000],
    },
  );
  const pricesHistory = columnar(
    ["^KS11", "^KQ11", "005930.KS"],
    historyDates,
    {
      "^KS11": [300, 900, 1800],
      "^KQ11": [80, 400, 550],
      "005930.KS": [8000, 15000, 28000],
    },
  );
  const macroRecent = columnar(
    ["leading_cycle", "news_sentiment"],
    recentDates,
    { leading_cycle: [99, 99.5, 100, 100.5, 101], news_sentiment: [92, 96, 101, 105, 108] },
  );
  const macroHistory = columnar(
    ["leading_cycle", "news_sentiment"],
    historyDates,
    { leading_cycle: [96, 97, 98], news_sentiment: [null, 88, 94] },
  );
  const creditRecent = columnar(
    ["customer_deposit", "kospi_credit", "kosdaq_credit"],
    recentDates,
    {
      customer_deposit: [80, 85, 90, 95, 100],
      kospi_credit: [20, 21, 22, 23, 24],
      kosdaq_credit: [6, 6.2, 6.4, 6.6, 6.8],
    },
  );
  const creditHistory = columnar(
    ["customer_deposit", "kospi_credit", "kosdaq_credit"],
    historyDates,
    {
      customer_deposit: [2, 15, 35],
      kospi_credit: [0.3, 2, 5],
      kosdaq_credit: [null, 0.2, 1],
    },
  );
  const adrRecent = columnar(
    ["adr_kospi", "adr_kosdaq", "fear_greed"],
    recentDates,
    {
      adr_kospi: [95, 100, 105, 110, 115],
      adr_kosdaq: [90, 95, 100, 105, 110],
      fear_greed: [35, 45, 55, 65, 75],
    },
  );
  const adrHistory = columnar(
    ["adr_kospi", "adr_kosdaq", "fear_greed"],
    [],
    { adr_kospi: [], adr_kosdaq: [], fear_greed: [] },
  );
  const payloads = new Map([
    ["prices_recent.json", pricesRecent],
    ["prices_history.json", pricesHistory],
    ["macro_data_recent.json", macroRecent],
    ["macro_data_history.json", macroHistory],
    ["credit_data_recent.json", creditRecent],
    ["credit_data_history.json", creditHistory],
    ["adr_data_recent.json", adrRecent],
    ["adr_data_history.json", adrHistory],
  ]);

  await page.route("**/data/*.json*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name === "disclosures.json") {
      await route.fulfill({ json: {
        generated_at: "2026-07-15T00:00:00Z",
        source: "OpenDART",
        format: "by-ticker-v1",
        tickers: ["005930.KS"],
        files: { "005930.KS": "./data/disclosures/005930.KS.json" },
        counts: { "005930.KS": 1 },
        latest: { "005930.KS": "2026-04-14" },
        total: 1,
      } });
      return;
    }
    if (name === "dart_corp_codes.json") {
      await route.fulfill({ json: {
        format: "stock-to-corp-shards-v1",
        prefix_length: 2,
        total: 1,
        files: { "00": "data/dart_corp_codes/00.json" },
        counts: { "00": 1 },
      } });
      return;
    }
    if (name === "krx_universe.json") {
      await route.fulfill({ json: {
        format: "krx-universe-v1",
        total: 2,
        records: [
          { ticker: "000660.KS", code: "000660", name: "SK하이닉스", market: "KOSPI" },
          { ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" },
        ],
      } });
      return;
    }
    if (name === "build_report.json") {
      await route.fulfill({ json: { records: [] } });
      return;
    }
    if (name?.endsWith("_history.json")) historyRequests += 1;
    const payload = payloads.get(name);
    if (payload) {
      await route.fulfill({ json: payload });
      return;
    }
    await route.abort();
  });
  await page.route("**/data/disclosures/*.json*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name !== "005930.KS.json") {
      await route.abort();
      return;
    }
    await route.fulfill({ json: {
      generated_at: "2026-07-15T00:00:00Z",
      source: "OpenDART",
      records: [{
        date: "2026-04-14",
        ticker: "005930.KS",
        name: "삼성전자",
        title: "유상증자 결정",
        url: "https://dart.fss.or.kr/example",
        source: "OpenDART",
      }],
    } });
  });
  await page.route("**/data/dart_corp_codes/*.json*", async (route) => {
    await route.fulfill({ json: {
      format: "stock-to-corp-shard-v1",
      prefix: "00",
      codes: {
        "005930": "00126380",
        "000660": "00164779",
      },
    } });
  });
  await page.route("**/api/dart/disclosures?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    const records = ["005930.KS", "000660.KS"].includes(ticker) ? [{
      date: "2026-04-14",
      ticker,
      name: ticker === "000660.KS" ? "SK하이닉스" : "삼성전자",
      title: ticker === "000660.KS" ? "단일판매ㆍ공급계약체결" : "유상증자 결정",
      url: "https://dart.fss.or.kr/example",
      source: "OpenDART",
    }] : [];
    await route.fulfill({ json: { ok: true, ticker, records } });
  });
  await stubExternalRefreshes(page);
  return () => historyRequests;
}

test("new stock loads its own Cloudflare DART disclosures", async ({ page }) => {
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
  });
  let requestedNewStockDisclosure = false;
  await page.route("**/api/dart/disclosures?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    if (ticker !== "000660.KS") {
      await route.fallback();
      return;
    }
    requestedNewStockDisclosure = true;
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

  await page.locator("#stockSearchInput").fill("SK하이닉스");
  const suggestion = page.locator(".stock-suggest-item").filter({ hasText: "SK하이닉스" });
  await expect(suggestion).toBeVisible();
  await suggestion.click();

  await expect(page.locator('[data-series="000660.KS"]')).toBeVisible();
  await expect.poll(() => requestedNewStockDisclosure).toBe(true);
  await expect(page.locator("#chart .textpoint text").filter({ hasText: "◆" }).first()).toBeVisible();
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
  await expect(page.locator("#chart .textpoint text").filter({ hasText: "◆" }).first()).toBeVisible();
  expect(gatewayApiRequests).toBe(0);
});

test("bundled recent data boots through the chart worker", async ({ page }) => {
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
  const [chartBox, resetBox] = await Promise.all([
    page.locator("#chart").boundingBox(),
    page.locator("#resetHandles").boundingBox(),
  ]);
  expect(chartBox).not.toBeNull();
  expect(resetBox).not.toBeNull();
  expect(resetBox.x).toBeGreaterThanOrEqual(chartBox.x);
  expect(resetBox.y).toBeGreaterThanOrEqual(chartBox.y);
  expect(resetBox.x + resetBox.width).toBeLessThan(chartBox.x + chartBox.width);
  expect(resetBox.y + resetBox.height).toBeLessThan(chartBox.y + chartBox.height);
  await page.locator("#stockSearchInput").fill("SK하이닉스");
  await expect(page.locator(".stock-suggest-item")).toContainText("SK하이닉스");
  await page.locator("#stockSearchInput").press("Escape");
  expect(await page.evaluate(() => window.ThinkStockE2E?.getChartModelSource?.())).toBe("worker");
  expect(await page.evaluate(() => window.ThinkStockE2E?.getAuxiliaryChartModelSource?.())).toBe("worker");
  const firstChartDate = await page.locator("#chart").evaluate((element) => element.data?.[0]?.x?.[0]);
  expect(firstChartDate).toMatch(/^2016-/);
  expect(pageErrors).toEqual([]);
});

test("AI toggle draws and removes a six-month virtual forecast", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastToggle")).toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBeGreaterThan(0);
  const horizonPoints = await page.locator("#chart").evaluate((element) => (
    (element.data || []).find((trace) => trace?.meta?.isAiForecastTrace)?.x?.length || 0
  ));
  expect(horizonPoints).toBe(127);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBe(0);
});

test("AI analysis loads only on demand and reuses its monthly browser cache", async ({ page }) => {
  let analysisRequests = 0;
  let releaseAnalysis;
  const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve; });
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    if (!localStorage.getItem("thinkstock-v5")) {
      localStorage.setItem("thinkstock-v5", JSON.stringify({
        customStocks: [{
          ticker: "005930.KS",
          name: "삼성전자",
          code: "005930",
          market: "KOSPI",
        }],
      }));
    }
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/analysis**", async (route) => {
    analysisRequests += 1;
    const ticker = new URL(route.request().url()).searchParams.get("ticker");
    await analysisGate;
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        ticker,
        savedAt: Date.now(),
        consensus: { ticker, targetPrice: 150000, opinion: 4.2, institutions: 6 },
        financials: [
          { ticker, period: "2024-12", frequency: "annual", revenue: 1000, operatingProfit: 80 },
          { ticker, period: "2025-12", frequency: "annual", revenue: 1300, operatingProfit: 160 },
          { ticker, period: "2025-12", frequency: "quarter", revenue: 300, operatingProfit: 32 },
          { ticker, period: "2026-03", frequency: "quarter", revenue: 390, operatingProfit: 58 },
        ],
      }),
    });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  expect(analysisRequests).toBe(0);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => analysisRequests).toBeGreaterThan(0);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "true");
  releaseAnalysis();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.fundamentalsUsed).length
  ))).toBeGreaterThan(0);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "false");

  const firstRequestCount = analysisRequests;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#aiForecastToggle")).toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.fundamentalsUsed).length
  ))).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(analysisRequests).toBe(firstRequestCount);
});

test("MACD toggle inserts a stock oscillator between the main and ADR charts", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      customStocks: [{
        ticker: "005930.KS",
        name: "삼성전자",
        code: "005930",
        market: "KOSPI",
      }],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-macd")).toBeHidden();

  await page.locator("#macdToggle").click();
  await expect(page.locator("#macdToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#chart-macd .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart-macd").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.macdSeriesKey).length
  ))).toBeGreaterThan(0);

  const macdPresentation = await page.evaluate(() => {
    const mainTraces = document.getElementById("chart")?.data || [];
    const macdElement = document.getElementById("chart-macd");
    const macdTraces = (macdElement?.data || []).filter((trace) => trace?.meta?.macdSeriesKey);
    return {
      labels: macdTraces.map((trace) => trace.name),
      colorsMatch: macdTraces.every((trace) => {
        const mainTrace = mainTraces.find((candidate) => (
          candidate?.meta?.seriesKey === trace.meta.macdSeriesKey
        ));
        return mainTrace?.line?.color === trace?.marker?.color;
      }),
      indicatorLabel: (macdElement?.layout?.annotations || []).some((annotation) => (
        annotation?.text === "MACD" && annotation?.xanchor === "left"
      )),
    };
  });
  expect(macdPresentation.labels).toContain("삼성전자");
  expect(macdPresentation.labels.every((label) => !label.endsWith(" MACD"))).toBe(true);
  expect(macdPresentation.colorsMatch).toBe(true);
  expect(macdPresentation.indicatorLabel).toBe(true);

  const positions = await page.evaluate(() => ({
    main: document.getElementById("chart").getBoundingClientRect().bottom,
    macdTop: document.getElementById("chart-macd").getBoundingClientRect().top,
    macdBottom: document.getElementById("chart-macd").getBoundingClientRect().bottom,
    adr: document.getElementById("chart-adr").getBoundingClientRect().top,
  }));
  expect(positions.macdTop).toBeGreaterThanOrEqual(positions.main);
  expect(positions.adr).toBeGreaterThanOrEqual(positions.macdBottom);

  await page.locator("#macdToggle").click();
  await expect(page.locator("#chart-macd")).toBeHidden();
});

test("macro refresh uses deployed data instead of browser ECOS or KOSIS requests", async ({ page }) => {
  let directMacroRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-api-v1", JSON.stringify({
      ecosApiKey: "saved-ecos-key",
      kosisApiKey: "saved-kosis-key",
    }));
  });
  await page.route("https://ecos.bok.or.kr/**", async (route) => {
    directMacroRequests += 1;
    await route.abort();
  });
  await page.route("https://kosis.kr/**", async (route) => {
    directMacroRequests += 1;
    await route.abort();
  });
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("thinkstock-api-v1"))).toBeNull();
  await page.locator("#refreshData").click();
  await expect(page.locator("#refreshData")).not.toHaveClass(/spinning/);

  expect(directMacroRequests).toBe(0);
  await expect(page.locator("#messageArea")).not.toContainText(/ECOS|KOSIS|Failed to fetch/);
});

test("startup loader releases before supplemental refresh finishes", async ({ page }) => {
  let releaseFearGreed;
  const fearGreedGate = new Promise((resolve) => { releaseFearGreed = resolve; });
  await page.route("https://kospi.feargreedchart.com/**", async (route) => {
    await fearGreedGate;
    await route.fulfill({
      status: 503,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: "{}",
    });
  });
  await stubExternalRefreshes(page, { stubFearGreed: false });

  try {
    await page.goto("/?e2e=1&perf=1", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => (
      window.ThinkStockE2E?.getRefreshPhaseStats?.().criticalReady || 0
    ))).toBeGreaterThan(0);
    await expect(page.locator("#chart .main-svg").first()).toBeVisible();
    await expect(page.locator(".hero h1")).not.toHaveClass(/is-loading/);
    expect(await page.evaluate(() => (
      window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
    ))).toBe(0);
    const startupPerf = await page.evaluate(() => window.ThinkStockPerf.summary());
    expect(startupPerf.appStarts).toBeGreaterThanOrEqual(1);
    expect(startupPerf.p95AppStartup).toBeLessThan(DESKTOP_PERF_BUDGET.maxAppStartup);
  } finally {
    releaseFearGreed();
  }

  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
  ))).toBeGreaterThan(0);
});

test("component snapshot restores the latest auxiliary data after reload", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const getHistoryRequests = await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();

  await page.evaluate(() => window.ThinkStockE2E.applyNewsSentimentForTest([
    { date: "2026-01-14", news_sentiment: 106.75 },
  ]));
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = element.data?.find((item) => item.name === "뉴스심리");
    const index = trace?.x?.indexOf("2026-01-14") ?? -1;
    return index >= 0 ? trace.y[index] : null;
  })).toBe(106.75);
  await page.evaluate(() => window.ThinkStockE2E.saveRuntimeSnapshotNow());

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = element.data?.find((item) => item.name === "뉴스심리");
    const index = trace?.x?.indexOf("2026-01-14") ?? -1;
    return index >= 0 ? trace.y[index] : null;
  })).toBe(106.75);
  expect(getHistoryRequests()).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("credit offset moves dates without changing the credit curve", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 120,
      hiddenSeries: ["leading_cycle", "^KQ11", "customer_deposit", "kosdaq_credit"],
      customStocks: [],
      creditOffset: 0,
      showDisclosures: false,
      hoverShowPopup: false,
    }));
  });
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const readCurves = () => page.locator("#chart").evaluate((element) => {
    const credit = element.data?.find((trace) => trace?.meta?.seriesKey === "kospi_credit");
    const price = element.data?.find((trace) => trace?.meta?.seriesKey === "^KS11");
    return {
      creditX: [...credit.x],
      creditY: [...credit.y],
      priceX: [...price.x],
      priceY: [...price.y],
    };
  });
  const zeroOffset = await readCurves();
  const input = page.locator("#creditOffset");
  await input.fill("-2");
  await input.dispatchEvent("change");
  await expect.poll(async () => (await readCurves()).creditX[0])
    .not.toBe(zeroOffset.creditX[0]);
  const shifted = await readCurves();
  const shiftedDates = zeroOffset.creditX.map((dateText) => {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 2);
    return date.toISOString().slice(0, 10);
  });

  expect(shifted.creditX).toEqual(shiftedDates);
  expect(shifted.creditY).toEqual(zeroOffset.creditY);
  expect(shifted.priceX).toEqual(zeroOffset.priceX);
  expect(shifted.priceY).toEqual(zeroOffset.priceY);
});

test("chart, disclosure popover, and lazy history remain interactive", async ({ page, isMobile }) => {
  let diagnosticsRequests = 0;
  await page.route("**/modules/performance-diagnostics.js*", async (route) => {
    diagnosticsRequests += 1;
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 120,
      hiddenSeries: ["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit"],
      customStocks: [{ ticker: "005930.KS", name: "삼성전자" }],
      showDisclosures: true,
      hoverShowPopup: false,
    }));
  });
  const getHistoryRequests = await installDataRoutes(page);
  await page.goto("/?e2e=1&perf=1", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#appVersionText")).toHaveText(/^\d+\.\d+$/);
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.ThinkStockPerformanceDiagnostics))).toBe(false);
  await page.locator("#apiOptionsBtn").click();
  await page.locator("#performanceDiagnosticsBtn").click();
  await expect(page.locator("#performanceDiagnosticsPanel")).toBeVisible();
  await expect(page.locator("#performanceDiagnosticsSummary")).toContainText("현재");
  expect(diagnosticsRequests).toBe(1);
  expect(await page.evaluate(() => Boolean(window.ThinkStockPerformanceDiagnostics))).toBe(true);
  await page.locator("#apiSettingsCloseBtn").click();
  await expect(page.locator("#apiSettingsModal")).toBeHidden();
  await expect(page.locator('[data-series="customer_deposit"]')).toBeVisible();
  await expect(page.locator('[data-series="news_sentiment"]')).toHaveCount(0);
  expect(await page.locator("#chart-adr").evaluate((element) => (
    element.data?.some((trace) => trace.name === "공포탐욕" && trace.yaxis === "y2")
      && element.data?.some((trace) => trace.name === "뉴스심리" && trace.yaxis === "y3")
  ))).toBe(true);
  const depositToggle = page.locator('[data-series="customer_deposit"]');
  await expect(depositToggle).toHaveClass(/is-off/);
  await depositToggle.click();
  await expect(depositToggle).toHaveClass(/is-on/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.seriesKey === "customer_deposit")?.visible
  ))).toBe(true);
  await depositToggle.click();
  await expect(depositToggle).toHaveClass(/is-off/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.seriesKey === "customer_deposit")?.visible
  ))).toBe("legendonly");

  const fearGreedLegend = page.locator("#chart-adr .legend .traces")
    .filter({ hasText: "공포탐욕" });
  await expect(fearGreedLegend).toBeVisible();
  await expect(fearGreedLegend).toHaveCSS("cursor", "pointer");
  await expect(fearGreedLegend.locator(".legendtext")).toHaveCSS("cursor", "pointer");
  await expect(fearGreedLegend.locator(".legendtoggle")).toHaveCSS("cursor", "pointer");
  await fearGreedLegend.click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.auxiliarySeriesKey === "fear_greed")?.visible
  ))).toBe("legendonly");
  await page.locator('.range-btn[data-months="36"]').click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.auxiliarySeriesKey === "fear_greed")?.visible
  ))).toBe("legendonly");
  await fearGreedLegend.click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.auxiliarySeriesKey === "fear_greed")?.visible
  ))).toBe(true);
  expect(await page.locator("#chart-adr").evaluate((element) => {
    const labels = (element.layout?.annotations || []).map((item) => item.text);
    const boundaryLines = (element.layout?.shapes || []).filter((item) => (
      item.type === "line" && item.yref === "y2" && item.line?.dash === "dash"
    ));
    const newsBoundaryLines = (element.layout?.shapes || []).filter((item) => (
      item.type === "line" && item.yref === "y3" && item.line?.dash === "dash"
    ));
    const separators = (element.layout?.shapes || [])
      .filter((item) => item.type === "line" && item.yref === "paper")
      .map((item) => item.y0);
    return labels.includes("공포")
      && labels.includes("탐욕")
      && boundaryLines.length === 2
      && labels.includes("부정")
      && labels.includes("긍정")
      && newsBoundaryLines.length === 2
      && separators.includes(0.54)
      && separators.includes(0.25)
      && element.layout?.yaxis?.domain?.[0] === 0.58
      && Math.abs(element.layout?.yaxis2?.domain?.[1] - element.layout?.yaxis2?.domain?.[0] - 0.21) < 0.001
      && Math.abs(element.layout?.yaxis3?.domain?.[1] - element.layout?.yaxis3?.domain?.[0] - 0.21) < 0.001;
  })).toBe(true);
  expect(await page.evaluate(() => window.ThinkStockE2E?.getChartModelSource?.())).toBe("worker");
  expect(await page.evaluate(() => window.ThinkStockE2E?.getAuxiliaryChartModelSource?.())).toBe("worker");
  expect(getHistoryRequests()).toBe(0);
  await expect(page.locator(".hero h1")).not.toHaveClass(/is-loading/);
  expect(await page.evaluate(() => window.ThinkStockE2E?.getMainHoverMode?.())).toBe(false);
  await page.evaluate(() => window.ThinkStockPerf?.clear?.());
  const dartCode = await page.evaluate(() => window.ThinkStockE2E.loadDartCorpCodeForTest("005930"));
  expect(dartCode).toEqual({
    loaded: true,
    corpCode: "00126380",
    shards: ["00"],
  });

  const middleUpdateBefore = await page.evaluate(() => ({
    revisions: window.ThinkStockE2E.getRuntimeSnapshotStats().revisions,
    worker: window.ThinkStockE2E.getChartWorkerStats(),
  }));
  expect(await page.evaluate(() => window.ThinkStockE2E.applyNewsSentimentForTest([
    { date: "2026-01-14", news_sentiment: 107.25 },
  ]))).toMatchObject({ updated: 1, latestDate: "2026-01-14" });
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = element.data?.find((item) => item.name === "뉴스심리");
    const index = trace?.x?.indexOf("2026-01-14") ?? -1;
    return index >= 0 ? trace.y[index] : null;
  })).toBe(107.25);
  const middleUpdateAfter = await page.evaluate(() => ({
    revisions: window.ThinkStockE2E.getRuntimeSnapshotStats().revisions,
    worker: window.ThinkStockE2E.getChartWorkerStats(),
  }));
  expect(middleUpdateAfter.revisions.macro).toBeGreaterThan(middleUpdateBefore.revisions.macro);
  expect(middleUpdateAfter.worker.sourceTransfers).toBeGreaterThan(middleUpdateBefore.worker.sourceTransfers);

  const togglePerfBefore = await page.evaluate(() => ({
    generation: window.ThinkStockE2E.getChartRenderGeneration(),
    ...window.ThinkStockE2E.getChartWorkerStats(),
  }));
  await page.locator('[data-series="customer_deposit"]').click();
  await expect(page.locator('[data-series="customer_deposit"]')).toHaveClass(/is-on/);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates
  ))).toBeGreaterThan(togglePerfBefore.partialDisclosureUpdates);
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartRenderGeneration()))
    .toBe(togglePerfBefore.generation);
  expect((await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats())).dispatched)
    .toBe(togglePerfBefore.dispatched);

  const dragPerfBefore = await page.evaluate(() => ({
    generation: window.ThinkStockE2E.getChartRenderGeneration(),
    ...window.ThinkStockE2E.getChartWorkerStats(),
  }));
  const dragResult = await page.locator("#chart").evaluate((element) => {
    const traceIndex = element.data.findIndex((trace) => (
      trace?.visible !== "legendonly" && !trace?.meta?.isDisclosureTrace && Array.isArray(trace?.y)
    ));
    const trace = element.data[traceIndex];
    const pointIndex = Math.max(0, Math.floor(trace.x.length / 2));
    const xaxis = element._fullLayout.xaxis;
    const yaxis = element._fullLayout.yaxis;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + xaxis._offset + xaxis.d2p(trace.x[pointIndex]);
    const clientY = rect.top + yaxis._offset + yaxis.d2p(trace.y[pointIndex]);
    const before = trace.y[pointIndex];
    element.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: clientY + 36,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: clientY + 36,
      button: 0,
      buttons: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }));
    return { before, traceIndex, pointIndex };
  });
  await expect.poll(() => page.locator("#chart").evaluate((element, drag) => (
    element.data?.[drag.traceIndex]?.y?.[drag.pointIndex]
  ), dragResult)).not.toBe(dragResult.before);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates
  ))).toBeGreaterThan(dragPerfBefore.partialDisclosureUpdates);
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartRenderGeneration()))
    .toBe(dragPerfBefore.generation);
  const dragPerfAfter = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());
  expect(dragPerfAfter.dispatched).toBe(dragPerfBefore.dispatched);
  expect(dragPerfAfter.sourceTransfers).toBe(dragPerfBefore.sourceTransfers);
  expect((await page.evaluate(() => window.ThinkStockE2E.getHighlightStats())).lineDomUpdates)
    .toBeGreaterThan(0);
  if (!isMobile) {
    const linePath = page.locator("#chart .scatterlayer .js-line").first();
    await expect(linePath).toBeVisible();
    await expect.poll(async () => {
      const linePointerPoint = await linePath.evaluate((path) => {
        const point = path.getPointAtLength(path.getTotalLength() / 3);
        const matrix = path.getScreenCTM();
        return {
          x: point.x * matrix.a + point.y * matrix.c + matrix.e,
          y: point.x * matrix.b + point.y * matrix.d + matrix.f,
        };
      });
      await page.mouse.move(linePointerPoint.x + 1, linePointerPoint.y);
      await page.mouse.move(linePointerPoint.x, linePointerPoint.y);
      return page.locator("#chart").evaluate((element) => ({
        hovering: element.classList.contains("is-line-hovering"),
        cursor: getComputedStyle(element).cursor,
      }));
    }).toEqual({ hovering: true, cursor: "pointer" });

    await expect.poll(async () => {
      const chartBox = await page.locator("#chart").boundingBox();
      await page.mouse.move(chartBox.x + 6, chartBox.y + 6);
      return page.locator("#chart").evaluate((element) => getComputedStyle(element).cursor);
    }).toBe("default");
  }

  const disclosureToggleBefore = await page.evaluate(() => ({
    generation: window.ThinkStockE2E.getChartRenderGeneration(),
    partial: window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates,
  }));
  await page.locator("#disclosureToggle").click();
  await expect(page.locator("#chart .textpoint text").filter({ hasText: "◆" })).toHaveCount(0);
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartRenderGeneration()))
    .toBe(disclosureToggleBefore.generation);
  await page.locator("#disclosureToggle").click();
  await expect(page.locator("#chart .textpoint text").filter({ hasText: "◆" }).first()).toBeVisible();
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartRenderGeneration()))
    .toBe(disclosureToggleBefore.generation);
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates))
    .toBeGreaterThan(disclosureToggleBefore.partial);

  const disclosureText = page.locator("#chart .textpoint text").filter({ hasText: "◆" }).first();
  await expect(disclosureText).toBeVisible();
  const getDisclosurePoint = () => page.locator("#chart").evaluate((element) => {
    const icon = [...element.querySelectorAll(".textpoint text")]
      .find((node) => node.textContent?.trim() === "◆");
    const textRect = icon?.getBoundingClientRect();
    if (!textRect?.width || !textRect?.height) return null;
    return {
      x: textRect.left + textRect.width * 0.5,
      y: textRect.top + textRect.height * 0.5,
    };
  });
  let disclosurePoint = await getDisclosurePoint();
  expect(disclosurePoint).not.toBeNull();
  const popover = page.locator("#chart .disclosure-popover");
  if (!isMobile) {
    await page.mouse.move(disclosurePoint.x, disclosurePoint.y);
    await expect(page.locator("#chart")).toHaveClass(/is-disclosure-hovering/);
    await expect.poll(() => page.locator("#chart").evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
    await expect.poll(() => page.evaluate(() => (
      window.ThinkStockE2E.getHighlightStats().disclosureDomUpdates
    ))).toBeGreaterThan(0);
  }
  if (isMobile) {
    await page.touchscreen.tap(disclosurePoint.x, disclosurePoint.y + 80);
  } else {
    await page.mouse.click(disclosurePoint.x, disclosurePoint.y + 80);
    await page.mouse.move(disclosurePoint.x - 70, disclosurePoint.y + 80);
    await page.mouse.down();
    await page.mouse.move(disclosurePoint.x + 70, disclosurePoint.y + 80, { steps: 5 });
    await page.mouse.up();
  }
  await expect(popover).toBeHidden();
  expect(await page.evaluate(() => window.ThinkStockE2E?.openFirstDisclosure?.(0, 80))).toBe(false);

  disclosurePoint = await getDisclosurePoint();
  expect(disclosurePoint).not.toBeNull();

  if (isMobile) {
    await page.touchscreen.tap(disclosurePoint.x, disclosurePoint.y);
  } else {
    await page.mouse.click(disclosurePoint.x, disclosurePoint.y);
  }
  if (isMobile && !await popover.isVisible()) {
    const opened = await page.evaluate(() => window.ThinkStockE2E?.openFirstDisclosure?.());
    expect(opened).toBe(true);
  }
  await expect(popover).toBeVisible();
  await expect(popover.locator(".disclosure-title-link")).toHaveAttribute("href", "https://dart.fss.or.kr/example");
  const chartBox = await page.locator("#chart").boundingBox();
  const popoverBox = await popover.boundingBox();
  expect(chartBox).not.toBeNull();
  expect(popoverBox).not.toBeNull();
  const marginCandidates = [
    { x: chartBox.x + 6, y: chartBox.y + 6 },
    { x: chartBox.x + chartBox.width - 6, y: chartBox.y + 6 },
    { x: chartBox.x + 6, y: chartBox.y + chartBox.height - 6 },
    { x: chartBox.x + chartBox.width - 6, y: chartBox.y + chartBox.height - 6 },
  ];
  const outsidePoint = marginCandidates.find((point) => (
    point.x < popoverBox.x
    || point.x > popoverBox.x + popoverBox.width
    || point.y < popoverBox.y
    || point.y > popoverBox.y + popoverBox.height
  ));
  expect(outsidePoint).toBeTruthy();
  if (isMobile) {
    await page.touchscreen.tap(outsidePoint.x, outsidePoint.y);
  } else {
    await page.mouse.click(outsidePoint.x, outsidePoint.y);
  }
  await expect(popover).toBeHidden();

  expect(await page.evaluate(() => window.ThinkStockE2E?.openFirstDisclosure?.())).toBe(true);
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "공시 닫기" }).click();
  await expect(popover).toBeHidden();

  await page.evaluate(() => window.ThinkStockE2E.saveRuntimeSnapshotNow());
  const snapshotStatsBefore = await page.evaluate(() => window.ThinkStockE2E.getRuntimeSnapshotStats());
  const runtimeCacheKeys = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("thinkstock-runtime-cache-v1", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("snapshots", "readonly");
      const keysRequest = tx.objectStore("snapshots").getAllKeys();
      keysRequest.onsuccess = () => {
        resolve(keysRequest.result.map(String).sort());
        db.close();
      };
      keysRequest.onerror = () => reject(keysRequest.error);
    };
  }));
  expect(runtimeCacheKeys).toEqual([
    "component:adr",
    "component:credit",
    "component:disclosure",
    "component:macro",
    "component:price",
    "latest",
  ]);
  await page.evaluate(() => window.ThinkStockE2E.saveRuntimeSnapshotNow());
  const snapshotStatsAfter = await page.evaluate(() => window.ThinkStockE2E.getRuntimeSnapshotStats());
  expect(snapshotStatsAfter.builds).toBe(snapshotStatsBefore.builds);
  expect(snapshotStatsAfter.writes).toBe(snapshotStatsBefore.writes);
  expect(snapshotStatsAfter.componentWrites).toBe(snapshotStatsBefore.componentWrites);
  expect(snapshotStatsAfter.skips).toBeGreaterThan(snapshotStatsBefore.skips);

  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("thinkstock-runtime-cache-v1", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("tickerPrices", "readwrite");
      const store = tx.objectStore("tickerPrices");
      const now = Date.now();
      for (let index = 1; index <= 5; index += 1) {
        const ticker = `${String(index).padStart(6, "0")}.KS`;
        store.put({ ticker, savedAt: now - index, lastAccessed: now - index }, ticker);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  const cleanupBefore = await page.evaluate(() => window.ThinkStockE2E.getCacheCleanupStats());
  await page.evaluate(() => window.ThinkStockE2E.pruneGranularCacheForTest("tickerPrices", 2));
  const remainingTickerCacheKeys = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("thinkstock-runtime-cache-v1", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("tickerPrices", "readonly");
      const keysRequest = tx.objectStore("tickerPrices").getAllKeys();
      keysRequest.onsuccess = () => { resolve(keysRequest.result.map(String).sort()); db.close(); };
      keysRequest.onerror = () => reject(keysRequest.error);
    };
  }));
  const cleanupAfter = await page.evaluate(() => window.ThinkStockE2E.getCacheCleanupStats());
  expect(remainingTickerCacheKeys).toEqual(["000001.KS", "000002.KS"]);
  expect(cleanupAfter.transactions - cleanupBefore.transactions).toBe(1);
  expect(cleanupAfter.deleted - cleanupBefore.deleted).toBe(3);

  if (!isMobile) {
    await page.evaluate(() => window.ThinkStockPerf?.clear?.());
    await page.waitForTimeout(100);
    for (let index = 0; index < 32; index += 1) {
      const ratio = index % 2 === 0 ? index / 31 : (31 - index) / 31;
      await page.mouse.move(
        chartBox.x + 50 + ratio * Math.max(1, chartBox.width - 100),
        chartBox.y + chartBox.height * (0.35 + (index % 3) * 0.12),
      );
    }
    await page.waitForTimeout(400);
    const perfSummary = await page.evaluate(() => window.ThinkStockPerf.summary());
    expect(perfSummary.pointerMoves).toBeGreaterThanOrEqual(DESKTOP_PERF_BUDGET.minPointerMoves);
    expect(perfSummary.frames).toBeGreaterThanOrEqual(DESKTOP_PERF_BUDGET.minFrames);
    expect(perfSummary.p95PointerMove).toBeLessThan(DESKTOP_PERF_BUDGET.maxP95PointerMove);
    expect(perfSummary.maxPointerMove).toBeLessThan(DESKTOP_PERF_BUDGET.maxPointerMove);
    expect(perfSummary.p95FrameGap).toBeLessThan(DESKTOP_PERF_BUDGET.maxP95FrameGap);
    expect(perfSummary.longFrameRatio).toBeLessThan(DESKTOP_PERF_BUDGET.maxLongFrameRatio);
  }

  const revisionsBeforeHistory = snapshotStatsAfter.revisions;
  const workerStatsBeforeHistory = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());
  await page.locator('.range-btn[data-months="360"]').click();
  await expect.poll(getHistoryRequests).toBe(4);
  await expect(page.locator('.range-btn[data-months="360"]')).toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => element.data?.[0]?.x?.[0]))
    .toBe("1998-07-14");
  const revisionsAfterHistory = await page.evaluate(() => window.ThinkStockE2E.getRuntimeSnapshotStats().revisions);
  expect(revisionsAfterHistory.price).toBeGreaterThan(revisionsBeforeHistory.price);
  expect(revisionsAfterHistory.macro).toBeGreaterThan(revisionsBeforeHistory.macro);
  expect(revisionsAfterHistory.credit).toBeGreaterThan(revisionsBeforeHistory.credit);
  const workerStatsAfterHistory = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());
  expect(workerStatsAfterHistory.sourceTransfers).toBeGreaterThan(workerStatsBeforeHistory.sourceTransfers);
  expect(workerStatsAfterHistory.partialChartUpdates)
    .toBeGreaterThan(workerStatsBeforeHistory.partialChartUpdates);
  expect(workerStatsAfterHistory.fullChartRenders).toBe(workerStatsBeforeHistory.fullChartRenders);
  const renderPerf = await page.evaluate(() => window.ThinkStockPerf.summary());
  expect(renderPerf.renderCharts).toBeGreaterThan(0);
  expect(renderPerf.p95RenderChart).toBeLessThan(DESKTOP_PERF_BUDGET.maxP95RenderChart);
  expect(renderPerf.p95AuxiliaryRender).toBeLessThan(DESKTOP_PERF_BUDGET.maxP95AuxiliaryRender);
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getCacheCleanupStats().runs))
    .toBeGreaterThan(0);
});
