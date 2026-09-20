import path from "node:path";

function portablePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sourcePath(root, value) {
  const absolute = path.isAbsolute(value) ? value : path.resolve(root, value);
  return portablePath(path.relative(root, absolute));
}

function normalizedSourceByteLength(value) {
  return Buffer.byteLength(String(value || "").replace(/\r\n?/g, "\n"), "utf8");
}

function summarizeBundle(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const metafile = options.metafile && typeof options.metafile === "object"
    ? options.metafile
    : {};
  const requestedOutput = options.metafileOutput
    ? path.resolve(root, String(options.metafileOutput))
    : "";
  const outputEntries = Object.entries(metafile.outputs || {});
  const output = (requestedOutput
    ? outputEntries.find(([file]) => path.resolve(root, file) === requestedOutput)?.[1]
    : null)
    || outputEntries.find(([, candidate]) => (
      candidate && typeof candidate === "object" && candidate.inputs
    ))?.[1]
    || {};
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
    imports: Object.freeze((Array.isArray(options.imports) ? options.imports : [])
      .map(portablePath).filter(Boolean)),
    contributors: Object.freeze(contributors),
  });
}

function summarizeLoadGroups(bundles, definitions = []) {
  const byFile = new Map(bundles.map((bundle) => [portablePath(bundle.file), bundle]));
  return definitions.map((definition) => {
    const files = new Set();
    function include(file) {
      const normalized = portablePath(file);
      if (files.has(normalized)) return;
      const bundle = byFile.get(normalized);
      if (!bundle) throw new Error(`Unknown load-group asset: ${normalized}`);
      files.add(normalized);
      bundle.imports?.forEach(include);
    }
    definition.entries.forEach(include);
    const assets = [...files].sort();
    return Object.freeze({
      name: String(definition.name),
      requests: assets.length,
      bytes: assets.reduce((total, file) => total + byFile.get(file).bytes, 0),
      gzipBytes: assets.reduce((total, file) => total + byFile.get(file).gzipBytes, 0),
      assets: Object.freeze(assets),
    });
  });
}

function assertLoadGroupLimits(groups, limits = {}) {
  groups.forEach((group) => {
    const limit = limits[group.name];
    if (!limit) throw new Error(`Missing load-group limit: ${group.name}`);
    if (group.gzipBytes > limit.maxGzipBytes) {
      throw new Error(`${group.name} load group exceeds ${limit.maxGzipBytes} gzip bytes: ${group.gzipBytes}`);
    }
    if (group.requests > limit.maxRequests) {
      throw new Error(`${group.name} load group exceeds ${limit.maxRequests} requests: ${group.requests}`);
    }
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
  const loadGroups = summarizeLoadGroups(bundles, options.loadGroups || []);
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
    loadGroups: Object.freeze(loadGroups),
  });
}

export {
  assertLoadGroupLimits,
  createBundleReport,
  normalizedSourceByteLength,
  summarizeBundle,
  summarizeLoadGroups,
};
