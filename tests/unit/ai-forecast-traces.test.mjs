import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("docs/modules/ai-forecast-scenarios.js"), "utf8");
const traceSource = await readFile(path.resolve("docs/modules/ai-forecast-traces.js"), "utf8");
const context = { URL };
vm.createContext(context);
vm.runInContext(source, context);
vm.runInContext(traceSource, context);
const { resolveScenarioPresentation } = context.ThinkStockAiForecastScenarios;
const {
  buildRepresentativeReportLink,
  isThickestAiScenarioTrace,
  representativeReportFromForecastClick,
  resolveScenarioTraceStyle,
  withoutStockCode,
} = context.ThinkStockAiForecastTraces;

function scenarios(upside, sideways, downside) {
  return {
    upside: { weight: upside },
    sideways: { weight: sideways },
    downside: { weight: downside },
  };
}

test("presents a near-tied range forecast as mixed and sideways-centered", () => {
  const presentation = resolveScenarioPresentation(scenarios(37, 31, 32), {
    expectedReturn: 0.024,
    flatBand: 0.07,
  });

  assert.equal(presentation.rawPrimaryKey, "upside");
  assert.equal(presentation.representativeKey, "sideways");
  assert.equal(presentation.expectedDirection, "sideways");
  assert.equal(presentation.decisive, false);
  assert.equal(presentation.lead, 5);
});

test("keeps a clearly dominant scenario as the emphasized forecast", () => {
  const presentation = resolveScenarioPresentation(scenarios(52, 28, 20), {
    expectedReturn: 0.12,
    flatBand: 0.07,
  });

  assert.equal(presentation.rawPrimaryKey, "upside");
  assert.equal(presentation.representativeKey, "upside");
  assert.equal(presentation.decisive, true);
  assert.equal(presentation.lead, 24);
});

test("retains a directional representative when the expected move clears the flat band", () => {
  const presentation = resolveScenarioPresentation(scenarios(31, 32, 37), {
    expectedReturn: -0.12,
    flatBand: 0.07,
  });

  assert.equal(presentation.rawPrimaryKey, "downside");
  assert.equal(presentation.representativeKey, "downside");
  assert.equal(presentation.expectedDirection, "downside");
  assert.equal(presentation.decisive, false);
});

test("uses one bright style and one shared dim style for forecast scenarios", () => {
  const highest = resolveScenarioTraceStyle(true);
  const secondary = resolveScenarioTraceStyle(false);

  assert.match(highest.color, /248, 248, 248/);
  assert.ok(highest.width > secondary.width);
  assert.equal(secondary.color, "rgba(138, 138, 138, 0.48)");
  assert.equal(resolveScenarioTraceStyle(false).color, secondary.color);
  assert.equal(resolveScenarioTraceStyle(false).width, secondary.width);
});

test("renders one report date and moves the source link to click interaction", () => {
  const html = buildRepresentativeReportLink({
    sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=651738",
    title: "JYP (035900) 목표가 20% 하향",
    publishedDate: "2026-08-14",
  }, (value) => String(value), "2026-08-15");
  assert.doesNotMatch(html, /<a href=/);
  assert.doesNotMatch(html, /report_idx=651738/);
  assert.match(html, /참고 리포트/);
  assert.doesNotMatch(html, /대표 리포트|035900/);
  assert.match(html, /JYP 목표가 20&#37; 하향/);
  assert.match(html, /2026-08-14/);
  assert.doesNotMatch(html, /2026-08-15/);
  assert.equal(buildRepresentativeReportLink(null), "");
  assert.equal(withoutStockCode("RFHIC (218410)"), "RFHIC");
});

test("extracts one safe representative report only from a thickest AI scenario", () => {
  const report = {
    sourceUrl: "https://stock.pstatic.net/stock-research/company/57/20260723_company_184323000.pdf",
    title: "RFHIC report",
    publishedDate: "2026-07-23",
    broker: "Hana Securities",
  };
  const thickTrace = { line: { width: 2.9 }, meta: {
      isAiForecastScenarioTrace: true,
      isEmphasizedAiScenario: true,
      thickestAiScenarioLineWidth: 2.9,
      representativeReport: report,
  } };
  const selected = representativeReportFromForecastClick({
    points: [{ data: thickTrace }],
  });
  assert.equal(selected.report.title, "RFHIC report");
  assert.equal(selected.report.publishedDate, "2026-07-23");
  assert.equal(isThickestAiScenarioTrace(thickTrace), true);
  assert.equal(representativeReportFromForecastClick({
    points: [{ data: { line: { width: 2.9 }, meta: { isAiForecastScenarioTrace: true, isEmphasizedAiScenario: true, thickestAiScenarioLineWidth: 2.9, representativeReport: {
      ...report,
      sourceUrl: "https://example.com/report.pdf",
    } } } }],
  }), null);
  assert.equal(representativeReportFromForecastClick({
    points: [{ data: { line: { width: 1.8 }, meta: {
      isAiForecastScenarioTrace: true,
      isEmphasizedAiScenario: true,
      thickestAiScenarioLineWidth: 2.9,
      representativeReport: report,
    } } }],
  }), null);
});

test("allows every AI scenario tied for the thickest rendered line", () => {
  const trace = (width) => ({
    line: { width },
    meta: {
      isAiForecastScenarioTrace: true,
      thickestAiScenarioLineWidth: 2.9,
    },
  });

  assert.equal(isThickestAiScenarioTrace(trace(2.9)), true);
  assert.equal(isThickestAiScenarioTrace(trace(2.9)), true);
  assert.equal(isThickestAiScenarioTrace(trace(1.8)), false);
});
