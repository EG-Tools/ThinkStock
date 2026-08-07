import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

await import("../../docs/modules/macd-oscillator.js");
await import("../../docs/modules/market-timing.js");
const { alignAsOf, buildMarketTimingSignals } = globalThis.ThinkStockMarketTiming;
const { buildMacdOscillator } = globalThis.ThinkStockMacdOscillator;

function dateAt(index) {
  return new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
}

function timingFixture({ oversold = true } = {}) {
  const dates = Array.from({ length: 130 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 65) return 100;
    if (index <= 78) return 100 - ((index - 64) * 2);
    return 72 + ((index - 78) * 1.2);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 75) return -0.6;
    if (index === 75) return -0.8;
    if (index === 76) return -0.7;
    if (index === 77) return -0.5;
    if (index === 78) return -0.25;
    return Math.min(0.5, -0.1 + ((index - 79) * 0.05));
  });
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: oversold && index >= 68 && index <= 82 ? 74 + Math.max(0, index - 76) * 2 : 100,
    fear_greed: oversold && index >= 68 && index <= 82 ? 19 + Math.max(0, index - 76) * 1.5 : 50,
  }));
  const macroRows = dates.map((_, index) => ({
    date: dateAt(index - 60),
    leading_cycle: 98 + (index * 0.02),
  }));
  return { dates, prices, oscillator, adrRows, macroRows };
}

test("as-of alignment never uses a future observation", () => {
  assert.deepEqual(
    alignAsOf([dateAt(0), dateAt(1), dateAt(2)], [{ date: dateAt(1), value: 42 }], 7),
    [null, 42, 42],
  );
});

test("emits one high-confidence buy signal after an oversold reversal", () => {
  const model = buildMarketTimingSignals({ indexKey: "^KS11", ...timingFixture() });

  assert.equal(model.strategy, "episode-extreme-v8");
  assert.equal(model.signals.length, 1);
  assert.ok(model.signals[0].setupReasons.length > 0);
  assert.ok(model.signals[0].stabilizationReasons.length > 0);
  assert.deepEqual(model.signals[0].triggerReasons, ["MACD 상승 다이버전스"]);
  assert.ok(model.signals[0].score >= 2);
  assert.ok(model.signals[0].confirmationDate >= model.signals[0].date);
});

test("does not emit a buy signal without prior oversold conditions", () => {
  const model = buildMarketTimingSignals({ indexKey: "^KS11", ...timingFixture({ oversold: false }) });
  assert.deepEqual(model.signals, []);
});

test("routes KOSDAQ stock timing through KOSDAQ breadth and thresholds", () => {
  const fixture = timingFixture();
  fixture.adrRows = fixture.adrRows.map((row) => ({
    ...row,
    adr_kosdaq: row.adr_kospi,
    adr_kospi: 100,
  }));

  const kosdaqStock = buildMarketTimingSignals({ indexKey: "218410.KQ", ...fixture });
  const kospiStock = buildMarketTimingSignals({ indexKey: "005930.KS", ...fixture });

  assert.equal(kosdaqStock.signals.length, 1);
  assert.ok(kosdaqStock.signals[0].setupReasons.includes("ADR 과매도"));
  assert.equal(kosdaqStock.signals[0].adrMin < 80, true);
  assert.equal(kospiStock.signals.length, 1);
  assert.equal(kospiStock.signals[0].adrMin, 100);
  assert.equal(kospiStock.signals[0].setupReasons.includes("ADR 과매도"), false);
});

test("rejects a buy signal when the index remains near its recent high", () => {
  const fixture = timingFixture();
  fixture.prices = fixture.prices.map((_, index) => 100 + (index * 0.08));
  const model = buildMarketTimingSignals({ indexKey: "^KS11", ...fixture });
  assert.deepEqual(model.signals, []);
});

test("turns exceptional credit growth near a market high into one sell signal", () => {
  const dates = Array.from({ length: 360 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index <= 309) return 100 + (index * 0.12);
    if (index <= 329) return 137.08 + ((index - 309) * 2);
    return 177.08 - ((index - 329) * 1.2);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 326) return 0.25;
    if (index <= 329) return 0.25 + ((index - 325) * 0.08);
    return 0.57 - ((index - 329) * 0.09);
  });
  const creditRows = dates.map((date, index) => ({
    date,
    kospi_credit: index < 285 ? 100 : 100 * Math.exp(0.0004 * ((index - 284) ** 2)),
  }));
  const adrRows = dates.map((date) => ({ date, adr_kospi: 125, fear_greed: 80 }));
  const macroRows = dates.map((_, index) => ({
    date: dateAt(index - 60),
    leading_cycle: 108 - (index * 0.02),
  }));
  const model = buildMarketTimingSignals({
    indexKey: "^KS11",
    dates,
    prices,
    oscillator,
    creditRows,
    adrRows,
    macroRows,
  });

  assert.equal(model.signals.length, 0);
  assert.equal(model.sellSignals.length, 1);
  assert.equal(model.sellSignals[0].date, dates[329]);
  assert.equal(model.sellSignals[0].confirmationDate, dates[330]);
  assert.ok(model.sellSignals[0].creditChange >= 8);
  assert.ok(model.sellSignals[0].sellSetupReasons.includes("신용 과열"));
  assert.ok(model.sellSignals[0].sellDeteriorationReasons.includes("고점 갱신 후 탄력 둔화"));
  assert.deepEqual(model.sellSignals[0].sellTriggerReasons, [
    "MACD 상승 탄력 반전",
    "신용 과열 속 고점 정체",
  ]);
});

test("applies one volatility-adjusted sell formula to KOSPI and KOSDAQ", () => {
  const dates = Array.from({ length: 360 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 300) return 100 + (index * 0.03);
    if (index <= 329) return 109 + ((index - 299) * 0.55);
    return 125.5 - ((index - 329) * 0.8);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 326) return 0.45;
    if (index <= 329) return 0.45 + ((index - 325) * 0.08);
    return 0.77 - ((index - 329) * 0.12);
  });
  const creditRows = dates.map((date, index) => {
    const credit = index < 290 ? 100 : 100 * Math.exp(0.00025 * ((index - 289) ** 2));
    return { date, kospi_credit: credit, kosdaq_credit: credit };
  });
  const adrRows = dates.map((date) => ({
    date,
    adr_kospi: 122,
    adr_kosdaq: 122,
    fear_greed: 78,
  }));
  const common = { dates, prices, oscillator, creditRows, adrRows };
  const kospi = buildMarketTimingSignals({ indexKey: "^KS11", ...common });
  const kosdaq = buildMarketTimingSignals({ indexKey: "^KQ11", ...common });

  assert.equal(kospi.sellSignals.length, 1);
  assert.equal(kosdaq.sellSignals.length, 1);
  assert.equal(kospi.sellSignals[0].date, kosdaq.sellSignals[0].date);
  assert.equal(kospi.sellSignals[0].confirmationDate, kosdaq.sellSignals[0].confirmationDate);
  assert.ok(kospi.sellSignals[0].price20d < 20);
  assert.ok(kosdaq.sellSignals[0].sellSetupReasons.includes("변동성 대비 급등"));
});

test("allows washed-out credit to arm a buy only after price and MACD recover", () => {
  const dates = Array.from({ length: 340 }, (_, index) => dateAt(index));
  const prices = dates.map((_, index) => {
    if (index < 275) return 100;
    if (index <= 290) return 100 - ((index - 274) * 2);
    return 68 + ((index - 290) * 0.6);
  });
  const oscillator = dates.map((_, index) => {
    if (index < 289) return -0.6;
    if (index === 289) return -0.9;
    return Math.min(0.4, -0.5 + ((index - 290) * 0.14));
  });
  const creditRows = dates.map((date, index) => ({
    date,
    kospi_credit: index < 270 ? 100 : Math.max(55, 100 - ((index - 269) * 1.8)),
  }));
  const macroRows = dates.map((date, index) => ({
    date,
    news_sentiment: 85 + (index * 0.02),
  }));
  const adrRows = dates.map((date, index) => ({
    date,
    adr_kospi: index >= 275 && index <= 305 ? 72 + Math.max(0, index - 292) * 2 : 100,
    fear_greed: 50,
  }));
  const model = buildMarketTimingSignals({
    indexKey: "^KS11",
    dates,
    prices,
    oscillator,
    creditRows,
    macroRows,
    adrRows,
  });

  assert.equal(model.signals.length, 1);
  assert.equal(model.signals[0].creditWashedOut, true);
  assert.ok(model.signals[0].setupReasons.includes("신용 투매"));
  assert.deepEqual(model.signals[0].triggerReasons, ["MACD 상승 다이버전스"]);
  assert.ok(model.signals[0].confirmationDate >= model.signals[0].date);
});

test("recovers major historical KOSPI turning points without future-dated markers", () => {
  const columnarRows = (filename) => {
    const payload = JSON.parse(fs.readFileSync(new URL(`../../docs/data/${filename}`, import.meta.url), "utf8"));
    return payload.dates.map((date, index) => Object.fromEntries([
      ["date", date],
      ...Object.entries(payload.columns).map(([key, values]) => [key, values[index]]),
    ]));
  };
  const pricePayload = JSON.parse(
    fs.readFileSync(new URL("../../docs/data/prices.json", import.meta.url), "utf8"),
  );
  const buildHistoricalModel = (indexKey) => {
    const macd = buildMacdOscillator({
      dates: pricePayload.dates,
      prices: pricePayload.columns[indexKey],
    });
    return buildMarketTimingSignals({
      indexKey,
      dates: macd.dates,
      prices: macd.prices,
      oscillator: macd.normalized,
      adrRows: columnarRows("adr_data.json"),
      macroRows: columnarRows("macro_data.json"),
      creditRows: columnarRows("credit_data.json"),
    });
  };
  const model = buildHistoricalModel("^KS11");
  const kosdaqModel = buildHistoricalModel("^KQ11");
  const rfhicModel = buildHistoricalModel("218410.KQ");
  const sells = new Set(model.sellSignals.map((signal) => signal.date));
  const tradingIndex = new Map(pricePayload.dates.map((date, index) => [date, index]));
  const nearestTradingDays = (targetDate, signalDates) => {
    const targetIndex = tradingIndex.get(targetDate);
    return Math.min(...signalDates.filter((date) => tradingIndex.has(date)).map((date) => (
      Math.abs(tradingIndex.get(date) - targetIndex)
    )));
  };

  ["2007-08-17", "2008-10-24", "2008-11-20", "2011-09-26", "2022-07-06"]
    .forEach((date) => assert.ok(
      nearestTradingDays(date, model.signals.map((signal) => signal.date)) <= 2,
      `missing buy near ${date}`,
    ));
  assert.ok(model.signals.length >= 18 && model.signals.length <= 30);
  const combinedBuyDates = [...model.signals, ...kosdaqModel.signals]
    .map((signal) => signal.date)
    .filter((date) => tradingIndex.has(date));
  ["2013-06-25", "2018-10-30", "2019-08-07", "2023-10-23", "2025-04-15"]
    .forEach((targetDate) => {
      assert.ok(nearestTradingDays(targetDate, combinedBuyDates) <= 4, `missing buy near ${targetDate}`);
    });
  [...model.signals, ...kosdaqModel.signals]
    .filter((signal) => signal.entryMode === "confirmation")
    .forEach((signal) => {
      assert.equal(signal.date, signal.confirmationDate);
      assert.ok(signal.setupDate <= signal.date);
    });
  ["2011-04-18", "2018-01-29", "2021-01-22", "2021-05-10"]
    .forEach((date) => assert.ok(sells.has(date), `missing sell ${date}`));
  ["2026-06-01", "2026-06-18"]
    .forEach((date) => assert.ok(
      nearestTradingDays(date, model.sellSignals.map((signal) => signal.date)) <= 1,
      `missing recent sell near ${date}`,
    ));
  const kosdaqSells = new Set(kosdaqModel.sellSignals.map((signal) => signal.date));
  ["2023-04-11", "2026-01-29"]
    .forEach((date) => assert.ok(kosdaqSells.has(date), `missing KOSDAQ sell ${date}`));
  assert.ok(
    nearestTradingDays("2026-04-27", kosdaqModel.sellSignals.map((signal) => signal.date)) <= 2,
    "missing KOSDAQ clustered-overheat sell near 2026-04-27",
  );
  ["2026-03-11", "2026-04-22", "2026-05-12"].forEach((date) => assert.ok(
    nearestTradingDays(date, rfhicModel.sellSignals.map((signal) => signal.date)) <= 1,
    `missing RFHIC sell near ${date}`,
  ));
  assert.ok(
    nearestTradingDays("2026-02-20", rfhicModel.sellSignals.map((signal) => signal.date)) > 3,
    "RFHIC intermediate high should remain inside the March peak episode",
  );
  [...model.signals, ...model.sellSignals, ...rfhicModel.sellSignals].forEach((signal) => {
    assert.ok(signal.confirmationDate >= signal.date);
  });
});
