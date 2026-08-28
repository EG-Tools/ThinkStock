import { finiteOrNull as finite } from "../../shared/runtime-foundation.mjs";
import { detectRecentChanges, detectSeriesGaps } from "./data-health.mjs";

  "use strict";

  function isEmptyComparableValue(value) {
    return value === null
      || value === undefined
      || value === ""
      || (typeof value === "number" && !Number.isFinite(value));
  }

  function comparableValuesMatch(left, right, numericStrings = true) {
    if (Object.is(left, right)) return true;
    const leftEmpty = isEmptyComparableValue(left);
    const rightEmpty = isEmptyComparableValue(right);
    if (leftEmpty || rightEmpty) return leftEmpty && rightEmpty;

    if (numericStrings) {
      const leftNumber = typeof left === "number" ? left : Number(String(left).trim());
      const rightNumber = typeof right === "number" ? right : Number(String(right).trim());
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return Object.is(leftNumber, rightNumber);
      }
    }
    return left === right;
  }

  function sameDatedRows(leftRows, rightRows, options = {}) {
    if (leftRows === rightRows) return true;
    const left = Array.isArray(leftRows) ? leftRows : [];
    const right = Array.isArray(rightRows) ? rightRows : [];
    if (left.length !== right.length) return false;
    const numericStrings = options.numericStrings !== false;
    const ignoredKeys = new Set(["date", ...(options.ignoreKeys || [])]);

    for (let index = 0; index < left.length; index += 1) {
      const leftRow = left[index] && typeof left[index] === "object" ? left[index] : {};
      const rightRow = right[index] && typeof right[index] === "object" ? right[index] : {};
      const leftDate = String(leftRow.date || "").slice(0, 10);
      const rightDate = String(rightRow.date || "").slice(0, 10);
      if (leftDate !== rightDate) return false;

      for (const key of Object.keys(leftRow)) {
        if (ignoredKeys.has(key) || isEmptyComparableValue(leftRow[key])) continue;
        if (!comparableValuesMatch(leftRow[key], rightRow[key], numericStrings)) return false;
      }
      for (const key of Object.keys(rightRow)) {
        if (ignoredKeys.has(key) || isEmptyComparableValue(rightRow[key])) continue;
        if (!comparableValuesMatch(leftRow[key], rightRow[key], numericStrings)) return false;
      }
    }
    return true;
  }

  function sameStringSet(leftValues, rightValues) {
    if (leftValues === rightValues) return true;
    const normalize = (values) => new Set(
      (Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean),
    );
    const left = normalize(leftValues);
    const right = normalize(rightValues);
    if (left.size !== right.size) return false;
    for (const value of left) {
      if (!right.has(value)) return false;
    }
    return true;
  }

  function sameRecordMap(leftRecord, rightRecord) {
    if (leftRecord === rightRecord) return true;
    const left = leftRecord && typeof leftRecord === "object" ? leftRecord : {};
    const right = rightRecord && typeof rightRecord === "object" ? rightRecord : {};
    const leftKeys = Object.keys(left).filter((key) => !isEmptyComparableValue(left[key]));
    const rightKeys = Object.keys(right).filter((key) => !isEmptyComparableValue(right[key]));
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => comparableValuesMatch(left[key], right[key], false));
  }

  function samePricePayload(leftPayload, rightPayload) {
    if (leftPayload === rightPayload) return true;
    const left = leftPayload && typeof leftPayload === "object" ? leftPayload : {};
    const right = rightPayload && typeof rightPayload === "object" ? rightPayload : {};
    return sameDatedRows(left.records, right.records)
      && sameStringSet(left.series, right.series)
      && sameRecordMap(left.display_names, right.display_names);
  }

  function selectChangedValue(currentValue, candidateValue, isEqual = Object.is) {
    return isEqual(currentValue, candidateValue)
      ? Object.freeze({ changed: false, value: currentValue })
      : Object.freeze({ changed: true, value: candidateValue });
  }

  function normalizeRuntimeSeedComponents(current = {}) {
    const source = current && typeof current === "object" ? current : {};
    const rawPricePayload = source.pricePayload && typeof source.pricePayload === "object"
      ? source.pricePayload
      : null;
    const records = Array.isArray(rawPricePayload?.records) ? rawPricePayload.records : [];
    const series = Array.isArray(rawPricePayload?.series) ? rawPricePayload.series : [];
    const displayNames = rawPricePayload?.display_names
      && typeof rawPricePayload.display_names === "object"
      && !Array.isArray(rawPricePayload.display_names)
      ? rawPricePayload.display_names
      : {};
    const pricePayload = rawPricePayload
      && records === rawPricePayload.records
      && series === rawPricePayload.series
      && displayNames === rawPricePayload.display_names
      ? rawPricePayload
      : {
        ...(rawPricePayload || {}),
        records,
        series,
        display_names: displayNames,
      };
    return Object.freeze({
      pricePayload,
      macroRows: Array.isArray(source.macroRows) ? source.macroRows : [],
      creditRows: Array.isArray(source.creditRows) ? source.creditRows : [],
      adrRows: Array.isArray(source.adrRows) ? source.adrRows : [],
      disclosureRows: Array.isArray(source.disclosureRows) ? source.disclosureRows : [],
    });
  }

  function mergeRuntimeSeedComponents(options = {}) {
    const current = normalizeRuntimeSeedComponents(options.current);
    const parsed = options.parsed && typeof options.parsed === "object" ? options.parsed : {};
    const operations = options.operations && typeof options.operations === "object" ? options.operations : {};
    const mergeWithExisting = options.mergeWithExisting === true;
    const preserveExisting = options.preserveExisting === true;
    const components = {
      pricePayload: current.pricePayload,
      macroRows: current.macroRows,
      creditRows: current.creditRows,
      adrRows: current.adrRows,
      disclosureRows: current.disclosureRows,
    };
    const changed = [];

    const commit = (name, property, candidate, isEqual) => {
      const selected = selectChangedValue(components[property], candidate, isEqual);
      components[property] = selected.value;
      if (selected.changed) changed.push(name);
    };
    const rowMerger = preserveExisting
      ? operations.mergeRowsPreservingExisting
      : operations.mergeRowsPreferIncoming;

    if (parsed.pricePayload?.records?.length) {
      const candidate = mergeWithExisting
        ? (preserveExisting
          ? operations.mergePricePayloadPreservingExisting(components.pricePayload, parsed.pricePayload)
          : operations.mergePricePayloadPreferIncoming(components.pricePayload, parsed.pricePayload))
        : parsed.pricePayload;
      commit("price", "pricePayload", candidate, samePricePayload);
    }

    if (parsed.macroRows?.length) {
      const candidate = mergeWithExisting
        ? rowMerger(components.macroRows, parsed.macroRows)
        : parsed.macroRows;
      commit("macro", "macroRows", candidate, sameDatedRows);
    }

    if (parsed.creditRows?.length) {
      const candidate = operations.normalizeCreditRows(
        mergeWithExisting
          ? rowMerger(components.creditRows, parsed.creditRows)
          : parsed.creditRows,
      );
      commit("credit", "creditRows", candidate, sameDatedRows);
    }

    let adrCandidate = components.adrRows;
    let hasAdrSeed = false;
    if (parsed.adrRows?.length) {
      adrCandidate = mergeWithExisting
        ? rowMerger(adrCandidate, parsed.adrRows)
        : parsed.adrRows;
      hasAdrSeed = true;
    }
    if (parsed.vkospiRows?.length) {
      adrCandidate = rowMerger(adrCandidate, parsed.vkospiRows);
      hasAdrSeed = true;
    }
    if (hasAdrSeed) commit("adr", "adrRows", adrCandidate, sameDatedRows);

    if (parsed.disclosurePayload && parsed.disclosurePayload.format !== "by-ticker-v1") {
      const seededRows = operations.sanitizeDisclosureRows(parsed.disclosureRows || []);
      const candidate = mergeWithExisting
        ? operations.mergeDisclosureRows(components.disclosureRows, seededRows)
        : seededRows;
      commit(
        "disclosure",
        "disclosureRows",
        candidate,
        (left, right) => sameDatedRows(left, right, { numericStrings: false }),
      );
    }

    return Object.freeze({
      changed: Object.freeze(changed),
      components: Object.freeze(components),
    });
  }

  function seriesStats(rows, key) {
    let first = "";
    let latest = "";
    let count = 0;
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || finite(row?.[key]) === null) return;
      count += 1;
      if (!first || date < first) first = date;
      if (!latest || date > latest) latest = date;
    });
    return { first, latest, count };
  }

  function anomalyKey(issue) {
    return [issue?.key, issue?.kind, issue?.previousDate || "", issue?.latestDate || ""].join(":");
  }

  function summarizeSeriesQuality(rows, keys = [], detail = {}) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const sourceKeys = [...new Set((keys || []).map(String).filter(Boolean))];
    const series = Object.freeze(Object.fromEntries(sourceKeys.map((key) => [
      key,
      Object.freeze(seriesStats(sourceRows, key)),
    ])));
    const covered = Object.values(series).filter((value) => value.count > 0);
    const firstDate = covered.reduce((first, value) => (
      !first || value.first < first ? value.first : first
    ), "");
    const latestDate = covered.reduce((latest, value) => (
      value.latest > latest ? value.latest : latest
    ), "");
    return Object.freeze({
      firstDate,
      latestDate,
      isEmpty: covered.length === 0,
      isStale: detail.isStale === true,
      anomalyCount: Math.max(0, Number(detail.anomalyCount) || 0),
      gapCount: Math.max(0, Number(detail.gapCount) || 0),
      revision: String(detail.revision || "").slice(0, 120),
      series,
    });
  }

  function incomingValueIssues(rows, policies) {
    const issues = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      Object.entries(policies || {}).forEach(([key, policy]) => {
        const value = finite(row?.[key]);
        if (value === null) return;
        const rejectedZero = policy?.rejectZero === true && value === 0;
        const belowMinimum = Number.isFinite(policy?.minValue) && value < Number(policy.minValue);
        const aboveMaximum = Number.isFinite(policy?.maxValue) && value > Number(policy.maxValue);
        if (!rejectedZero && !belowMinimum && !aboveMaximum) return;
        issues.push({
          key,
          kind: rejectedZero ? "zero" : "range",
          latestDate: date,
          latestValue: value,
        });
      });
    });
    return issues;
  }

  function duplicateDateIssues(rows, keys) {
    const seen = new Map();
    const issues = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const values = seen.get(date) || new Map();
      (Array.isArray(keys) ? keys : []).forEach((key) => {
        const value = finite(row?.[key]);
        if (value === null) return;
        if (values.has(key) && values.get(key) !== value) {
          issues.push({ key, kind: "duplicate-conflict", latestDate: date, latestValue: value });
        } else {
          values.set(key, value);
        }
      });
      seen.set(date, values);
    });
    return issues;
  }

  function validateSeriesRows(options = {}) {
    const currentRows = Array.isArray(options.currentRows) ? options.currentRows : [];
    const candidateRows = Array.isArray(options.candidateRows) ? options.candidateRows : [];
    const incomingRows = Array.isArray(options.incomingRows) ? options.incomingRows : [];
    const keys = [...new Set((options.keys || []).map(String).filter(Boolean))];
    const policies = options.policies || {};
    const gapPolicies = options.gapPolicies || {};
    const allowLatestRegression = new Set(options.allowLatestRegressionKeys || []);
    const allowCountDecrease = new Set(options.allowCountDecreaseKeys || []);
    const quality = (detail = {}) => summarizeSeriesQuality(candidateRows, keys, detail);

    if (!candidateRows.length && currentRows.length) {
      return { ok: false, reason: "candidate-empty", issues: [], quality: quality() };
    }

    const duplicateIssues = duplicateDateIssues(candidateRows, keys);
    if (duplicateIssues.length) {
      return {
        ok: false,
        reason: "duplicate-date-conflict",
        issues: duplicateIssues,
        quality: quality({ anomalyCount: duplicateIssues.length }),
      };
    }

    const directIssues = incomingValueIssues(incomingRows, policies);
    if (directIssues.length) {
      return {
        ok: false,
        reason: "incoming-range",
        issues: directIssues,
        quality: quality({ anomalyCount: directIssues.length }),
      };
    }

    const beforeIssues = detectRecentChanges(currentRows, policies);
    const afterIssues = detectRecentChanges(candidateRows, policies);
    const beforeKeys = new Set(beforeIssues.map(anomalyKey));
    const introducedIssues = afterIssues.filter((issue) => !beforeKeys.has(anomalyKey(issue)));
    if (introducedIssues.length) {
      return {
        ok: false,
        reason: "introduced-anomaly",
        issues: introducedIssues,
        quality: quality({ anomalyCount: afterIssues.length }),
      };
    }

    const gapOptions = {
      excludeDates: options.excludeDates,
      lookbackDays: options.gapLookbackDays,
      maxDates: options.maximumGapDates,
      referenceDates: options.referenceDates,
    };
    const beforeGaps = detectSeriesGaps(currentRows, gapPolicies, gapOptions);
    const afterGaps = detectSeriesGaps(candidateRows, gapPolicies, gapOptions);
    const beforeGapKeys = new Set(beforeGaps.map(anomalyKey));
    const introducedGaps = afterGaps.filter((issue) => !beforeGapKeys.has(anomalyKey(issue)));
    if (introducedGaps.length) {
      return {
        ok: false,
        reason: "introduced-gap",
        issues: introducedGaps,
        quality: quality({ anomalyCount: afterIssues.length, gapCount: afterGaps.length }),
      };
    }

    for (const key of keys) {
      const before = seriesStats(currentRows, key);
      const after = seriesStats(candidateRows, key);
      if (before.count > 0 && after.count === 0) {
        return { ok: false, reason: `series-lost:${key}`, issues: [], quality: quality() };
      }
      if (before.latest && after.latest < before.latest && !allowLatestRegression.has(key)) {
        return { ok: false, reason: `latest-regressed:${key}`, issues: [], quality: quality() };
      }
      if (before.count > after.count && !allowCountDecrease.has(key)) {
        return { ok: false, reason: `coverage-regressed:${key}`, issues: [], quality: quality() };
      }
    }

    return {
      ok: true,
      reason: "",
      issues: [],
      quality: quality({ anomalyCount: afterIssues.length, gapCount: afterGaps.length }),
    };
  }

  function issueDate(issue) {
    return String(issue?.date || issue?.latestDate || "").slice(0, 10);
  }

  function repairSeriesRows(options = {}, failedValidation = null) {
    const validation = failedValidation || validateSeriesRows(options);
    const candidateRows = Array.isArray(options.candidateRows) ? options.candidateRows : [];
    if (validation.ok) {
      return {
        ...validation,
        rows: candidateRows,
        repaired: false,
        repair: Object.freeze({ attempted: false, quarantined: [], unresolvedDates: [] }),
      };
    }

    const currentRows = Array.isArray(options.currentRows) ? options.currentRows : [];
    const incomingRows = Array.isArray(options.incomingRows) ? options.incomingRows : [];
    const keys = [...new Set((options.keys || []).map(String).filter(Boolean))];
    const currentByDate = new Map(currentRows.map((row) => [String(row?.date || "").slice(0, 10), row]));
    const candidateByDate = new Map(candidateRows.map((row) => [
      String(row?.date || "").slice(0, 10),
      { ...row, date: String(row?.date || "").slice(0, 10) },
    ]));
    const quarantined = [];
    const unresolvedDates = new Set();
    const blocked = new Set();

    const restoreField = (date, key, kind) => {
      if (!date || !key) return;
      const candidate = candidateByDate.get(date) || { date };
      const previous = currentByDate.get(date);
      const previousValue = finite(previous?.[key]);
      if (previousValue === null) delete candidate[key];
      else candidate[key] = previousValue;
      const hasValue = Object.entries(candidate).some(([name, value]) => (
        name !== "date" && finite(value) !== null
      ));
      if (hasValue) candidateByDate.set(date, candidate);
      else candidateByDate.delete(date);
      blocked.add(`${date}|${key}`);
      quarantined.push(Object.freeze({ date, key, kind: String(kind || validation.reason) }));
    };

    for (const issue of validation.issues || []) {
      const date = issueDate(issue);
      const key = String(issue?.key || "");
      if (issue?.kind === "missing-date") {
        const previous = currentByDate.get(date);
        if (previous) candidateByDate.set(date, { ...previous });
        else unresolvedDates.add(date);
        continue;
      }
      restoreField(date, key, issue?.kind);
    }

    const regressedKey = String(validation.reason || "").split(":")[1] || "";
    if (/^(?:series-lost|latest-regressed|coverage-regressed):/.test(validation.reason) && regressedKey) {
      currentRows.forEach((row) => {
        const date = String(row?.date || "").slice(0, 10);
        const value = finite(row?.[regressedKey]);
        if (!date || value === null) return;
        const candidate = candidateByDate.get(date) || { date };
        if (finite(candidate[regressedKey]) === null) candidate[regressedKey] = value;
        candidateByDate.set(date, candidate);
      });
    }

    const repairedRows = [...candidateByDate.values()]
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")))
      .sort((left, right) => left.date.localeCompare(right.date));
    const repairedIncoming = incomingRows.map((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const next = { ...row, date };
      keys.forEach((key) => {
        if (blocked.has(`${date}|${key}`)) delete next[key];
      });
      return next;
    });
    const repairedValidation = validateSeriesRows({
      ...options,
      candidateRows: repairedRows,
      incomingRows: repairedIncoming,
    });
    return {
      ...repairedValidation,
      rows: repairedRows,
      repaired: repairedValidation.ok && quarantined.length > 0,
      repair: Object.freeze({
        attempted: true,
        quarantined: Object.freeze(quarantined),
        unresolvedDates: Object.freeze([...unresolvedDates].sort()),
      }),
      originalValidation: validation,
    };
  }

  function assertSeriesRows(options = {}) {
    const result = validateSeriesRows(options);
    if (result.ok) return result;
    const issue = result.issues?.[0];
    const detail = issue
      ? `${issue.key} ${issue.latestDate || ""} ${issue.kind}`.trim()
      : result.reason;
    const error = new Error(`${options.label || "runtime data"} validation failed: ${detail}`);
    error.code = "RUNTIME_DATA_REJECTED";
    error.validation = result;
    throw error;
  }

export {
  assertSeriesRows,
  duplicateDateIssues,
  mergeRuntimeSeedComponents,
  normalizeRuntimeSeedComponents,
  repairSeriesRows,
  sameDatedRows,
  samePricePayload,
  sameRecordMap,
  sameStringSet,
  selectChangedValue,
  seriesStats,
  summarizeSeriesQuality,
  validateSeriesRows,
};
