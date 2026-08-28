import controller from "../../docs/modules/stock-research-controller.js";
import historyCache from "../../docs/modules/stock-research-history-cache.js";
import research from "../../docs/modules/stock-research.js";
import * as marketCalendar from "../../shared/market-calendar.mjs";

historyCache.configureMarketCalendar(marketCalendar);

const stockResearchFeature = Object.freeze({
  controller,
  research,
});
if (Object.values(stockResearchFeature).some((module) => !module)) {
  throw new Error("stock research feature bundle is incomplete");
}

export { stockResearchFeature };
export default stockResearchFeature;
