import dataPayload from "./data-payload.mjs?v=dev";
import { attachDataWorker } from "./data-worker-runtime.mjs?v=dev";

attachDataWorker(globalThis, dataPayload);
