(function initThinkStockInsiderTrades(globalScope) {
  "use strict";

  const TICKER_PATTERN = /^\d{6}\.(KS|KQ)$/;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const BUY_COLOR = "#ef4444";
  const SELL_COLOR = "#3b82f6";

  function finiteNumber(value) {
    const normalized = String(value ?? "").replaceAll(",", "").trim();
    if (!normalized || normalized === "-") return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeDate(value) {
    const digits = String(value || "").replace(/\D/g, "");
    const date = digits.length === 8
      ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
      : String(value || "").slice(0, 10);
    if (!DATE_PATTERN.test(date)) return "";
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
  }

  function sanitizeRow(value) {
    const ticker = String(value?.ticker || "").trim().toUpperCase();
    const date = normalizeDate(value?.date || value?.rcept_dt);
    const sharesChanged = finiteNumber(value?.sharesChanged ?? value?.sp_stock_lmp_irds_cnt);
    if (!TICKER_PATTERN.test(ticker) || !date || !sharesChanged) return null;
    const side = sharesChanged > 0 ? "buy" : "sell";
    const receiptNo = String(value?.receiptNo || value?.rcept_no || "").replace(/\D/g, "").slice(0, 14);
    return {
      ticker,
      date,
      side,
      reporter: String(value?.reporter || value?.repror || "").trim().slice(0, 80),
      role: String(value?.role || "").trim().slice(0, 120),
      sharesBefore: finiteNumber(value?.sharesBefore),
      sharesOwned: finiteNumber(value?.sharesOwned ?? value?.sp_stock_lmp_cnt),
      sharesChanged,
      ownershipRate: finiteNumber(value?.ownershipRate ?? value?.sp_stock_lmp_rate),
      ownershipRateChanged: finiteNumber(
        value?.ownershipRateChanged ?? value?.sp_stock_lmp_irds_rate,
      ),
      receiptNo,
      recordId: String(value?.recordId || "").trim().slice(0, 300),
      recordType: String(value?.recordType || "").trim().slice(0, 80),
      transactionMethod: String(value?.transactionMethod || "").trim().slice(0, 80),
      securityType: String(value?.securityType || "").trim().slice(0, 80),
      unitPrice: finiteNumber(value?.unitPrice),
      url: receiptNo
        ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
        : "",
      source: String(value?.source || "OpenDART").trim().slice(0, 80),
    };
  }

  function sanitizeRows(records) {
    return (Array.isArray(records) ? records : []).map(sanitizeRow).filter(Boolean);
  }

  function mergeRows(existing, incoming) {
    const rows = new Map();
    [...sanitizeRows(existing), ...sanitizeRows(incoming)].forEach((row) => {
      const key = row.recordId || (row.recordType === "major-holder-detail" ? [
        row.receiptNo,
        row.date,
        row.reporter,
        row.transactionMethod,
        row.securityType,
        row.sharesBefore,
        row.sharesChanged,
        row.sharesOwned,
      ].join("|") : row.receiptNo) || [
        row.ticker,
        row.date,
        row.reporter,
        row.sharesChanged,
      ].join("|");
      rows.set(key, row);
    });
    return [...rows.values()].sort((left, right) => (
      left.date.localeCompare(right.date)
      || left.ticker.localeCompare(right.ticker)
      || left.reporter.localeCompare(right.reporter)
    ));
  }

  function netSameReporterTrades(records) {
    const buckets = new Map();
    (Array.isArray(records) ? records : []).forEach((row, index) => {
      const reporter = String(row?.reporter || "").trim();
      const sharesChanged = finiteNumber(row?.sharesChanged);
      const canNet = reporter && sharesChanged !== null;
      const key = canNet
        ? `${row.ticker}|${row.date}|${reporter.toLowerCase()}`
        : `unmatched|${index}`;
      const bucket = buckets.get(key) || [];
      bucket.push(row);
      buckets.set(key, bucket);
    });

    return [...buckets.values()].flatMap((rows) => {
      const hasBuy = rows.some((row) => finiteNumber(row?.sharesChanged) > 0);
      const hasSell = rows.some((row) => finiteNumber(row?.sharesChanged) < 0);
      if (!hasBuy || !hasSell) return rows;
      const sharesChanged = rows.reduce((total, row) => (
        total + (finiteNumber(row?.sharesChanged) || 0)
      ), 0);
      if (!sharesChanged) return [];
      const side = sharesChanged > 0 ? "buy" : "sell";
      const representative = rows.find((row) => row?.side === side) || rows[0];
      return [{
        ...representative,
        side,
        sharesChanged,
        nettedTransactionCount: rows.length,
      }];
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatShares(value) {
    const number = finiteNumber(value);
    return number === null ? "-" : `${Math.abs(number).toLocaleString("ko-KR")}주`;
  }

  function markerTrace(groups, side) {
    const matches = (Array.isArray(groups) ? groups : []).filter((group) => group?.side === side);
    if (!matches.length) return null;
    const isBuy = side === "buy";
    const label = isBuy ? "매수" : "매도";
    return {
      x: matches.map((group) => group.plotDate),
      y: matches.map((group) => group.y),
      customdata: matches.map((group) => [group.ticker, group.events.length, group.paired === true]),
      type: "scatter",
      mode: "markers",
      name: `내부거래 ${label}`,
      showlegend: false,
      cliponaxis: false,
      yaxis: "y",
      marker: {
        symbol: isBuy ? "triangle-up" : "triangle-down",
        size: 12,
        color: isBuy ? BUY_COLOR : SELL_COLOR,
        line: { color: isBuy ? BUY_COLOR : SELL_COLOR, width: 1 },
      },
      hovertemplate: matches.map((group) => {
        const first = group.events[0] || {};
        const reporter = first.reporter ? `<br>${escapeHtml(first.reporter)}` : "";
        const role = first.role ? ` · ${escapeHtml(first.role)}` : "";
        const method = first.transactionMethod ? `<br>${escapeHtml(first.transactionMethod)}` : "";
        const owned = first.sharesOwned === null || first.sharesOwned === undefined
          ? ""
          : `<br>거래 후 ${formatShares(first.sharesOwned)}`;
        const ownershipRate = first.ownershipRate === null || first.ownershipRate === undefined
          ? ""
          : ` (${Number(first.ownershipRate).toLocaleString("ko-KR")}%)`;
        const more = group.events.length > 1 ? `<br>외 ${group.events.length - 1}건` : "";
        return `<b>${escapeHtml(group.name)}</b><br>${escapeHtml(first.date)} ${label}`
          + `${method}<br>보유 증감 ${formatShares(first.sharesChanged)}${owned}${ownershipRate}`
          + `${reporter}${role}${more}`
          + "<extra>내부거래</extra>";
      }),
      meta: { isInsiderTradeTrace: true, insiderTradeSide: side },
    };
  }

  function buildMarkerTraces(groups) {
    return [markerTrace(groups, "buy"), markerTrace(groups, "sell")].filter(Boolean);
  }

  globalScope.ThinkStockInsiderTrades = Object.freeze({
    BUY_COLOR,
    SELL_COLOR,
    buildMarkerTraces,
    mergeRows,
    netSameReporterTrades,
    normalizeDate,
    sanitizeRow,
    sanitizeRows,
  });
}(typeof self !== "undefined" ? self : globalThis));
