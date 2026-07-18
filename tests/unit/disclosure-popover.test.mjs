import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const source = await readFile(path.resolve("docs/modules/disclosure-popover.js"), "utf8");
const context = {};
vm.runInNewContext(source, context);
const popover = context.ThinkStockDisclosurePopover;


test("builds linked disclosure titles without summary labels", () => {
  const html = popover.buildPopoverHtml({
    name: "Life User",
    plotDate: "2026-07-18",
    events: [{ title: "Contract", url: "https://example.com" }],
  });

  assert.match(html, /disclosure-title-link/);
  assert.match(html, /Contract/);
  assert.doesNotMatch(html, /event-type|summary/);
});
