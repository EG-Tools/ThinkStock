import assert from "node:assert/strict";
import test from "node:test";
import * as popover from "../../docs/modules/disclosure-popover.mjs";


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

test("renders an optional report date and broker above its linked title", () => {
  const html = popover.buildPopoverHtml({
    name: "RFHIC · 최신 리포트",
    events: [{
      caption: "26.08.22 현대차증권",
      title: "리포트 제목은 여기에...",
      url: "https://example.com/report",
    }],
  });

  assert.match(html, /disclosure-event-caption/);
  assert.match(html, /26\.08\.22 현대차증권/);
  assert.match(html, /리포트 제목은 여기에\.\.\./);
});


test("marks broker report links for the authenticated inline opener", () => {
  const html = popover.buildPopoverHtml({
    name: "RFHIC · 최신 리포트",
    events: [{
      linkAction: "broker-report",
      title: "최근 리포트",
      url: "https://example.com/report.pdf",
    }],
  });

  assert.match(html, /data-link-action="broker-report"/);
  assert.match(html, /data-event-index="0"/);
});
