import * as apiPeriods from "../../docs/modules/api-periods.mjs";
import * as cacheManager from "../../docs/modules/app-cache-manager.mjs";
import * as releaseNotes from "../../docs/modules/release-notes.mjs";
import { createSettingsPanelRuntime } from "../../docs/modules/settings-panel-runtime.mjs";

const settingsFeature = Object.freeze({
  apiPeriods,
  cacheManager,
  releaseNotes,
  runtime: Object.freeze({ createSettingsPanelRuntime }),
});

export { settingsFeature };
export default settingsFeature;
