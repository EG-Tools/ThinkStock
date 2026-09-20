const MARKET_SOURCES = Object.freeze(["indices", "adr", "crisis"]);
const SHARED_SOURCES = Object.freeze(["macro", "credit"]);
export const MARKET_REFRESH_CRON = "5 0-8 * * *";
export const SHARED_REFRESH_CRON = "10 0,8,12 * * *";

export function planScheduledRefresh(scheduledTime, cron) {
  const date = new Date(scheduledTime);
  if (!Number.isFinite(date.getTime())) return [];
  const hour = date.getUTCHours();
  const weekday = date.getUTCDay();
  if (cron === MARKET_REFRESH_CRON && weekday >= 1 && weekday <= 5 && hour <= 8) {
    return MARKET_SOURCES;
  }
  if (cron === SHARED_REFRESH_CRON && weekday >= 1 && weekday <= 5
    && [0, 8, 12].includes(hour)) {
    return SHARED_SOURCES;
  }
  return [];
}

export async function runScheduledRefresh(scheduledTime, cron, tasks, log = console) {
  const sources = planScheduledRefresh(scheduledTime, cron);
  const results = new Array(sources.length);
  let cursor = 0;
  // Reuse a free provider slot without exceeding the two-source limit.
  await Promise.all(Array.from({ length: Math.min(2, sources.length) }, async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      const source = sources[index];
      try {
        const response = await tasks[source]();
        const payload = await response.json();
        const warning = String(payload?.error || payload?.warning || "");
        const componentLatestDates = payload?.componentLatestDates || {};
        const componentWarnings = Array.isArray(payload?.componentWarnings)
          ? payload.componentWarnings.filter(Boolean)
          : [];
        results[index] = {
          source,
          ok: response.ok && payload?.ok === true && payload.stale !== true
            && payload.partial !== true && payload.delayed !== true
            && !warning && !componentWarnings.length,
          latestDate: String(payload?.latestDate || Object.values(componentLatestDates).sort().at(-1) || "")
            .slice(0, 10),
          ...(Object.keys(componentLatestDates).length ? { componentLatestDates } : {}),
          error: response.ok
            ? [warning, ...componentWarnings].filter(Boolean).join(" / ")
            : `HTTP ${response.status}: ${warning || "provider failed"}`,
        };
      } catch (error) {
        results[index] = { source, ok: false, latestDate: "", error: String(error?.message || error) };
      }
    }
  }));
  for (const result of results) {
    const event = JSON.stringify({ event: "scheduled-source-refresh", ...result });
    if (result.ok) log.info(event);
    else log.warn(event);
  }
  return results;
}
