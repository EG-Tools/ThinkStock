"use strict";

function lineItemsFromTextContent(textContent, options = {}) {
  const rowTolerance = Math.max(0.1, Number(options.rowTolerance) || 1.8);
  const rows = [];
  (Array.isArray(textContent?.items) ? textContent.items : []).forEach((item) => {
    const text = String(item?.str || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const x = Number(item?.transform?.[4]) || 0;
    const y = Number(item?.transform?.[5]) || 0;
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= rowTolerance);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  });
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}

export { lineItemsFromTextContent };
