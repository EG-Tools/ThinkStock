const SEOUL_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const value = String(dateText || "").slice(0, 10);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp + ((Number(days) || 0) * DAY_MS)).toISOString().slice(0, 10);
}

export function latestWeekdayOnOrBefore(dateText) {
  let value = String(dateText || "").slice(0, 10);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const date = new Date(`${value}T00:00:00Z`);
    const weekday = date.getUTCDay();
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
  return latestWeekdayOnOrBefore(minutes >= cutoff ? today : shiftIsoDate(today, -1));
}

const api = Object.freeze({
  koreanDateText,
  shiftIsoDate,
  latestWeekdayOnOrBefore,
  expectedLatestKoreanTradingDate,
});

globalThis.ThinkStockMarketCalendar = api;
