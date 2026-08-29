const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const DISPLAY_GROUPS = Object.freeze([
    Object.freeze({
      id: "krx-market-index",
      name: "코스피·코스닥 지수 시세정보",
      memberIds: Object.freeze(["krx-kosdaq-index", "krx-kospi-index"]),
    }),
    Object.freeze({
      id: "krx-market-trading",
      name: "코스피·코스닥 일별매매정보",
      memberIds: Object.freeze(["krx-kosdaq-trading", "krx-kospi-trading"]),
    }),
    Object.freeze({
      id: "krx-market-basics",
      name: "코스피·코스닥 종목기본정보",
      memberIds: Object.freeze(["krx-kospi-basics", "krx-kosdaq-basics"]),
    }),
    Object.freeze({
      id: "unlimited-public-apis",
      name: "DART·FRED",
      memberIds: Object.freeze(["dart", "fred"]),
    }),
  ]);

  const DEFAULT_PERIODS = Object.freeze([
    Object.freeze({
      id: "krx-auth-key",
      name: "KRX API",
      startDate: "2026-04-15",
      endDate: "2027-04-14",
    }),
    Object.freeze({
      id: "krx-derivatives-index",
      name: "파생상품지수 시세정보",
      startDate: "2026-08-12",
      endDate: "2027-08-11",
    }),
    Object.freeze({
      id: "krx-kosdaq-index",
      name: "KOSDAQ 시리즈 일별시세정보",
      startDate: "2026-04-17",
      endDate: "2027-04-16",
    }),
    Object.freeze({
      id: "krx-kosdaq-trading",
      name: "코스닥 일별매매정보",
      startDate: "2026-04-17",
      endDate: "2027-04-16",
    }),
    Object.freeze({
      id: "krx-kospi-basics",
      name: "유가증권 종목기본정보",
      startDate: "2026-04-17",
      endDate: "2027-04-16",
    }),
    Object.freeze({
      id: "krx-kospi-trading",
      name: "유가증권 일별매매정보",
      startDate: "2026-04-17",
      endDate: "2027-04-16",
    }),
    Object.freeze({
      id: "krx-kospi-index",
      name: "KOSPI 시리즈 일별시세정보",
      startDate: "2026-04-17",
      endDate: "2027-04-16",
    }),
    Object.freeze({
      id: "krx-kosdaq-basics",
      name: "코스닥 종목기본정보",
      startDate: "2026-04-17",
      endDate: "2027-04-16",
    }),
    Object.freeze({
      id: "bok-ecos",
      name: "한국은행",
      startDate: "2026-04-19",
      endDate: "2028-04-19",
    }),
    Object.freeze({
      id: "fsc-open-api",
      name: "금융위원회",
      startDate: "2026-04-17",
      endDate: "2028-04-17",
    }),
    Object.freeze({ id: "dart", name: "DART", noExpiry: true }),
    Object.freeze({ id: "fred", name: "FRED", noExpiry: true }),
  ]);

  function normalizePeriods(periods = DEFAULT_PERIODS) {
    return (Array.isArray(periods) ? periods : [])
      .map((period) => ({
        id: String(period?.id || "").trim(),
        name: String(period?.name || "").trim(),
        startDate: String(period?.startDate || "").trim(),
        endDate: String(period?.endDate || "").trim(),
        noExpiry: period?.noExpiry === true,
      }))
      .filter((period) => (
        period.id
        && period.name
        && (period.noExpiry || (
          DATE_PATTERN.test(period.startDate)
          && DATE_PATTERN.test(period.endDate)
          && period.startDate <= period.endDate
        ))
      ));
  }

  function formatPeriodDate(value) {
    return DATE_PATTERN.test(String(value || "")) ? String(value).replace(/-/g, "/") : "";
  }

  function compactPeriodsForDisplay(periods = DEFAULT_PERIODS) {
    const normalized = normalizePeriods(periods);
    const byId = new Map(normalized.map((period) => [period.id, period]));
    const groupByMember = new Map();
    DISPLAY_GROUPS.forEach((group) => {
      group.memberIds.forEach((id) => groupByMember.set(id, group));
    });
    const consumed = new Set();
    const compacted = [];
    normalized.forEach((period) => {
      if (consumed.has(period.id)) return;
      const group = groupByMember.get(period.id);
      const members = group?.memberIds.map((id) => byId.get(id)).filter(Boolean) || [];
      const rangeKey = (entry) => (entry.noExpiry
        ? "none"
        : `${entry.startDate}:${entry.endDate}`);
      const canMerge = group
        && members.length === group.memberIds.length
        && members.every((entry) => rangeKey(entry) === rangeKey(members[0]));
      if (!canMerge) {
        compacted.push(period);
        return;
      }
      members.forEach((entry) => consumed.add(entry.id));
      compacted.push({
        id: group.id,
        name: group.name,
        startDate: members[0].startDate,
        endDate: members[0].endDate,
        noExpiry: members[0].noExpiry,
      });
    });
    return compacted;
  }

  function formatPeriodRange(period, today = koreaDateText()) {
    if (period?.noExpiry === true) return "기간 제한 없음";
    if (DATE_PATTERN.test(String(today || ""))
      && DATE_PATTERN.test(String(period?.endDate || ""))
      && today > period.endDate) return "기간만료";
    return `${formatPeriodDate(period?.startDate)} ~ ${formatPeriodDate(period?.endDate)}`;
  }

  function koreaDateText(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);
      const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    } catch (_) {
      return new Date(date.getTime() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    }
  }

export {
  DEFAULT_PERIODS,
  DISPLAY_GROUPS,
  compactPeriodsForDisplay,
  formatPeriodDate,
  formatPeriodRange,
  koreaDateText,
  normalizePeriods,
};
