(function initThinkStockDataFreshnessController(globalScope) {
  "use strict";

  const LABELS = Object.freeze({
    price: "\uac00\uaca9",
    leading: "\uc120\ud589",
    news: "\ub274\uc2a4\uc2ec\ub9ac",
    credit: "\uc608\ud0c1\u00b7\uc2e0\uc6a9",
    adr: "ADR",
    fearGreed: "\uacf5\ud3ec\ud0d0\uc695",
    volatility: "\ubcc0\ub3d9\uc131",
    crisis: "\uce68\uccb4\uc2e0\ud638",
  });

  const SOURCE_BY_LABEL = Object.freeze({
    [LABELS.price]: "prices",
    [LABELS.leading]: "macro",
    [LABELS.news]: "macro",
    [LABELS.credit]: "credit",
    [LABELS.adr]: "adr",
    [LABELS.fearGreed]: "adr",
    [LABELS.volatility]: "adr",
    [LABELS.crisis]: "crisis",
  });

  function gapPolicies(keys, policy = { maxMissingWeekdays: 10, scanPoints: 120 }) {
    return Object.fromEntries((keys || []).map((key) => [key, policy]));
  }

  function createDataFreshnessController(options = {}) {
    const dataHealth = options.dataHealth || globalScope.ThinkStockDataHealth;
    const view = options.view || globalScope.ThinkStockDataFreshnessView;
    const runtimeDataApp = options.runtimeDataApp;
    const labelName = typeof options.labelName === "function"
      ? options.labelName
      : (value) => String(value || "");
    if (!dataHealth?.buildFreshnessItems || !view?.render || !view?.summarizeQuality) {
      throw new Error("data freshness controller dependencies are incomplete");
    }
    const policies = dataHealth.DEFAULT_SERIES_POLICIES || {};
    let previousSignature = "";

    function render(element, model = {}) {
      if (!element) return Object.freeze({ rendered: false, items: [] });
      const signature = String(model.renderSignature || "");
      if (signature && signature === previousSignature) {
        return Object.freeze({ rendered: false, items: [] });
      }
      previousSignature = signature;
      const priceKeys = Array.isArray(model.pricePayload?.series) ? model.pricePayload.series : [];
      const creditKeys = Array.isArray(model.creditKeys) ? model.creditKeys : [];
      const adrKeys = Array.isArray(model.adrKeys) ? model.adrKeys : [];
      const fearGreedKeys = Array.isArray(model.fearGreedKeys) ? model.fearGreedKeys : [];
      const volatilityKeys = Array.isArray(model.volatilityKeys) ? model.volatilityKeys : [];
      const items = dataHealth.buildFreshnessItems([
        {
          label: LABELS.price,
          rows: model.pricePayload?.records || [],
          keys: priceKeys,
          gapPolicies: gapPolicies(priceKeys),
        },
        {
          label: LABELS.leading,
          rows: model.macroRows,
          keys: ["leading_cycle"],
          changePolicies: { leading_cycle: policies.leading_cycle },
        },
        {
          label: LABELS.news,
          rows: model.macroRows,
          keys: ["news_sentiment"],
          gapPolicies: gapPolicies(["news_sentiment"]),
          changePolicies: { news_sentiment: policies.news_sentiment },
        },
        {
          label: LABELS.credit,
          rows: model.creditRows,
          keys: creditKeys,
          gapPolicies: gapPolicies(creditKeys),
          changePolicies: {
            customer_deposit: policies.customer_deposit,
            kospi_credit: policies.kospi_credit,
            kosdaq_credit: policies.kosdaq_credit,
          },
        },
        {
          label: LABELS.adr,
          rows: model.adrRows,
          keys: adrKeys,
          gapPolicies: gapPolicies(adrKeys),
          changePolicies: {
            adr_kospi: policies.adr_kospi,
            adr_kosdaq: policies.adr_kosdaq,
          },
        },
        {
          label: LABELS.fearGreed,
          rows: model.adrRows,
          keys: fearGreedKeys,
          gapPolicies: gapPolicies(fearGreedKeys),
          changePolicies: { fear_greed: policies.fear_greed },
        },
        {
          label: LABELS.volatility,
          rows: model.adrRows,
          keys: volatilityKeys,
          gapPolicies: Object.fromEntries(volatilityKeys.map((key) => [key, policies[key]])),
          changePolicies: { vkospi: policies.vkospi, vix: policies.vix },
          gapLookbackDays: 45,
        },
        {
          label: LABELS.crisis,
          rows: model.crisisRows,
          keys: ["score"],
        },
      ]);

      view.render(element, items, { labelName, priceStatus: model.priceStatus });
      const qualityBySource = view.summarizeQuality(items, SOURCE_BY_LABEL);
      Object.entries(qualityBySource).forEach(([source, quality]) => {
        runtimeDataApp?.noteSourceQuality?.(source, { ...quality, revision: signature });
      });
      return Object.freeze({ rendered: true, items, qualityBySource });
    }

    return Object.freeze({ render });
  }

  globalScope.ThinkStockDataFreshnessController = Object.freeze({
    LABELS,
    SOURCE_BY_LABEL,
    createDataFreshnessController,
  });
}(typeof self !== "undefined" ? self : globalThis));
