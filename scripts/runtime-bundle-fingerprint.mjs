import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export function fingerprintRuntimeBundleEntries(entries, length = 12) {
  const hash = createHash("sha256");
  [...(entries || [])]
    .map((entry) => ({
      name: String(entry?.name || "").replaceAll("\\", "/"),
      content: entry?.content,
    }))
    .filter((entry) => entry.name && entry.content !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => {
      hash.update(entry.name);
      hash.update("\0");
      hash.update(entry.content);
      hash.update("\0");
    });
  return hash.digest("hex").slice(0, Math.max(1, Number(length) || 12));
}

export async function runtimeBundleFingerprint(assetDirectory, length = 12) {
  async function collect(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return collect(path.join(directory, entry.name), name);
      return entry.isFile() && entry.name.endsWith(".js") ? [name] : [];
    }));
    return nested.flat();
  }
  const names = (await collect(assetDirectory))
    .filter((name) => name.endsWith(".bundle.min.js") || name.startsWith("chunks/"))
    .sort((left, right) => left.localeCompare(right));
  if (!names.length) throw new Error("No runtime bundles were found");
  const entries = await Promise.all(names.map(async (name) => ({
    name,
    content: await readFile(path.join(assetDirectory, name)),
  })));
  return fingerprintRuntimeBundleEntries(entries, length);
}
