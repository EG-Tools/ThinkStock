import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("docs/modules/ai-forecast-scenarios.js"), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
const { resolveScenarioPresentation } = context.ThinkStockAiForecastScenarios;

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
