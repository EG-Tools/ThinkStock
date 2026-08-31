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
  evaluateChartRuntimeEfficiency,
  evaluatePerformanceBudget,
} from "../../shared/performance-budget.mjs";

import RESEARCH_CONTRACT from "../../docs/modules/stock-research-contract.js";
import { RELEASES as RELEASE_NOTES } from "../../docs/modules/release-notes.mjs";

test("API settings marks expired periods without a startup reminder", async ({ page }) => {
  await stubExternalRefreshes(page);
  await installDataRoutes(page);
  await page.addInitScript(() => {
    const NativeDate = Date;
    const fixedTime = NativeDate.parse("2027-04-15T03:00:00Z");
    class FixedDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedTime]));
      }

      static now() {
        return fixedTime;
      }
    }
    window.Date = FixedDate;
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#apiExpiryReminderModal")).toHaveCount(0);
  await page.locator("#apiOptionsBtn").click();
  await expect(page.locator("#apiSettingsModal")).toBeVisible();
  await page.locator("#apiPeriodBtn").click();
  await expect(page.locator("#apiPeriodPanel")).toBeVisible();
  const krxApiRow = page.locator("#apiPeriodRows .api-period-row").filter({ hasText: "KRX API" });
  await expect(krxApiRow).toContainText("기간만료");
});

test("stock research Worker loads its bundled dependencies without global collisions", async ({ page }) => {
  await stubExternalRefreshes(page);
  await installDataRoutes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });

  const response = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker("./assets/stock-research-worker.bundle.min.js?v=e2e-worker-scope");
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("stock research Worker initialization timed out"));
    }, 5_000);
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "stock research Worker failed to load"));
    };
    worker.onmessage = (event) => {
      if (event.data?.id !== 1) return;
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.postMessage({
      id: 1,
      type: "init",
      shared: {
        kospiRows: [],
        kosdaqRows: [],
        adrRows: [],
        macroRows: [],
        creditRows: [],
        crisisRows: [],
      },
    });
  }));

  expect(response).toEqual({ id: 1, ready: true });
});

test("stock research blocked list scrolls after five rows and unblocks one stock", async ({ page }) => {
  await stubExternalRefreshes(page);
  await installDataRoutes(page);
  await page.addInitScript((researchContract) => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      ticker: `${String(index + 1).padStart(6, "0")}.KS`,
      name: index === 0
        ? "삼성전자"
        : (index === 1 ? "삼성바이오로직스우" : `차단종목${index + 1}`),
      market: "KOSPI",
      blockedAt: `2026-08-${String(Math.min(28, index + 1)).padStart(2, "0")}T00:00:00.000Z`,
    }));
    localStorage.setItem(researchContract.BLOCKED_KEY, JSON.stringify({
      schema: researchContract.BLOCKED_SCHEMA,
      entries,
    }));
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
  }, RESEARCH_CONTRACT);

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.locator("#stockResearchBtn").click();
  await expect(page.locator("#stockResearchModal")).toBeVisible();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toHaveText("차단 20 종목");
  await page.locator("#stockResearchModalBlockedClearBtn").click();

  const blockedPopover = page.locator("#stockResearchPanel .stock-research-list-popover");
  const blockedList = blockedPopover.locator(".chart-hover-summary-lines");
  await expect(blockedPopover).toBeVisible();
  await expect(blockedList.locator(".chart-hover-summary-row")).toHaveCount(20);
  await expect(blockedList.locator(".chart-hover-summary-title").nth(1)).toHaveText("삼성바이오로직스...");
  await expect(blockedPopover).toHaveClass(/can-scroll-down/);
  await expect(blockedPopover).not.toHaveClass(/can-scroll-up/);
  await page.locator("#stockResearchPanel").dispatchEvent("pointerdown");
  await expect(blockedPopover).toBeHidden();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#stockResearchModalBlockedClearBtn").click();
  await expect(blockedPopover).toBeVisible();
  const scrolling = await blockedList.evaluate((element) => {
    const firstRow = element.querySelector(".chart-hover-summary-row");
    const rowHeight = firstRow?.getBoundingClientRect().height || 0;
    return {
      clientHeight: element.clientHeight,
      rowHeight,
      scrollHeight: element.scrollHeight,
      touchAction: getComputedStyle(element).touchAction,
      scrollbarWidth: getComputedStyle(element).scrollbarWidth,
      width: element.closest(".stock-research-list-popover")?.getBoundingClientRect().width || 0,
    };
  });
  expect(scrolling.scrollHeight).toBeGreaterThan(scrolling.clientHeight);
  expect(Math.round(scrolling.clientHeight / scrolling.rowHeight)).toBe(5);
  expect(scrolling.touchAction).toBe("pan-y");
  expect(["none", "auto"].includes(scrolling.scrollbarWidth)).toBe(true);
  expect(scrolling.width).toBeLessThanOrEqual(191);
  await blockedList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => blockedList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(blockedPopover).toHaveClass(/can-scroll-up/);
  await expect(blockedPopover).not.toHaveClass(/can-scroll-down/);

  const blockedAction = blockedList.locator(".chart-hover-summary-action").first();
  await expect(blockedAction).toHaveAttribute("aria-label", "삼성전자 해제");
  await blockedAction.click();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toHaveText("차단 19 종목");
  await expect(blockedList.locator(".chart-hover-summary-row")).toHaveCount(20);
  await expect(blockedAction).toHaveText("차단");
  await expect(blockedAction).toHaveAttribute("aria-label", "삼성전자 차단");
  await expect(blockedPopover).toBeVisible();
  await blockedAction.click();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toHaveText("차단 20 종목");
  await expect(blockedAction).toHaveText("해제");
  await expect(blockedAction).toHaveAttribute("aria-label", "삼성전자 해제");
});

test("stock research popup preserves results while adding multiple candidates", async ({ page }) => {
  await stubExternalRefreshes(page);
  let researchUniverseRequests = 0;
  let fullHistoryRequests = 0;
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/research/history?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    if (ticker !== "279570.KS") {
      await route.abort();
      return;
    }
    await route.fulfill({ json: {
      ok: true,
      ticker,
      rows: [{ date: "2026-08-28", close: 15000, volume: 120000 }],
    } });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/prices?*", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    await route.fulfill({ json: {
      ok: true,
      ticker,
      source: "KRX",
      latestDate: ticker === "279570.KS" ? "2026-08-28" : "",
      records: ticker === "279570.KS"
        ? [{ date: "2026-08-28", close: 15000, volume: 120000 }]
        : [],
    } });
  });
  await page.route("**/api/research/universe*", async (route) => {
    researchUniverseRequests += 1;
    await route.abort();
  });
  await page.route("https://query2.finance.yahoo.com/v8/finance/chart/000001.KS**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("range") === "max") fullHistoryRequests += 1;
    await route.fulfill({ json: {
      chart: {
        result: [{
          meta: { gmtoffset: 0 },
          timestamp: [
            Date.parse("2003-01-02T00:00:00Z") / 1000,
            Date.parse("2026-08-10T00:00:00Z") / 1000,
          ],
          indicators: { quote: [{ close: [5000, 13000], volume: [500000, 1500000] }] },
        }],
        error: null,
      },
    } });
  });
  await page.addInitScript((researchContract) => {
    window.__THINKSTOCK_E2E_LATEST_TRADING_DATE__ = "2026-07-14";
    const candidates = [
      {
        ticker: "005930.KS",
        code: "005930",
        name: "삼성전자",
        category: "반도체",
        market: "KOSPI",
        marketRank: 1,
        status: "반전 확인",
        buyCount: 5,
        recentMonthBuyCount: 5,
        lastBuyDate: "2026-07-20",
        sellCount: 1,
        recentMonthSellCount: 1,
        lastSellDate: "2026-08-07",
        sellDate: "2026-08-07",
        reasons: ["매수 5회 연속", "매도 전환 2026-08-07", "마지막 매도 2026-08-07", "20일 등락 4.2%"],
      },
      {
        ticker: "218410.KQ",
        code: "218410",
        name: "RFHIC",
        category: "통신장비",
        market: "KOSDAQ",
        marketRank: 65,
        status: "바닥 점검",
        buyCount: 6,
        recentMonthBuyCount: 6,
        lastBuyDate: "2026-07-14",
        reasons: ["매수 6회 연속", "최근 저점 안정화 관찰"],
      },
      ...[1, 2, 3, 4].map((index) => ({
        ticker: `00000${index}.KS`,
        code: `00000${index}`,
        name: `후보${index}`,
        category: "테스트",
        market: "KOSPI",
        marketRank: index + 1,
        status: "바닥 점검",
        buyCount: 5,
        recentMonthBuyCount: 5,
        lastBuyDate: "2026-07-20",
        reasons: ["매수 5회 연속"],
      })),
    ];
    candidates.forEach((candidate) => {
      candidate.latestDate = "2026-07-14";
    });
    localStorage.setItem(researchContract.CACHE_KEY, JSON.stringify({
      schema: 1,
      formatSchema: researchContract.CACHE_FORMAT_SCHEMA,
      strategy: researchContract.CALCULATION_VERSION,
      calculationVersion: researchContract.CALCULATION_VERSION,
      historyQualityVersion: researchContract.HISTORY_QUALITY_VERSION,
      baseDate: "2026-08-07",
      generatedAt: "2026-08-07T10:00:00Z",
      minimumBuySignals: 1,
      candidates: candidates.slice(0, 5),
      candidatePool: candidates,
      candidateOrder: candidates.map((candidate) => candidate.ticker),
      candidatePageIndex: 0,
      failed: 2,
      universeTickers: ["279570.KS", "950260.KQ"],
      universeState: {
        "279570.KS": {
          fingerprint: "279570.KS|KOSPI|케이뱅크",
          metadataFingerprint: "279570.KS|케이뱅크|120|100000",
          signalFingerprint: "",
          analysisStatus: "failed",
          failureCount: 1,
        },
        "950260.KQ": {
          fingerprint: "950260.KQ|KOSDAQ|인제니아테라퓨틱스(Reg.S)",
          metadataFingerprint: "950260.KQ|인제니아테라퓨틱스(Reg.S)|180|50000",
          signalFingerprint: "",
          analysisStatus: "failed",
          failureCount: 1,
        },
      },
    }));
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
  }, RESEARCH_CONTRACT);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => new Promise((resolve, reject) => {
    const contract = window.ThinkStockE2E.getRuntimeStorageContract();
    const request = indexedDB.open(contract.dbName, contract.dbVersion);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("tickerResearchHistory", "readwrite");
      const rows = [];
      const cursor = new Date("2025-01-02T00:00:00Z");
      // Leave enough weekday rows for the runtime's Korean holiday filter to
      // remove exchange closures while still exercising a 300+ point cache.
      while (rows.length < 340) {
        const weekday = cursor.getUTCDay();
        if (weekday !== 0 && weekday !== 6) {
          rows.push({
            date: cursor.toISOString().slice(0, 10),
            close: 10000 + rows.length,
            volume: 1000000 + rows.length,
          });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      tx.objectStore("tickerResearchHistory").put({
        schema: 1,
        ticker: "000001.KS",
        latestDate: rows.at(-1).date,
        savedAt: Date.now(),
        lastAccessed: Date.now(),
        rows,
      }, "000001.KS");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.locator("#stockResearchBtn").click();
  await expect(page.locator("#stockResearchModal")).toBeVisible();
  await expect(page.locator("#stockResearchFailedBtn")).toHaveText("추출 실패 2개");
  await expect(page.locator("#stockResearchFailedBtn")).toBeVisible();
  await page.locator("#stockResearchFailedBtn").click();
  const failurePopover = page.locator("#stockResearchPanel .chart-hover-summary");
  await expect(failurePopover).toBeVisible();
  await expect(page.locator("#stockResearchFailedBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(failurePopover).toContainText("케이뱅크");
  await expect(failurePopover.locator('[title="인제니아테라퓨틱스(Reg.S)"]')).toHaveCount(1);
  await expect(failurePopover).not.toContainText("279570.KS");
  await expect(failurePopover.getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "케이뱅크 추가" })).toBeVisible();
  await page.locator("#stockResearchPanel").dispatchEvent("pointerdown");
  await expect(failurePopover).toBeHidden();
  await expect(page.locator("#stockResearchFailedBtn")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#stockResearchFailedBtn").click();
  const failedStockAction = failurePopover.locator(".chart-hover-summary-action").first();
  await expect(failedStockAction).toHaveAttribute("aria-label", "케이뱅크 추가");
  await failedStockAction.click();
  await expect(page.locator('[data-series="279570.KS"]')).toHaveClass(/is-on/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "279570.KS");
    const grouped = (element.data || []).find((item) => item?.meta?.hoverGroupTicker === "279570.KS");
    return {
      count: trace?.x?.length || 0,
      listingDate: trace?.meta?.listingDate || "",
      marker: trace?.marker?.symbol || "",
      mode: trace?.mode || "",
      showsListingDate: [trace?.text || [], grouped?.text || []]
        .flat()
        .some((text) => String(text).includes("상장일")),
    };
  })).toEqual({
    count: 1,
    listingDate: "2026-08-28",
    marker: "circle",
    mode: "markers",
    showsListingDate: true,
  });
  await expect(failedStockAction).toHaveText("제거");
  await expect(failedStockAction).toHaveAttribute("aria-label", "케이뱅크 제거");
  await failedStockAction.click();
  await expect(page.locator('[data-series="279570.KS"]')).toHaveCount(0);
  await expect(failedStockAction).toHaveText("추가");
  await page.locator("#stockResearchFailedBtn").click();
  await expect(failurePopover).toBeHidden();
  await expect.poll(() => researchUniverseRequests).toBe(0);
  await expect(page.locator("#stockResearchAsOf")).toContainText("2026-08-07");
  await expect(page.locator("#stockResearchAsOf")).toContainText("검출종목 6개 · 탐구기준");
  await expect(page.locator('[data-research-ticker="005930.KS"]')).toContainText("반도체");
  await expect(page.locator('[data-research-ticker="005930.KS"] .stock-research-market-rank')).toHaveText("코스피 1위");
  await expect(page.locator('[data-research-ticker="005930.KS"] .stock-research-status')).toHaveText("5회 연속 신호");
  await expect(page.locator('[data-research-ticker="005930.KS"]')).not.toContainText("마지막 2026-07-20");
  await expect(page.locator('[data-research-ticker="005930.KS"]')).not.toContainText("마지막 매도");
  await expect(page.locator('[data-research-ticker="005930.KS"]')).not.toContainText("20일 등락");
  const cardLabelStyles = await page.locator('[data-research-ticker="005930.KS"]').evaluate((card) => {
    const rank = getComputedStyle(card.querySelector(".stock-research-market-rank"));
    const signal = getComputedStyle(card.querySelector(".stock-research-status"));
    return { rankColor: rank.color, rankSize: rank.fontSize, signalSize: signal.fontSize };
  });
  expect(cardLabelStyles.rankColor).toBe("rgb(255, 255, 255)");
  expect(cardLabelStyles.rankSize).toBe(cardLabelStyles.signalSize);
  await expect(page.locator("#stockResearchMinimumValue")).toHaveText("5");
  await expect(page.locator("#stockResearchBuyFilter")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stockResearchSellFilter")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stockResearchTodayFilter")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stockResearchTodayFilter")).toHaveText("1일");
  await expect(page.locator("#stockResearchModalCacheClearBtn")).toHaveCount(0);
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toBeDisabled();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toHaveText("차단 0 종목");
  await expect(page.locator("#stockResearchRefreshBtn")).toHaveText("재검색");
  await expect(page.locator("#stockResearchStopBtn")).toBeDisabled();
  await expect(page.locator("#stockResearchPagePosition")).toHaveText("1");
  const popupLayout = await page.locator(".stock-research-panel").evaluate((panelElement) => {
    const header = panelElement.querySelector(".stock-research-header");
    const actions = panelElement.querySelector(".stock-research-actions");
    const list = panelElement.querySelector(".stock-research-results");
    const panel = header.closest(".stock-research-panel").getBoundingClientRect();
    const actionBoxes = [
      actions.querySelector(".stock-research-signal-stepper"),
      document.getElementById("stockResearchPreviousBtn"),
      document.getElementById("stockResearchNextBtn"),
      document.getElementById("stockResearchStopBtn"),
      document.getElementById("stockResearchRefreshBtn"),
    ].map((element) => element.getBoundingClientRect());
    const pageControls = actions.querySelector(".stock-research-page-controls").getBoundingClientRect();
    const close = document.getElementById("stockResearchCloseBtn").getBoundingClientRect();
    const blockedClear = document.getElementById("stockResearchModalBlockedClearBtn").getBoundingClientRect();
    const runControls = actions.querySelector(".stock-research-run-controls").getBoundingClientRect();
    const stop = document.getElementById("stockResearchStopBtn").getBoundingClientRect();
    const refresh = document.getElementById("stockResearchRefreshBtn").getBoundingClientRect();
    const next = document.getElementById("stockResearchNextBtn").getBoundingClientRect();
    return {
      actionLefts: actionBoxes.map((box) => box.left),
      actionTops: actionBoxes.map((box) => box.top),
      pageButtonSizes: actionBoxes.slice(1, 3).map((box) => Math.min(box.width, box.height)),
      pageCenterOffset: Math.abs((pageControls.left + pageControls.right) / 2 - (panel.left + panel.right) / 2),
      runControlsRightOffset: Math.abs(actions.getBoundingClientRect().right - runControls.right),
      refreshGroupRightOffset: Math.abs(runControls.right - refresh.right),
      nextBeforeStop: next.right <= stop.left,
      stopBeforeRefresh: stop.right <= refresh.left,
      signalFontSize: Number.parseFloat(getComputedStyle(actions.querySelector(".stock-research-signal-stepper")).fontSize),
      signalHasColumn: getComputedStyle(actions.querySelector(".stock-research-signal-stepper")).borderTopWidth !== "0px",
      actionsBelowList: actions.getBoundingClientRect().top >= list.getBoundingClientRect().bottom,
      headerOverflow: Math.max(0, header.scrollWidth - header.clientWidth),
      closeRight: close.right,
      closeLeft: close.left,
      blockedClearRight: blockedClear.right,
      panelRight: panel.right,
    };
  });
  expect(popupLayout.actionLefts).toEqual([...popupLayout.actionLefts].sort((left, right) => left - right));
  expect(Math.max(...popupLayout.actionTops) - Math.min(...popupLayout.actionTops)).toBeLessThan(12);
  expect(popupLayout.pageButtonSizes.every((size) => size >= 34)).toBe(true);
  expect(popupLayout.pageCenterOffset).toBeLessThan(2);
  expect(popupLayout.runControlsRightOffset).toBeLessThanOrEqual(16);
  expect(popupLayout.refreshGroupRightOffset).toBeLessThan(2);
  expect(popupLayout.nextBeforeStop).toBe(true);
  expect(popupLayout.stopBeforeRefresh).toBe(true);
  expect(popupLayout.signalFontSize).toBeGreaterThanOrEqual(13);
  expect(popupLayout.signalHasColumn).toBe(false);
  expect(popupLayout.actionsBelowList).toBe(true);
  expect(popupLayout.headerOverflow).toBeLessThanOrEqual(1);
  expect(popupLayout.closeRight).toBeLessThanOrEqual(popupLayout.panelRight);
  expect(popupLayout.blockedClearRight).toBeLessThanOrEqual(popupLayout.closeLeft);
  expect(popupLayout.closeLeft - popupLayout.blockedClearRight).toBeLessThanOrEqual(8);
  await expect(page.locator("#stockResearchList .stock-research-item")).toHaveCount(5);
  const cachedAddDuration = await page.locator('[data-research-toggle="000001.KS"]').evaluate((button) => (
    new Promise((resolve, reject) => {
      const started = performance.now();
      let timeoutId = 0;
      const observer = new MutationObserver(() => check());
      const cleanup = () => {
        observer.disconnect();
        clearTimeout(timeoutId);
      };
      const check = () => {
        const currentButton = document.querySelector('[data-research-toggle="000001.KS"]');
        const seriesButton = document.querySelector('[data-series="000001.KS"]');
        if (currentButton?.textContent?.trim() !== "제거" || !seriesButton?.classList.contains("is-off")) return;
        cleanup();
        resolve(performance.now() - started);
      };
      observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("cached stock add did not commit within 3 seconds"));
      }, 3000);
      button.click();
      queueMicrotask(check);
    })
  ));
  await expect(page.locator('[data-research-toggle="000001.KS"]')).toHaveText("제거");
  await expect(page.locator('[data-series="000001.KS"]')).toHaveClass(/is-off/);
  expect(cachedAddDuration).toBeLessThan(1000);
  expect(fullHistoryRequests).toBe(0);
  await page.locator('[data-research-toggle="000001.KS"]').click();
  await expect(page.locator('[data-research-toggle="000001.KS"]')).toHaveText("추가");
  const fullPageHeight = await page.locator(".stock-research-panel").evaluate((panel) => panel.getBoundingClientRect().height);
  await page.locator("#stockResearchNextBtn").click();
  await expect(page.locator("#stockResearchPagePosition")).toHaveText("2");
  await expect(page.locator('[data-research-ticker="000004.KS"]')).toBeVisible();
  const shortPageHeight = await page.locator(".stock-research-panel").evaluate((panel) => panel.getBoundingClientRect().height);
  expect(Math.abs(shortPageHeight - fullPageHeight)).toBeLessThan(2);
  await page.locator("#stockResearchPreviousBtn").click();
  await expect(page.locator("#stockResearchPagePosition")).toHaveText("1");
  await expect(page.locator('[data-research-ticker="005930.KS"]')).toBeVisible();
  await page.locator("#stockResearchMinimumDecrease").click();
  await page.locator("#stockResearchMinimumDecrease").click();
  await page.locator("#stockResearchMinimumDecrease").click();
  await page.locator("#stockResearchMinimumDecrease").click();
  await expect(page.locator("#stockResearchMinimumValue")).toHaveText("1");
  await expect(page.locator("#stockResearchMinimumDecrease")).toBeDisabled();
  await expect(page.locator("#stockResearchAsOf")).not.toContainText("재검색 필요");
  expect(researchUniverseRequests).toBe(0);
  await page.locator(".stock-research-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(page.locator("#stockResearchModal")).toBeVisible();
  await page.locator('[data-research-toggle="005930.KS"]').click();
  await expect(page.locator("#stockResearchModal")).toBeVisible();
  await expect(page.locator('[data-research-ticker="005930.KS"]')).toContainText("5회 연속 신호");
  await expect(page.locator('[data-research-toggle="005930.KS"]')).toHaveText("제거");
  await page.locator('[data-research-toggle="005930.KS"]').click();
  await expect(page.locator('[data-research-toggle="005930.KS"]')).toHaveText("추가");
  await page.locator('[data-research-block="218410.KQ"]').click();
  await expect(page.locator('[data-research-ticker="218410.KQ"]')).toHaveCount(0);
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toBeEnabled();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toHaveText("차단 1 종목");
  await expect(page.locator("#stockResearchAsOf")).toContainText("검출종목 5개 · 탐구기준");
  await expect(page.locator("#stockResearchList .stock-research-item")).toHaveCount(5);
  await expect(page.locator('[data-research-ticker="000004.KS"]')).toBeVisible();
  await page.locator("#stockResearchModalBlockedClearBtn").click();
  await expect(failurePopover).toBeVisible();
  await expect(failurePopover.locator(".chart-hover-summary-row")).toHaveCount(1);
  await expect(failurePopover).toContainText("RFHIC");
  await page.getByRole("button", { name: "RFHIC 해제" }).click();
  await expect(failurePopover).toBeVisible();
  await expect(page.getByRole("button", { name: "RFHIC 차단" })).toBeVisible();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toBeDisabled();
  await expect(page.locator("#stockResearchModalBlockedClearBtn")).toHaveText("차단 0 종목");
  await expect(page.locator('[data-research-ticker="218410.KQ"]')).toBeVisible();
  await expect(page.locator("#stockResearchAsOf")).toContainText("검출종목 6개 · 탐구기준");
  await page.locator("#stockResearchPanel").dispatchEvent("pointerdown");
  await expect(failurePopover).toBeHidden();
  await page.locator("#stockResearchCloseBtn").click();
  await expect(page.locator("#stockResearchModal")).toBeHidden();
  await page.locator("#apiOptionsBtn").click();
  await expect(page.locator("#stockResearchBlockedBtn")).toHaveCount(0);
  await expect(page.locator("#stockResearchCacheClearBtn")).toHaveCount(0);
  await expect(page.locator("#appCacheBtn")).toBeEnabled();
  await expect(page.locator("#appCacheBtn")).toHaveText(/^캐시 \S+$/);
  await expect(page.locator("#appStateResetBtn")).toHaveText("전체초기화");
  await page.locator("#apiSettingsCloseBtn").click();
  await page.locator("#stockResearchBtn").click();
  await expect(page.locator('[data-research-ticker="218410.KQ"]')).toBeVisible();
  await expect(page.locator("#stockResearchAsOf")).toContainText("검출종목 6개 · 탐구기준");
  await page.locator("#stockResearchSellFilter").click();
  await page.locator("#stockResearchTodayFilter").click();
  await expect(page.locator("#stockResearchBuyFilter")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stockResearchSellFilter")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stockResearchTodayFilter")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stockResearchTodayFilter")).toHaveText("1일");
  await expect(page.locator("#stockResearchSignalLabel")).toHaveText("전체신호");
  await expect(page.locator("#stockResearchMinimumValue")).toHaveText("1");
  await expect(page.locator("#stockResearchMinimumDecrease")).toBeDisabled();
  await expect(page.locator("#stockResearchMinimumIncrease")).toBeEnabled();
  await expect(page.locator("#stockResearchAsOf")).not.toContainText("기존 결과 내 필터");
  await expect(page.locator("#stockResearchAsOf")).toContainText("탐구기준 2026-07-14");
  await expect(page.locator("#stockResearchList .stock-research-item")).toHaveCount(1);
  await expect(page.locator('[data-research-ticker="005930.KS"]')).toHaveCount(0);
  await expect(page.locator('[data-research-ticker="218410.KQ"]')).toContainText("매수 1회 · 1일");
  expect(researchUniverseRequests).toBe(0);
  await page.locator("#stockResearchRefreshBtn").click();
  await expect.poll(() => researchUniverseRequests).toBe(1);
  await expect(page.locator("#stockResearchRefreshBtn")).toBeEnabled();
  await expect(page.locator("#stockResearchRefreshBtn")).toHaveText("재검색");
  await expect(page.locator("#stockResearchProgress .stock-research-progress-track")).toBeHidden();
  await page.locator("#stockResearchCloseBtn").click();
  await page.locator("#apiOptionsBtn").click();
  await expect(page.locator("#appCacheBtn")).toBeEnabled();
  await page.locator("#appCacheBtn").click();
  await expect(page.locator("#appCachePanel")).toBeVisible();
  await expect(page.locator("#appCachePanel .app-cache-row")).toHaveCount(4);
  await expect(page.locator("#appCachePanel")).toContainText("가격·지표·공시·AI·종목탐구");
  await expect(page.locator("#appCacheDeleteBtn")).toBeEnabled();
  await page.locator("#appCacheDeleteBtn").click();
  await expect(page.locator("#appCacheDeleteBtn")).toBeDisabled();
  await expect(page.locator("#appCacheBtn")).toHaveText("캐시 없음");
  await expect(page.locator("#appCachePanelTotal")).toHaveText("캐시 없음");
  await expect(page.locator("#appCacheRows")).toBeHidden();
  await expect(page.locator("#appCacheEmpty")).toBeVisible();
  await page.locator("#apiSettingsCloseBtn").click();
  await page.locator("#stockResearchBtn").click();
  await expect(page.locator("#stockResearchRefreshBtn")).toHaveText("검색");
  await expect(page.locator("#stockResearchEmpty")).toContainText("검색을 누르면");
  await page.locator("#stockResearchTodayFilter").click();
  await expect(page.locator("#stockResearchTodayFilter")).toHaveText("15일");
  await expect(page.locator("#stockResearchTodayFilter")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#stockResearchTodayFilter").click();
  await expect(page.locator("#stockResearchTodayFilter")).toHaveText("30일");
  await page.locator("#stockResearchTodayFilter").click();
  await expect(page.locator("#stockResearchTodayFilter")).toHaveText("1일");
  await expect(page.locator("#stockResearchTodayFilter")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => researchUniverseRequests).toBe(1);
});

test("options reset UI state without deleting access credentials or caches", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript((researchContract) => {
    if (sessionStorage.getItem("thinkstock-state-reset-test-seeded") === "1") return;
    sessionStorage.setItem("thinkstock-state-reset-test-seeded", "1");
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      autoChartReset: false,
      hoverShowPopup: false,
      showChartTools: false,
      showChartHandles: false,
      showCoMovement: false,
      showRecessionSignals: false,
      showDisclosures: true,
      showInsiderTrades: true,
      creditOffset: -9,
      customStocks: [{
        ticker: "005930.KS",
        code: "005930",
        name: "삼성전자",
        market: "KOSPI",
      }],
      hiddenSeries: ["^KS11"],
      hiddenAuxiliarySeries: ["fear_greed"],
      seriesOffsets: { "005930.KS": 12 },
      seriesScales: { "005930.KS": 1.8 },
    }));
    localStorage.setItem(researchContract.BLOCKED_KEY, JSON.stringify({
      schema: 1,
      entries: [{ ticker: "218410.KQ", name: "RFHIC" }],
    }));
    localStorage.setItem(researchContract.MINIMUM_KEY, "2");
    localStorage.setItem(researchContract.CACHE_KEY, JSON.stringify({
      schema: 1,
      formatSchema: researchContract.CACHE_FORMAT_SCHEMA,
      strategy: researchContract.CALCULATION_VERSION,
      calculationVersion: researchContract.CALCULATION_VERSION,
      candidates: [],
    }));
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "keep-token" }));
  }, RESEARCH_CONTRACT);

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-custom-series="005930.KS"]')).toHaveCount(1);
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#chartHandlesToggle")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#apiOptionsBtn").click();
  await expect(page.locator("#appCacheBtn")).toHaveText(/^캐시 \S+$/);

  await page.locator("#appStateResetBtn").click();
  await expect(page.locator("#appStateResetConfirm")).toBeVisible();
  await expect(page.locator("#appStateResetConfirmBtn")).toHaveText("예");
  await expect(page.locator("#appStateResetCancelBtn")).toHaveText("아니오");
  await page.locator("#appStateResetCancelBtn").click();
  await expect(page.locator("#appStateResetConfirm")).toBeHidden();
  await page.locator("#appStateResetBtn").click();
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator("#appStateResetConfirmBtn").click(),
  ]);

  await expect(page.locator('[data-custom-series="005930.KS"]')).toHaveCount(0);
  await expect(page.locator("#hoverToggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#chartToolsToggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#chartHandlesToggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#coMovementToggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#recessionToggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#disclosureToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#insiderTradeToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#epsToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#creditOffset")).toHaveValue("-2");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(6);
  await expect(page.locator('[data-series="^KS11"]')).toHaveClass(/\bis-on\b/);
  for (const key of [
    "leading_cycle",
    "t10y1y",
    "us_credit_spread",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
    "^KQ11",
  ]) {
    await expect(page.locator(`[data-series="${key}"]`)).not.toHaveClass(/\bis-on\b/);
  }
  const researchStorageKeys = {
    BLOCKED_KEY: RESEARCH_CONTRACT.BLOCKED_KEY,
    MINIMUM_KEY: RESEARCH_CONTRACT.MINIMUM_KEY,
    CACHE_KEY: RESEARCH_CONTRACT.CACHE_KEY,
  };
  const storageState = await page.evaluate((researchContract) => ({
    appState: localStorage.getItem("thinkstock-v5"),
    blocked: localStorage.getItem(researchContract.BLOCKED_KEY),
    minimum: localStorage.getItem(researchContract.MINIMUM_KEY),
    researchCache: localStorage.getItem(researchContract.CACHE_KEY),
    access: JSON.parse(localStorage.getItem("thinkstock-dart-gateway-v1") || "null"),
    admin: JSON.parse(localStorage.getItem("thinkstock-admin-session-v1") || "null"),
  }), researchStorageKeys);
  expect(storageState.appState).toBeNull();
  expect(storageState.blocked).toBeNull();
  expect(storageState.minimum).toBeNull();
  expect(storageState.researchCache).not.toBeNull();
  expect(storageState.access).toEqual({ accessToken: "keep-token" });
  expect(storageState.admin?.sessionToken).toMatch(/^v1\./);
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
  await page.locator("#chart").evaluate(async (element) => {
    await globalThis.Plotly.relayout(element, {
      "yaxis.range[0]": 99.9,
      "yaxis.range[1]": 100.1,
      "yaxis.autorange": false,
    });
  });
  await page.locator("#refreshData").click();
  await expect(page.locator("#refreshData")).not.toHaveClass(/spinning/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const xRange = element?._fullLayout?.xaxis?.range?.map(Date.parse);
    const yRange = element?._fullLayout?.yaxis?.range?.map(Number);
    if (!xRange?.every(Number.isFinite) || !yRange?.every(Number.isFinite)) return false;
    const lowX = Math.min(...xRange);
    const highX = Math.max(...xRange);
    const lowY = Math.min(...yRange);
    const highY = Math.max(...yRange);
    const values = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly")
      .flatMap((trace) => (trace.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        return Number.isFinite(time) && Number.isFinite(value) && time >= lowX && time <= highX
          ? [value]
          : [];
      }));
    return values.length > 0 && values.every((value) => value >= lowY && value <= highY);
  })).toBe(true);

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
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
  ))).toBeGreaterThan(0);
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
    await expect.poll(() => page.evaluate(() => (
      window.ThinkStockE2E?.getRuntimeDiagnosticState?.().startupVisualReady === true
      && getComputedStyle(document.querySelector(".hero h1")).getPropertyValue("--title-load").trim() === "100.00%"
    ))).toBe(true);
    expect(await page.evaluate(() => (
      window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
    ))).toBe(0);
    const startupPerf = await page.evaluate(() => window.ThinkStockE2E.getPerformanceApi().summary());
    const startupProfiles = await page.evaluate(() => (
      window.ThinkStockE2E.getPerformanceApi().getOperationProfiles(20)
        .filter((profile) => String(profile.label || "").startsWith("startup:"))
    ));
    expect(startupPerf.appStarts).toBeGreaterThanOrEqual(1);
    expect(
      startupPerf.p95AppStartup,
      `startup profiles: ${JSON.stringify(startupProfiles)}`,
    ).toBeLessThan(DESKTOP_PERF_BUDGET.maxAppStartup);
  } finally {
    releaseFearGreed();
  }

  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
  ))).toBeGreaterThan(0);
});

test("startup skips hidden stock price refresh until it is explicitly requested", async ({ page }) => {
  let hiddenPriceStarted = false;
  await stubExternalRefreshes(page);
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/prices/batch**", async (route) => {
    const tickers = String(new URL(route.request().url()).searchParams.get("tickers") || "")
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean);
    if (tickers.includes("000660.KS")) {
      hiddenPriceStarted = true;
    }
    await route.fulfill({ json: {
      ok: true,
      requested: tickers.length,
      succeeded: tickers.length,
      results: tickers.map((ticker) => ({
        ok: true,
        ticker,
        source: "KRX",
        latestDate: "",
        records: [],
      })),
    } });
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      hiddenSeries: ["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit", "000660.KS"],
      customStocks: [
        { ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" },
        { ticker: "000660.KS", code: "000660", name: "SK하이닉스", market: "KOSPI" },
      ],
    }));
  });

  await page.goto("/?e2e=1&perf=1", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().criticalReady || 0
  ))).toBeGreaterThan(0);
  await expect(page.locator(".hero h1")).not.toHaveClass(/is-loading/);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRuntimeDiagnosticState?.().startupVisualReady || false
  ))).toBe(true);

  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
  ))).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(hiddenPriceStarted).toBe(false);
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
    const trace = element.data?.find((item) => item.meta?.auxiliarySeriesKey === "news_sentiment");
    const index = trace?.x?.indexOf("2026-01-14") ?? -1;
    return index >= 0 ? trace.y[index] : null;
  })).toBeGreaterThan(0);
  await page.evaluate(() => window.ThinkStockE2E.saveRuntimeSnapshotNow());

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = element.data?.find((item) => item.meta?.auxiliarySeriesKey === "news_sentiment");
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
  await page.route("**/assets/diagnostics-runtime-feature.bundle.min.js*", async (route) => {
    diagnosticsRequests += 1;
    await route.continue();
  });
  await page.addInitScript((researchContract) => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 120,
      hiddenSeries: ["customer_deposit", "kospi_credit", "^KQ11", "kosdaq_credit"],
      customStocks: [{ ticker: "005930.KS", name: "삼성전자" }],
      showDisclosures: true,
      hoverShowPopup: false,
    }));
    localStorage.setItem(researchContract.BLOCKED_KEY, JSON.stringify({
      schema: 1,
      entries: [
        { ticker: "000001.KS", name: "차단1" },
        { ticker: "000002.KS", name: "차단2" },
      ],
    }));
  }, RESEARCH_CONTRACT);
  const getHistoryRequests = await installDataRoutes(page);
  await page.goto("/?e2e=1&perf=1", { waitUntil: "domcontentloaded" });

  await test.step("boot charts, browse release notes, and keep diagnostics hidden", async () => {
  await expect(page.locator("#appVersionText")).toHaveText(/^\d+\.\d+$/);
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();
  await waitForChartRenderIdle(page);
  await expect(page.locator("#hoverToggle")).toHaveText("정보창");
  const mutedColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--muted)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(page.locator("#hoverToggle")).toHaveCSS("color", mutedColor);
  await expect.poll(() => page.evaluate(() => {
    const infoStyle = getComputedStyle(document.getElementById("hoverToggle"));
    const researchStyle = getComputedStyle(document.getElementById("stockResearchBtn"));
    return ["borderRadius", "fontSize", "fontWeight", "paddingBlock", "paddingInline"]
      .every((property) => infoStyle[property] === researchStyle[property]);
  })).toBe(true);
  if (isMobile) {
    const buttonSizing = await page.locator("#hoverToggle").evaluate((button) => ({
      width: button.getBoundingClientRect().width,
      scrollWidth: button.scrollWidth,
    }));
    expect(buttonSizing.width - buttonSizing.scrollWidth).toBeLessThanOrEqual(2);
  }
  await page.locator("#hoverToggle").click();
  await expect(page.locator("#hoverToggle")).toHaveClass(/is-active/);
  await expect.poll(() => page.evaluate(() => {
    const resetStyle = getComputedStyle(document.getElementById("resetHandles"));
    const infoStyle = getComputedStyle(document.getElementById("hoverToggle"));
    return ["backgroundColor", "borderColor", "color"]
      .every((property) => infoStyle[property] === resetStyle[property]);
  })).toBe(true);
  await page.locator("#hoverToggle").click();
  expect(await page.evaluate(() => Boolean(window.ThinkStockPerformanceDiagnostics))).toBe(false);
  const displayedVersion = String(
    await page.locator("[data-app-version-copy]").first().textContent(),
  ).trim();
  expect(displayedVersion).toMatch(/^\d+\.\d+$/);
  await expect(page.locator("#mainAppMeta")).toContainText(`Version : ${displayedVersion}`);
  await expect(page.locator("#mainAppMeta")).toContainText("회사 : Life User");
  await expect(page.locator("#mainAppMeta")).toContainText("이메일 : Lyrikey@Naver.com");
  await expect(page.locator("#mainAppMeta a")).toHaveAttribute("href", "mailto:Lyrikey@Naver.com");
  await expect(page.locator("#mainAppMeta")).toHaveCSS("justify-content", "center");
  await expect(page.locator("#mainAppMeta")).toHaveCSS("margin-top", "2px");
  await page.locator("#apiOptionsBtn").click();
  await expect(page.locator("#apiSettingsTitle")).toHaveText("설정");
  const settingsScrollStyle = await page.locator("#apiSettingsModal .api-settings-panel").evaluate((panel) => ({
    overflowY: getComputedStyle(panel).overflowY,
    scrollbarWidth: getComputedStyle(panel).scrollbarWidth,
    touchAction: getComputedStyle(panel).touchAction,
  }));
  expect(settingsScrollStyle).toEqual({
    overflowY: "auto",
    scrollbarWidth: "none",
    touchAction: "pan-y",
  });
  const settingsOverflow = await page.locator("#apiSettingsModal .api-settings-panel").evaluate(
    (panel) => panel.scrollHeight - panel.clientHeight > 1,
  );
  await expect.poll(() => page.locator("#apiSettingsModal").evaluate((modal) => ({
    down: modal.classList.contains("can-scroll-down"),
    up: modal.classList.contains("can-scroll-up"),
  }))).toEqual({ down: settingsOverflow, up: false });
  if (settingsOverflow) {
    await page.locator("#apiSettingsModal .api-settings-panel").evaluate((panel) => {
      panel.scrollTop = panel.scrollHeight;
      panel.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => page.locator("#apiSettingsModal").evaluate((modal) => ({
      down: modal.classList.contains("can-scroll-down"),
      up: modal.classList.contains("can-scroll-up"),
    }))).toEqual({ down: false, up: true });
    await page.locator("#apiSettingsModal .api-settings-panel").evaluate((panel) => {
      panel.scrollTop = 0;
      panel.dispatchEvent(new Event("scroll"));
    });
  }
  await expect(page.locator("#apiSettingsModal .api-settings-panel > .api-settings-header")).not.toContainText("Version");
  await expect(page.locator(".api-settings-version")).toHaveText(`Version : ${displayedVersion}`);
  await expect(page.locator("#settingsAppMeta")).toBeVisible();
  await expect(page.locator("#settingsAppMeta")).toContainText("회사 : Life User");
  await expect(page.locator("#settingsAppMeta")).toContainText("이메일 : Lyrikey@Naver.com");
  await expect(page.locator("#settingsAppMeta a")).toHaveAttribute("href", "mailto:Lyrikey@Naver.com");
  expect(await page.locator("#settingsAppMeta").evaluate((element) => {
    const style = getComputedStyle(element);
    return { justifyContent: style.justifyContent, fontSize: style.fontSize };
  })).toEqual({ justifyContent: "flex-start", fontSize: "11px" });
  await expect(page.locator(".settings-control-group")).toHaveCount(1);
  await expect(page.locator(".settings-control-group > .cursor-line-setting")).toHaveCount(4);
  expect(await page.locator(".settings-control-group").evaluate((group) => ({
    outerBorder: getComputedStyle(group).borderTopWidth,
    rowSideBorders: [...group.children].map((row) => getComputedStyle(row).borderLeftWidth),
  }))).toEqual({ outerBorder: "1px", rowSideBorders: ["0px", "0px", "0px", "0px"] });
  await expect(page.locator("#apiOptionsBtn")).toHaveAttribute("aria-label", "설정");
  const settingsActions = await page.locator(".api-settings-actions").evaluate((element) => {
    const releaseNotes = document.getElementById("releaseNotesBtn").getBoundingClientRect();
    const cache = document.getElementById("appCacheBtn").getBoundingClientRect();
    return { releaseNotesLeft: releaseNotes.left, cacheLeft: cache.left };
  });
  expect(settingsActions.releaseNotesLeft).toBeLessThan(settingsActions.cacheLeft);
  await expect(page.locator("#releaseNotesBtn")).toHaveText("업데이트내역");
  await expect(page.locator("#appCacheBtn")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#appCacheBtn").click();
  await expect(page.locator("#appCacheBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#appCachePanel")).toBeVisible();
  await expect(page.locator("#appCachePanel .app-cache-row")).toHaveCount(4);
  await expect(page.locator("#appCachePanel")).toContainText("앱 파일");
  await expect(page.locator("#appCachePanel")).toContainText("현재 세션");
  await expect(page.locator("#apiPeriodBtn")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#apiPeriodBtn").click();
  await expect(page.locator("#appCachePanel")).toBeHidden();
  await expect(page.locator("#appCacheBtn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#apiPeriodBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#apiPeriodPanel")).toBeVisible();
  await expect(page.locator("#apiSettingsModal .settings-control-group")).toBeVisible();
  await expect(page.locator("#apiSettingsModal .api-local-server-field").first()).toBeVisible();
  await expect(page.locator("#apiPeriodRows .api-period-row")).toHaveCount(8);
  await expect(page.locator("#apiPeriodRows")).toContainText("KRX API");
  await expect(page.locator("#apiPeriodRows")).toContainText("2026/04/15 ~ 2027/04/14");
  await expect(page.locator("#apiPeriodRows")).toContainText("파생상품지수 시세정보");
  await expect(page.locator("#apiPeriodRows")).toContainText("2026/08/12 ~ 2027/08/11");
  await expect(page.locator("#apiPeriodRows")).toContainText("코스피·코스닥 일별매매정보");
  await expect(page.locator("#apiPeriodRows")).toContainText("코스피·코스닥 종목기본정보");
  await expect(page.locator("#apiPeriodRows")).toContainText("한국은행");
  await expect(page.locator("#apiPeriodRows")).toContainText("2026/04/19 ~ 2028/04/19");
  await expect(page.locator("#apiPeriodRows")).toContainText("기간 제한 없음");
  await page.locator("#releaseNotesBtn").click();
  await expect(page.locator("#apiPeriodPanel")).toBeHidden();
  await expect(page.locator("#apiPeriodBtn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#apiSettingsModal .settings-control-group")).toBeVisible();
  await expect(page.locator("#releaseNotesPanel")).toBeVisible();
  const latestRelease = RELEASE_NOTES[0];
  await expect(page.locator("#releaseNotesVersion")).toHaveText(`v${latestRelease.version}`);
  await expect(page.locator("#releaseNotesDate")).toHaveText(latestRelease.date);
  await expect(page.locator("#releaseNotesSize")).toHaveText(/^\d+KB$/);
  expect(await page.locator(".release-notes-heading").evaluate((element) => (
    [...element.children].map((child) => child.id)
  ))).toEqual(["releaseNotesVersion", "releaseNotesDate", "releaseNotesSize"]);
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(latestRelease.items.length);
  const v284Index = RELEASE_NOTES.findIndex((release) => release.version === "2.84");
  expect(v284Index).toBeGreaterThan(0);
  for (let index = 0; index < v284Index; index += 1) {
    await page.locator("#releaseNotesOlderBtn").click();
  }
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.84");
  await expect(page.locator("#releaseNotesList")).toContainText("200");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(6);
  await expect(page.locator("#releaseNotesList")).toHaveClass(/is-two-column/);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.83");
  await expect(page.locator("#releaseNotesList")).toContainText("AI 과거시점 기업 근거 검증 확대");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(5);
  await expect(page.locator("#releaseNotesList")).not.toHaveClass(/is-two-column/);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.82");
  await expect(page.locator("#releaseNotesList")).toContainText("app.js");
  await expect(page.locator("#releaseNotesList")).toContainText("AI");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(7);
  await expect(page.locator("#releaseNotesList")).toHaveClass(/is-two-column/);
  const latestReleaseLayout = await page.locator("#releaseNotesList").evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    columnCount: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
  }));
  expect(latestReleaseLayout.columnCount).toBe(2);
  const chartRangeBeforeReleaseNavigation = await page.locator("#chart").evaluate((element) => (
    [...(element.layout?.xaxis?.range || [])]
  ));
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.81");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(8);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.80");
  await expect(page.locator("#releaseNotesList")).toContainText("데이터 이상값 격리·마지막 정상값 복구 강화");
  await expect(page.locator("#releaseNotesList")).toContainText("AI 최고확률 시나리오 단일 강조");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(8);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.79");
  await expect(page.locator("#releaseNotesList")).toContainText("AI 동일 표본 워크포워드·배포 안전장치 강화");
  await expect(page.locator("#releaseNotesList")).toContainText("구형 관리자 인증 이관 경로 정리");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(7);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.78");
  await expect(page.locator("#releaseNotesList")).toContainText("지수 6종 색상 고정 및 종목 색상 자동 배정");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(7);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.77");
  await expect(page.locator("#releaseNotesList")).toContainText("로컬·Cloudflare 공시 처리 규칙 통합");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(9);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.76");
  await expect(page.locator("#releaseNotesList")).toContainText("메인차트 도구 접기 및 동행율 재배치");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(7);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.75");
  await expect(page.locator("#releaseNotesList")).toContainText("뉴스심리 2005년 이후 전체 이력 복구");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(3);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.74");
  await expect(page.locator("#releaseNotesList")).toContainText("iPhone 홈 화면 공포탐욕·VIX 복구");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(6);
  await expect(page.locator("#releaseNotesList")).toHaveClass(/is-two-column/);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.73");
  await expect(page.locator("#releaseNotesList")).toContainText("AI 국면별 워크포워드·비교 검증 강화");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(6);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.72");
  await expect(page.locator("#releaseNotesList")).toContainText("이례적 급등락 이후 AI 시나리오 다양화");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(5);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.71");
  await expect(page.locator("#releaseNotesList")).toContainText("캐시 종류별 용량 상세보기");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(8);
  await expect(page.locator("#releaseNotesList")).toHaveClass(/is-two-column/);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.70");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(4);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.69");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(5);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.68");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(5);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.67");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(1);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.66");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(5);
  await expect(page.locator("#releaseNotesList")).not.toHaveClass(/is-two-column/);
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.65");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(7);
  await expect(page.locator("#releaseNotesList")).toHaveClass(/is-two-column/);
  const twoColumnPositions = await page.locator("#releaseNotesList").evaluate((element) => (
    [...element.children].map((item) => ({
      column: item.style.gridColumn,
      row: item.style.gridRow,
    }))
  ));
  expect(twoColumnPositions[4]).toEqual({ column: "1", row: "5" });
  expect(twoColumnPositions[5]).toEqual({ column: "2", row: "1" });
  await page.locator("#releaseNotesOlderBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.58");
  await expect(page.locator("#releaseNotesList")).toContainText("종목탐구 통합 캐시");
  await expect(page.locator("#releaseNotesList > li")).toHaveCount(4);
  await expect(page.locator("#releaseNotesList")).not.toHaveClass(/is-two-column/);
  expect(Math.abs(await page.locator("#releaseNotesList").evaluate((element) => (
    element.getBoundingClientRect().height
  )) - latestReleaseLayout.height)).toBeLessThanOrEqual(1);
  await page.locator("#releaseNotesNewerBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.65");
  expect(await page.locator("#chart").evaluate((element) => (
    [...(element.layout?.xaxis?.range || [])]
  ))).toEqual(chartRangeBeforeReleaseNavigation);
  await page.locator("#releaseNotesOlderBtn").dblclick({ delay: 20 });
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.34");
  expect(await page.locator("#chart").evaluate((element) => (
    [...(element.layout?.xaxis?.range || [])]
  ))).toEqual(chartRangeBeforeReleaseNavigation);
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await page.locator("#releaseNotesNewerBtn").click();
  await expect(page.locator("#releaseNotesVersion")).toHaveText("v2.72");
  await expect.poll(() => diagnosticsRequests).toBeGreaterThan(0);
  expect(await page.evaluate(() => Boolean(window.ThinkStockPerformanceDiagnostics))).toBe(false);
  await expect.poll(() => page.evaluate(() => {
    const history = JSON.parse(localStorage.getItem("thinkstock-performance-history-v1") || "[]");
    const appState = history[0]?.appState;
    return appState?.blockedStockCount === 2
      && Number.isFinite(appState?.cacheBytes)
      && Number.isFinite(appState?.chartRender?.total)
      && Number.isFinite(appState?.aiForecast?.quality?.seriesCount);
  })).toBe(true);
  await page.locator("#apiSettingsCloseBtn").click();
  await expect(page.locator("#apiSettingsModal")).toBeHidden();
  await expect(page.locator('[data-series="customer_deposit"]')).toBeVisible();
  await expect(page.locator('[data-series="news_sentiment"]')).toHaveCount(0);
  expect(await page.locator("#chart-adr").evaluate((element) => {
    const hasMappedTrace = (name) => {
      const trace = element.data?.find((candidate) => candidate.name === name);
      if (!trace) return false;
      const axisName = String(trace.yaxis || "y");
      const layoutKey = axisName === "y" ? "yaxis" : `yaxis${axisName.slice(1)}`;
      return Boolean(element._fullLayout?.[layoutKey]);
    };
    return ["공포탐욕", "뉴스심리", "VKOSPI"].every(hasMappedTrace);
  })).toBe(true);
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

  const representativeToggles = page.locator(
    "#chart-adr > .auxiliary-representative-toggles > .auxiliary-representative-toggle",
  );
  const fearGreedToggle = page.locator(
    '.auxiliary-representative-toggle[data-auxiliary-panel="fearGreed"]',
  );
  const fullAuxiliaryHeight = await page.locator("#chart-adr").evaluate((element) => (
    element.getBoundingClientRect().height
  ));
  expect(await representativeToggles.allTextContents()).toEqual([
    "ADR", "변동성", "공포탐욕", "뉴스심리",
  ]);
  expect(await representativeToggles.evaluateAll((buttons) => {
    const rects = buttons.map((button) => button.getBoundingClientRect());
    const tops = rects.map((rect) => rect.top);
    return Math.max(...tops) - Math.min(...tops) <= 1
      && rects.every((rect, index) => index === 0 || rect.left > rects[index - 1].right);
  })).toBe(true);
  await expect(fearGreedToggle).toBeVisible();
  await expect(fearGreedToggle).toHaveCSS("cursor", "pointer");
  await fearGreedToggle.click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.auxiliarySeriesKey === "fear_greed")?.visible === true
  ))).toBe(false);
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    [...element.querySelectorAll(".auxiliary-panel-title")]
      .some((item) => item.textContent?.trim() === "공포탐욕")
  ))).toBe(false);
  const collapsedFearHeight = await page.locator("#chart-adr").evaluate((element) => (
    element.getBoundingClientRect().height
  ));
  expect(collapsedFearHeight).toBeLessThan(fullAuxiliaryHeight - 50);
  await setChartRangeMonths(page, 36);
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.auxiliarySeriesKey === "fear_greed")?.visible === true
  ))).toBe(false);
  await fearGreedToggle.click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    element.data?.find((trace) => trace.meta?.auxiliarySeriesKey === "fear_greed")?.visible
  ))).toBe(true);
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    const trace = element.data?.find((item) => item.meta?.auxiliarySeriesKey === "fear_greed");
    const axisReference = trace?.yaxis || "y";
    const axisKey = axisReference === "y" ? "yaxis" : `yaxis${axisReference.slice(1)}`;
    return element.layout?.[axisKey]?.visible === true
      && [...element.querySelectorAll(".auxiliary-panel-title")]
        .some((item) => item.textContent?.trim() === "공포탐욕");
  })).toBe(true);
  const adrPanelToggle = page.locator(
    '.auxiliary-representative-toggle[data-auxiliary-panel="adr"]',
  );
  let kospiAdrToggle = page.locator('.auxiliary-series-toggle[data-auxiliary-series="adr_kospi"]');
  let kosdaqAdrToggle = page.locator('.auxiliary-series-toggle[data-auxiliary-series="adr_kosdaq"]');
  await expect(kospiAdrToggle).toBeVisible();
  await expect(kosdaqAdrToggle).toBeVisible();
  const adrHeadingOrder = await page.locator('.auxiliary-panel-heading[data-panel-key="adr"]')
    .evaluate((element) => [...element.children].map((item) => item.textContent?.trim()));
  expect(adrHeadingOrder).toEqual(["ADR", "KOSPI", "KOSDAQ"]);
  await kospiAdrToggle.click();
  expect(await page.evaluate(() => window.ThinkStockE2E.getHiddenAuxiliarySeries()))
    .toContain("adr_kospi");
  await expect(kospiAdrToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    element.layout?.yaxis?.visible
  ))).toBe(true);
  await kosdaqAdrToggle.click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    [...element.querySelectorAll(".auxiliary-panel-title")]
      .some((item) => item.textContent?.trim() === "ADR")
  ))).toBe(true);
  expect(await page.locator("#chart-adr").evaluate((element) => (
    element.getBoundingClientRect().height
  ))).toBe(fullAuxiliaryHeight);
  await expect(adrPanelToggle).toHaveAttribute("aria-pressed", "true");
  await adrPanelToggle.click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => (
    [...element.querySelectorAll(".auxiliary-panel-title")]
      .some((item) => item.textContent?.trim() === "ADR")
  ))).toBe(false);
  expect(await page.locator("#chart-adr").evaluate((element) => (
    element.getBoundingClientRect().height
  ))).toBeLessThan(fullAuxiliaryHeight - 120);
  await adrPanelToggle.click();
  await expect.poll(() => page.locator("#chart-adr").evaluate((element) => {
    return [...element.querySelectorAll(".auxiliary-panel-title")]
        .some((item) => item.textContent?.trim() === "ADR");
  })).toBe(true);
  kospiAdrToggle = page.locator('.auxiliary-series-toggle[data-auxiliary-series="adr_kospi"]');
  kosdaqAdrToggle = page.locator('.auxiliary-series-toggle[data-auxiliary-series="adr_kosdaq"]');
  await expect(kospiAdrToggle).toHaveAttribute("aria-pressed", "false");
  await expect(kosdaqAdrToggle).toHaveAttribute("aria-pressed", "false");
  await kospiAdrToggle.click();
  await kosdaqAdrToggle.click();
  await expect(kospiAdrToggle).toHaveAttribute("aria-pressed", "true");
  await expect(kosdaqAdrToggle).toHaveAttribute("aria-pressed", "true");
  for (const panel of [
    { panelKey: "newsSentiment", traceKey: "news_sentiment", title: "뉴스심리" },
    { panelKey: "vkospi", traceKey: "vkospi", title: "변동성" },
  ]) {
    const panelToggle = page.locator(
      `.auxiliary-representative-toggle[data-auxiliary-panel="${panel.panelKey}"]`,
    );
    await panelToggle.click();
    await expect.poll(() => page.locator("#chart-adr").evaluate((element, descriptor) => ({
      traceVisible: element.data?.find(
        (trace) => trace.meta?.auxiliarySeriesKey === descriptor.traceKey,
      )?.visible === true,
      hasTitle: [...element.querySelectorAll(".auxiliary-panel-title")]
        .some((item) => item.textContent?.trim() === descriptor.title),
      panelCount: element.querySelectorAll(".auxiliary-panel-title").length,
    }), panel)).toEqual({
      traceVisible: false,
      hasTitle: false,
      panelCount: 3,
    });
    expect(await page.locator("#chart-adr").evaluate((element) => (
      element.getBoundingClientRect().height
    ))).toBeLessThan(fullAuxiliaryHeight - 50);
    await expect(panelToggle).toHaveAttribute("aria-pressed", "false");
    await panelToggle.click();
    await expect.poll(() => page.locator("#chart-adr").evaluate((element, descriptor) => {
      const trace = element.data?.find(
        (candidate) => candidate.meta?.auxiliarySeriesKey === descriptor.traceKey,
      );
      const axisReference = trace?.yaxis || "y";
      const axisKey = axisReference === "y" ? "yaxis" : `yaxis${axisReference.slice(1)}`;
      return {
        traceVisible: trace?.visible === true,
        axisVisible: element.layout?.[axisKey]?.visible === true,
        hasTitle: [...element.querySelectorAll(".auxiliary-panel-title")]
          .some((item) => item.textContent?.trim() === descriptor.title),
        panelCount: element.querySelectorAll(".auxiliary-panel-title").length,
      };
    }, panel)).toEqual({
      traceVisible: true,
      axisVisible: true,
      hasTitle: true,
      panelCount: 4,
    });
  }
  expect(await page.locator("#chart-adr").evaluate((element) => {
    const labels = (element.layout?.annotations || []).map((item) => item.text);
    const traceFor = (seriesKey) => element.data?.find((trace) => (
      trace.meta?.auxiliarySeriesKey === seriesKey
    ));
    const axisKeyFor = (axisReference = "y") => (
      axisReference === "y" ? "yaxis" : `yaxis${axisReference.slice(1)}`
    );
    const fearAxis = traceFor("fear_greed")?.yaxis || "y";
    const newsAxis = traceFor("news_sentiment")?.yaxis || "y";
    const boundaryLines = (element.layout?.shapes || []).filter((item) => (
      item.type === "line" && item.yref === fearAxis && item.line?.dash === "2px,4px"
        && item.line?.width === 1
        && [25, 75].includes(Number(item.y0))
    ));
    const newsBoundaryLines = (element.layout?.shapes || []).filter((item) => (
      item.type === "line" && item.yref === newsAxis && item.line?.dash === "2px,4px"
        && item.line?.width === 1
        && [90, 110].includes(Number(item.y0))
    ));
    const vkospiTrace = traceFor("vkospi");
    const separatorLines = [...element.querySelectorAll(
      ":scope > .auxiliary-separator-layer > .auxiliary-section-separator",
    )];
    const panelTitles = [...element.querySelectorAll(
      ":scope > .auxiliary-panel-heading > .auxiliary-panel-title",
    )];
    const panelTitleNames = panelTitles.map((item) => item.textContent?.trim());
    const chartRect = element.getBoundingClientRect();
    const plotLeft = chartRect.left + (Number(element._fullLayout?._size?.l) || 0);
    const panelTitlesAligned = panelTitles.every((title) => (
      Math.abs(title.getBoundingClientRect().left - plotLeft) <= 1
    ));
    const panelTitlesBelowSeparators = panelTitles.every((title) => {
      const separator = element.querySelector(
        `.auxiliary-section-separator[data-panel-key="${title.dataset.panelKey}"]`,
      );
      if (!separator) return false;
      const gap = title.getBoundingClientRect().top - separator.getBoundingClientRect().bottom;
      return gap >= 2 && gap <= 5;
    });
    const representativeRect = element.querySelector(
      ":scope > .auxiliary-representative-toggles",
    )?.getBoundingClientRect();
    const controlsSeparatorRect = element.querySelector(
      '[data-separator="controls"]',
    )?.getBoundingClientRect();
    const separatorsReachEdges = separatorLines.every((line) => {
      const rect = line.getBoundingClientRect();
      return Math.abs(rect.left - chartRect.left) <= 1
        && Math.abs(rect.right - chartRect.right) <= 1;
    });
    const controlsSeparatorGap = representativeRect && controlsSeparatorRect
      ? controlsSeparatorRect.top - representativeRect.bottom
      : null;
    const panelDomains = panelTitles.map((title) => {
      const seriesKeyByPanel = {
        adr: "adr_kospi",
        fearGreed: "fear_greed",
        newsSentiment: "news_sentiment",
        vkospi: "vkospi",
      };
      const trace = traceFor(seriesKeyByPanel[title.dataset.panelKey]);
      return element.layout?.[axisKeyFor(trace?.yaxis || "y")]?.domain || [];
    });
    const domainsDescendWithoutOverlap = panelDomains.every((domain, index) => (
      domain.length === 2
      && (index === 0
        ? Math.abs(domain[1] - 1) < 0.001
        : panelDomains[index - 1][0] > domain[1])
    ));
    return panelTitleNames.length === 4
      && ["ADR", "공포탐욕", "뉴스심리", "변동성"].every((name) => panelTitleNames.includes(name))
      && panelTitlesAligned
      && panelTitlesBelowSeparators
      && labels.includes("공포")
      && labels.includes("탐욕")
      && boundaryLines.length === 2
      && labels.includes("부정")
      && labels.includes("긍정")
      && newsBoundaryLines.length === 2
      && vkospiTrace?.y?.some((value) => Number.isFinite(value))
      && separatorLines.length === 4
      && element.querySelectorAll("[data-paper-y]").length === 3
      && separatorsReachEdges
      && controlsSeparatorGap >= 3 && controlsSeparatorGap <= 8
      && domainsDescendWithoutOverlap
      && Math.abs(panelDomains.at(-1)?.[0] || 0) < 0.001;
  })).toBe(true);
  const adrHeaderGeometry = await page.locator("#chart-adr").evaluate((element) => {
    const title = element.querySelector('.auxiliary-panel-title[data-panel-key="adr"]')
      ?.getBoundingClientRect();
    const separator = element.querySelector('.auxiliary-section-separator[data-panel-key="adr"]')
      ?.getBoundingClientRect();
    return {
      titleTop: title?.top ?? null,
      separatorBottom: separator?.bottom ?? null,
      gap: title && separator ? title.top - separator.bottom : null,
    };
  });
  expect(adrHeaderGeometry.gap, JSON.stringify(adrHeaderGeometry)).toBeGreaterThanOrEqual(2);
  expect(adrHeaderGeometry.gap, JSON.stringify(adrHeaderGeometry)).toBeLessThanOrEqual(5);
  expect(await page.evaluate(() => window.ThinkStockE2E?.getChartModelSource?.())).toBe("worker");
  expect(await page.evaluate(() => window.ThinkStockE2E?.getAuxiliaryChartModelSource?.())).toBe("worker");
  expect(getHistoryRequests()).toBe(0);
  await expect(page.locator(".hero h1")).not.toHaveClass(/is-loading/);
  expect(await page.evaluate(() => window.ThinkStockE2E?.getMainHoverMode?.())).toBe(false);
  await page.evaluate(() => window.ThinkStockE2E?.getPerformanceApi?.()?.clear?.());
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
    const trace = element.data?.find((item) => item.meta?.auxiliarySeriesKey === "news_sentiment");
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
  await waitForChartRenderIdle(page);

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
    return range.map(Date.parse);
  });
  await page.locator('[data-series="customer_deposit"]').click();
  await expect(page.locator('[data-series="customer_deposit"]')).toHaveClass(/is-on/);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getChartRenderGeneration()
  ))).toBeGreaterThan(toggleRenderGenerationBefore);
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ))).toEqual(toggledFromRange);

  const hoverToggleRenderGenerationBefore = await page.evaluate(() => (
    window.ThinkStockE2E.getChartRenderGeneration()
  ));
  await page.locator("#hoverToggle").click();
  await expect(page.locator("#hoverToggle")).toHaveClass(/is-active/);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getChartRenderGeneration()
  ))).toBeGreaterThan(hoverToggleRenderGenerationBefore);
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().supplementalReady || 0
  ))).toBeGreaterThan(0);
  const chartResetButton = page.locator("#resetHandles");
  if (await chartResetButton.getAttribute("aria-pressed") === "true") {
    await chartResetButton.click();
  }
  await expect(chartResetButton).toHaveAttribute("aria-pressed", "false");
  const dragPerfBefore = await page.evaluate(() => ({
    generation: window.ThinkStockE2E.getChartRenderGeneration(),
    ...window.ThinkStockE2E.getChartWorkerStats(),
  }));
  const dragResult = await page.locator("#chart").evaluate((element) => {
    const traceIndex = element.data.findIndex((trace) => (
      trace?.visible !== "legendonly"
      && trace?.meta?.seriesKey
      && !trace?.meta?.isGroupedHoverTrace
      && !trace?.meta?.isDisclosureTrace
      && !trace?.meta?.isAiForecastTrace
      && Array.isArray(trace?.y)
    ));
    const trace = element.data[traceIndex];
    const pointIndex = Math.max(0, Math.floor(trace.x.length / 2));
    const xaxis = element._fullLayout.xaxis;
    const yaxis = element._fullLayout.yaxis;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + xaxis._offset + xaxis.d2p(trace.x[pointIndex]);
    const clientY = rect.top + yaxis._offset + yaxis.d2p(trace.y[pointIndex]);
    const dragTarget = window.ThinkStockE2E.getLineDragTargetAt(clientX, clientY);
    const draggedTraceIndex = Number.isInteger(dragTarget?.traceIndex)
      ? dragTarget.traceIndex
      : traceIndex;
    const draggedTrace = element.data[draggedTraceIndex];
    const targetDate = trace.x[pointIndex];
    const matchingPointIndex = draggedTrace?.x?.indexOf(targetDate) ?? -1;
    const draggedPointIndex = matchingPointIndex >= 0
      ? matchingPointIndex
      : Math.max(0, draggedTrace?.y?.findIndex((value) => Number.isFinite(Number(value))) ?? 0);
    const before = draggedTrace?.y?.[draggedPointIndex];
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
    const markerSetHiddenDuringDrag = element.classList.contains("is-series-transform-marker-hidden");
    const disclosureTraceIndex = (element.data || [])
      .findIndex((candidate) => candidate?.meta?.isDisclosureTrace);
    const disclosureTrace = element.data?.[disclosureTraceIndex];
    const disclosureTextNodes = [...element.querySelectorAll(".scatterlayer .textpoint text")]
      .filter((node) => node.textContent?.trim() === "◆");
    const disclosureMarkerCount = disclosureTrace?.x?.length || 0;
    const disclosureVisibleDuringDrag = disclosureMarkerCount > 0
      && disclosureTextNodes.length > 0
      && disclosureTextNodes.some((node) => getComputedStyle(node).visibility !== "hidden");
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
      traceIndex: draggedTraceIndex,
      pointIndex: draggedPointIndex,
      hoverHiddenDuringDrag,
      markerSetHiddenDuringDrag,
      disclosureMarkerCount,
      disclosureVisibleDuringDrag,
      dragClassCleared: !element.classList.contains("is-line-dragging"),
    };
  });
  expect(dragResult.hoverHiddenDuringDrag).toBe(true);
  expect(dragResult.markerSetHiddenDuringDrag).toBe(false);
  expect(dragResult.disclosureMarkerCount).toBeGreaterThan(0);
  expect(dragResult.disclosureVisibleDuringDrag).toBe(true);
  expect(dragResult.dragClassCleared).toBe(true);
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);
  await expect.poll(() => page.locator("#chart").evaluate((element, drag) => (
    element.data?.[drag.traceIndex]?.y?.[drag.pointIndex]
  ), dragResult)).not.toBe(dragResult.before);
  const partialUpdatesAfterDrag = await page.evaluate(() => (
    window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates
  ));
  expect(partialUpdatesAfterDrag)
    .toBeGreaterThanOrEqual(dragPerfBefore.partialDisclosureUpdates);
  expect(partialUpdatesAfterDrag)
    .toBeLessThanOrEqual(dragPerfBefore.partialDisclosureUpdates + 1);
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
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isDisclosureTrace).length
  ))).toBe(0);
  await page.locator("#disclosureToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isDisclosureTrace).length
  ))).toBe(1);
  await expect(page.locator("#disclosureToggle")).toHaveText("공시");
  expect(await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats().partialDisclosureUpdates))
    .toBeGreaterThan(disclosureToggleBefore.partial);

  const getDisclosurePoint = () => page.locator("#chart").evaluate((element) => {
    const traceIndex = (element.data || []).findIndex((trace) => trace?.meta?.isDisclosureTrace);
    const trace = element.data?.[traceIndex];
    const xAxis = element._fullLayout?.xaxis;
    const yAxis = trace?.yaxis === "y2" ? element._fullLayout?.yaxis2 : element._fullLayout?.yaxis;
    const chartRect = element.getBoundingClientRect();
    if (!trace?.x?.length || !trace?.y?.length
      || typeof xAxis?.d2p !== "function" || typeof yAxis?.d2p !== "function") return null;
    return {
      x: chartRect.left + Number(xAxis._offset || 0) + xAxis.d2p(trace.x[0]),
      y: chartRect.top + Number(yAxis._offset || 0) + yAxis.d2p(trace.y[0]),
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
        element.classList.contains("is-event-marker-hovering")
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

  const disclosurePointIsVisible = async () => {
    const chartRect = await page.locator("#chart").boundingBox();
    return Boolean(
      chartRect
      && disclosurePoint
      && disclosurePoint.x >= chartRect.x
      && disclosurePoint.x <= chartRect.x + chartRect.width
      && disclosurePoint.y >= chartRect.y
      && disclosurePoint.y <= chartRect.y + chartRect.height
    );
  };
  if (!(await disclosurePointIsVisible())) {
    if (await chartResetButton.getAttribute("aria-pressed") !== "true") {
      await chartResetButton.click();
      await expect(chartResetButton).toHaveAttribute("aria-pressed", "true");
    }
    await page.locator("#chartRange1Year").click();
    await expect.poll(async () => {
      disclosurePoint = await getDisclosurePoint();
      return disclosurePointIsVisible();
    }).toBe(true);
  }

  // A newer async marker render can replace the shared disclosure lookup
  // before Plotly swaps the visible trace. The visible marker must still own
  // enough data to open its popup without the mutable lookup map.
  await page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.isDisclosureTrace);
    if (trace?.customdata?.[0]) trace.customdata[0][0] = "d|stale-rendered-marker";
  });

  if (isMobile) {
    await page.touchscreen.tap(disclosurePoint.x, disclosurePoint.y);
  } else {
    await page.mouse.click(disclosurePoint.x, disclosurePoint.y);
  }
  await expect(popover).toBeVisible();
  await expect.poll(() => popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(topmost && (topmost === element || element.contains(topmost)));
  })).toBe(true);
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
    const contract = window.ThinkStockE2E.getRuntimeStorageContract();
    const request = indexedDB.open(contract.dbName, contract.dbVersion);
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
    const contract = window.ThinkStockE2E.getRuntimeStorageContract();
    const request = indexedDB.open(contract.dbName, contract.dbVersion);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("tickerPrices", "readwrite");
      const store = tx.objectStore("tickerPrices");
      const now = Date.now();
      for (let index = 1; index <= 5; index += 1) {
        const ticker = `${String(index).padStart(6, "0")}.KS`;
        store.put({
          schema: 6,
          ticker,
          savedAt: now - index,
          lastAccessed: now - index,
          points: [{ date: "2026-08-21", close: 1000 + index }],
        }, ticker);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  const cleanupBefore = await page.evaluate(() => window.ThinkStockE2E.getCacheCleanupStats());
  await page.evaluate(() => window.ThinkStockE2E.pruneGranularCacheForTest("tickerPrices", 2));
  const remainingTickerCacheKeys = await page.evaluate(() => new Promise((resolve, reject) => {
    const contract = window.ThinkStockE2E.getRuntimeStorageContract();
    const request = indexedDB.open(contract.dbName, contract.dbVersion);
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
    let perfSummary = null;
    let budgetResult = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.evaluate(() => window.ThinkStockE2E?.getPerformanceApi?.()?.clear?.());
      await page.waitForTimeout(100);
      for (let index = 0; index < 32; index += 1) {
        const ratio = index % 2 === 0 ? index / 31 : (31 - index) / 31;
        await page.mouse.move(
          chartBox.x + 50 + ratio * Math.max(1, chartBox.width - 100),
          chartBox.y + chartBox.height * (0.35 + (index % 3) * 0.12),
        );
      }
      await page.waitForTimeout(400);
      perfSummary = await page.evaluate(() => window.ThinkStockE2E.getPerformanceApi().summary());
      budgetResult = evaluatePerformanceBudget(perfSummary, DESKTOP_PERF_BUDGET);
      if (budgetResult.ok) break;
    }
    expect(perfSummary.pointerMoves).toBeGreaterThanOrEqual(DESKTOP_PERF_BUDGET.minPointerMoves);
    expect(perfSummary.frames).toBeGreaterThanOrEqual(DESKTOP_PERF_BUDGET.minFrames);
    expect(budgetResult.violations).toEqual([]);
  }
  });

  await test.step("load historical segments without forcing a full Plotly render", async () => {
  const revisionsBeforeHistory = snapshotStatsAfter.revisions;
  const workerStatsBeforeHistory = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());
  await setChartRangeMonths(page, 360);
  await expect.poll(getHistoryRequests).toBe(4);
  expect(await page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(360);
  await expect.poll(() => page.locator("#chart").evaluate((element) => element.data?.[0]?.x?.[0]))
    .toBe("1998-07-14");
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const firstVisibleDates = (element.data || []).flatMap((trace) => {
      if (!trace?.meta?.seriesKey || !String(trace.mode || "").includes("lines")) return [];
      const firstIndex = (trace.y || []).findIndex((value) => Number.isFinite(Number(value)));
      return firstIndex >= 0 ? [String(trace.x?.[firstIndex] || "").slice(0, 10)] : [];
    }).filter(Boolean).sort();
    return {
      earliest: firstVisibleDates[0] || "",
      tick: String(element._fullLayout?.xaxis?.tickvals?.[0] || "").slice(0, 10),
    };
  })).toEqual({ earliest: "1998-07-12", tick: "1998-07-12" });
  const revisionsAfterHistory = await page.evaluate(() => window.ThinkStockE2E.getRuntimeSnapshotStats().revisions);
  expect(revisionsAfterHistory.price).toBeGreaterThan(revisionsBeforeHistory.price);
  expect(revisionsAfterHistory.macro).toBeGreaterThan(revisionsBeforeHistory.macro);
  expect(revisionsAfterHistory.credit).toBeGreaterThan(revisionsBeforeHistory.credit);
  const workerStatsAfterHistory = await page.evaluate(() => window.ThinkStockE2E.getChartWorkerStats());
  expect(workerStatsAfterHistory.sourceTransfers).toBeGreaterThan(workerStatsBeforeHistory.sourceTransfers);
  expect(workerStatsAfterHistory.partialChartUpdates)
    .toBeGreaterThan(workerStatsBeforeHistory.partialChartUpdates);
  expect(workerStatsAfterHistory.fullChartRenders).toBe(workerStatsBeforeHistory.fullChartRenders);
  const renderPerf = await page.evaluate(() => window.ThinkStockE2E.getPerformanceApi().summary());
  expect(renderPerf.renderCharts).toBeGreaterThan(0);
  expect(renderPerf.p95RenderChart).toBeLessThan(DESKTOP_PERF_BUDGET.maxP95RenderChart);
  expect(renderPerf.p95AuxiliaryRender).toBeLessThan(DESKTOP_PERF_BUDGET.maxP95AuxiliaryRender);
  const efficiencyResult = evaluateChartRuntimeEfficiency(workerStatsAfterHistory.renderTelemetry);
  expect(efficiencyResult.violations).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getCacheCleanupStats().runs))
    .toBeGreaterThan(0);
  });
});
