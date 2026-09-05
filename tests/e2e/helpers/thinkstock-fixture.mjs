import { expect, test as base } from "@playwright/test";
import { DESKTOP_PERFORMANCE_BUDGET as DESKTOP_PERF_BUDGET } from "../../../shared/performance-budget.mjs";

const ADMIN_SESSION_STORAGE_KEY = "thinkstock-admin-session-v1";
const ADMIN_DEVICE_STORAGE_KEY = "thinkstock-device-id-v1";
const E2E_ADMIN_DEVICE_ID = "e2e-device-12345678";
const E2E_ADMIN_SESSION_TOKEN = "v1.ZTJlLWFkbWluLXNlc3Npb24.signature";
const E2E_ADMIN_CODE = "1234567890";
const recentDates = ["2025-07-14", "2025-10-14", "2026-01-14", "2026-04-14", "2026-07-14"];
const historyDates = ["1998-07-14", "2005-07-14", "2012-07-14"];
const timingVolumeDates = (() => {
  const dates = [];
  const cursor = new Date(Date.UTC(2025, 4, 1));
  const end = Date.parse(`${recentDates.at(-1)}T00:00:00Z`);
  while (cursor.getTime() <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
})();

function timingVolumeRows(ticker) {
  const key = String(ticker || "").trim().toUpperCase();
  const baseClose = {
    "^KS11": 6856.83,
    "^KQ11": 783.98,
    "005930.KS": 263000,
    "218410.KQ": 44750,
    "033100.KQ": 42100,
  }[key] || 30000;
  return timingVolumeDates.map((date, index) => ({
    date,
    close: baseClose * (1 + (Math.sin(index / 3) * 0.035) + (index * 0.0015)),
    volume: 1_000_000 + (index * 12_500),
  }));
}
const test = base.extend({
  adminAccessState: [async ({ page }, use, testInfo) => {
    const shouldStartLocked = testInfo.title === "general mode locks private analysis features"
      || testInfo.title === "administrator code unlocks private analysis features";
    await page.route("https://thinkstock-api.keg0320.workers.dev/**", async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname === "/api/admin/session") {
        const payload = request.postDataJSON?.() || {};
        const accepted = payload.action === "refresh"
          ? payload.sessionToken === E2E_ADMIN_SESSION_TOKEN
          : payload.action === "login" && payload.code === E2E_ADMIN_CODE;
        await route.fulfill({
          status: accepted ? 200 : 401,
          headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
          body: JSON.stringify(accepted ? {
            ok: true,
            sessionToken: E2E_ADMIN_SESSION_TOKEN,
            expiresAt: Date.now() + 86400_000,
            renewed: payload.action === "refresh",
          } : { ok: false, error: "접속코드가 틀렸습니다." }),
        });
        return;
      }
      await route.fulfill({
        status: 503,
        headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "E2E route not explicitly mocked" }),
      });
    });
    await page.addInitScript(({ sessionKey, deviceKey, deviceId, sessionToken, locked }) => {
      localStorage.setItem(deviceKey, deviceId);
      if (locked) localStorage.removeItem(sessionKey);
      else localStorage.setItem(sessionKey, JSON.stringify({
        deviceId,
        sessionToken,
        expiresAt: Date.now() + 86400_000,
      }));
    }, {
      sessionKey: ADMIN_SESSION_STORAGE_KEY,
      deviceKey: ADMIN_DEVICE_STORAGE_KEY,
      deviceId: E2E_ADMIN_DEVICE_ID,
      sessionToken: E2E_ADMIN_SESSION_TOKEN,
      locked: shouldStartLocked,
    });
    await use();
  }, { auto: true }],
});

async function setChartRangeMonths(page, targetMonths) {
  await page.evaluate((months) => window.ThinkStockE2E.setActiveMonthsForTest(months), targetMonths);
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getActiveMonths()))
    .toBe(targetMonths);
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

async function waitForChartRenderIdle(page) {
  let previousCompleted = -1;
  await expect.poll(async () => {
    const runtime = await page.evaluate(() => window.ThinkStockE2E?.getChartWorkerStats?.() || null);
    const scheduler = runtime?.scheduler;
    const progressiveComposition = runtime?.progressiveComposition;
    const visualFrames = runtime?.visualFrames;
    const completed = Number(scheduler?.completedTransactionId) || 0;
    const stable = completed === previousCompleted
      && completed === (Number(scheduler?.lastTransactionId) || 0)
      && !scheduler?.framePending
      && !scheduler?.inFlight
      && !scheduler?.deferred
      && !scheduler?.renderAfterFlight
      && !(scheduler?.pendingReasons || []).length
      && !runtime?.activeType
      && !(runtime?.queuedTypes || []).length
      && !progressiveComposition?.inFlight
      && !(Number(progressiveComposition?.pending) || 0)
      && !visualFrames?.framePending
      && !visualFrames?.inFlight
      && !(Number(visualFrames?.pendingSeries) || 0)
      && !visualFrames?.pendingMarkers
      && !visualFrames?.pendingHandles;
    previousCompleted = completed;
    return stable;
  }, { intervals: [80, 100, 140, 180] }).toBe(true);
}

async function waitForAppReady(page) {
  await expect.poll(() => page.evaluate(() => {
    const title = document.querySelector(".hero h1");
    const aiToggle = document.getElementById("aiForecastToggle");
    return Number(title?.getAttribute("aria-valuenow")) >= 100
      && !title?.classList.contains("is-loading")
      && aiToggle?.dataset?.bound === "1";
  }), {
    message: "Think Stock did not reach its user-visible 100% ready state",
    timeout: 30000,
  }).toBe(true);
}

async function visibleTracePixelSpan(page, seriesKey) {
  return page.locator("#chart").evaluate((element, targetSeries) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === targetSeries);
    const xAxis = element._fullLayout?.xaxis;
    const yAxis = element._fullLayout?.yaxis;
    if (!trace || !xAxis || !yAxis || typeof yAxis.d2p !== "function") return 0;
    const range = (xAxis.range || []).map(Date.parse);
    const pixels = (trace.x || []).flatMap((date, index) => {
      const time = Date.parse(date);
      const value = Number(trace.y?.[index]);
      return time >= range[0] && time <= range[1] && Number.isFinite(value)
        ? [yAxis.d2p(value)]
        : [];
    });
    return pixels.length ? Math.max(...pixels) - Math.min(...pixels) : 0;
  }, seriesKey);
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
      t10y1y: "장단기금리차",
      us_credit_spread: "신용스프레드",
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
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/auth/check**", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/indices**", async (route) => {
    await route.fulfill({ json: {
      ok: true,
      records: ["^KS11", "^KQ11"].flatMap((ticker) => (
        timingVolumeRows(ticker).map((row) => ({ ticker, ...row }))
      )),
    } });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/bootstrap**", async (route) => {
    const tickers = [...new Set(String(new URL(route.request().url()).searchParams.get("tickers") || "")
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean))];
    await route.fulfill({ json: {
      ok: true,
      partial: false,
      indices: {
        ok: true,
        records: [
          { ticker: "^KS11", date: recentDates.at(-1), close: 3200 },
          { ticker: "^KQ11", date: recentDates.at(-1), close: 860 },
        ],
      },
      prices: {
        ok: true,
        requested: tickers.length,
        succeeded: tickers.length,
        results: tickers.map((ticker) => ({
          ok: true,
          ticker,
          source: "KRX",
          latestDate: recentDates.at(-1),
          records: [{ date: recentDates.at(-1), close: 100, volume: 1_000_000 }],
        })),
      },
    } });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/research/history**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const ticker = String(requestUrl.searchParams.get("ticker") || "").trim().toUpperCase();
    const since = String(requestUrl.searchParams.get("since") || "").slice(0, 10);
    const rows = timingVolumeRows(ticker).filter((row) => !since || row.date >= since);
    await route.fulfill({ json: { ok: true, ticker, rows } });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/prices/batch**", async (route) => {
    const tickers = [...new Set(String(new URL(route.request().url()).searchParams.get("tickers") || "")
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean))];
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
  await page.route("https://query2.finance.yahoo.com/**", unavailable);
  await page.route("https://corsproxy.io/**", unavailable);
  await page.route("**/api/adr**", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        cached: true,
        stale: false,
        latestDate: recentDates.at(-1),
        rows: recentDates.map((date, index) => ({
          date,
          adr_kospi: 95 + index,
          adr_kosdaq: 90 + index,
        })),
      },
    });
  });
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
    await page.route(/^https?:\/\/(?:www\.)?kospi\.feargreedchart\.com\//i, unavailable);
  }
}

async function installDataRoutes(page, options = {}) {
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
      "005930.KS": options.shortStockHistory ? [null, null, 28000] : [8000, 15000, 28000],
    },
  );
  const macroSeries = options.includeMacroSpreads
    ? ["leading_cycle", "t10y1y", "us_credit_spread", "news_sentiment"]
    : ["leading_cycle", "news_sentiment"];
  const macroRecent = columnar(macroSeries, recentDates, {
    leading_cycle: [99, 99.5, 100, 100.5, 101],
    ...(options.includeMacroSpreads ? {
      t10y1y: [0.18, 0.42, 0.31, 0.68, 0.53],
      us_credit_spread: [0.74, 0.92, 0.81, 1.16, 0.89],
    } : {}),
    news_sentiment: [92, 96, 101, 105, 108],
  });
  const macroHistory = columnar(macroSeries, historyDates, {
    leading_cycle: [96, 97, 98],
    ...(options.includeMacroSpreads ? {
      t10y1y: [0.35, -0.18, 0.12],
      us_credit_spread: [1.42, 1.08, 0.96],
    } : {}),
    news_sentiment: [null, 88, 94],
  });
  const creditDates = options.staleCreditTail ? recentDates.slice(0, -1) : recentDates;
  const creditRecent = columnar(
    ["customer_deposit", "kospi_credit", "kosdaq_credit"],
    creditDates,
    {
      customer_deposit: [80, 85, 90, 95, 100].slice(0, creditDates.length),
      kospi_credit: [20, 21, 22, 23, 24].slice(0, creditDates.length),
      kosdaq_credit: [6, 6.2, 6.4, 6.6, 6.8].slice(0, creditDates.length),
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
  const vkospiData = {
    format: "records-v1",
    generated_at: "2026-07-15T00:00:00Z",
    source: "KRX 파생상품지수 시세정보",
    records: recentDates.map((date, index) => ({
      date,
      vkospi: [21.8, 19.4, 24.6, 18.7, 22.3][index],
    })),
  };
  const payloads = new Map([
    ["data_manifest.json", {
      format: "segmented-data-v1",
      revision: "e2e-fixture",
      datasets: {
        prices: {
          recent: { file: "prices_recent.json" },
          history: { file: "prices_history.json" },
        },
        macro_data: {
          recent: { file: "macro_data_recent.json" },
          history: { file: "macro_data_history.json" },
        },
        credit_data: {
          recent: { file: "credit_data_recent.json" },
          history: { file: "credit_data_history.json" },
        },
        adr_data: {
          recent: { file: "adr_data_recent.json" },
          history: { file: "adr_data_history.json" },
        },
      },
    }],
    ["prices_recent.json", pricesRecent],
    ["prices_history.json", pricesHistory],
    ["macro_data_recent.json", macroRecent],
    ["macro_data_history.json", macroHistory],
    ["credit_data_recent.json", creditRecent],
    ["credit_data_history.json", creditHistory],
    ["adr_data_recent.json", adrRecent],
    ["adr_data_history.json", adrHistory],
    ["vkospi_data.json", vkospiData],
  ]);
  Object.entries(options.payloadOverrides || {}).forEach(([name, payload]) => {
    payloads.set(name, payload);
  });

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
        files: {
          "00": "data/dart_corp_codes/00.json",
          "21": "data/dart_corp_codes/21.json",
        },
        counts: { "00": 2, "21": 1 },
      } });
      return;
    }
    if (name === "krx_universe.json") {
      const records = Array.isArray(options.krxUniverseRecords)
        ? options.krxUniverseRecords
        : [
          { ticker: "000660.KS", code: "000660", name: "SK하이닉스", market: "KOSPI" },
          { ticker: "005930.KS", code: "005930", name: "삼성전자", market: "KOSPI" },
        ];
      await route.fulfill({ json: {
        format: "krx-universe-v1",
        total: records.length,
        records,
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
        "218410": "01078178",
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

export {
  expect,
  test,
  recentDates,
  historyDates,
  DESKTOP_PERF_BUDGET,
  setChartRangeMonths,
  waitForBoundingBox,
  waitForAppReady,
  waitForChartRenderIdle,
  visibleTracePixelSpan,
  columnar,
  stubExternalRefreshes,
  installDataRoutes,
};
