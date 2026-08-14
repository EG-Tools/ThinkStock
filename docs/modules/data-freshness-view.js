(function initDataFreshnessView(globalScope) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function priceSourceLabel(status) {
    if (!status) return "";
    const source = status.source === "NAVER_FALLBACK"
      ? "네이버 보완"
      : (status.source === "KRX" ? "KRX" : "저장본");
    if (status.stale) return `${source} 확인필요`;
    if (status.localCache) return `${source} 저장본`;
    if (status.cached) return `${source} 캐시`;
    return source;
  }

  function render(element, items, options = {}) {
    if (!element) return "";
    const labelName = typeof options.labelName === "function"
      ? options.labelName
      : (value) => String(value || "");
    const runtimeStatus = options.priceStatus || null;
    const markup = (Array.isArray(items) ? items : []).map((item) => {
      const itemRuntimeStatus = item.label === "가격" ? runtimeStatus : null;
      const classes = [
        "freshness-chip",
        item.isEmpty ? "is-empty" : "",
        item.isStale || itemRuntimeStatus?.stale ? "is-stale" : "",
        itemRuntimeStatus?.localCache || itemRuntimeStatus?.cached ? "is-cache" : "",
        item.anomalies?.length || item.gaps?.length ? "is-anomaly" : "",
      ].filter(Boolean).join(" ");
      const rangeTitle = item.first && item.latest ? `범위: ${item.first} ~ ${item.latest}` : "";
      const staleTitle = item.isStale ? `최신 데이터 확인 필요: ${item.ageDays}일 전` : "";
      const anomalyTitle = item.anomalies?.length
        ? `최근 값 급변 확인 필요: ${item.anomalies.map((entry) => labelName(entry.key)).join(", ")}`
        : "";
      const gapTitle = item.gaps?.length
        ? `데이터 공백 확인 필요: ${item.gaps.map((entry) => `${labelName(entry.key)} ${entry.previousDate}~${entry.latestDate}`).join(", ")}`
        : "";
      const runtimeTitle = itemRuntimeStatus
        ? [
          labelName(itemRuntimeStatus.ticker),
          `출처: ${priceSourceLabel(itemRuntimeStatus)}`,
          itemRuntimeStatus.marketDate ? `KRX 시장 기준일: ${itemRuntimeStatus.marketDate}` : "",
          itemRuntimeStatus.expectedDate ? `예상 거래일: ${itemRuntimeStatus.expectedDate}` : "",
          itemRuntimeStatus.warning,
        ].filter(Boolean).join(" / ")
        : "";
      const title = [rangeTitle, staleTitle, anomalyTitle, gapTitle, runtimeTitle].filter(Boolean).join(" / ");
      const dateText = itemRuntimeStatus?.latestDate || item.date || "없음";
      const sourceText = itemRuntimeStatus ? priceSourceLabel(itemRuntimeStatus) : "";
      const sourceMarkup = sourceText ? `<small>${escapeHtml(sourceText)}</small>` : "";
      return `<span class="${classes}" title="${escapeHtml(title)}"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(dateText)}${sourceMarkup}</span>`;
    }).join("");
    element.innerHTML = markup;
    return markup;
  }

  function summarizeQuality(items, sourceByLabel = {}) {
    const grouped = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const source = String(sourceByLabel[item?.label] || item?.source || item?.label || "").trim();
      if (!source) return;
      const current = grouped.get(source) || {
        firstDate: "",
        latestDate: "",
        isEmpty: true,
        isStale: false,
        anomalyCount: 0,
        gapCount: 0,
      };
      const firstDate = String(item?.first || "").slice(0, 10);
      const latestDate = String(item?.latest || item?.date || "").slice(0, 10);
      if (firstDate && (!current.firstDate || firstDate < current.firstDate)) current.firstDate = firstDate;
      if (latestDate && (!current.latestDate || latestDate > current.latestDate)) current.latestDate = latestDate;
      current.isEmpty = current.isEmpty && item?.isEmpty === true;
      current.isStale = current.isStale || item?.isStale === true;
      current.anomalyCount += Array.isArray(item?.anomalies) ? item.anomalies.length : 0;
      current.gapCount += Array.isArray(item?.gaps) ? item.gaps.length : 0;
      grouped.set(source, current);
    });
    return Object.freeze(Object.fromEntries([...grouped.entries()].map(([source, value]) => [
      source,
      Object.freeze(value),
    ])));
  }

  globalScope.ThinkStockDataFreshnessView = Object.freeze({
    escapeHtml,
    priceSourceLabel,
    render,
    summarizeQuality,
  });
}(typeof self !== "undefined" ? self : globalThis));
