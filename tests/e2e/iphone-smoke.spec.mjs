import { expect, test } from "@playwright/test";

const ADMIN_ACCESS_STORAGE_KEY = "thinkstock-admin-access-v1";
const ADMIN_ACCESS_HASH = "5b7a763e921d64f5a8ff38a62819a789ec90c8198700672a7929fff376ca3d58";
const recentDates = ["2025-07-14", "2025-10-14", "2026-01-14", "2026-04-14", "2026-07-14"];
const historyDates = ["1998-07-14", "2005-07-14", "2012-07-14"];
const DESKTOP_PERF_BUDGET = Object.freeze({
  minPointerMoves: 20,
  minFrames: 20,
  maxP95PointerMove: 20,
  maxPointerMove: 50,
  maxP95FrameGap: 180,
  maxLongFrameRatio: 0.70,
  maxP95RenderChart: 2000,
  maxP95AuxiliaryRender: 1200,
  maxAppStartup: 4500,
});

test.beforeEach(async ({ page }, testInfo) => {
  const shouldStartLocked = testInfo.title === "general mode locks private analysis features"
    || testInfo.title === "administrator code unlocks private analysis features";
  await page.addInitScript(({ key, hash }) => {
    if (hash) localStorage.setItem(key, hash);
    else localStorage.removeItem(key);
  }, { key: ADMIN_ACCESS_STORAGE_KEY, hash: shouldStartLocked ? "" : ADMIN_ACCESS_HASH });
});

async function setChartRangeMonths(page, targetMonths) {
  const stepper = page.locator("#chartRangeStepper");
  for (let step = 0; step < 12; step += 1) {
    const currentMonths = Number(await stepper.getAttribute("data-months"));
    if (currentMonths === targetMonths) return;
    const selector = currentMonths < targetMonths ? "#rangeExpand" : "#rangeContract";
    await page.locator(selector).click();
    await expect.poll(async () => Number(await stepper.getAttribute("data-months")))
      .not.toBe(currentMonths);
  }
  throw new Error(`Unable to reach ${targetMonths} months with the chart range stepper`);
}

async function waitForBoundingBox(locator) {
  let box = null;
  let previousKey = "";
  await expect.poll(async () => {
    box = await locator.boundingBox();
    if (!box) return false;
    const key = [box.x, box.y, box.width, box.height].map((value) => value.toFixed(2)).join(":");
    const stable = key === previousKey;
    previousKey = key;
    return stable;
  }).toBe(true);
  return box;
}

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
  // Keep the seeded personal token valid while startup checks recent ECOS changes.
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/macro**", async (route) => {
    await route.fulfill({ json: { ok: true, leadingRows: [], newsRows: [] } });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/credit**", async (route) => {
    await route.fulfill({ json: { ok: true, rows: [] } });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/crisis-signal**", async (route) => {
    await route.fulfill({ json: { ok: true, records: [] } });
  });
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
  await page.route("**/api/prices?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    await route.fulfill({ json: {
      ok: true,
      ticker,
      source: "KRX",
      latestDate: "",
      records: [],
    } });
  });
  await stubExternalRefreshes(page);
  return () => historyRequests;
}

test("new stock loads its own Cloudflare DART disclosures", async ({ page }) => {
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "e2e-token" }));
  });
  let newStockDisclosureRequests = 0;
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
    if (ticker !== "000660.KS") {
      await route.fallback();
      return;
    }
    newStockDisclosureRequests += 1;
    forcedNewStockDisclosures.push(requestUrl.searchParams.get("force"));
    if (newStockDisclosureRequests === 1) {
      await route.fulfill({ json: {
        ok: true,
        ticker,
        cached: true,
        records: [],
        nextPage: null,
        complete: true,
      } });
      return;
    }
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
  await expect.poll(() => page.locator("#chart").evaluate((element) => ({
    xRange: [...element._fullLayout.xaxis.range],
    yRange: [...element._fullLayout.yaxis.range],
  }))).toEqual(lockedViewport);
  await expect.poll(() => newStockDisclosureRequests).toBe(2);
  expect(forcedNewStockDisclosures).toEqual([null, "1"]);
  await expect(page.locator("#chart .textpoint text").filter({ hasText: "◆" }).first()).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const stockTrace = (element.data || []).find((trace) => trace?.meta?.seriesKey === "000660.KS");
    const disclosureTrace = (element.data || []).find((trace) => trace?.meta?.isDisclosureTrace);
    const markerColors = disclosureTrace?.textfont?.color;
    return Array.isArray(markerColors) && markerColors.includes(stockTrace?.line?.color);
  })).toBe(true);
  releaseNewStockAnalysis();
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 10000 });
});

test("general mode locks private analysis features", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      showInsiderTrades: true,
      showCoMovement: true,
      showRecessionSignals: true,
      showDisclosures: true,
      showMacdOscillator: true,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  for (const id of ["disclosureToggle", "insiderTradeToggle", "coMovementToggle", "recessionToggle", "aiForecastToggle", "macdToggle"]) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.locator("#coMovementPanel")).toBeHidden();
});

test("administrator code unlocks private analysis features", async ({ page }) => {
  const adminCode = process.env.THINKSTOCK_TEST_ADMIN_CODE;
  test.skip(!adminCode, "THINKSTOCK_TEST_ADMIN_CODE is required for this local-only check");
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
  for (const id of ["disclosureToggle", "insiderTradeToggle", "coMovementToggle", "recessionToggle", "aiForecastToggle", "macdToggle"]) {
    await expect(page.locator(`#${id}`)).toBeEnabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-disabled", "false");
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), ADMIN_ACCESS_STORAGE_KEY))
    .toBe(ADMIN_ACCESS_HASH);
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
  await expect(page.locator(".range-btn")).toHaveCount(0);
  await expect(page.locator("#rangeExpand")).toBeVisible();
  await expect(page.locator("#rangeContract")).toBeVisible();
  await expect(page.locator("#rangeExpand .range-zoom-symbol")).toHaveText(/[\-\u2212]/);
  await expect(page.locator("#rangeContract .range-zoom-symbol")).toHaveText("+");
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#resetHandles")).toHaveClass(/is-active/);
  const rangeControlLayout = await page.locator(".chart-refresh-tools").evaluate((tools) => {
    const refresh = tools.querySelector("#refreshData")?.getBoundingClientRect();
    const expand = tools.querySelector("#rangeExpand")?.getBoundingClientRect();
    const contract = tools.querySelector("#rangeContract")?.getBoundingClientRect();
    const status = tools.parentElement?.querySelector("#runtimeRefreshStatus");
    const wasHidden = status?.hidden;
    if (status) status.hidden = false;
    const statusRect = status?.getBoundingClientRect();
    if (status) status.hidden = wasHidden;
    return refresh && expand && contract && statusRect ? {
      refreshBottom: refresh.bottom,
      refreshLeft: refresh.left,
      expandTop: expand.top,
      expandBottom: expand.bottom,
      contractTop: contract.top,
      contractBottom: contract.bottom,
      centerSpread: Math.max(
        refresh.left + refresh.width / 2,
        expand.left + expand.width / 2,
        contract.left + contract.width / 2,
      ) - Math.min(
        refresh.left + refresh.width / 2,
        expand.left + expand.width / 2,
        contract.left + contract.width / 2,
      ),
      statusRight: statusRect.right,
    } : null;
  });
  expect(rangeControlLayout?.contractTop).toBeGreaterThanOrEqual(rangeControlLayout?.refreshBottom || 0);
  expect(rangeControlLayout?.expandTop).toBeGreaterThanOrEqual(rangeControlLayout?.contractBottom || 0);
  expect(rangeControlLayout?.centerSpread).toBeLessThanOrEqual(1);
  expect(rangeControlLayout?.statusRight).toBeLessThanOrEqual(rangeControlLayout?.refreshLeft || 0);
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
  expect((chartBox.x + chartBox.width) - (refreshBox.x + refreshBox.width)).toBeGreaterThanOrEqual(30);
  expect((chartBox.x + chartBox.width) - (refreshBox.x + refreshBox.width)).toBeLessThanOrEqual(38);
  const chartControlLayout = await page.locator(".main-chart-wrap").evaluate((container) => {
    const chartRect = container.querySelector("#chart").getBoundingClientRect();
    return ["resetHandles", "coMovementToggle", "aiForecastToggle", "macdToggle"].map((id) => {
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
  const firstChartDate = await page.locator("#chart").evaluate((element) => element.data?.[0]?.x?.[0]);
  expect(firstChartDate).toMatch(/^2016-/);
  expect(pageErrors).toEqual([]);
});

test("auto chart reset ignores saved series transforms", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      autoChartReset: true,
      hiddenSeries: ["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit"],
      seriesOffsets: { kospi_credit: 42 },
      seriesScales: { kospi_credit: 0.1 },
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
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
  const zoomDrag = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    return {
      startX: rect.left + axis._offset + axis._length * 0.55,
      endX: rect.left + axis._offset + axis._length * 0.8,
      y: rect.top + 2,
      span: Math.abs(Date.parse(axis.range[1]) - Date.parse(axis.range[0])),
    };
  });
  await page.locator("#chart").dispatchEvent("pointerdown", {
    pointerId: 29,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: zoomDrag.startX,
    clientY: zoomDrag.y,
  });
  await page.evaluate(({ endX, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 29, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: endX, clientY: y,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 29, pointerType: "mouse", isPrimary: true, button: 0, clientX: endX, clientY: y,
    }));
  }, zoomDrag);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    return end - start;
  })).toBeLessThan(zoomDrag.span * 0.5);
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
});

test("locked chart frame stays fixed and scale handles follow the visible endpoint", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  if (await page.locator("#resetHandles").getAttribute("aria-pressed") === "true") {
    await page.locator("#resetHandles").click();
  }
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "false");
  const yRangeBefore = await page.locator("#chart").evaluate((element) => [...element._fullLayout.yaxis.range]);
  const xRangeBefore = await page.locator("#chart").evaluate((element) => [...element._fullLayout.xaxis.range]);

  await page.locator("#chartHistorySlider").evaluate((slider) => {
    slider.value = "0";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => element._fullLayout.xaxis.range[0]))
    .not.toBe(xRangeBefore[0]);
  const yRangeAfter = await page.locator("#chart").evaluate((element) => [...element._fullLayout.yaxis.range]);
  expect(yRangeAfter[0]).toBeCloseTo(yRangeBefore[0], 6);
  expect(yRangeAfter[1]).toBeCloseTo(yRangeBefore[1], 6);

  await page.locator("#chartHistorySlider").evaluate((slider) => {
    slider.value = slider.max;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => element._fullLayout.xaxis.range[1]))
    .toBe(xRangeBefore[1]);
  await page.locator("#chart").evaluate(async (element) => {
    const trace = element.data.find((item) => item?.meta?.seriesKey === "^KS11");
    const left = trace.x[Math.floor(trace.x.length * 0.35)];
    const right = trace.x[Math.floor(trace.x.length * 0.65)];
    await window.Plotly.relayout(element, { "xaxis.range": [left, right] });
  });
  await expect.poll(async () => Number(await page.locator("#chartHistorySlider").inputValue()))
    .toBeLessThan(900);
  const sliderViewportBefore = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));
  await page.locator("#chartHistorySlider").evaluate((slider) => {
    slider.value = String(Math.max(Number(slider.min), Number(slider.value) - 100));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element._fullLayout.xaxis.range[0])
  ))).toBeLessThan(sliderViewportBefore[0]);
  const sliderViewportAfter = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));
  expect(sliderViewportAfter[1] - sliderViewportAfter[0])
    .toBeCloseTo(sliderViewportBefore[1] - sliderViewportBefore[0], -3);
  const repeatedZoomStart = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    return {
      range: element._fullLayout.xaxis.range.map(Date.parse),
      startX: rect.left + axis._offset + axis._length * 0.2,
      endX: rect.left + axis._offset + axis._length * 0.7,
      y: rect.top + 2,
    };
  });
  await page.locator("#chart").dispatchEvent("pointerdown", {
    pointerId: 27,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: repeatedZoomStart.startX,
    clientY: repeatedZoomStart.y,
  });
  await page.evaluate(({ endX, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 27, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: endX, clientY: y,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 27, pointerType: "mouse", isPrimary: true, button: 0, clientX: endX, clientY: y,
    }));
  }, repeatedZoomStart);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    return end - start;
  })).toBeLessThan((repeatedZoomStart.range[1] - repeatedZoomStart.range[0]) * 0.7);
  const touchZoomStart = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element._fullLayout.xaxis;
    return {
      range: element._fullLayout.xaxis.range.map(Date.parse),
      startX: rect.left + axis._offset + axis._length * 0.2,
      endX: rect.left + axis._offset + axis._length * 0.7,
      y: rect.top + 2,
    };
  });
  await page.locator("#chart").dispatchEvent("pointerdown", {
    pointerId: 28,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: touchZoomStart.startX,
    clientY: touchZoomStart.y,
  });
  await page.locator("#chart").dispatchEvent("pointermove", {
    pointerId: 28,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
    clientX: touchZoomStart.endX,
    clientY: touchZoomStart.y,
  });
  await page.locator("#chart").dispatchEvent("pointerup", {
    pointerId: 28,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: touchZoomStart.endX,
    clientY: touchZoomStart.y,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    return end - start;
  })).toBeLessThan((touchZoomStart.range[1] - touchZoomStart.range[0]) * 0.7);

  const handle = page.locator('.y-handle-right[data-series-key="^KS11"]');
  await expect(handle).toBeVisible();
  const box = await waitForBoundingBox(handle);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 18);
  await page.mouse.up();
  await expect(handle).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const trace = element.data.find((item) => item?.meta?.seriesKey === "^KS11");
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    let last = null;
    trace.x.forEach((date, index) => {
      const time = Date.parse(date);
      if (time >= start && time <= end && Number.isFinite(Number(trace.y[index]))) last = Number(trace.y[index]);
    });
    const handleNode = document.querySelector('.y-handle-right[data-series-key="^KS11"]');
    const expectedTop = element._fullLayout.yaxis._offset + element._fullLayout.yaxis.l2p(last) - 7;
    return Math.abs(Number.parseFloat(handleNode.style.top) - expectedTop);
  })).toBeLessThanOrEqual(1);
});

test("AI toggle draws and removes a six-month virtual forecast", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#aiForecastProgress")).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBeGreaterThan(0);
  const scenarioSummary = await page.locator("#chart").evaluate((element) => {
    const traces = (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace);
    return {
      count: traces.length,
      roles: [...new Set(traces.map((trace) => trace.meta.aiTraceRole))].sort(),
      endpoints: traces.map((trace) => String(trace.text?.at(-1) || "")),
      hasMacroIndex: traces.some((trace) => trace.meta.forecastMode === "macro-index"),
      styles: traces.map((trace) => ({
        series: trace.meta.seriesKey,
        probability: Number(trace.meta.scenarioProbability),
        primary: trace.meta.isPrimaryAiScenario === true,
        width: Number(trace.line?.width),
        color: String(trace.line?.color || ""),
      })),
    };
  });
  expect(scenarioSummary.count).toBeGreaterThanOrEqual(3);
  expect(scenarioSummary.count % 3).toBe(0);
  expect(scenarioSummary.roles).toEqual(["downside", "sideways", "upside"]);
  expect(scenarioSummary.endpoints.every((text) => /\d+% · .+/.test(text))).toBe(true);
  expect(scenarioSummary.hasMacroIndex).toBe(true);
  const scenarioStyleGroups = Map.groupBy(scenarioSummary.styles, (style) => style.series);
  scenarioStyleGroups.forEach((styles) => {
    const highestProbability = Math.max(...styles.map((style) => style.probability));
    const primaryStyles = styles.filter((style) => style.primary);
    expect(primaryStyles.length).toBeGreaterThan(0);
    expect(primaryStyles.every((style) => style.probability === highestProbability)).toBe(true);
    expect(primaryStyles.every((style) => style.width === 2.9)).toBe(true);
    expect(primaryStyles.every((style) => style.color.includes("248, 248, 248"))).toBe(true);
    expect(styles.filter((style) => !style.primary).every((style) => style.width < 2.9)).toBe(true);
  });
  const horizonPoints = await page.locator("#chart").evaluate((element) => (
    (element.data || []).find((trace) => trace?.meta?.isAiForecastTrace)?.x?.length || 0
  ));
  expect(horizonPoints).toBe(127);
  const observedEnd = await page.locator("#chart").evaluate((element) => Math.max(
    ...(element.data || [])
      .filter((trace) => !trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
      .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
  ));
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 5000 });

  const forecastPrices = () => page.locator("#chart").evaluate((element) => (
    (element.data || []).find((trace) => trace?.meta?.isAiForecastTrace)?.customdata || []
  ));
  const baselineForecast = await forecastPrices();
  for (const months of [3, 6, 12, 360]) {
    await setChartRangeMonths(page, months);
    await expect(page.locator("#chartRangeStepper"))
      .toHaveAttribute("data-months", String(months));
    await expect.poll(forecastPrices).toEqual(baselineForecast);
  }

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBe(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeLessThanOrEqual(observedEnd);
});

test("AI forecast renders when KOSPI is the first series enabled after an empty boot", async ({ page }) => {
  const pageUrl = process.env.THINKSTOCK_AI_EMPTY_BOOT_URL || "/?e2e=1";
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 120,
      hiddenSeries: [
        "leading_cycle",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
      customStocks: [],
    }));
  });
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator('.series-toggle-btn[data-series="^KS11"]')).toHaveClass(/is-off/);

  await page.locator('.series-toggle-btn[data-series="^KS11"]').click();
  await page.locator("#aiForecastToggle").click();
  await expect(page.locator('.series-toggle-btn[data-series="^KS11"]')).toHaveClass(/is-on/);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.seriesKey === "^KS11"
    )).length
  )), { message: "KOSPI AI forecast did not render after an empty boot" }).toBe(3);
  const visibleRange = await page.locator("#chart").evaluate((element) => {
    const observedEnd = Math.max(
      ...(element.data || [])
        .filter((trace) => !trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
        .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
    );
    return {
      observedEnd,
      forecastEnd: Math.max(
        ...(element.data || [])
          .filter((trace) => trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
          .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
      ),
      viewportEnd: Date.parse(element?._fullLayout?.xaxis?.range?.[1]),
    };
  });
  expect(visibleRange.viewportEnd).toBeGreaterThan(visibleRange.observedEnd);
  expect(visibleRange.viewportEnd).toBeGreaterThanOrEqual(visibleRange.forecastEnd);
});

test("AI off clamps the viewport to the last observed date", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length
  ))).toBeGreaterThan(0);
  const observedEnd = await page.locator("#chart").evaluate((element) => Math.max(
    ...(element.data || [])
      .filter((trace) => !trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
      .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
  ));
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeGreaterThan(observedEnd);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length
  ))).toBe(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeLessThanOrEqual(observedEnd);
});

test("AI forecasts survive repeated KOSPI and KOSDAQ toggle cycles", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  const kosdaqButton = page.locator('.series-toggle-btn[data-series="^KQ11"]');
  if (await kosdaqButton.getAttribute("aria-pressed") !== "true") await kosdaqButton.click();
  await page.evaluate(() => {
    const bar = document.getElementById("aiForecastProgressBar");
    const text = document.getElementById("aiForecastProgressText");
    window.__aiProgressSamples = [];
    const capture = () => window.__aiProgressSamples.push({
      value: Number.parseFloat(bar?.style?.width || "0"),
      text: text?.textContent || "",
    });
    new MutationObserver(capture).observe(bar, { attributes: true, attributeFilter: ["style"] });
    new MutationObserver(capture).observe(text, { childList: true, subtree: true });
  });

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.locator("#aiForecastToggle").click();
    await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.locator("#chart").evaluate((element) => (
      new Set((element.data || [])
        .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
        .map((trace) => trace?.meta?.seriesKey)).size
    )), { message: `AI cycle ${cycle + 1} did not render both indices` }).toBe(2);

    await page.locator("#aiForecastToggle").click();
    await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.locator("#chart").evaluate((element) => (
      (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length
    ))).toBe(0);
  }

  for (let click = 0; click < 5; click += 1) {
    await page.locator("#aiForecastToggle").click();
    await page.waitForTimeout(40);
  }
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    new Set((element.data || [])
      .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
      .map((trace) => trace?.meta?.seriesKey)).size
  )), { message: "rapid AI toggles did not preserve the final ON state" }).toBe(2);
  const progressSamples = await page.evaluate(() => window.__aiProgressSamples || []);
  expect(progressSamples.some((sample) => sample.value === 0)).toBe(true);
  expect(progressSamples.some((sample) => sample.value === 25)).toBe(true);
  expect(progressSamples.some((sample) => sample.value === 85)).toBe(true);
  expect(progressSamples.some((sample) => sample.value === 100)).toBe(true);
  expect(progressSamples.some((sample, index) => (
    sample.value === 0 && progressSamples.slice(0, index).some((prior) => prior.value === 100)
  ))).toBe(true);
});

test("enabling KOSDAQ while AI is active calculates only the new index", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      hiddenSeries: ["^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"],
      customStocks: [],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.seriesKey === "^KS11"
    )).length
  ))).toBe(3);
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 5000 });
  const countsBeforeKOSDAQ = await page.evaluate(() => (
    window.ThinkStockE2E.getAiForecastState().calculationCounts
  ));
  expect(countsBeforeKOSDAQ["^KS11"]).toBe(1);

  await page.evaluate(() => {
    const wrap = document.getElementById("aiForecastProgress");
    window.__kosdaqAiProgressVisibility = [];
    const capture = () => window.__kosdaqAiProgressVisibility.push(!wrap?.hidden);
    new MutationObserver(capture).observe(wrap, { attributes: true, attributeFilter: ["hidden"] });
  });
  await page.locator('.series-toggle-btn[data-series="^KQ11"]').click();
  await expect(page.locator("#aiForecastProgress")).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.seriesKey === "^KQ11"
    )).length
  ))).toBe(3);
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 5000 });
  expect(await page.evaluate(() => window.__kosdaqAiProgressVisibility || [])).toContain(true);
  const stateAfterKOSDAQ = await page.evaluate(() => window.ThinkStockE2E.getAiForecastState());
  expect(stateAfterKOSDAQ.calculationCounts["^KS11"]).toBe(countsBeforeKOSDAQ["^KS11"]);
  expect(stateAfterKOSDAQ.calculationCounts["^KQ11"]).toBe(1);
  expect(stateAfterKOSDAQ.cachedTargets).toEqual(expect.arrayContaining(["^KS11", "^KQ11"]));
});

test("AI requests analysis only for stock toggles that are on", async ({ page }) => {
  await installDataRoutes(page);
  const stockSeries = ["005930.KS", "000660.KS", "035420.KS", "035720.KS"];
  await page.route("**/data/prices_recent.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", ...stockSeries],
      recentDates,
      {
        "^KS11": [2800, 2900, 3000, 3100, 3200],
        "^KQ11": [780, 800, 820, 840, 860],
        "005930.KS": [70000, 72000, 74000, 76000, 78000],
        "000660.KS": [90000, 88000, 91000, 93000, 95000],
        "035420.KS": [180000, 185000, 183000, 190000, 195000],
        "035720.KS": [45000, 47000, 46000, 48000, 50000],
      },
    ) });
  });
  await page.route("**/data/prices_history.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", ...stockSeries],
      historyDates,
      {
        "^KS11": [300, 900, 1800],
        "^KQ11": [80, 400, 550],
        "005930.KS": [8000, 15000, 28000],
        "000660.KS": [12000, 28000, 52000],
        "035420.KS": [25000, 60000, 110000],
        "035720.KS": [10000, 22000, 35000],
      },
    ) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      hiddenSeries: [
        "leading_cycle", "^KS11", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit",
        "000660.KS", "035720.KS",
      ],
      customStocks: [
        { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
        { ticker: "000660.KS", name: "SK하이닉스", code: "000660", market: "KOSPI" },
        { ticker: "035420.KS", name: "NAVER", code: "035420", market: "KOSPI" },
        { ticker: "035720.KS", name: "카카오", code: "035720", market: "KOSPI" },
      ],
    }));
  });
  const analysisRequests = [];
  await page.route("**/api/analysis**", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    analysisRequests.push(ticker);
    await route.fulfill({ json: { ok: true, ticker, savedAt: Date.now(), financials: [] } });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await page.locator("#aiForecastToggle").click();

  await expect.poll(() => [...new Set(analysisRequests)].sort())
    .toEqual(["005930.KS", "035420.KS"]);
  await page.waitForTimeout(300);
  expect([...new Set(analysisRequests)].sort()).toEqual(["005930.KS", "035420.KS"]);
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getAiForecastState().targets))
    .toEqual(["005930.KS", "035420.KS"]);
});

test("market timing applies to a visible stock series", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 360,
      customStocks: [
        { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
      ],
      showRecessionSignals: true,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace)
      .flatMap((trace) => trace.customdata || [])
      .some((row) => row?.[0] === "삼성전자")
  ))).toBe(true);
  const timingMarkerStyles = await page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace)
      .map((trace) => ({ symbol: trace.marker?.symbol, size: trace.marker?.size }))
  ));
  expect(timingMarkerStyles.length).toBeGreaterThan(0);
  expect(timingMarkerStyles.every(({ symbol, size }) => (
    ["triangle-up", "triangle-down"].includes(symbol) && size >= 13
  ))).toBe(true);

  const maximumTimingMarkerGap = async () => {
    const gaps = await page.evaluate(() => window.ThinkStockE2E.getTimingMarkerPixelGaps());
    return gaps.length ? Math.max(...gaps) : Number.POSITIVE_INFINITY;
  };

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  )), { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);

  const kospiToggle = page.locator('.series-toggle-btn[data-series="^KS11"]');
  await kospiToggle.click();
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);
  await kospiToggle.click();
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);
});

test("co-movement toggle shows only the last visible stock for the selected period", async ({ page }) => {
  await installDataRoutes(page);
  await page.route("**/data/prices_recent.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", "005930.KS", "000660.KS"],
      recentDates,
      {
        "^KS11": [2800, 2900, 3000, 3100, 3200],
        "^KQ11": [780, 800, 820, 840, 860],
        "005930.KS": [70000, 72000, 74000, 76000, 78000],
        "000660.KS": [90000, 88000, 91000, 93000, 95000],
      },
    ) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      customStocks: [
        { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
        { ticker: "000660.KS", name: "SK하이닉스", code: "000660", market: "KOSPI" },
      ],
      showCoMovement: false,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const buttonOrder = await Promise.all([
    page.locator("#resetHandles").boundingBox(),
    page.locator("#coMovementToggle").boundingBox(),
    page.locator("#aiForecastToggle").boundingBox(),
    page.locator("#macdToggle").boundingBox(),
  ]);
  expect(buttonOrder.every(Boolean)).toBe(true);
  expect(buttonOrder[0].y).toBeLessThan(buttonOrder[1].y);
  expect(buttonOrder[1].y).toBeLessThan(buttonOrder[2].y);
  expect(buttonOrder[2].y).toBeLessThan(buttonOrder[3].y);

  await expect(page.locator("#coMovementPanel")).toBeHidden();
  await page.locator("#coMovementToggle").click();
  await expect(page.locator("#coMovementToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#coMovementPanel")).toBeVisible();
  const coMovementLayout = await page.locator("#coMovementPanel").evaluate((panel) => {
    const chart = document.getElementById("chart");
    const panelRect = panel.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    const style = getComputedStyle(panel);
    return {
      centerDelta: Math.abs((panelRect.left + panelRect.right) / 2 - (chartRect.left + chartRect.right) / 2),
      topOffset: panelRect.top - chartRect.top,
      borderWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
    };
  });
  expect(coMovementLayout.centerDelta).toBeLessThanOrEqual(1);
  expect(coMovementLayout.topOffset).toBeGreaterThanOrEqual(10);
  expect(coMovementLayout.topOffset).toBeLessThanOrEqual(18);
  expect(coMovementLayout.borderWidth).toBe("0px");
  expect(coMovementLayout.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 1년");
  await expect(page.locator("#coMovementPanel")).toContainText("코스피 75%");
  await expect(page.locator("#coMovementPanel")).toContainText("코스닥 75%");
  await expect(page.locator("#coMovementPanel .co-movement-metric")).toHaveCount(2);

  const clickStockLine = async (ticker, date) => {
    const point = await page.locator("#chart").evaluate((element, target) => {
      const trace = (element.data || []).find((item) => item?.meta?.seriesKey === target.ticker);
      const pointIndex = trace?.x?.indexOf(target.date) ?? -1;
      const xAxis = element?._fullLayout?.xaxis;
      const yAxis = element?._fullLayout?.yaxis;
      const rect = element.getBoundingClientRect();
      if (pointIndex < 0 || !xAxis || !yAxis) return null;
      return {
        x: rect.left + Number(xAxis._offset || 0) + xAxis.d2p(trace.x[pointIndex]),
        y: rect.top + Number(yAxis._offset || 0) + yAxis.l2p(Number(trace.y[pointIndex])),
      };
    }, { ticker, date });
    expect(point).not.toBeNull();
    await page.mouse.click(point.x, point.y);
  };
  await clickStockLine("005930.KS", "2026-01-14");
  await expect(page.locator("#coMovementPanel")).toContainText("삼성전자 1년");
  await clickStockLine("000660.KS", "2026-01-14");
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 1년");

  await page.locator('[data-series="000660.KS"]').click();
  await expect(page.locator("#coMovementPanel")).toContainText("삼성전자 1년");
  await page.locator('[data-series="000660.KS"]').click();
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 1년");

  await setChartRangeMonths(page, 3);
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 3개월");
  await page.locator("#coMovementToggle").click();
  await expect(page.locator("#coMovementPanel")).toBeHidden();
});

test("insider trade toggle draws DART buy and sell triangles for three years", async ({ page }) => {
  await installDataRoutes(page);
  await stubExternalRefreshes(page);
  await page.route("**/data/disclosures/005930.KS.json*", async (route) => {
    await route.fulfill({ json: {
      generated_at: "2026-07-15T00:00:00Z",
      source: "OpenDART",
      records: [
        {
          date: "2026-04-14",
          ticker: "005930.KS",
          name: "삼성전자",
          title: "유상증자 결정",
          url: "https://dart.fss.or.kr/example",
          source: "OpenDART",
        },
        {
          date: "2026-04-13",
          ticker: "005930.KS",
          name: "삼성전자",
          title: "전일 공시",
          url: "https://dart.fss.or.kr/previous",
          source: "OpenDART",
        },
      ],
    } });
  });
  let authorization = "";
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 36,
      hiddenSeries: ["leading_cycle", "^KS11", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"],
      customStocks: [{ ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" }],
      hoverShowPopup: true,
      showDisclosures: true,
      showInsiderTrades: false,
    }));
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/dart/insider-trades?*", async (route) => {
    authorization = route.request().headers().authorization || "";
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    const records = ticker === "000660.KS"
      ? [{
          ticker,
          date: "2026-04-14",
          side: "buy",
          reporter: "박임원",
          role: "대표이사",
          sharesChanged: 300,
          receiptNo: "20260414000456",
        }]
      : [
          {
            ticker: "005930.KS",
            date: "2026-04-14",
            side: "buy",
            reporter: "홍길동",
            role: "대표이사",
            sharesChanged: 1250,
            receiptNo: "20260114000123",
          },
          {
            ticker: "005930.KS",
            date: "2026-04-14",
            side: "sell",
            reporter: "김주주",
            role: "등기임원",
            sharesChanged: -500,
            receiptNo: "20260414000123",
          },
          {
            ticker: "005930.KS",
            date: "2026-04-13",
            side: "buy",
            reporter: "전일임원",
            role: "임원",
            sharesChanged: 100,
            receiptNo: "20260413000123",
          },
        ];
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        ticker,
        checkedFrom: "2023-08-03",
        records,
      }),
    });
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
  await expect(page.locator("#insiderTradeToggle")).toHaveAttribute("data-bound", "1");
  await expect.poll(() => page.locator("#chart").evaluate((element) => element._fullLayout?.hovermode)).toBe("x unified");
  await test.step("render and style disclosure and insider markers", async () => {
  await expect(page.locator("#insiderTradeToggle")).toHaveText("내부거래");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getInsiderTradeState())).toMatchObject({
    enabled: false,
  });
  expect(await page.locator("#insiderTradeToggle").evaluate((element) => typeof element.onclick)).toBe("function");
  await page.locator("#insiderTradeToggle").click();
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getInsiderTradeState())).toMatchObject({
    enabled: true,
    rows: 3,
    loadedTickers: ["005930.KS"],
    pendingTickers: [],
    visibleTickers: ["005930.KS"],
    gatewayReady: true,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace).map((trace) => ({
      side: trace.meta.insiderTradeSide,
      symbol: trace.marker.symbol,
      color: trace.marker.color,
      yaxis: trace.yaxis,
      paired: trace.customdata?.[0]?.[2],
      dates: trace.x,
    }))
  ))).toEqual([
    { side: "buy", symbol: "triangle-up", color: "#b91c1c", yaxis: "y", paired: true, dates: ["2026-04-14"] },
    { side: "sell", symbol: "triangle-down", color: "#1d4ed8", yaxis: "y", paired: true, dates: ["2026-04-14"] },
  ]);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const disclosure = (element.data || []).find((trace) => trace?.meta?.isDisclosureTrace);
    const insiders = (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace);
    return {
      disclosure: disclosure?.hovertemplate?.[0] || "",
      buy: insiders.find((trace) => trace.meta.insiderTradeSide === "buy")?.hovertemplate?.[0] || "",
      sell: insiders.find((trace) => trace.meta.insiderTradeSide === "sell")?.hovertemplate?.[0] || "",
    };
  })).toEqual({
    disclosure: expect.stringContaining('<span style="color:#f59e0b"><b>공시</b></span>'),
    buy: expect.stringContaining('<span style="color:#b91c1c"><b>내부자거래 : 매수</b></span>'),
    sell: expect.stringContaining('<span style="color:#1d4ed8"><b>내부자거래 : 매도</b></span>'),
  });
  const eventHoverTemplates = await page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isDisclosureTrace || trace?.meta?.isInsiderTradeTrace)
      .flatMap((trace) => trace.hovertemplate || [])
  ));
  expect(eventHoverTemplates.every((template) => !template.includes("삼성전자"))).toBe(true);
  expect(eventHoverTemplates.every((template) => !template.includes("2026-04-14"))).toBe(true);
  expect(await page.evaluate(() => {
    const hoverLayer = document.createElement("div");
    hoverLayer.className = "hoverlayer";
    const legendPoints = document.createElement("div");
    legendPoints.className = "legendpoints";
    hoverLayer.append(legendPoints);
    document.body.append(hoverLayer);
    const display = getComputedStyle(legendPoints).display;
    hoverLayer.remove();
    return display;
  })).toBe("none");
  await expect(page.locator("#insiderTradeToggle")).toHaveText("내부거래");
  await expect.poll(() => page.evaluate(() => {
    const disclosureStyle = getComputedStyle(document.getElementById("disclosureToggle"));
    const insiderStyle = getComputedStyle(document.getElementById("insiderTradeToggle"));
    const disclosure = [disclosureStyle.backgroundColor, disclosureStyle.borderColor, disclosureStyle.color];
    const insider = [insiderStyle.backgroundColor, insiderStyle.borderColor, insiderStyle.color];
    return insider.every((value, index) => value === disclosure[index]);
  })).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const disclosure = (element.data || []).find((trace) => trace?.meta?.isDisclosureTrace);
    const insiders = (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace);
    const stock = (element.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    const stockYAt = (date) => {
      const index = stock?.x?.indexOf(date) ?? -1;
      return index >= 0 ? Number(stock.y[index]) : Number.NaN;
    };
    return {
      disclosureAxis: disclosure?.yaxis,
      disclosureDates: disclosure?.x,
      pairedDiamond: Number(insiders[0]?.y?.[0]) > Number(insiders[1]?.y?.[0]),
      disclosureAboveLine: (disclosure?.x || []).every((date, index) => (
        Number(disclosure.y[index]) > stockYAt(date)
      )),
      insiderBelowLine: insiders.every((trace) => (trace.x || []).every((date, index) => (
        Number(trace.y[index]) < stockYAt(date)
      ))),
    };
  })).toEqual({
    disclosureAxis: "y",
    disclosureDates: ["2026-04-14"],
    pairedDiamond: true,
    disclosureAboveLine: true,
    insiderBelowLine: true,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    [...element.querySelectorAll(".scatterlayer path.point")]
      .filter((point) => ["rgb(185, 28, 28)", "rgb(29, 78, 216)"].includes(point.style.fill))
      .map((point) => getComputedStyle(point).display)
  ))).toEqual(["inline", "inline"]);
  });

  const readPairedMarkerGeometry = () => page.locator("#chart").evaluate((element) => {
    const points = [...element.querySelectorAll(".scatterlayer path.point")]
      .filter((point) => ["rgb(185, 28, 28)", "rgb(29, 78, 216)"].includes(point.style.fill));
    const buy = points.find((point) => point.style.fill === "rgb(185, 28, 28)")?.getBoundingClientRect();
    const sell = points.find((point) => point.style.fill === "rgb(29, 78, 216)")?.getBoundingClientRect();
    if (!buy || !sell) return null;
    const stock = (element.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    const stockIndex = stock?.x?.indexOf("2026-04-14") ?? -1;
    const axis = element?._fullLayout?.yaxis;
    const chartTop = element.getBoundingClientRect().top;
    const stockLineY = stockIndex >= 0 && axis
      ? chartTop + axis._offset + axis.l2p(Number(stock.y[stockIndex]))
      : Number.NaN;
    return {
      horizontallyAligned: Math.abs((buy.left + buy.right) - (sell.left + sell.right)) < 1,
      buyAboveSell: buy.top < sell.top,
      lineClearance: buy.top - stockLineY,
      verticalClearance: sell.top - buy.bottom,
    };
  });
  const pairedMarkerGeometry = await test.step("align same-day insider markers around the stock line", async () => {
    const geometry = await readPairedMarkerGeometry();
    expect(geometry).toMatchObject({
      horizontallyAligned: true,
      buyAboveSell: true,
      lineClearance: expect.any(Number),
      verticalClearance: expect.any(Number),
    });
    expect(geometry.lineClearance).toBeGreaterThanOrEqual(1);
    expect(geometry.verticalClearance).toBeGreaterThanOrEqual(0);
    expect(geometry.verticalClearance).toBeLessThanOrEqual(4);
    return geometry;
  });

  await test.step("keep handles and event markers synchronized during transforms", async () => {
  const offsetHandle = page.locator('.y-handle-left[title="삼성전자 (위치)"]');
  const pairedScaleHandle = page.locator('.y-handle-right[title="삼성전자 (스케일)"]');
  await expect(offsetHandle).toBeVisible();
  await expect(pairedScaleHandle).toBeVisible();
  const [offsetBefore, scaleBefore] = await Promise.all([
    offsetHandle.boundingBox(),
    pairedScaleHandle.boundingBox(),
  ]);
  const handleTopsBefore = await page.locator("#y-handles").evaluate(() => ({
    offset: Number.parseFloat(document.querySelector('.y-handle-left[title="삼성전자 (위치)"]').style.top),
    scale: Number.parseFloat(document.querySelector('.y-handle-right[title="삼성전자 (스케일)"]').style.top),
  }));
  await page.mouse.move(
    offsetBefore.x + offsetBefore.width / 2,
    offsetBefore.y + offsetBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    offsetBefore.x + offsetBefore.width / 2,
    offsetBefore.y + offsetBefore.height / 2 + 30,
  );
  const handleTopsDuring = await page.locator("#y-handles").evaluate(() => ({
    offset: Number.parseFloat(document.querySelector('.y-handle-left[title="삼성전자 (위치)"]').style.top),
    scale: Number.parseFloat(document.querySelector('.y-handle-right[title="삼성전자 (스케일)"]').style.top),
  }));
  const offsetDelta = handleTopsDuring.offset - handleTopsBefore.offset;
  const scaleDelta = handleTopsDuring.scale - handleTopsBefore.scale;
  expect(Math.abs(offsetDelta - 30)).toBeLessThanOrEqual(1);
  expect(Math.abs(scaleDelta - offsetDelta)).toBeLessThanOrEqual(1);
  await page.mouse.up();

  const scaleHandle = page.locator('.y-handle-right[title="삼성전자 (스케일)"]');
  await expect(scaleHandle).toBeVisible();
  const scaleHandleBox = await waitForBoundingBox(scaleHandle);
  const scaleYRangeBefore = await page.locator("#chart").evaluate((element) => (
    [...element._fullLayout.yaxis.range]
  ));
  await page.mouse.move(
    scaleHandleBox.x + scaleHandleBox.width / 2,
    scaleHandleBox.y + scaleHandleBox.height / 2,
  );
  await page.mouse.down();
  await expect(scaleHandle).toHaveClass(/dragging/);
  await page.mouse.move(
    scaleHandleBox.x + scaleHandleBox.width / 2,
    scaleHandleBox.y + scaleHandleBox.height / 2 - 45,
    { steps: 3 },
  );
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().scales).length
  ))).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).lineClearance - pairedMarkerGeometry.lineClearance,
  )).toBeLessThanOrEqual(2);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const scaleYRangeAfter = await page.locator("#chart").evaluate((element) => (
    [...element._fullLayout.yaxis.range]
  ));
  expect(scaleYRangeAfter[0]).toBeCloseTo(scaleYRangeBefore[0], 6);
  expect(scaleYRangeAfter[1]).toBeCloseTo(scaleYRangeBefore[1], 6);
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).lineClearance - pairedMarkerGeometry.lineClearance,
  )).toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).verticalClearance - pairedMarkerGeometry.verticalClearance,
  )).toBeLessThanOrEqual(2);

  const transformsBeforeFit = await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms());
  expect(Object.keys(transformsBeforeFit.offsets).length).toBeGreaterThan(0);
  expect(Object.keys(transformsBeforeFit.scales).length).toBeGreaterThan(0);
  await page.locator("#resetHandles").click();
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).toEqual(
    transformsBeforeFit,
  );
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).lineClearance - pairedMarkerGeometry.lineClearance,
  )).toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).verticalClearance - pairedMarkerGeometry.verticalClearance,
  )).toBeLessThanOrEqual(2);
  const lineDragStart = await page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "005930.KS");
    const xAxis = element?._fullLayout?.xaxis;
    const yAxis = element?._fullLayout?.yaxis;
    const rect = element.getBoundingClientRect();
    const validIndexes = Array.from(trace?.y || [], (value, index) => (
      Number.isFinite(Number(value)) ? index : -1
    )).filter((index) => index >= 0);
    const pointIndex = validIndexes[Math.floor(validIndexes.length / 2)] ?? -1;
    if (!trace || !xAxis || !yAxis || pointIndex < 0) return null;
    return {
      x: rect.left + xAxis._offset + xAxis.d2p(trace.x[pointIndex]),
      y: rect.top + yAxis._offset + yAxis.l2p(Number(trace.y[pointIndex])),
      ySpan: Math.abs(yAxis.range[1] - yAxis.range[0]),
    };
  });
  expect(lineDragStart).not.toBeNull();
  const lineHandleTopsBefore = await page.locator("#y-handles").evaluate(() => ({
    left: Number.parseFloat(document.querySelector('.y-handle-left[data-series-key="005930.KS"]').style.top),
    right: Number.parseFloat(document.querySelector('.y-handle-right[data-series-key="005930.KS"]').style.top),
  }));
  await page.mouse.move(lineDragStart.x, lineDragStart.y);
  await page.mouse.down();
  await page.mouse.move(lineDragStart.x, lineDragStart.y + 24);
  await expect.poll(async () => Object.keys(
    (await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).offsets,
  ).length).toBeGreaterThan(0);
  const lineHandleTopsDuring = await page.locator("#y-handles").evaluate(() => ({
    left: Number.parseFloat(document.querySelector('.y-handle-left[data-series-key="005930.KS"]').style.top),
    right: Number.parseFloat(document.querySelector('.y-handle-right[data-series-key="005930.KS"]').style.top),
  }));
  expect(Math.abs((lineHandleTopsDuring.left - lineHandleTopsBefore.left) - 24)).toBeLessThanOrEqual(1);
  expect(Math.abs((lineHandleTopsDuring.right - lineHandleTopsBefore.right) - 24)).toBeLessThanOrEqual(1);
  const lineDragYSpan = await page.locator("#chart").evaluate((element) => (
    Math.abs(element._fullLayout.yaxis.range[1] - element._fullLayout.yaxis.range[0])
  ));
  expect(Math.abs(lineDragYSpan - lineDragStart.ySpan)).toBeLessThanOrEqual(0.01);
  await page.mouse.up();
  const transformsBeforeFinalFit = await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms());
  expect(Object.keys(transformsBeforeFinalFit.offsets).length).toBeGreaterThan(0);
  expect(Object.keys(transformsBeforeFinalFit.scales).length).toBeGreaterThan(0);
  await page.locator("#resetHandles").click();
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).toEqual(
    { offsets: {}, scales: {} },
  );
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.autorange
  ))).toBe(false);
  const fittedRangeCoversVisibleLines = await page.locator("#chart").evaluate((element) => {
    const xRange = element._fullLayout.xaxis.range.map((value) => Date.parse(value));
    const yRange = element._fullLayout.yaxis.range;
    const values = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly")
      .flatMap((trace) => Array.from(trace.y || [], (value, index) => ({
        x: Date.parse(trace.x[index]),
        y: Number(value),
      })))
      .filter((point) => (
        Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && point.x >= Math.min(...xRange)
        && point.x <= Math.max(...xRange)
      ));
    const minimum = Math.min(...values.map((point) => point.y));
    const maximum = Math.max(...values.map((point) => point.y));
    return yRange[0] < minimum && yRange[1] > maximum;
  });
  expect(fittedRangeCoversVisibleLines).toBe(true);
  });

  await test.step("limit event hover to exact dates and update visible tickers", async () => {
  const moveNativeHoverToDate = async (date) => {
    const point = await page.locator("#chart").evaluate((element, targetDate) => {
      const xAxis = element?._fullLayout?.xaxis;
      const yAxis = element?._fullLayout?.yaxis;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + Number(xAxis?._offset || 0) + xAxis.d2p(targetDate),
        y: rect.top + Number(yAxis?._offset || 0) + Number(yAxis?._length || 0) / 2,
      };
    }, date);
    await page.mouse.move(point.x - 4, point.y);
    await page.mouse.move(point.x, point.y);
  };
  const eventHoverInfo = () => page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isInsiderTradeTrace || trace?.meta?.isDisclosureTrace)
      .map((trace) => trace.hoverinfo)
  ));
  await moveNativeHoverToDate("2026-01-14");
  await expect.poll(eventHoverInfo).toEqual(["skip", "skip", "skip"]);
  await moveNativeHoverToDate("2026-04-14");
  await expect.poll(eventHoverInfo).toEqual(["all", "all", "all"]);
  expect(authorization).toBe("Bearer private");

  const insiderMarkerTickers = () => page.locator("#chart").evaluate((element) => (
    [...new Set((element.data || [])
      .filter((trace) => trace?.meta?.isInsiderTradeTrace)
      .flatMap((trace) => trace.customdata || [])
      .map((item) => item?.[0])
      .filter(Boolean))].sort()
  ));
  await expect.poll(insiderMarkerTickers).toEqual(["005930.KS"]);

  const zoomedRange = await page.locator("#chart").evaluate(async (element) => {
    await window.Plotly.relayout(element, { "xaxis.range": ["2026-01-14", "2026-04-14"] });
    return [...element._fullLayout.xaxis.range];
  });

  await page.locator("#stockSearchInput").fill("SK하이닉스");
  await page.locator(".stock-suggest-item").filter({ hasText: "SK하이닉스" }).click();
  await expect(page.locator('[data-series="000660.KS"]')).toBeVisible();
  await expect.poll(insiderMarkerTickers).toEqual(["000660.KS", "005930.KS"]);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isInsiderTradeTrace)
      .flatMap((trace) => trace.customdata || [])
      .find((item) => item?.[0] === "000660.KS")?.[2]
  ))).toBe(false);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    [...element._fullLayout.xaxis.range]
  ))).toEqual(zoomedRange);

  await page.locator('[data-series="005930.KS"]').click();
  await expect.poll(insiderMarkerTickers).toEqual(["000660.KS"]);
  await page.locator('[data-series="005930.KS"]').click();
  await expect.poll(insiderMarkerTickers).toEqual(["000660.KS", "005930.KS"]);

  await page.locator("#insiderTradeToggle").click();
  await expect(page.locator("#insiderTradeToggle")).toHaveText("내부거래");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace).length
  ))).toBe(0);
  });
});

test("AI analysis loads only on demand and reuses its monthly browser cache", async ({ page }) => {
  let analysisRequests = 0;
  let journalRecords = [];
  let releaseAnalysis;
  const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve; });
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    if (!localStorage.getItem("thinkstock-v5")) {
      localStorage.setItem("thinkstock-v5", JSON.stringify({
        showAiForecast: true,
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
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/forecast-journal**", async (route) => {
    if (route.request().method() === "POST") {
      journalRecords = route.request().postDataJSON()?.records || [];
    }
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ ok: true, ticker: "005930.KS", records: journalRecords }),
    });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "false");
  expect(analysisRequests).toBe(0);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => analysisRequests).toBeGreaterThan(0);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "true");
  releaseAnalysis();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.fundamentalsUsed).length
  ))).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.isAiForecastTrace);
    const rangeEnd = element?._fullLayout?.xaxis?.range?.[1];
    return Boolean(trace?.x?.at(-1) && rangeEnd && String(rangeEnd).slice(0, 10) >= trace.x.at(-1));
  })).toBe(true);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => journalRecords.length).toBeGreaterThan(0);
  const savedForecast = journalRecords.find((record) => record.ticker === "005930.KS");
  expect(Object.keys(savedForecast?.horizons || {}).sort()).toEqual(["10", "126", "20", "5", "63"]);
  expect(Object.keys(savedForecast?.audit?.features || {}).length).toBeGreaterThan(50);
  expect(savedForecast?.audit?.sources?.internet_news_rows).toBe(0);
  expect(savedForecast?.horizons?.[126]?.attribution?.components).toBeTruthy();

  const firstRequestCount = analysisRequests;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#aiForecastToggle")).not.toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBe(0);
  await page.locator("#aiForecastToggle").click();
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

  const positions = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    const macd = document.getElementById("chart-macd").getBoundingClientRect();
    return {
      main: document.getElementById("chart").getBoundingClientRect().bottom,
      macdTop: macd.top,
      macdBottom: macd.bottom,
      macdInsideShell: macd.left >= shell.left && macd.right <= shell.right,
      adr: document.getElementById("chart-adr").getBoundingClientRect().top,
    };
  });
  expect(positions.macdTop).toBeGreaterThanOrEqual(positions.main);
  expect(positions.adr).toBeGreaterThanOrEqual(positions.macdBottom);
  expect(positions.macdInsideShell).toBe(true);

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

test("failed live refresh preserves the last valid chart data", async ({ page }) => {
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
  });
  let failedRequests = 0;
  const failRequest = async (route) => {
    failedRequests += 1;
    await route.fulfill({
      status: 503,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "temporary upstream failure" }),
    });
  };
  await page.route("**/api/macro**", failRequest);
  await page.route("**/api/credit**", failRequest);
  await page.route("**/api/indices**", failRequest);
  await page.route("**/api/prices**", failRequest);

  const readSeries = () => page.evaluate(() => {
    const compact = (element) => (element?.data || [])
      .filter((trace) => trace?.meta?.seriesKey || trace?.meta?.auxiliarySeriesKey)
      .map((trace) => ({
        key: trace.meta.seriesKey || trace.meta.auxiliarySeriesKey,
        x: trace.x,
        y: trace.y,
      }));
    return {
      main: compact(document.getElementById("chart")),
      auxiliary: compact(document.getElementById("chart-adr")),
    };
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  const before = await readSeries();
  expect(before.main.length).toBeGreaterThan(0);
  expect(before.auxiliary.length).toBeGreaterThan(0);

  await page.locator("#refreshData").click();
  await expect(page.locator("#refreshData")).not.toHaveClass(/spinning/);
  await expect.poll(() => failedRequests).toBeGreaterThan(0);
  expect(await readSeries()).toEqual(before);
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

test("falls back to seed data when a cached snapshot has no prices", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installDataRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-runtime-cache-v1", JSON.stringify({
      version: 10,
      format: "compact-v1",
      saved_at: new Date().toISOString(),
      macroRows: [{ date: "2026-01-14", news_sentiment: 105 }],
      revisions: { macro: 1 },
    }));
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element.data?.some((trace) => Array.isArray(trace.x) && trace.x.length > 0) || false
  ))).toBe(true);
  expect(pageErrors).toEqual([]);
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
    const trace = element.data?.find((item) => item.name === "뉴스심리 20일 이동평균");
    const index = trace?.x?.indexOf("2026-01-14") ?? -1;
    return index >= 0 ? trace.y[index] : null;
  })).toBeGreaterThan(0);
  await page.evaluate(() => window.ThinkStockE2E.saveRuntimeSnapshotNow());

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = element.data?.find((item) => item.name === "뉴스심리 20일 이동평균");
    const index = trace?.x?.indexOf("2026-01-14") ?? -1;
    return index >= 0 ? trace.y[index] : null;
  })).toBeGreaterThan(0);
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
  test.slow();
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

  await test.step("boot charts and lazy-load diagnostics", async () => {
  await expect(page.locator("#appVersionText")).toHaveText(/^\d+\.\d+$/);
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await expect(page.locator("#hoverToggle")).toHaveText("정보창");
  await expect(page.locator("#hoverToggle")).toHaveCSS("color", "rgb(138, 138, 138)");
  if (isMobile) {
    const buttonSizing = await page.locator("#hoverToggle").evaluate((button) => ({
      width: button.getBoundingClientRect().width,
      scrollWidth: button.scrollWidth,
    }));
    expect(buttonSizing.width - buttonSizing.scrollWidth).toBeLessThanOrEqual(2);
  }
  await page.locator("#hoverToggle").click();
  await expect(page.locator("#hoverToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#hoverToggle")).toHaveCSS("background-color", "rgba(74, 222, 128, 0.12)");
  await expect(page.locator("#hoverToggle")).toHaveCSS("border-color", "rgba(74, 222, 128, 0.25)");
  await expect(page.locator("#hoverToggle")).toHaveCSS("color", "rgb(74, 222, 128)");
  await page.locator("#hoverToggle").click();
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
      && element.data?.some((trace) => trace.name === "뉴스심리 20일 이동평균" && trace.yaxis === "y3")
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
  await setChartRangeMonths(page, 36);
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
  });

  let chartBox = null;
  let snapshotStatsAfter = null;
  await test.step("update chart data and exercise direct interactions", async () => {
  const middleUpdateBefore = await page.evaluate(() => ({
    revisions: window.ThinkStockE2E.getRuntimeSnapshotStats().revisions,
    renderGeneration: window.ThinkStockE2E.getChartRenderGeneration(),
    worker: window.ThinkStockE2E.getChartWorkerStats(),
  }));
  expect(await page.evaluate(() => window.ThinkStockE2E.applyNewsSentimentForTest([
    { date: "2026-01-14", news_sentiment: 107.25 },
  ]))).toMatchObject({ updated: 1, latestDate: "2026-01-14" });
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = element.data?.find((item) => item.name === "뉴스심리 20일 이동평균");
    const index = trace?.x?.indexOf("2026-01-14") ?? -1;
    return index >= 0 ? trace.y[index] : null;
  })).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getChartRenderGeneration()
  ))).toBeGreaterThan(middleUpdateBefore.renderGeneration);
  const middleUpdateAfter = await page.evaluate(() => ({
    revisions: window.ThinkStockE2E.getRuntimeSnapshotStats().revisions,
    worker: window.ThinkStockE2E.getChartWorkerStats(),
  }));
  expect(middleUpdateAfter.revisions.macro).toBeGreaterThan(middleUpdateBefore.revisions.macro);
  expect(middleUpdateAfter.worker.sourceTransfers).toBeGreaterThanOrEqual(middleUpdateBefore.worker.sourceTransfers);

  const toggleRenderGenerationBefore = await page.evaluate(() => (
    window.ThinkStockE2E.getChartRenderGeneration()
  ));
  const toggledFromRange = await page.locator("#chart").evaluate(async (element) => {
    const current = [...element._fullLayout.xaxis.range];
    const midpoint = new Date((new Date(current[0]).getTime() + new Date(current[1]).getTime()) / 2);
    const from = new Date(midpoint);
    const to = new Date(midpoint);
    from.setUTCDate(from.getUTCDate() - 20);
    to.setUTCDate(to.getUTCDate() + 20);
    const range = [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
    await window.Plotly.relayout(element, { "xaxis.range": range });
    return range;
  });
  await page.locator('[data-series="customer_deposit"]').click();
  await expect(page.locator('[data-series="customer_deposit"]')).toHaveClass(/is-on/);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getChartRenderGeneration()
  ))).toBeGreaterThan(toggleRenderGenerationBefore);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    [...element._fullLayout.xaxis.range]
  ))).toEqual(toggledFromRange);

  await page.locator("#hoverToggle").click();
  await expect(page.locator("#hoverToggle")).toHaveClass(/is-active/);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
  ))).toBeGreaterThan(0);
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
    window.Plotly.Fx.hover(element, [{ curveNumber: traceIndex, pointNumber: pointIndex }]);
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
    const hoverGroupDuringDrag = element.querySelector(".hoverlayer > g");
    const hoverHiddenDuringDrag = !hoverGroupDuringDrag
      || getComputedStyle(hoverGroupDuringDrag).display === "none";
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
    return {
      before,
      traceIndex,
      pointIndex,
      hoverHiddenDuringDrag,
      dragClassCleared: !element.classList.contains("is-line-dragging"),
    };
  });
  expect(dragResult.hoverHiddenDuringDrag).toBe(true);
  expect(dragResult.dragClassCleared).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element, drag) => (
    element.data?.[drag.traceIndex]?.y?.[drag.pointIndex]
  ), dragResult)).not.toBe(dragResult.before);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates
  ))).toBeGreaterThan(dragPerfBefore.partialDisclosureUpdates);
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartRenderGeneration()))
    .toBeLessThanOrEqual(dragPerfBefore.generation + 1);
  const dragPerfAfter = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());
  expect(dragPerfAfter.dispatched).toBeLessThanOrEqual(dragPerfBefore.dispatched + 1);
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

    await page.locator("#chart").dispatchEvent("pointerleave", { pointerType: "mouse" });
    await expect.poll(() => page.locator("#chart").evaluate((element) => (
      getComputedStyle(element).cursor
    ))).toBe("default");
  }
  await page.locator("#hoverToggle").click();
  await expect(page.locator("#hoverToggle")).not.toHaveClass(/is-active/);

  const disclosureToggleBefore = await page.evaluate(() => ({
    partial: window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates,
  }));
  await page.locator("#disclosureToggle").click();
  await expect(page.locator("#disclosureToggle")).toHaveText("공시");
  await expect(page.locator("#chart .textpoint text").filter({ hasText: "◆" })).toHaveCount(0);
  await page.locator("#disclosureToggle").click();
  await expect(page.locator("#chart .textpoint text").filter({ hasText: "◆" }).first()).toBeVisible();
  await expect(page.locator("#disclosureToggle")).toHaveText("공시");
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
    await expect.poll(async () => {
      disclosurePoint = await getDisclosurePoint();
      await page.locator("#chart").dispatchEvent("pointermove", {
        clientX: disclosurePoint.x,
        clientY: disclosurePoint.y,
        pointerType: "mouse",
        isPrimary: true,
      });
      return page.locator("#chart").evaluate((element) => (
        element.classList.contains("is-disclosure-hovering")
      ));
    }).toBe(true);
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
  if (!await popover.isVisible()) {
    const opened = await page.evaluate(() => window.ThinkStockE2E?.openFirstDisclosure?.());
    expect(opened).toBe(true);
  }
  await expect(popover).toBeVisible();
  await expect(popover.locator(".disclosure-title-link")).toHaveAttribute("href", "https://dart.fss.or.kr/example");
  chartBox = await page.locator("#chart").boundingBox();
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
  });

  await test.step("persist snapshots and prune granular caches", async () => {
  await page.evaluate(() => window.ThinkStockE2E.saveRuntimeSnapshotNow());
  const snapshotStatsBefore = await page.evaluate(() => window.ThinkStockE2E.getRuntimeSnapshotStats());
  const runtimeCacheKeys = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("thinkstock-runtime-cache-v1", 4);
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
    "component:crisis",
    "component:disclosure",
    "component:macro",
    "component:price",
    "latest",
  ]);
  await page.evaluate(() => window.ThinkStockE2E.saveRuntimeSnapshotNow());
  snapshotStatsAfter = await page.evaluate(() => window.ThinkStockE2E.getRuntimeSnapshotStats());
  expect(snapshotStatsAfter.builds).toBe(snapshotStatsBefore.builds);
  expect(snapshotStatsAfter.writes).toBe(snapshotStatsBefore.writes);
  expect(snapshotStatsAfter.componentWrites).toBe(snapshotStatsBefore.componentWrites);
  expect(snapshotStatsAfter.skips).toBeGreaterThan(snapshotStatsBefore.skips);

  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("thinkstock-runtime-cache-v1", 4);
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
    const request = indexedDB.open("thinkstock-runtime-cache-v1", 4);
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
  });

  await test.step("stay inside the desktop interaction budget", async () => {
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
  });

  await test.step("load historical segments without forcing a full Plotly render", async () => {
  const revisionsBeforeHistory = snapshotStatsAfter.revisions;
  const workerStatsBeforeHistory = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());
  await setChartRangeMonths(page, 360);
  await expect.poll(getHistoryRequests).toBe(4);
  await expect(page.locator("#chartRangeStepper")).toHaveAttribute("data-months", "360");
  await expect.poll(() => page.locator("#chart").evaluate((element) => element.data?.[0]?.x?.[0]))
    .toBe("1998-07-14");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    String(element._fullLayout?.xaxis?.tickvals?.[0] || "").slice(0, 10)
  ))).toBe("1998-07-14");
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
});
