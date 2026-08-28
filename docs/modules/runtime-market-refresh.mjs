"use strict";

  function componentResult(result = {}, error = null) {
    if (error) {
      return Object.freeze({
        ok: false,
        error: String(error?.message || error || "refresh failed").slice(0, 300),
        latestDate: "",
        updated: 0,
      });
    }
    return Object.freeze({
      ok: true,
      latestDate: String(result?.latestDate || "").slice(0, 10),
      updated: Math.max(0, Number(result?.updated) || 0),
      isEmpty: !String(result?.latestDate || "").slice(0, 10),
    });
  }

  function createRuntimeMarketRefresh(options = {}) {
    const gateway = options.gateway;
    const getSeriesController = options.getSeriesController;
    if (!gateway || typeof getSeriesController !== "function") {
      throw new Error("runtime market refresh dependencies are incomplete");
    }
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 12000);
    const creditKeys = Object.freeze([...(options.creditKeys || [])]);
    const vkospiSeries = Object.freeze([...(options.vkospiSeries || ["vkospi"])]);
    const vixSeries = Object.freeze([...(options.vixSeries || ["vix"])]);
    const canFetchProtected = () => options.isLocal === true || options.canUseGateway?.() === true;
    const policiesFor = (keys) => options.policiesFor?.(keys) || {};

    function applyVolatilityRows(liveRows, key, label, seriesKeys, validation = {}) {
      return getSeriesController().applyAuxiliarySeriesRows(liveRows, key, label, {
        gapPolicies: policiesFor(seriesKeys),
        gapLookbackDays: 45,
        ...validation,
      });
    }

    function applyVkospiRows(liveRows) {
      const referenceDates = (options.getPricePayload?.()?.records || []).flatMap((row) => (
        Number.isFinite(Number(row?.["^KS11"])) ? [String(row.date || "").slice(0, 10)] : []
      ));
      return applyVolatilityRows(liveRows, "vkospi", "VKOSPI", vkospiSeries, { referenceDates });
    }

    function applyVixRows(liveRows) {
      return applyVolatilityRows(liveRows, "vix", "VIX", vixSeries);
    }

    async function refreshMacro(signal = null, forceNetwork = false) {
      if (!canFetchProtected()) return { applied: [], warnings: [], components: {} };
      const payload = await gateway.fetchMacro({ signal, forceNetwork, timeoutMs });
      const controller = getSeriesController();
      const applied = [];
      const warnings = [
        ...(payload.warning ? [payload.warning] : []),
        ...(Array.isArray(payload.componentWarnings) ? payload.componentWarnings : []),
      ];
      const latestDates = [];
      const failures = [];
      const components = {};
      let attempted = 0;
      let accepted = 0;

      const applyComponent = (component, rows, build, keys, label, displayLabel, validation = {}) => {
        if (!Array.isArray(rows) || !rows.length) return;
        attempted += 1;
        try {
          const result = controller.commitMacroBuild(build(rows), keys, { label, validation });
          accepted += 1;
          components[component] = componentResult(result);
          if (result.latestDate) latestDates.push(result.latestDate);
          if (result.updated) applied.push(`${displayLabel} ${result.updated}건 반영(~ ${result.latestDate})`);
        } catch (error) {
          failures.push(error);
          components[component] = componentResult(null, error);
          warnings.push(`${displayLabel}은 이전 값 유지: ${error.message}`);
        }
      };

      applyComponent("macro:leading", payload.leadingRows,
        (rows) => controller.buildLeadingCycleLiveRows(rows), ["leading_cycle"],
        "leading cycle", "선행순환변동", {
          allowLatestRegressionKeys: ["leading_cycle"],
          allowCountDecreaseKeys: ["leading_cycle"],
        });
      applyComponent("macro:news", payload.newsRows,
        (rows) => controller.buildNewsSentimentLiveRows(rows), ["news_sentiment"],
        "news sentiment", "뉴스심리");
      applyComponent("macro:policyRate", payload.policyRateRows,
        (rows) => controller.buildMacroIndicatorLiveRows(rows, ["policy_rate"]), ["policy_rate"],
        "policy rate", "기준금리");
      applyComponent("macro:trade:export", payload.tradeRows,
        (rows) => controller.buildMacroIndicatorLiveRows(rows, ["export_value"]), ["export_value"],
        "exports", "수출");
      applyComponent("macro:trade:import", payload.tradeRows,
        (rows) => controller.buildMacroIndicatorLiveRows(rows, ["import_value"]), ["import_value"],
        "imports", "수입");

      if (attempted > 0 && accepted === 0 && failures.length) throw failures[0];
      return {
        applied,
        warnings,
        components: Object.freeze(components),
        latestDate: latestDates.sort().at(-1) || "",
      };
    }

    async function refreshCredit(signal = null, forceNetwork = false) {
      if (!canFetchProtected()) return { applied: [], warnings: [], components: {} };
      const payload = await gateway.fetchCredit({ signal, forceNetwork, timeoutMs });
      const controller = getSeriesController();
      const scaledRows = controller.scaleCreditRowsToExisting(
        payload.rows,
        options.getCreditRows?.() || [],
      );
      const labels = {
        customer_deposit: "고객예탁금",
        kospi_credit: "코스피 신용",
        kosdaq_credit: "코스닥 신용",
      };
      const warnings = [
        ...(payload.warning ? [payload.warning] : []),
        ...(Array.isArray(payload.componentWarnings) ? payload.componentWarnings : []),
      ];
      const latestDates = [];
      const failures = [];
      const components = {};
      let updated = 0;
      let accepted = 0;
      for (const key of creditKeys) {
        try {
          const result = controller.applyCreditLiveRows(scaledRows, [key], labels[key]);
          accepted += 1;
          updated += result.updated;
          components[`credit:${key}`] = componentResult(result);
          if (result.latestDate) latestDates.push(result.latestDate);
        } catch (error) {
          failures.push(error);
          components[`credit:${key}`] = componentResult(null, error);
          warnings.push(`${labels[key]}은 이전 값 유지: ${error.message}`);
        }
      }
      if (!accepted && failures.length) throw failures[0];
      const latestDate = latestDates.sort().at(-1) || "";
      return {
        applied: updated ? [`신용·예탁금 ${updated}건 반영(~ ${latestDate})`] : [],
        warnings,
        components: Object.freeze(components),
        latestDate,
      };
    }

    async function refreshCrisis(signal = null, forceNetwork = false) {
      const payload = await gateway.fetchCrisisSignal({ signal, forceNetwork, timeoutMs });
      const controller = getSeriesController();
      const applied = [];
      const warnings = [
        ...(payload.warning ? [payload.warning] : []),
        ...(Array.isArray(payload.componentWarnings) ? payload.componentWarnings : []),
      ];
      const latestDates = [];
      const failures = [];
      const components = {};
      let accepted = 0;
      const applyComponent = (component, task, displayLabel) => {
        try {
          const result = task();
          accepted += 1;
          components[component] = componentResult(result);
          if (result.latestDate) latestDates.push(result.latestDate);
          if (result.updated) applied.push(`${displayLabel} ${result.updated}건 반영(~ ${result.latestDate})`);
        } catch (error) {
          failures.push(error);
          components[component] = componentResult(null, error);
          warnings.push(`${displayLabel}는 이전 값 유지: ${error.message}`);
        }
      };

      applyComponent("crisis:signal", () => controller.applyCrisisSignalRows(payload.records), "침체 위기신호");
      applyComponent("volatility:vkospi", () => applyVkospiRows(payload.vkospiRows), "VKOSPI");
      applyComponent("volatility:vix", () => applyVixRows(payload.vixRows), "VIX");
      if (!accepted && failures.length) throw failures[0];
      return {
        applied,
        warnings,
        components: Object.freeze(components),
        latestDate: latestDates.sort().at(-1) || "",
      };
    }

    return Object.freeze({
      applyVixRows,
      applyVkospiRows,
      refreshCredit,
      refreshCrisis,
      refreshMacro,
    });
  }

export {
  componentResult,
  createRuntimeMarketRefresh,
};
