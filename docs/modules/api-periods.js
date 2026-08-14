(function initThinkStockApiPeriods(globalScope) {
  "use strict";

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const REMINDER_STORAGE_KEY = "thinkstock-api-period-reminder-v1";
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

  function formatPeriodRange(period) {
    if (period?.noExpiry === true) return "기간 제한 없음";
    return `${formatPeriodDate(period?.startDate)} ~ ${formatPeriodDate(period?.endDate)}`;
  }

  function shiftDateMonths(value, amount) {
    if (!DATE_PATTERN.test(String(value || ""))) return "";
    const [year, month, day] = value.split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 1 + amount, 1));
    const targetYear = first.getUTCFullYear();
    const targetMonth = first.getUTCMonth();
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
      .toISOString()
      .slice(0, 10);
  }

  function shiftDateDays(value, amount) {
    if (!DATE_PATTERN.test(String(value || ""))) return "";
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
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

  function periodSignature(periods = DEFAULT_PERIODS) {
    return normalizePeriods(periods)
      .map((period) => `${period.id}:${period.noExpiry ? "none" : `${period.startDate}:${period.endDate}`}`)
      .join("|");
  }

  function reminderPeriods(periods, today) {
    if (!DATE_PATTERN.test(String(today || ""))) return [];
    return normalizePeriods(periods)
      .filter((period) => !period.noExpiry && today >= shiftDateMonths(period.endDate, -1))
      .sort((left, right) => left.endDate.localeCompare(right.endDate));
  }

  function createReminderStore(scope = globalScope, options = {}) {
    const periods = normalizePeriods(options.periods || DEFAULT_PERIODS);
    const signature = periodSignature(periods);
    const storage = options.storage || scope.localStorage;
    const storageKey = String(options.storageKey || REMINDER_STORAGE_KEY);
    const now = typeof options.now === "function" ? options.now : () => new Date();

    function today() {
      return koreaDateText(now());
    }

    function read() {
      try {
        const parsed = JSON.parse(storage?.getItem(storageKey) || "null");
        if (!parsed || parsed.signature !== signature) return { signature };
        return {
          signature,
          lastShownDate: DATE_PATTERN.test(String(parsed.lastShownDate || ""))
            ? parsed.lastShownDate
            : "",
          snoozeUntil: DATE_PATTERN.test(String(parsed.snoozeUntil || ""))
            ? parsed.snoozeUntil
            : "",
        };
      } catch (_) {
        return { signature };
      }
    }

    function write(state) {
      const next = {
        signature,
        lastShownDate: DATE_PATTERN.test(String(state?.lastShownDate || ""))
          ? state.lastShownDate
          : "",
        snoozeUntil: DATE_PATTERN.test(String(state?.snoozeUntil || ""))
          ? state.snoozeUntil
          : "",
      };
      try { storage?.setItem(storageKey, JSON.stringify(next)); } catch (_) {}
      return next;
    }

    function decision(dateText = today()) {
      const due = reminderPeriods(periods, dateText);
      const state = read();
      const snoozed = Boolean(state.snoozeUntil && dateText < state.snoozeUntil);
      return Object.freeze({
        show: due.length > 0 && !snoozed && state.lastShownDate !== dateText,
        today: dateText,
        periods: due,
        expired: due.some((period) => dateText > period.endDate),
      });
    }

    function markShown(dateText = today()) {
      const state = read();
      return write({ ...state, lastShownDate: dateText });
    }

    function dismiss({ dateText = today(), snoozeDays = 0 } = {}) {
      const state = read();
      return write({
        ...state,
        lastShownDate: dateText,
        snoozeUntil: snoozeDays > 0 ? shiftDateDays(dateText, snoozeDays) : "",
      });
    }

    return Object.freeze({ decision, dismiss, markShown, periods, read, storageKey, today });
  }

  globalScope.ThinkStockApiPeriods = Object.freeze({
    DEFAULT_PERIODS,
    DISPLAY_GROUPS,
    REMINDER_STORAGE_KEY,
    compactPeriodsForDisplay,
    createReminderStore,
    formatPeriodDate,
    formatPeriodRange,
    koreaDateText,
    normalizePeriods,
    periodSignature,
    reminderPeriods,
    shiftDateDays,
    shiftDateMonths,
  });
}(typeof self !== "undefined" ? self : globalThis));
