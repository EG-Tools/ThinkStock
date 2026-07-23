import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

function rowsFromColumnar(payload) {
  const series = Array.isArray(payload?.series) ? payload.series : Object.keys(payload?.columns || {});
  return (payload?.dates || []).map((date, index) => {
    const row = { date };
    series.forEach((key) => { row[key] = payload.columns?.[key]?.[index] ?? null; });
    return row;
  });
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const source = await readFile(path.resolve("docs/modules/ai-forecast.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { buildForecast } = sandbox.ThinkStockAiForecast;

const [pricePayload, macroPayload, creditPayload, adrPayload] = await Promise.all([
  readJson("docs/data/prices_recent.json"),
  readJson("docs/data/macro_data_recent.json"),
  readJson("docs/data/credit_data_recent.json"),
  readJson("docs/data/adr_data_recent.json"),
]);
const priceRows = rowsFromColumnar(pricePayload);
const macroRows = rowsFromColumnar(macroPayload);
const creditRows = rowsFromColumnar(creditPayload);
const adrRows = rowsFromColumnar(adrPayload);
const stockSeries = (pricePayload.series || []).filter((series) => /(?:\.KS|\.KQ)$/i.test(series));
const horizons = [20, 63, 126];
const observations = [];

for (const series of stockSeries) {
  const validIndexes = priceRows
    .map((row, index) => Number(row[series]) > 0 ? index : -1)
    .filter((index) => index >= 0);
  const lastUsable = validIndexes.at(-1) - 126;
  const anchors = Array.from({ length: 8 }, (_, index) => lastUsable - ((7 - index) * 126))
    .filter((index) => index >= 755 && Number(priceRows[index]?.[series]) > 0);
  for (const anchor of anchors) {
    const history = priceRows.slice(0, anchor + 1).filter((row) => Number(row[series]) > 0);
    const cutoff = history.at(-1).date;
    const forecast = buildForecast({
      series,
      dates: history.map((row) => row.date),
      prices: history.map((row) => row[series]),
      marketCandidates: ["^KS11", "^KQ11"].map((marketSeries) => ({
        series: marketSeries,
        dates: history.map((row) => row.date),
        prices: history.map((row) => row[marketSeries]),
      })),
      macroRows: macroRows.filter((row) => row.date <= cutoff),
      creditRows: creditRows.filter((row) => row.date <= cutoff),
      auxiliaryRows: adrRows.filter((row) => row.date <= cutoff),
    });
    if (!forecast) continue;
    horizons.forEach((horizon) => {
      const actualPrice = Number(priceRows[anchor + horizon]?.[series]);
      const currentPrice = Number(priceRows[anchor]?.[series]);
      const predictedPrice = Number(forecast.prices[horizon]);
      if (!(actualPrice > 0 && currentPrice > 0 && predictedPrice > 0)) return;
      const actualReturn = Math.log(actualPrice / currentPrice);
      const predictedReturn = Math.log(predictedPrice / currentPrice);
      observations.push({
        series,
        cutoff,
        horizon,
        actualReturn,
        predictedReturn,
        absoluteError: Math.abs(actualReturn - predictedReturn),
        baselineError: Math.abs(actualReturn),
        directionCorrect: Math.sign(actualReturn) === Math.sign(predictedReturn),
        covered: actualPrice >= forecast.lowerPrices[horizon] && actualPrice <= forecast.upperPrices[horizon],
        modelKind: forecast.model.horizons.find((item) => item.days === horizon)?.kind || "unknown",
      });
    });
  }
}

function summarize(rows) {
  const mae = average(rows.map((row) => row.absoluteError));
  const baselineMae = average(rows.map((row) => row.baselineError));
  return {
    samples: rows.length,
    mae: Number(mae.toFixed(6)),
    baselineMae: Number(baselineMae.toFixed(6)),
    improvement: Number((baselineMae > 0 ? (baselineMae - mae) / baselineMae : 0).toFixed(4)),
    directionAccuracy: Number(average(rows.map((row) => row.directionCorrect ? 1 : 0)).toFixed(4)),
    intervalCoverage: Number(average(rows.map((row) => row.covered ? 1 : 0)).toFixed(4)),
    learnedModels: rows.filter((row) => row.modelKind !== "baseline").length,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  overall: summarize(observations),
  byHorizon: Object.fromEntries(horizons.map((horizon) => [
    horizon,
    summarize(observations.filter((row) => row.horizon === horizon)),
  ])),
  bySeries: Object.fromEntries(stockSeries.map((series) => [
    series,
    summarize(observations.filter((row) => row.series === series)),
  ])),
};

console.log(JSON.stringify(report, null, 2));
