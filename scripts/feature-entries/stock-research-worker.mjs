import macd from "../../docs/modules/macd-oscillator.mjs";
import timing from "../../docs/modules/market-timing.mjs";
import timingService from "../../docs/modules/market-timing-service.mjs";
import research from "../../docs/modules/stock-research.js";
import {
  bindStockResearchWorker,
  createStockResearchWorkerRuntime,
} from "../../docs/modules/stock-research-worker-runtime.mjs";

const runtime = createStockResearchWorkerRuntime({ macd, timing, timingService, research });
bindStockResearchWorker(globalThis, runtime);
