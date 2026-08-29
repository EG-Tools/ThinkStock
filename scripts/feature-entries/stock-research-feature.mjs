import controller from "../../docs/modules/stock-research-controller.js";
import historyCache from "../../docs/modules/stock-research-history-cache.js";
import research from "../../docs/modules/stock-research.js";
import { createStockResearchApp } from "../../docs/modules/stock-research-app.mjs";
import * as marketCalendar from "../../shared/market-calendar.mjs";
import { createScheduledSettlementRuntime } from "../../docs/modules/scheduled-settlement-runtime.mjs";

historyCache.configureMarketCalendar(marketCalendar);

const stockResearchFeature = Object.freeze({
  controller,
  createApp: createStockResearchApp,
  createScheduledSettlementRuntime,
  research,
});
if (Object.values(stockResearchFeature).some((module) => !module)) {
  throw new Error("stock research feature bundle is incomplete");
}

export { stockResearchFeature };
export default stockResearchFeature;
