import { finiteOrNull as toFinite } from "../../shared/runtime-foundation.mjs";
import { mergeDatedSeriesRows } from "../../shared/series-integrity.mjs";
import { DEFAULT_SERIES_POLICIES } from "./data-health.mjs";
import {
  repairSeriesRows,
  sameDatedRows,
  validateSeriesRows,
} from "./runtime-data-transaction.mjs";

  "use strict";

  const INDEX_POLICIES = Object.freeze({
    "^KS11": Object.freeze({
      minValue: 100,
      maxValue: 15_000,
      rejectZero: true,
      maxRelativeChange: 0.18,
      maxAbsoluteChange: 500,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
    "^KQ11": Object.freeze({
      minValue: 50,
      maxValue: 5_000,
      rejectZero: true,
      maxRelativeChange: 0.22,
      maxAbsoluteChange: 180,
      maxGapDays: 14,
      maxMissingWeekdays: 10,
      scanPoints: 120,
    }),
  });
  const STOCK_PRICE_POLICY = Object.freeze({
    minValue: 0.01,
    maxValue: 1_000_000_000,
    rejectZero: true,
    scanPoints: 120,
  });
  const COMPONENT_KEYS = Object.freeze({
    macro: Object.freeze(["leading_cycle", "news_sentiment"]),
    credit: Object.freeze(["customer_deposit", "kospi_credit", "kosdaq_credit"]),
    adr: Object.freeze(["adr_kospi", "adr_kosdaq", "fear_greed", "vkospi", "vix"]),
    crisis: Object.freeze(["score"]),
  });

  function normalizeTicker(ticker) {
    return String(ticker || "").trim().toUpperCase();
  }

  function policiesFor(keys) {
    return Object.fromEntries((Array.isArray(keys) ? keys : []).flatMap((key) => (
      DEFAULT_SERIES_POLICIES[key]
        ? [[key, DEFAULT_SERIES_POLICIES[key]]]
        : []
    )));
  }

  function gapPoliciesFor(keys) {
    return Object.fromEntries(Object.entries(policiesFor(keys)).filter(([, policy]) => (
      Number.isFinite(Number(policy?.maxMissingWeekdays))
    )));
  }

  function pricePolicyFor(ticker) {
    return INDEX_POLICIES[normalizeTicker(ticker)] || STOCK_PRICE_POLICY;
  }

  function priceRows(payload, ticker) {
    const key = normalizeTicker(ticker);
    return (Array.isArray(payload?.records) ? payload.records : []).flatMap((row) => {
      const value = toFinite(row?.[key]);
      return value === null ? [] : [{ date: String(row?.date || "").slice(0, 10), close: value }];
    });
  }

  function mergePriceRows(currentRows, incomingRows) {
    const byDate = new Map((Array.isArray(currentRows) ? currentRows : []).map((row) => [
      String(row?.date || "").slice(0, 10),
      { date: String(row?.date || "").slice(0, 10), close: toFinite(row?.close) },
    ]));
    (Array.isArray(incomingRows) ? incomingRows : []).forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const close = toFinite(row?.close);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && close !== null) byDate.set(date, { date, close });
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function assertRows(options = {}) {
    const keys = [...new Set((options.keys || []).map(String).filter(Boolean))];
    const input = {
      ...options,
      keys,
      policies: options.policies || policiesFor(keys),
      gapPolicies: options.gapPolicies || gapPoliciesFor(keys),
    };
    const result = options.autoRepair === false
      ? validateSeriesRows(input)
      : repairSeriesRows(input);
    if (result.ok) return result;
    const issue = result.issues?.[0] || result.originalValidation?.issues?.[0];
    const detail = issue
      ? `${issue.key} ${issue.latestDate || issue.date || ""} ${issue.kind}`.trim()
      : result.reason;
    const error = new Error(`${options.label || "runtime data"} validation failed: ${detail}`);
    error.code = "RUNTIME_DATA_REJECTED";
    error.validation = result;
    throw error;
  }

  function validatePricePoints(options = {}) {
    const ticker = normalizeTicker(options.ticker);
    const incomingRows = (Array.isArray(options.incomingPoints) ? options.incomingPoints : []).map((point) => ({
      date: String(point?.date || "").slice(0, 10),
      close: toFinite(point?.close),
    }));
    const currentRows = priceRows(options.currentPayload, ticker);
    const candidateRows = mergePriceRows(currentRows, incomingRows);
    const policy = pricePolicyFor(ticker);
    const isIndex = Boolean(INDEX_POLICIES[ticker]);
    return validateSeriesRows({
      currentRows,
      candidateRows,
      incomingRows,
      keys: ["close"],
      policies: { close: policy },
      gapPolicies: isIndex && Array.isArray(options.referenceDates)
        ? { close: policy }
        : {},
      referenceDates: options.referenceDates,
      gapLookbackDays: 45,
      maximumGapDates: 3,
    });
  }

  function assertPricePoints(options = {}) {
    const result = validatePricePoints(options);
    if (result.ok) return result;
    const ticker = normalizeTicker(options.ticker) || "price";
    const issue = result.issues?.[0];
    const detail = issue
      ? `${issue.kind} ${issue.latestDate || issue.date || ""}`.trim()
      : result.reason;
    const error = new Error(`${ticker} price validation failed: ${detail}`);
    error.code = "RUNTIME_DATA_REJECTED";
    error.validation = result;
    throw error;
  }

  function validateSnapshotComponent(name, value) {
    const component = String(name || "").trim();
    if (component === "price") {
      const payload = value && typeof value === "object" ? value : null;
      if (!payload?.records?.length) return { ok: false, reason: "price-empty", issues: [] };
      const indexDates = [...new Set(payload.records.flatMap((row) => (
        ["^KS11", "^KQ11"].some((ticker) => toFinite(row?.[ticker]) !== null)
          ? [String(row?.date || "").slice(0, 10)]
          : []
      )))].sort();
      const tickers = [...new Set([
        ...(Array.isArray(payload.series) ? payload.series : []),
        "^KS11",
        "^KQ11",
      ].map(normalizeTicker).filter((ticker) => priceRows(payload, ticker).length))];
      for (const ticker of tickers) {
        const result = validatePricePoints({
          ticker,
          currentPayload: { records: [] },
          incomingPoints: priceRows(payload, ticker),
          referenceDates: INDEX_POLICIES[ticker] ? indexDates : undefined,
        });
        if (!result.ok) return { ...result, reason: `${ticker}:${result.reason}` };
      }
      return { ok: tickers.length > 0, reason: tickers.length ? "" : "price-series-empty", issues: [] };
    }

    const keys = COMPONENT_KEYS[component];
    if (!keys) return { ok: true, reason: "", issues: [] };
    const rows = Array.isArray(value) ? value : [];
    if (!rows.length) return { ok: true, reason: "", issues: [] };
    return validateSeriesRows({
      currentRows: [],
      candidateRows: rows,
      incomingRows: rows,
      keys,
      policies: policiesFor(keys),
      gapPolicies: gapPoliciesFor(keys),
    });
  }

  function dateOf(row) {
    return String(row?.date || "").slice(0, 10);
  }

  function sameNumber(left, right) {
    const a = toFinite(left);
    const b = toFinite(right);
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return Math.abs(a - b) <= 1e-9;
  }

  function sortedRows(byDate) {
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function rebaseOwnedSeriesRows(currentRows, stagedRows, ownedKeys) {
    const keys = [...new Set((ownedKeys || []).map(String).filter(Boolean))];
    if (!keys.length) return Array.isArray(stagedRows) ? stagedRows : [];
    const byDate = new Map((Array.isArray(currentRows) ? currentRows : []).flatMap((row) => {
      const date = dateOf(row);
      if (!date) return [];
      const next = { ...row, date };
      keys.forEach((key) => { delete next[key]; });
      return [[date, next]];
    }));
    for (const row of Array.isArray(stagedRows) ? stagedRows : []) {
      const date = dateOf(row);
      if (!date) continue;
      const next = byDate.get(date) || { date };
      keys.forEach((key) => {
        if (Object.hasOwn(row, key)) next[key] = row[key];
      });
      byDate.set(date, next);
    }
    for (const [date, row] of byDate) {
      if (!Object.keys(row).some((key) => key !== "date")) byDate.delete(date);
    }
    return sortedRows(byDate);
  }

  function normalizeDatedRows(rows, keys, options = {}) {
    const valueKeys = Array.isArray(keys) ? keys.filter(Boolean) : [];
    const byDate = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const date = dateOf(row);
      if (!date || (options.requireIsoDate === true && !/^\d{4}-\d{2}-\d{2}$/.test(date))) continue;
      const next = { ...(byDate.get(date) || {}), date };
      for (const key of valueKeys) {
        const value = toFinite(row?.[key]);
        if (value !== null && (options.positiveOnly !== true || value > 0)) {
          next[key] = value;
        } else if (options.includeMissingKeys === true && !Object.hasOwn(next, key)) {
          next[key] = null;
        }
      }
      if (valueKeys.some((key) => {
        const value = toFinite(next[key]);
        return value !== null && (options.positiveOnly !== true || value > 0);
      })) byDate.set(date, next);
    }
    return sortedRows(byDate);
  }

  function normalizeCreditInputRows(rows, keys) {
    return normalizeDatedRows(rows, keys, {
      includeMissingKeys: true,
      positiveOnly: true,
    });
  }

  function mergeDatedSeries(options = {}) {
    const keys = Array.isArray(options.keys) ? options.keys : [];
    if (typeof mergeDatedSeriesRows === "function") {
      const previousByDate = new Map((options.sourceRows || []).flatMap((row) => {
        const date = dateOf(row);
        return date ? [[date, row]] : [];
      }));
      let updated = 0;
      for (const row of options.incomingRows || []) {
        const date = dateOf(row);
        if (!date) continue;
        const previous = previousByDate.get(date) || {};
        for (const key of keys) {
          const value = toFinite(row?.[key]);
          if (value !== null && !sameNumber(previous[key], value)) updated += 1;
        }
      }
      const rows = mergeDatedSeriesRows(
        options.sourceRows,
        options.incomingRows,
        { keys, policies: options.policies },
      );
      return {
        rows,
        updated,
        latestDate: dateOf((options.incomingRows || []).at(-1)),
      };
    }
    const byDate = new Map((options.sourceRows || []).flatMap((row) => {
      const date = dateOf(row);
      return date ? [[date, { ...row, date }]] : [];
    }));
    let updated = 0;
    for (const row of options.incomingRows || []) {
      const date = dateOf(row);
      if (!date) continue;
      const previous = byDate.get(date) || { date };
      for (const key of keys) {
        const value = toFinite(row?.[key]);
        if (value === null) continue;
        if (!sameNumber(previous[key], value)) updated += 1;
        previous[key] = value;
      }
      byDate.set(date, previous);
    }
    return {
      rows: sortedRows(byDate),
      updated,
      latestDate: dateOf((options.incomingRows || []).at(-1)),
    };
  }

  function mergeLeadingCycle(options = {}) {
    const key = options.key || "leading_cycle";
    const latestDate = String(options.latestDate || "").slice(0, 10);
    const replaceStartDate = String(options.replaceStartDate || "").slice(0, 10);
    const byDate = new Map((options.sourceRows || []).flatMap((row) => {
      const date = dateOf(row);
      if (!date) return [];
      const next = { ...row, date };
      if (replaceStartDate && date >= replaceStartDate) delete next[key];
      return [[date, next]];
    }));
    for (const rawDate of options.priceDates || []) {
      const date = String(rawDate || "").slice(0, 10);
      if (date && !byDate.has(date)) byDate.set(date, { date });
    }
    let updated = 0;
    for (const row of options.denseRows || []) {
      const date = dateOf(row);
      const value = toFinite(row?.[key]);
      if (!date || value === null) continue;
      const previous = byDate.get(date) || { date };
      if (!sameNumber(previous[key], value)) updated += 1;
      previous[key] = value;
      byDate.set(date, previous);
    }
    for (const [date, row] of byDate) {
      if (!latestDate || date <= latestDate || toFinite(row[key]) === null) continue;
      row[key] = null;
      updated += 1;
    }
    return { rows: sortedRows(byDate), updated, latestDate };
  }

  function mergeCreditRows(options = {}) {
    const keys = Array.isArray(options.keys) ? options.keys : [];
    const byDate = new Map();
    for (const row of options.sourceRows || []) {
      const date = dateOf(row);
      if (!date) continue;
      const next = { ...row, date };
      for (const key of keys) {
        const value = toFinite(row?.[key]);
        next[key] = value !== null && value > 0 ? value : null;
      }
      byDate.set(date, next);
    }
    let updated = 0;
    for (const row of options.incomingRows || []) {
      const date = dateOf(row);
      if (!date) continue;
      const previous = byDate.get(date) || { date };
      const next = { ...previous, date };
      for (const key of keys) {
        const value = toFinite(row?.[key]);
        next[key] = value !== null ? value : (previous[key] ?? null);
      }
      if (keys.some((key) => !sameNumber(previous[key], next[key]))) updated += 1;
      byDate.set(date, next);
    }
    const rows = sortedRows(byDate);
    return {
      rows,
      updated,
      latestDate: dateOf(rows.at(-1)) || dateOf((options.incomingRows || []).at(-1)),
    };
  }

  function normalizeCrisisRows(rows) {
    const stages = new Set(["stable", "caution", "warning", "crisis"]);
    const numericKeys = [
      "curve", "labor", "credit", "t10y2y", "t10y3m", "t10y1y", "unemployment",
      "initialClaims4w", "creditSpread", "sahm", "fedFunds", "fedFundsChange6m",
      "vkospi", "vkospiChange20", "vix", "vixChange20", "krwUsd", "krwUsdChange20",
    ];
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const date = dateOf(row);
      const score = toFinite(row?.score);
      if (!date || score === null || score < 0 || score > 100) return null;
      const normalized = { date, score: Math.round(score) };
      for (const key of numericKeys) {
        const value = toFinite(row?.[key]);
        if (value !== null) normalized[key] = value;
      }
      normalized.stage = stages.has(row?.stage)
        ? row.stage
        : (score >= 75 ? "crisis" : score >= 50 ? "warning" : score >= 25 ? "caution" : "stable");
      normalized.uninversion = row?.uninversion === true || row?.uninversion === 1;
      return normalized;
    }).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date));
  }

  function medianScaleFactor(existingRows, liveRows, key) {
    const existingByDate = new Map((existingRows || []).flatMap((row) => {
      const date = dateOf(row);
      return date ? [[date, row]] : [];
    }));
    const ratios = (liveRows || []).flatMap((row) => {
      const existingValue = toFinite(existingByDate.get(dateOf(row))?.[key]);
      const liveValue = toFinite(row?.[key]);
      return existingValue !== null && liveValue !== null && liveValue > 0
        ? [existingValue / liveValue]
        : [];
    }).sort((left, right) => left - right);
    if (!ratios.length) return 1;
    const middle = Math.floor(ratios.length / 2);
    const factor = ratios.length % 2
      ? ratios[middle]
      : (ratios[middle - 1] + ratios[middle]) / 2;
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  }

  function scaleRowsToExisting(options = {}) {
    const keys = Array.isArray(options.keys) ? options.keys : [];
    const factors = Object.fromEntries(keys.map((key) => [
      key,
      medianScaleFactor(options.existingRows, options.liveRows, key),
    ]));
    return (options.liveRows || []).map((row) => {
      const out = { date: dateOf(row) };
      for (const key of keys) {
        const value = toFinite(row?.[key]);
        out[key] = value !== null ? value * factors[key] : null;
      }
      return out;
    });
  }

  function createRuntimeSeriesController(options = {}) {
    const creditKeys = Array.isArray(options.creditKeys) ? options.creditKeys : [];
    const getRows = (name) => {
      const rows = options.getRows?.(name);
      return Array.isArray(rows) ? rows : [];
    };
    const commitRows = (name, rows, changedKeys = []) => {
      options.setRows?.(name, rows, changedKeys);
      options.markChanged?.(name, changedKeys);
    };
    const policiesFor = (keys) => options.policiesFor?.(keys) || {};
    const validate = (label, currentRows, candidateRows, incomingRows, keys, validation = {}) => (
      options.validate?.(label, currentRows, candidateRows, incomingRows, keys, validation)
      || { rows: candidateRows }
    );

    function beginTransaction(name) {
      const sourceName = String(name || "").trim();
      let stagedRows = getRows(sourceName);
      const ownedKeys = new Set();
      let changed = false;
      let committed = false;
      return Object.freeze({
        rows: () => stagedRows,
        stage(result, keys, stageOptions = {}) {
          if (committed) throw new Error(`${sourceName} transaction already committed`);
          if (!result?.updated) {
            return { updated: 0, latestDate: result?.latestDate || "" };
          }
          const accepted = validate(
            stageOptions.label || sourceName,
            stagedRows,
            result.rows,
            result.normalized,
            keys,
            stageOptions.validation,
          );
          stagedRows = accepted.rows || result.rows;
          (Array.isArray(keys) ? keys : []).forEach((key) => ownedKeys.add(String(key)));
          changed = true;
          return { updated: result.updated, latestDate: result.latestDate };
        },
        commit() {
          if (committed) return false;
          committed = true;
          if (!changed) return false;
          // Network requests may finish in parallel. Rebase only this transaction's
          // fields so a later commit cannot restore unrelated fields from its old snapshot.
          commitRows(sourceName, rebaseOwnedSeriesRows(
            getRows(sourceName),
            stagedRows,
            [...ownedKeys],
          ), [...ownedKeys]);
          return true;
        },
      });
    }

    function buildLeadingCycleLiveRows(monthlyRows, sourceRows = getRows("macro")) {
      const leadingKey = "leading_cycle";
      const normalized = normalizeDatedRows(monthlyRows, [leadingKey]);
      const priceDates = (options.getPriceDates?.() || []).filter(Boolean);
      if (!normalized.length) {
        return {
          rows: sourceRows,
          normalized,
          updated: 0,
          latestDate: normalized.at(-1)?.date || "",
        };
      }
      const latestDate = normalized.at(-1)?.date || "";
      const publicationDates = normalized.map((row) => row.date).filter(Boolean);
      const targetDates = [...new Set([...priceDates, ...publicationDates])].sort();
      const denseRows = options.buildDenseMacroRows?.(normalized, targetDates, {
        stepColumns: [leadingKey],
      }) || normalized;
      return {
        ...mergeLeadingCycle({
          sourceRows,
          denseRows,
          priceDates,
          latestDate,
          replaceStartDate: normalized[0]?.date || "",
        }),
        normalized,
      };
    }

    function buildDatedLiveRows(liveRows, keys, sourceRows = getRows("macro"), normalizeOptions = {}) {
      const normalized = normalizeDatedRows(liveRows, keys, normalizeOptions);
      if (!normalized.length) {
        return { rows: sourceRows, normalized, updated: 0, latestDate: "" };
      }
      return {
        ...mergeDatedSeries({ sourceRows, incomingRows: normalized, keys }),
        normalized,
      };
    }

    function commitMacroBuild(result, keys, commitOptions = {}) {
      if (!result?.updated) return { updated: 0, latestDate: result?.latestDate || "" };
      const currentRows = getRows("macro");
      const accepted = validate(
        commitOptions.label || "macro",
        currentRows,
        result.rows,
        result.normalized,
        keys,
        commitOptions.validation,
      );
      commitRows("macro", accepted.rows || result.rows, keys);
      return { updated: result.updated, latestDate: result.latestDate };
    }

    function buildCreditLiveRows(
      liveRows,
      sourceRows = getRows("credit"),
      keys = creditKeys,
      buildOptions = {},
    ) {
      const normalized = buildOptions.normalized === true
        ? (Array.isArray(liveRows) ? liveRows : [])
        : normalizeCreditInputRows(liveRows, keys);
      if (!normalized.length) {
        return { rows: sourceRows, normalized, updated: 0, latestDate: "" };
      }
      return {
        ...mergeCreditRows({ sourceRows, incomingRows: normalized, keys }),
        normalized,
      };
    }

    function applyCreditLiveRows(liveRows, keys = creditKeys, label = "credit balance") {
      const currentRows = getRows("credit");
      const result = buildCreditLiveRows(liveRows, currentRows, keys);
      if (!result.updated) return { updated: 0, latestDate: result.latestDate };
      const accepted = validate(
        label,
        currentRows,
        result.rows,
        result.normalized,
        keys,
      );
      commitRows("credit", accepted.rows || result.rows, keys);
      return { updated: result.updated, latestDate: result.latestDate };
    }

    function applyCrisisSignalRows(liveRows) {
      const normalized = normalizeCrisisRows(liveRows);
      if (!normalized.length) return { updated: 0, latestDate: "" };
      const currentRows = getRows("crisis");
      const changed = !sameDatedRows(currentRows, normalized);
      if (changed) {
        const accepted = validate(
          "recession signal",
          currentRows,
          normalized,
          normalized,
          ["score"],
        );
        commitRows("crisis", accepted.rows || normalized, ["score"]);
      }
      return { updated: changed ? 1 : 0, latestDate: normalized.at(-1)?.date || "" };
    }

    function buildAuxiliarySeriesRows(liveRows, key, sourceRows = getRows("adr")) {
      const normalized = normalizeDatedRows(liveRows, [key], {
        positiveOnly: true,
        requireIsoDate: true,
      });
      if (!normalized.length) {
        return { rows: sourceRows, normalized, updated: 0, latestDate: "" };
      }
      return {
        ...mergeDatedSeries({
          sourceRows,
          incomingRows: normalized,
          keys: [key],
          policies: policiesFor([key]),
        }),
        normalized,
      };
    }

    function applyAuxiliarySeriesRows(liveRows, key, label, validationOptions = {}) {
      const currentRows = getRows("adr");
      const result = buildAuxiliarySeriesRows(liveRows, key, currentRows);
      if (!result.normalized.length) return { updated: 0, latestDate: "" };
      if (result.updated) {
        const accepted = validate(
          label,
          currentRows,
          result.rows,
          result.normalized,
          [key],
          // Independently sourced auxiliary series may resume after a provider
          // gap. Validate their values here; the chart owns visual gap breaks.
          { gapPolicies: {}, ...validationOptions },
        );
        commitRows("adr", accepted.rows || result.rows, [key]);
      }
      return { updated: result.updated, latestDate: result.latestDate };
    }

    function scaleCreditRowsToExisting(liveRows, existingRows) {
      const normalized = normalizeCreditInputRows(liveRows, creditKeys);
      if (!normalized.length) return normalized;
      return scaleRowsToExisting({
        existingRows: normalizeCreditInputRows(existingRows, creditKeys),
        liveRows: normalized,
        keys: creditKeys,
      });
    }

    return Object.freeze({
      applyAuxiliarySeriesRows,
      applyCreditLiveRows,
      applyCrisisSignalRows,
      beginTransaction,
      buildAuxiliarySeriesRows,
      applyNewsSentimentLiveRows: (rows) => commitMacroBuild(
        buildDatedLiveRows(rows, ["news_sentiment"]),
        ["news_sentiment"],
        { label: "news sentiment" },
      ),
      buildCreditLiveRows,
      buildLeadingCycleLiveRows,
      buildMacroIndicatorLiveRows: (rows, keys, sourceRows, normalizeOptions = {}) => buildDatedLiveRows(
        rows,
        keys,
        sourceRows,
        { positiveOnly: true, requireIsoDate: true, ...normalizeOptions },
      ),
      buildNewsSentimentLiveRows: (rows, sourceRows) => buildDatedLiveRows(
        rows,
        ["news_sentiment"],
        sourceRows,
      ),
      commitMacroBuild,
      scaleCreditRowsToExisting,
    });
  }

export {
  COMPONENT_KEYS,
  INDEX_POLICIES,
  STOCK_PRICE_POLICY,
  assertPricePoints,
  assertRows,
  createRuntimeSeriesController,
  gapPoliciesFor,
  mergeCreditRows,
  mergeDatedSeries,
  mergeLeadingCycle,
  normalizeCreditInputRows,
  normalizeCrisisRows,
  normalizeDatedRows,
  policiesFor,
  pricePolicyFor,
  priceRows,
  sameNumber as sameNullableNumber,
  scaleRowsToExisting,
  validatePricePoints,
  validateSnapshotComponent,
};
