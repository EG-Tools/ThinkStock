import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import("../../docs/modules/release-notes.js");

const { RELEASES, createReleaseNotesNavigator } = globalThis.ThinkStockReleaseNotes;
const appSource = await readFile(new URL("../../docs/app.js", import.meta.url), "utf8");
const appVersion = appSource.match(/const APP_VERSION = "([^"]+)";/)?.[1];

test("release notes keep major versions newest-first", () => {
  assert.equal(RELEASES[0].version, appVersion);
  assert.match(RELEASES[0].date, /^\d{4}\.\d{2}\.\d{2}$/);
  assert.ok(RELEASES[0].items.some((item) => item.includes("AI")));
  assert.ok(RELEASES.length > 1);
});

test("right navigation moves to older releases and left returns newer", () => {
  const navigator = createReleaseNotesNavigator();
  assert.equal(navigator.current().release.version, appVersion);
  assert.equal(navigator.current().hasNewer, false);

  const older = navigator.older();
  assert.equal(older.release.version, RELEASES[1].version);
  assert.equal(older.hasNewer, true);

  assert.equal(navigator.newer().release.version, appVersion);
});
