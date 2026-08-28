import fs from "node:fs";
import macdOscillator from "../docs/modules/macd-oscillator.mjs";
import marketTiming from "../docs/modules/market-timing.mjs";

function columnarRows(filename) {
  const payload = JSON.parse(fs.readFileSync(new URL(`../docs/data/${filename}`, import.meta.url), "utf8"));
  return payload.dates.map((date, index) => Object.fromEntries([
    ["date", date],
    ...Object.entries(payload.columns).map(([key, values]) => [key, values[index]]),
  ]));
}

const pricePayload = JSON.parse(
  fs.readFileSync(new URL("../docs/data/prices.json", import.meta.url), "utf8"),
);

for (const indexKey of ["^KS11", "^KQ11"]) {
  const macd = macdOscillator.buildMacdOscillator({
    dates: pricePayload.dates,
    prices: pricePayload.columns[indexKey],
  });
  const model = marketTiming.buildMarketTimingSignals({
    indexKey,
    dates: macd.dates,
    prices: macd.prices,
    oscillator: macd.normalized,
    adrRows: columnarRows("adr_data.json"),
    macroRows: columnarRows("macro_data.json"),
    creditRows: columnarRows("credit_data.json"),
  });

  console.log(`${indexKey}: buy=${model.signals.length}, sell=${model.sellSignals.length}`);
  model.sellSignals.forEach((signal) => {
    console.log([
      signal.date,
      signal.confirmationDate,
      `20d=${signal.price20d?.toFixed(1)}`,
      `60d=${signal.price60d?.toFixed(1)}`,
      `credit=${signal.creditChange?.toFixed(1)}`,
      `rank=${signal.creditPercentile?.toFixed(2)}`,
      `adr=${signal.adr?.toFixed(1)}`,
    ].join(" | "));
  });

  const prices = macd.prices;
  const dates = macd.dates;
  const returns = prices.map((price, index) => (
    index > 0 ? Math.log(price / prices[index - 1]) : 0
  ));
  const creditKey = indexKey === "^KQ11" ? "kosdaq_credit" : "kospi_credit";
  const adrKey = indexKey === "^KQ11" ? "adr_kosdaq" : "adr_kospi";
  const creditByDate = new Map(columnarRows("credit_data.json").map((row) => [row.date, row[creditKey]]));
  const adrByDate = new Map(columnarRows("adr_data.json").map((row) => [row.date, row[adrKey]]));
  let lastCandidate = -100;
  console.log(`${indexKey}: post-2020 reversal peaks`);
  for (let index = 252; index < prices.length - 20; index += 1) {
    if (dates[index] < "2020-01-01") continue;
    const trailingHigh = Math.max(...prices.slice(index - 119, index + 1));
    const futureLow = Math.min(...prices.slice(index + 1, index + 21));
    const futureDrawdown = ((futureLow / prices[index]) - 1) * 100;
    if (prices[index] < trailingHigh * 0.998 || futureDrawdown > -8 || index - lastCandidate < 25) continue;
    const volatility = Math.max(0.002, Math.sqrt(
      returns.slice(index - 62, index + 1).reduce((sum, value) => sum + (value ** 2), 0) / 63,
    ));
    const return20 = Math.log(prices[index] / prices[index - 20]);
    const return63 = Math.log(prices[index] / prices[index - 63]);
    let creditNow = null;
    let credit20 = null;
    let adrNow = null;
    for (let cursor = index; cursor >= Math.max(0, index - 10); cursor -= 1) {
      creditNow ??= Number(creditByDate.get(dates[cursor])) || null;
      adrNow ??= Number(adrByDate.get(dates[cursor])) || null;
    }
    for (let cursor = index - 20; cursor >= Math.max(0, index - 30); cursor -= 1) {
      credit20 ??= Number(creditByDate.get(dates[cursor])) || null;
    }
    const creditGrowth = creditNow && credit20 ? ((creditNow / credit20) - 1) * 100 : null;
    console.log([
      dates[index],
      `future20=${futureDrawdown.toFixed(1)}`,
      `r20=${(return20 * 100).toFixed(1)}`,
      `z20=${(return20 / (volatility * Math.sqrt(20))).toFixed(2)}`,
      `r63=${(return63 * 100).toFixed(1)}`,
      `z63=${(return63 / (volatility * Math.sqrt(63))).toFixed(2)}`,
      `credit=${creditGrowth?.toFixed(1)}`,
      `adr=${adrNow?.toFixed(1)}`,
      `osc=${macd.normalized[index]?.toFixed(2)}`,
    ].join(" | "));
    lastCandidate = index;
  }
}
