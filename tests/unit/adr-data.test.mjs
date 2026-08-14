import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  mergeAdrLiveRows,
  mergeAdrRows,
  parseAdrChartRows,
} from "../../shared/adr-data.mjs";

test("parses both ADR markets and rejects unpublished zero values", () => {
  const timestamp = Date.parse("2026-08-06T00:00:00+09:00");
  const rows = parseAdrChartRows(
    `<script>const kospi_adr=[[${timestamp},91.2],[${timestamp + 86400000},0]];`
      + `const kosdaq_adr=[[${timestamp},87.4],[${timestamp + 86400000},0]];</script>`,
  );
  assert.deepEqual(rows, [{ date: "2026-08-06", adr_kospi: 91.2, adr_kosdaq: 87.4 }]);
});

test("same-day ADR updates replace the earlier value without losing other indicators", () => {
  const result = mergeAdrLiveRows(
    [{ date: "2026-08-06", adr_kospi: 91.2, adr_kosdaq: 87.4, fear_greed: 32 }],
    [{ date: "2026-08-06", adr_kospi: 95.8, adr_kosdaq: 89.1 }],
  );
  assert.equal(result.added, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.changed, 1);
  assert.deepEqual(result.rows, [
    { date: "2026-08-06", adr_kospi: 95.8, adr_kosdaq: 89.1, fear_greed: 32 },
  ]);
});

test("ADR cache merge keeps newer cached dates while applying source corrections", () => {
  const rows = mergeAdrRows(
    [
      { date: "2026-08-05", adr_kospi: 80 },
      { date: "2026-08-06", adr_kospi: 90 },
    ],
    [{ date: "2026-08-05", adr_kospi: 82 }],
  );
  assert.deepEqual(rows, [
    { date: "2026-08-05", adr_kospi: 82 },
    { date: "2026-08-06", adr_kospi: 90 },
  ]);
});

test("bundled ADR and fear-greed history never encodes missing values as zero", () => {
  const payload = JSON.parse(fs.readFileSync(
    new URL("../../docs/data/adr_data.json", import.meta.url),
    "utf8",
  ));
  for (const key of ["adr_kospi", "adr_kosdaq", "fear_greed"]) {
    assert.equal(payload.columns[key].includes(0), false, `${key} contains a zero sentinel`);
  }
  assert.ok(payload.columns.fear_greed.filter(Number.isFinite).length > 3_000);
});
