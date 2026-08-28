"use strict";

  const contract = require("./stock-research-contract.js");
  if (!contract) throw new Error("stock research contract failed to load");

  function visibleCandidateReasons(reasons) {
    return (Array.isArray(reasons) ? reasons : [])
      .map((value) => String(value || "").trim())
      .filter((value) => value
        && !/^(매수|매도)\s+\d+회(?:\s+연속)?$/.test(value)
        && !/^마지막\s+매도(?:\s|$)/.test(value)
        && !/^20일\s+등락(?:\s|$)/.test(value));
  }

  function candidateMeetsSignalMinimum(candidate, filter = {}, minimum = contract.MINIMUM_DEFAULT) {
    const number = minimum == null || String(minimum).trim() === ""
      ? contract.MINIMUM_DEFAULT
      : Math.round(Number(minimum));
    const normalizedMinimum = Number.isFinite(number)
      ? Math.max(contract.MINIMUM_LOW, Math.min(contract.MINIMUM_HIGH, number))
      : contract.MINIMUM_DEFAULT;
    const buyCount = normalizedMinimum === 1
      ? Number(candidate?.recentMonthBuyCount)
      : Number(candidate?.buyCount);
    const sellCount = normalizedMinimum === 1
      ? Number(candidate?.recentMonthSellCount)
      : Number(candidate?.sellCount);
    return (filter.includeBuy !== false && buyCount >= normalizedMinimum)
      || (filter.includeSell === true && sellCount >= normalizedMinimum);
  }

  function latestResearchDate(rows, fallback = "") {
    const latest = (Array.isArray(rows) ? rows : []).reduce((value, row) => {
      const date = String(row?.date || row?.latestDate || "").slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && date > value ? date : value;
    }, "");
    return latest || String(fallback || "").slice(0, 10);
  }

  function resolveResearchMarketDates(shared = {}) {
    return Object.freeze({
      KOSPI: latestResearchDate(shared?.kospiRows),
      KOSDAQ: latestResearchDate(shared?.kosdaqRows),
    });
  }

  function candidateResearchMarket(candidate) {
    const market = String(candidate?.market || "").trim().toUpperCase();
    const ticker = String(candidate?.ticker || "").trim().toUpperCase();
    if (market === "KOSDAQ" || ticker.endsWith(".KQ")) return "KOSDAQ";
    if (market === "KOSPI" || ticker.endsWith(".KS")) return "KOSPI";
    return "";
  }

  function candidateResearchMarketDate(candidate, marketDates = {}) {
    const market = candidateResearchMarket(candidate);
    return market ? String(marketDates?.[market] || "").slice(0, 10) : "";
  }

  function researchMarketDateIsCurrent(marketDate, expectedDate = "") {
    const reference = String(marketDate || "").slice(0, 10);
    const expected = String(expectedDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reference)) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) return true;
    return reference >= expected;
  }

  function candidateMatchesTodayFilter(candidate, filter = {}, marketDates = {}, expectedDate = "") {
    const referenceDate = candidateResearchMarketDate(candidate, marketDates);
    if (!researchMarketDateIsCurrent(referenceDate, expectedDate)) return false;
    const candidateDate = String(candidate?.latestDate || candidate?.asOfDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidateDate) || candidateDate !== referenceDate) return false;
    const buyDate = String(candidate?.lastBuyDate || "").slice(0, 10);
    const sellDate = String(candidate?.lastSellDate || candidate?.sellDate || "").slice(0, 10);
    return (filter?.includeBuy === true && buyDate === referenceDate)
      || (filter?.includeSell === true && sellDate === referenceDate);
  }

  function researchMarketDateLabel(marketDates = {}, expectedDate = "") {
    const kospi = String(marketDates?.KOSPI || "").slice(0, 10);
    const kosdaq = String(marketDates?.KOSDAQ || "").slice(0, 10);
    const delayed = [
      !researchMarketDateIsCurrent(kospi, expectedDate) ? "코스피" : "",
      !researchMarketDateIsCurrent(kosdaq, expectedDate) ? "코스닥" : "",
    ].filter(Boolean);
    if (delayed.length) return `${delayed.join("·")} 최신가격 지연`;
    if (kospi && kosdaq && kospi === kosdaq) return kospi;
    return [
      kospi ? `코스피 ${kospi}` : "",
      kosdaq ? `코스닥 ${kosdaq}` : "",
    ].filter(Boolean).join(" · ") || "최신 거래일 미확인";
  }

  const stockResearchFilter = Object.freeze({
    candidateMatchesTodayFilter,
    candidateMeetsSignalMinimum,
    candidateResearchMarket,
    candidateResearchMarketDate,
    latestResearchDate,
    researchMarketDateLabel,
    researchMarketDateIsCurrent,
    resolveResearchMarketDates,
    visibleCandidateReasons,
  });

module.exports = stockResearchFilter;
