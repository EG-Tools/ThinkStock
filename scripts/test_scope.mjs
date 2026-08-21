const LOCAL_ONLY_PATTERNS = [
  /^run_local_iphone13promax\.bat$/,
  /^scripts\/resize_preview_window\.ps1$/,
];

const GENERATED_ARTIFACT_PATTERNS = [
  /^docs\/assets\/(?:app|ai-feature|market-timing-feature|stock-research-feature|settings-feature)\.bundle\.min\.js$/,
];

const WEBKIT_PATTERNS = [
  /^docs\/(app\.js|index\.html|styles\.css)$/,
  /^docs\/assets\/app\.bundle\.min\.js$/,
  /^docs\/modules\/(ai-|app-ui|broker-|cache-migrations|chart-|data-seed|disclosure|insider|main-chart|market-timing|optional-feature|runtime-(?:bootstrap|data|series|source)|startup|stock-research)/,
  /^scripts\/pages-entry\.mjs$/,
  /^scripts\/feature-entries\//,
];

const SERVICE_WORKER_PATTERNS = [
  /^docs\/sw\.js$/,
  /^docs\/modules\/(cache-refresh-policy|service-worker-client)\.js$/,
];

const FULL_UNIT_PATTERNS = [
  /^package(?:-lock)?\.json$/,
  /^docs\/(?:app\.js|index\.html|styles\.css|sw\.js)$/,
  /^docs\/assets\//,
  /^scripts\/pages-entry\.mjs$/,
];

const SERVER_ONLY_PATTERNS = [
  /^worker\/src\//,
  /^scripts\/local_pages_server\.mjs$/,
  /^shared\/dart-disclosure\.mjs$/,
];

const EXPLICIT_UNIT_TESTS = Object.freeze([
  Object.freeze({ pattern: /^worker\/src\/index\.mjs$/, tests: ["tests/unit/dart-worker.test.mjs"] }),
  Object.freeze({ pattern: /^scripts\/local_pages_server\.mjs$/, tests: ["tests/unit/local-pages-server.test.mjs"] }),
  Object.freeze({
    pattern: /^scripts\/(?:run_ai_walkforward_validation|compare_ai_walkforward_reports)\.mjs$/,
    tests: [
      "tests/unit/ai-walkforward-comparison.test.mjs",
      "tests/unit/ai-point-in-time-audit.test.mjs",
    ],
  }),
  Object.freeze({ pattern: /^\.github\/workflows\/deploy-pages\.yml$/, tests: ["tests/unit/release-script.test.mjs"] }),
]);

function inferredUnitTest(file) {
  if (/^tests\/unit\/[^/]+\.test\.mjs$/.test(file)) return file;
  const match = file.match(/^(?:docs\/modules|shared|scripts)\/([^/]+?)\.(?:js|mjs|cjs)$/);
  return match ? `tests/unit/${match[1]}.test.mjs` : "";
}

function unitTestsForFile(file) {
  const explicit = EXPLICIT_UNIT_TESTS.find((entry) => entry.pattern.test(file));
  if (explicit) return explicit.tests;
  const inferred = inferredUnitTest(file);
  return inferred ? [inferred] : [];
}

export const WEBKIT_SMOKE_PATTERN = [
  "bundled recent data boots through the chart worker",
  "startup loader releases before supplemental refresh finishes",
  "AI toggle draws and removes a six-month virtual forecast",
  "stock research popup preserves results while adding multiple candidates",
  "chart, disclosure popover, and lazy history remain interactive",
  "service worker registers and precaches the app shell",
].join("|");

export function normalizeChangedFiles(files) {
  return [...new Set((Array.isArray(files) ? files : [])
    .map((file) => String(file || "").trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .filter((file) => !LOCAL_ONLY_PATTERNS.some((pattern) => pattern.test(file))))];
}

export function classifyChangedFiles(files) {
  const requested = normalizeChangedFiles(files);
  const hasSourceChange = requested.some((file) => (
    !GENERATED_ARTIFACT_PATTERNS.some((pattern) => pattern.test(file))
    && /^(?:docs|shared|scripts|worker)\//.test(file)
  ));
  const normalized = hasSourceChange
    ? requested.filter((file) => !GENERATED_ARTIFACT_PATTERNS.some((pattern) => pattern.test(file)))
    : requested;
  const unitTests = [...new Set(normalized.flatMap(unitTestsForFile))];
  const hasUnmappedSource = normalized.some((file) => (
    /^(?:docs|shared|scripts|worker)\//.test(file)
    && !unitTestsForFile(file).length
  ));
  const runFullUnit = normalized.some((file) => FULL_UNIT_PATTERNS.some((pattern) => pattern.test(file)))
    || hasUnmappedSource;
  const runWebkitSmoke = normalized.some((file) => WEBKIT_PATTERNS.some((pattern) => pattern.test(file)));
  const runServiceWorker = normalized.some((file) => SERVICE_WORKER_PATTERNS.some((pattern) => pattern.test(file)));
  const runWebBuild = normalized.some((file) => (
    /^(?:docs|shared)\//.test(file)
    && !SERVER_ONLY_PATTERNS.some((pattern) => pattern.test(file))
  )) || normalized.some((file) => (
    /^scripts\/(?:pages-entry|build_pages_bundle)\.mjs$/.test(file)
    || file.startsWith("scripts/feature-entries/")
  ));
  return Object.freeze({
    files: normalized,
    runUnit: normalized.length > 0,
    runFullUnit,
    unitTests,
    runWebkitSmoke,
    runServiceWorker,
    runWebBuild,
    validationProfile: runFullUnit ? "full" : (
      runWebkitSmoke || runServiceWorker || unitTests.length ? "focused" : "none"
    ),
  });
}
