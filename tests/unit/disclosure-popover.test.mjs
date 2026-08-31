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

test("reuses the popover with a context-specific close label", () => {
  const html = popover.buildPopoverHtml({
    name: "추출 실패 종목",
    events: [{ title: "케이뱅크" }],
  }, { closeLabel: "실패 종목 닫기" });

  assert.match(html, /aria-label="실패 종목 닫기"/);
  assert.match(html, /케이뱅크/);
});

test("builds the minimal chart-hover summary with names only", () => {
  const html = popover.buildHoverSummaryHtml({
    events: [{ title: "케이뱅크" }, { title: "알지노믹스" }],
  });

  assert.match(html, /chart-hover-summary-lines/);
  assert.match(html, /케이뱅크/);
  assert.match(html, /알지노믹스/);
  assert.doesNotMatch(html, /button|추출 실패 종목|279570\.KS/);
});

test("adds a compact reusable action to an interactive hover summary", () => {
  const html = popover.buildHoverSummaryHtml({
    events: [{
      title: "삼성바이오로직...",
      fullTitle: "삼성바이오로직스홀딩스",
      actionLabel: "추가",
    }],
  });

  assert.match(html, /chart-hover-summary-action/);
  assert.match(html, /data-popover-event-action/);
  assert.match(html, /aria-label="삼성바이오로직스홀딩스 추가"/);
  assert.match(html, />추가<\/button>/);
});

test("uses the shared destructive tone only for block and remove actions", () => {
  const html = popover.buildHoverSummaryHtml({
    events: [
      { title: "차단 후보", actionLabel: "차단" },
      { title: "추가 후보", actionLabel: "추가" },
      { title: "제거 후보", actionLabel: "제거" },
    ],
  });

  assert.equal((html.match(/is-destructive/g) || []).length, 2);
  assert.match(html, /class="chart-hover-summary-action"[^>]+>추가<\/button>/);
});
