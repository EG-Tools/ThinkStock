import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/modules/release-notes.js");

const { RELEASES, createReleaseNotesNavigator } = globalThis.ThinkStockReleaseNotes;

test("release notes keep major versions newest-first", () => {
  assert.equal(RELEASES[0].version, "2.78");
  assert.ok(RELEASES[0].items.some((item) => item.includes("캐시")));
  assert.ok(RELEASES.length > 1);
});

test("right navigation moves to older releases and left returns newer", () => {
  const navigator = createReleaseNotesNavigator();
  assert.equal(navigator.current().release.version, "2.78");
  assert.equal(navigator.current().hasNewer, false);

  const older = navigator.older();
  assert.equal(older.release.version, "2.77");
  assert.equal(older.hasNewer, true);

  assert.equal(navigator.newer().release.version, "2.78");
});
