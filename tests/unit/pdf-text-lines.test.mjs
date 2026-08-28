import assert from "node:assert/strict";
import test from "node:test";

import { lineItemsFromTextContent } from "../../docs/modules/pdf-text-lines.mjs";

test("PDF text items share one row grouping and horizontal ordering rule", () => {
  const lines = lineItemsFromTextContent({
    items: [
      { str: "오른쪽", transform: [1, 0, 0, 1, 90, 100] },
      { str: "둘째 줄", transform: [1, 0, 0, 1, 10, 80] },
      { str: "왼쪽", transform: [1, 0, 0, 1, 10, 101] },
      { str: "  ", transform: [1, 0, 0, 1, 0, 120] },
    ],
  });
  assert.deepEqual(lines, ["왼쪽 오른쪽", "둘째 줄"]);
});
