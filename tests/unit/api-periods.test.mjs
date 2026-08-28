import assert from "node:assert/strict";
import test from "node:test";
import * as apiPeriods from "../../docs/modules/api-periods.mjs";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("keeps the KRX key and registered service periods in one source", () => {
  const module = apiPeriods;
  assert.equal(module.DEFAULT_PERIODS.length, 12);
  assert.deepEqual(
    { ...module.DEFAULT_PERIODS[0] },
    {
      id: "krx-auth-key",
      name: "KRX API",
      startDate: "2026-04-15",
      endDate: "2027-04-14",
    },
  );
  assert.equal(module.DEFAULT_PERIODS[1].name, "파생상품지수 시세정보");
  assert.equal(module.DEFAULT_PERIODS[1].endDate, "2027-08-11");
  assert.equal(module.DEFAULT_PERIODS[8].name, "한국은행");
  assert.equal(module.formatPeriodRange(module.DEFAULT_PERIODS[8]), "2026/04/19 ~ 2028/04/19");
  assert.equal(module.formatPeriodRange(module.DEFAULT_PERIODS[10]), "기간 제한 없음");
});

test("compacts matching API periods for display without changing reminder sources", () => {
  const module = apiPeriods;
  const compacted = module.compactPeriodsForDisplay(module.DEFAULT_PERIODS);

  assert.equal(module.DEFAULT_PERIODS.length, 12);
  assert.equal(compacted.length, 8);
  assert.deepEqual(
    Array.from(compacted, (period) => period.name),
    [
      "KRX API",
      "파생상품지수 시세정보",
      "코스피·코스닥 지수 시세정보",
      "코스피·코스닥 일별매매정보",
      "코스피·코스닥 종목기본정보",
      "한국은행",
      "금융위원회",
      "DART·FRED",
    ],
  );
  assert.equal(module.formatPeriodRange(compacted[3]), "2026/04/17 ~ 2027/04/16");
  assert.equal(module.formatPeriodRange(compacted[7]), "기간 제한 없음");
});

test("starts reminders one calendar month before expiry and only once per day", () => {
  const storage = createStorage();
  let now = new Date("2027-03-13T03:00:00Z");
  const module = apiPeriods;
  const store = module.createReminderStore(
    { localStorage: storage },
    { now: () => now },
  );

  assert.equal(store.decision().show, false);
  now = new Date("2027-03-14T03:00:00Z");
  assert.equal(store.decision().show, true);
  assert.equal(store.decision().periods[0].name, "KRX API");
  store.markShown();
  assert.equal(store.decision().show, false);
  now = new Date("2027-03-15T03:00:00Z");
  assert.equal(store.decision().show, true);
});

test("seven-day snooze resumes on the eighth calendar date", () => {
  const storage = createStorage();
  let now = new Date("2027-03-14T03:00:00Z");
  const module = apiPeriods;
  const store = module.createReminderStore(
    { localStorage: storage },
    { now: () => now },
  );

  store.dismiss({ snoozeDays: 7 });
  now = new Date("2027-03-20T03:00:00Z");
  assert.equal(store.decision().show, false);
  now = new Date("2027-03-21T03:00:00Z");
  assert.equal(store.decision().show, true);
});

test("renewed period dates ignore the previous reminder state", () => {
  const storage = createStorage();
  const module = apiPeriods;
  const oldStore = module.createReminderStore(
    { localStorage: storage },
    { now: () => new Date("2027-03-20T03:00:00Z") },
  );
  oldStore.dismiss({ snoozeDays: 7 });

  const renewedStore = module.createReminderStore(
    { localStorage: storage },
    {
      now: () => new Date("2027-03-20T03:00:00Z"),
      periods: [{
        id: "krx-auth-key",
        name: "KRX API",
        startDate: "2027-04-15",
        endDate: "2028-04-14",
      }],
    },
  );
  assert.equal(renewedStore.decision().show, false);
  assert.notEqual(renewedStore.read().signature, oldStore.read().signature);
});
