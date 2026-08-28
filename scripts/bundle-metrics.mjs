import path from "node:path";

function portablePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sourcePath(root, value) {
  const absolute = path.isAbsolute(value) ? value : path.resolve(root, value);
  return portablePath(path.relative(root, absolute));
}

function summarizeBundle(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const metafile = options.metafile && typeof options.metafile === "object"
    ? options.metafile
    : {};
  const output = Object.values(metafile.outputs || {}).find((candidate) => (
    candidate && typeof candidate === "object" && candidate.inputs
  )) || {};
  const contributors = Object.entries(output.inputs || {}).map(([input, value]) => ({
    input: sourcePath(root, input),
    bytes: Math.max(0, Number(value?.bytesInOutput) || 0),
  })).filter((entry) => entry.input && entry.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes || left.input.localeCompare(right.input));
  return Object.freeze({
    name: String(options.name || "bundle"),
    file: sourcePath(root, String(options.file || "")),
    bytes: Math.max(0, Number(options.bytes) || 0),
    gzipBytes: Math.max(0, Number(options.gzipBytes) || 0),
    contributors: Object.freeze(contributors),
  });
}

function createBundleReport(options = {}) {
  const bundles = (Array.isArray(options.bundles) ? options.bundles : [])
    .filter(Boolean)
    .map((bundle) => ({ ...bundle, contributors: [...(bundle.contributors || [])] }));
  const usage = new Map();
  bundles.forEach((bundle) => {
    bundle.contributors.forEach((entry) => {
      const current = usage.get(entry.input) || { input: entry.input, bytes: 0, bundles: [] };
      current.bytes += Math.max(0, Number(entry.bytes) || 0);
      current.bundles.push(bundle.name);
      usage.set(entry.input, current);
    });
  });
  const sharedInputs = [...usage.values()]
    .filter((entry) => new Set(entry.bundles).size > 1)
    .map((entry) => ({
      ...entry,
      bundles: [...new Set(entry.bundles)].sort(),
    }))
    .sort((left, right) => right.bytes - left.bytes || left.input.localeCompare(right.input));
  return Object.freeze({
    schema: 1,
    generatedAt: String(options.generatedAt || new Date().toISOString()),
    appVersion: String(options.appVersion || ""),
    totals: Object.freeze({
      bytes: bundles.reduce((sum, bundle) => sum + bundle.bytes, 0),
      gzipBytes: bundles.reduce((sum, bundle) => sum + bundle.gzipBytes, 0),
    }),
    bundles: Object.freeze(bundles.map((bundle) => Object.freeze({
      ...bundle,
      contributors: Object.freeze(bundle.contributors.slice(0, 30)),
    }))),
    sharedInputs: Object.freeze(sharedInputs.slice(0, 40).map(Object.freeze)),
  });
}

export { createBundleReport, summarizeBundle };
