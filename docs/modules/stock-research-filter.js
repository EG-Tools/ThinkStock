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

  function resolveCandidateResearchMarketDates(candidates = [], fallback = {}) {
    const resolved = {
      KOSPI: String(fallback?.KOSPI || "").slice(0, 10),
      KOSDAQ: String(fallback?.KOSDAQ || "").slice(0, 10),
    };
    (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
      const market = candidateResearchMarket(candidate);
      const date = String(candidate?.latestDate || candidate?.asOfDate || "").slice(0, 10);
      if (market && /^\d{4}-\d{2}-\d{2}$/.test(date) && date > resolved[market]) {
        resolved[market] = date;
      }
    });
    return Object.freeze(resolved);
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
    return candidateMatchesSignalWindow(candidate, {
      ...filter,
      signalWindowDays: 1,
    }, marketDates, expectedDate);
  }

  function signalCalendarAge(signalDate, referenceDate) {
    const signalTime = Date.parse(`${String(signalDate || "").slice(0, 10)}T00:00:00Z`);
    const referenceTime = Date.parse(`${String(referenceDate || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(signalTime) || !Number.isFinite(referenceTime) || signalTime > referenceTime) {
      return null;
    }
    return Math.floor((referenceTime - signalTime) / 86400000);
  }

  function candidateSignalWindowState(candidate, filter = {}, marketDates = {}, expectedDate = "") {
    const windowDays = contract.normalizeSignalWindowDays(
      filter?.signalWindowDays,
      filter?.todayOnly === true,
    );
    const sessionSpan = contract.signalWindowSessionSpan(windowDays);
    const referenceDate = candidateResearchMarketDate(candidate, marketDates);
    if (!windowDays || !researchMarketDateIsCurrent(referenceDate, expectedDate)) {
      return Object.freeze({ matches: false, buy: false, sell: false, referenceDate, windowDays });
    }
    const candidateDate = String(candidate?.latestDate || candidate?.asOfDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidateDate) || candidateDate !== referenceDate) {
      return Object.freeze({ matches: false, buy: false, sell: false, referenceDate, windowDays });
    }
    const buyDate = String(candidate?.lastBuyDate || "").slice(0, 10);
    const sellDate = String(candidate?.lastSellDate || candidate?.sellDate || "").slice(0, 10);
    const normalizedMinimum = Math.max(
      contract.MINIMUM_LOW,
      Math.min(contract.MINIMUM_HIGH, Math.round(Number(filter?.minimumSignals) || 1)),
    );
    const signalIsInside = (date, storedAge) => {
      const sessionAge = Number(storedAge);
      if (Number.isInteger(sessionAge) && sessionAge >= 0) return sessionAge < sessionSpan;
      const calendarAge = signalCalendarAge(date, referenceDate);
      return Number.isInteger(calendarAge) && calendarAge >= 0 && calendarAge < sessionSpan;
    };
    const countInside = (values, fallbackDate, fallbackAge) => {
      if (Array.isArray(values)) {
        return values.filter((value) => {
          const age = Number(value);
          return Number.isInteger(age) && age >= 0 && age < sessionSpan;
        }).length;
      }
      return signalIsInside(fallbackDate, fallbackAge) ? 1 : 0;
    };
    const buyCount = countInside(
      candidate?.buySignalSessionAges,
      buyDate,
      candidate?.lastBuySessionAge,
    );
    const sellCount = countInside(
      candidate?.sellSignalSessionAges,
      sellDate,
      candidate?.lastSellSessionAge,
    );
    const buy = filter?.includeBuy === true && buyCount >= normalizedMinimum;
    const sell = filter?.includeSell === true && sellCount >= normalizedMinimum;
    return Object.freeze({
      matches: buy || sell,
      buy,
      sell,
      buyCount,
      sellCount,
      minimumSignals: normalizedMinimum,
      referenceDate,
      windowDays,
    });
  }

  function candidateMatchesSignalWindow(candidate, filter = {}, marketDates = {}, expectedDate = "") {
    return candidateSignalWindowState(candidate, filter, marketDates, expectedDate).matches;
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
    candidateMatchesSignalWindow,
    candidateMeetsSignalMinimum,
    candidateResearchMarket,
    candidateResearchMarketDate,
    candidateSignalWindowState,
    latestResearchDate,
    nextSignalWindowDays: contract.nextSignalWindowDays,
    normalizeSignalWindowDays: contract.normalizeSignalWindowDays,
    researchMarketDateLabel,
    researchMarketDateIsCurrent,
    resolveCandidateResearchMarketDates,
    resolveResearchMarketDates,
    signalWindowLabel: contract.signalWindowLabel,
    signalWindowSessionSpan: contract.signalWindowSessionSpan,
    visibleCandidateReasons,
  });

module.exports = stockResearchFilter;
