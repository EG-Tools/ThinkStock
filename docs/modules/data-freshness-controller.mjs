import { escapeHtml } from "../../shared/runtime-foundation.mjs";

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
    [LABELS.leading]: "macro:leading",
    [LABELS.news]: "macro:news",
    [LABELS.credit]: "credit",
    [LABELS.adr]: "adr",
    [LABELS.fearGreed]: "fearGreed",
    [LABELS.volatility]: "volatility",
    [LABELS.crisis]: "crisis",
  });

  function gapPolicies(keys, policy = { maxMissingWeekdays: 10, scanPoints: 120 }) {
    return Object.fromEntries((keys || []).map((key) => [key, policy]));
  }

  function priceSourceLabel(status) {
    if (!status) return "";
    const source = status.source === "NAVER_FALLBACK"
      ? "네이버 보완"
      : (status.source === "KRX" ? "KRX" : "저장본");
    if (status.stale) return `${source} 확인필요`;
    if (status.localCache) return `${source} 저장본`;
    if (status.cached) return `${source} 캐시`;
    return source;
  }

  function renderFreshness(element, items, options = {}) {
    if (!element) return "";
    const labelName = typeof options.labelName === "function"
      ? options.labelName
      : (value) => String(value || "");
    const runtimeStatus = options.priceStatus || null;
    const markup = (Array.isArray(items) ? items : []).map((item) => {
      const itemRuntimeStatus = item.label === LABELS.price ? runtimeStatus : null;
      const classes = [
        "freshness-chip",
        item.isEmpty ? "is-empty" : "",
        item.isStale || itemRuntimeStatus?.stale ? "is-stale" : "",
        itemRuntimeStatus?.localCache || itemRuntimeStatus?.cached ? "is-cache" : "",
        item.anomalies?.length || item.gaps?.length ? "is-anomaly" : "",
      ].filter(Boolean).join(" ");
      const rangeTitle = item.first && item.latest ? `범위: ${item.first} ~ ${item.latest}` : "";
      const staleTitle = item.isStale ? `최신 데이터 확인 필요: ${item.ageDays}일 전` : "";
      const anomalyTitle = item.anomalies?.length
        ? `최근 값 급변 확인 필요: ${item.anomalies.map((entry) => labelName(entry.key)).join(", ")}`
        : "";
      const gapTitle = item.gaps?.length
        ? `데이터 공백 확인 필요: ${item.gaps.map((entry) => `${labelName(entry.key)} ${entry.previousDate}~${entry.latestDate}`).join(", ")}`
        : "";
      const runtimeTitle = itemRuntimeStatus
        ? [
          labelName(itemRuntimeStatus.ticker),
          `출처: ${priceSourceLabel(itemRuntimeStatus)}`,
          itemRuntimeStatus.marketDate ? `KRX 시장 기준일: ${itemRuntimeStatus.marketDate}` : "",
          itemRuntimeStatus.expectedDate ? `예상 거래일: ${itemRuntimeStatus.expectedDate}` : "",
          itemRuntimeStatus.warning,
        ].filter(Boolean).join(" / ")
        : "";
      const title = [rangeTitle, staleTitle, anomalyTitle, gapTitle, runtimeTitle].filter(Boolean).join(" / ");
      const dateText = itemRuntimeStatus?.latestDate || item.date || "없음";
      const sourceText = itemRuntimeStatus ? priceSourceLabel(itemRuntimeStatus) : "";
      const sourceMarkup = sourceText ? `<small>${escapeHtml(sourceText)}</small>` : "";
      return `<span class="${classes}" title="${escapeHtml(title)}"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(dateText)}${sourceMarkup}</span>`;
    }).join("");
    element.innerHTML = markup;
    return markup;
  }

  function summarizeQuality(items, sourceByLabel = {}) {
    const grouped = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const source = String(sourceByLabel[item?.label] || item?.source || item?.label || "").trim();
      if (!source) return;
      const current = grouped.get(source) || {
        firstDate: "",
        latestDate: "",
        isEmpty: true,
        isStale: false,
        anomalyCount: 0,
        gapCount: 0,
      };
      const firstDate = String(item?.first || "").slice(0, 10);
      const latestDate = String(item?.latest || item?.date || "").slice(0, 10);
      if (firstDate && (!current.firstDate || firstDate < current.firstDate)) current.firstDate = firstDate;
      if (latestDate && (!current.latestDate || latestDate > current.latestDate)) current.latestDate = latestDate;
      current.isEmpty = current.isEmpty && item?.isEmpty === true;
      current.isStale = current.isStale || item?.isStale === true;
      current.anomalyCount += Array.isArray(item?.anomalies) ? item.anomalies.length : 0;
      current.gapCount += Array.isArray(item?.gaps) ? item.gaps.length : 0;
      grouped.set(source, current);
    });
    return Object.freeze(Object.fromEntries([...grouped.entries()].map(([source, value]) => [
      source,
      Object.freeze(value),
    ])));
  }

  const dataFreshnessView = Object.freeze({
    render: renderFreshness,
    summarizeQuality,
  });

  function createDataFreshnessController(options = {}) {
    const dataHealth = options.dataHealth;
    const view = options.view || dataFreshnessView;
    const runtimeDataApp = options.runtimeDataApp;
    const labelName = typeof options.labelName === "function"
      ? options.labelName
      : (value) => String(value || "");
    const requestFrame = typeof options.requestFrame === "function"
      ? options.requestFrame
      : (callback) => globalThis.requestAnimationFrame?.(callback)
        ?? globalThis.setTimeout?.(callback, 16)
        ?? 0;
    const cancelFrame = typeof options.cancelFrame === "function"
      ? options.cancelFrame
      : (frameId) => {
        if (typeof globalThis.cancelAnimationFrame === "function") {
          globalThis.cancelAnimationFrame(frameId);
        } else {
          globalThis.clearTimeout?.(frameId);
        }
      };
    const resolveElement = typeof options.resolveElement === "function"
      ? options.resolveElement
      : () => null;
    const resolveModel = typeof options.resolveModel === "function"
      ? options.resolveModel
      : () => ({});
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    if (!dataHealth?.buildFreshnessItems || !view?.render || !view?.summarizeQuality) {
      throw new Error("data freshness controller dependencies are incomplete");
    }
    const policies = dataHealth.DEFAULT_SERIES_POLICIES || {};
    let previousSignature = "";
    let frameId = 0;
    const counters = {
      scheduled: 0,
      coalesced: 0,
      rendered: 0,
      skipped: 0,
    };

    function render(element, model = {}) {
      if (!element) {
        counters.skipped += 1;
        return Object.freeze({ rendered: false, items: [] });
      }
      const signature = String(model.renderSignature || "");
      if (signature && signature === previousSignature) {
        counters.skipped += 1;
        return Object.freeze({ rendered: false, items: [] });
      }
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
      previousSignature = signature;
      const qualityBySource = view.summarizeQuality(items, SOURCE_BY_LABEL);
      Object.entries(qualityBySource).forEach(([source, quality]) => {
        runtimeDataApp?.noteSourceQuality?.(source, { ...quality, revision: signature });
      });
      counters.rendered += 1;
      return Object.freeze({ rendered: true, items, qualityBySource });
    }

    function renderNow(element = resolveElement(), model = resolveModel()) {
      if (frameId) {
        cancelFrame(frameId);
        frameId = 0;
      }
      return render(element, model);
    }

    function schedule() {
      if (frameId) {
        counters.coalesced += 1;
        return false;
      }
      counters.scheduled += 1;
      frameId = requestFrame(() => {
        frameId = 0;
        try { renderNow(); } catch (error) { onError(error); }
      });
      return true;
    }

    function dispose() {
      if (!frameId) return;
      cancelFrame(frameId);
      frameId = 0;
    }

    return Object.freeze({
      dispose,
      render,
      renderNow,
      schedule,
      stats: () => Object.freeze({ ...counters, pending: Boolean(frameId) }),
    });
  }

export {
  LABELS,
  SOURCE_BY_LABEL,
  createDataFreshnessController,
  escapeHtml,
  priceSourceLabel,
  renderFreshness as render,
  summarizeQuality,
};
