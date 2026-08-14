const SEOUL_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// KRX closures that cannot be derived from weekends or fixed-date rules.
// Historical series dates remain authoritative when callers provide them.
export const KNOWN_KRX_CLOSED_DATES = Object.freeze([
  "2025-01-27",
  "2025-01-28",
  "2025-01-29",
  "2025-01-30",
  "2025-03-03",
  "2025-05-06",
  "2025-10-06",
  "2025-10-07",
  "2025-10-08",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-03-02",
  "2026-05-25",
  "2026-06-03",
  "2026-08-17",
  "2026-09-24",
  "2026-09-25",
  "2026-10-05",
]);

const FIXED_KRX_CLOSED_MONTH_DAYS = Object.freeze([
  "01-01",
  "03-01",
  "05-01",
  "05-05",
  "06-06",
  "08-15",
  "10-03",
  "10-09",
  "12-25",
]);

function normalizeIsoDate(value) {
  const text = String(value || "").slice(0, 10);
  if (!DATE_PATTERN.test(text)) return "";
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text
    ? text
    : "";
}

function normalizedDateSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(normalizeIsoDate).filter(Boolean));
}

function lastWeekdayOfYear(year) {
  let date = `${year}-12-31`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return date;
    date = shiftIsoDate(date, -1);
  }
  return date;
}

function datePartsInTimeZone(date = new Date(), timeZone = SEOUL_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
}

export function koreanDateText(date = new Date()) {
  const parts = datePartsInTimeZone(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftIsoDate(dateText, days) {
  const value = normalizeIsoDate(dateText);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + ((Number(days) || 0) * DAY_MS)).toISOString().slice(0, 10);
}

export function isKoreanTradingDate(dateText, options = {}) {
  const value = normalizeIsoDate(dateText);
  if (!value) return false;
  const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;

  const openDates = normalizedDateSet(options.openDates);
  if (openDates.has(value)) return true;

  const referenceDates = [...normalizedDateSet(options.referenceDates)].sort();
  if (referenceDates.length && value >= referenceDates[0] && value <= referenceDates.at(-1)) {
    return referenceDates.includes(value);
  }

  const closedDates = normalizedDateSet([
    ...KNOWN_KRX_CLOSED_DATES,
    ...(Array.isArray(options.closedDates) ? options.closedDates : []),
  ]);
  if (closedDates.has(value)) return false;
  if (FIXED_KRX_CLOSED_MONTH_DAYS.includes(value.slice(5))) return false;
  if (value === lastWeekdayOfYear(value.slice(0, 4))) return false;
  return true;
}

export function latestKoreanTradingDateOnOrBefore(dateText, options = {}) {
  let value = normalizeIsoDate(dateText);
  if (!value) return "";
  const maximumLookbackDays = Math.max(
    7,
    Math.min(90, Math.round(Number(options.maximumLookbackDays) || 40)),
  );
  for (let attempt = 0; attempt <= maximumLookbackDays; attempt += 1) {
    if (isKoreanTradingDate(value, options)) return value;
    value = shiftIsoDate(value, -1);
  }
  return value;
}

export function latestWeekdayOnOrBefore(dateText) {
  let value = normalizeIsoDate(dateText);
  if (!value) return "";
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return value;
    value = shiftIsoDate(value, -1);
  }
  return value;
}

export function expectedLatestKoreanTradingDate(date = new Date(), options = {}) {
  const closeHour = Math.max(0, Math.min(23, Number(options.closeHour) || 18));
  const closeMinute = Math.max(0, Math.min(59, Number(options.closeMinute) || 0));
  const parts = datePartsInTimeZone(date);
  const minutes = (Number(parts.hour) * 60) + Number(parts.minute);
  const cutoff = (closeHour * 60) + closeMinute;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return latestKoreanTradingDateOnOrBefore(
    minutes >= cutoff ? today : shiftIsoDate(today, -1),
    options,
  );
}

export function isKoreanCurrentPriceWindow(date = new Date(), options = {}) {
  const openHour = Math.max(0, Math.min(23, Number(options.openHour) || 9));
  const openMinute = Math.max(0, Math.min(59, Number(options.openMinute) || 0));
  const closeHour = Math.max(0, Math.min(23, Number(options.closeHour) || 18));
  const closeMinute = Math.max(0, Math.min(59, Number(options.closeMinute) || 0));
  const parts = datePartsInTimeZone(date);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (!isKoreanTradingDate(today, options)) return false;
  const minutes = (Number(parts.hour) * 60) + Number(parts.minute);
  const open = (openHour * 60) + openMinute;
  const close = (closeHour * 60) + closeMinute;
  return minutes >= open && minutes < close;
}

const api = Object.freeze({
  koreanDateText,
  shiftIsoDate,
  isKoreanTradingDate,
  latestKoreanTradingDateOnOrBefore,
  latestWeekdayOnOrBefore,
  expectedLatestKoreanTradingDate,
  isKoreanCurrentPriceWindow,
});

globalThis.ThinkStockMarketCalendar = api;
