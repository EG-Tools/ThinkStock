import { expect, test } from "@playwright/test";

const recentDates = ["2025-07-14", "2025-10-14", "2026-01-14", "2026-04-14", "2026-07-14"];
const historyDates = ["1998-07-14", "2005-07-14", "2012-07-14"];

function columnar(series, dates, columns) {
  return {
    generated_at: "2026-07-15T00:00:00Z",
    format: "columnar-v1",
    series,
    display_names: {
      "^KS11": "코스피",
      "^KQ11": "코스닥",
      "005930.KS": "삼성전자",
      leading_cycle: "선행지수 순환변동치",
      customer_deposit: "고객예탁금",
      kospi_credit: "코스피 신용",
      kosdaq_credit: "코스닥 신용",
    },
    dates,
    columns,
  };
}

async function stubExternalRefreshes(page) {
  const unavailable = (route) => route.fulfill({
    status: 503,
    headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
    body: "{}",
  });
  await page.route("https://query2.finance.yahoo.com/**", unavailable);
  await page.route("https://corsproxy.io/**", unavailable);
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
  const macroRecent = columnar(["leading_cycle"], recentDates, { leading_cycle: [99, 99.5, 100, 100.5, 101] });
  const macroHistory = columnar(["leading_cycle"], historyDates, { leading_cycle: [96, 97, 98] });
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
    ["adr_kospi", "adr_kosdaq"],
    recentDates,
    { adr_kospi: [95, 100, 105, 110, 115], adr_kosdaq: [90, 95, 100, 105, 110] },
  );
  const adrHistory = columnar(["adr_kospi", "adr_kosdaq"], [], { adr_kospi: [], adr_kosdaq: [] });
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
        records: [{
          date: "2026-04-14",
          ticker: "005930.KS",
          name: "삼성전자",
          title: "유상증자 결정",
          type: "자금조달",
          url: "https://dart.fss.or.kr/example",
        }],
      } });
      return;
    }
    if (name === "dart_corp_codes.json" || name === "build_report.json") {
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
  await stubExternalRefreshes(page);
  return () => historyRequests;
}

test("bundled recent data boots through the chart worker", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#appVersionText")).toHaveText("0.60");
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  expect(await page.evaluate(() => window.ThinkStockE2E?.getChartModelSource?.())).toBe("worker");
  const firstChartDate = await page.locator("#chart").evaluate((element) => element.data?.[0]?.x?.[0]);
  expect(firstChartDate).toMatch(/^2016-/);
  expect(pageErrors).toEqual([]);
});

test("chart, disclosure popover, and lazy history remain interactive", async ({ page, isMobile }) => {
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
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#appVersionText")).toHaveText("0.60");
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await expect(page.locator('[data-series="customer_deposit"]')).toBeVisible();
  expect(await page.evaluate(() => window.ThinkStockE2E?.getChartModelSource?.())).toBe("worker");
  expect(getHistoryRequests()).toBe(0);

  await page.locator('[data-series="customer_deposit"]').click();
  await expect(page.locator('[data-series="customer_deposit"]')).toHaveClass(/is-on/);

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
    element.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: clientY + 36,
      button: 0,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: clientY + 36,
      button: 0,
    }));
    return { before, traceIndex, pointIndex };
  });
  await expect.poll(() => page.locator("#chart").evaluate((element, drag) => (
    element.data?.[drag.traceIndex]?.y?.[drag.pointIndex]
  ), dragResult)).not.toBe(dragResult.before);

  const disclosureText = page.locator("#chart .textpoint text").filter({ hasText: "v" }).first();
  await expect(disclosureText).toBeVisible();
  const getDisclosurePoint = () => page.locator("#chart").evaluate((element) => {
    const trace = element.data?.find((item) => item?.meta?.isDisclosureTrace);
    const xAxis = element._fullLayout?.xaxis;
    const yAxis = element._fullLayout?.yaxis;
    const rect = element.getBoundingClientRect();
    if (!trace || !xAxis || !yAxis) return null;
    return {
      x: rect.left + xAxis._offset + xAxis.d2p(trace.x[0]),
      y: rect.top + yAxis._offset + yAxis.d2p(trace.y[0]),
    };
  });
  let disclosurePoint = await getDisclosurePoint();
  expect(disclosurePoint).not.toBeNull();
  const popover = page.locator("#chart .disclosure-popover");
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
  await popover.getByRole("button", { name: "공시 닫기" }).click();
  await expect(popover).toBeHidden();

  await page.locator('.range-btn[data-months="360"]').click();
  await expect.poll(getHistoryRequests).toBe(4);
  await expect(page.locator('.range-btn[data-months="360"]')).toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => element.data?.[0]?.x?.[0]))
    .toBe("1998-07-14");
});
