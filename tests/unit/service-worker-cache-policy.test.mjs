import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("content-hashed runtime chunks use cache-first without a query version", async () => {
  const source = await readFile(new URL("../../docs/sw.js", import.meta.url), "utf8");
  assert.match(source, /isContentHashedChunk\s*=\s*\/\\\/assets\\\/chunks/);
  assert.match(source, /\|\| isContentHashedChunk/);
  assert.match(source, /if \(isVersionedAssetUrl\(url\)\) \{\s*event\.respondWith\(cacheFirst/);
});
