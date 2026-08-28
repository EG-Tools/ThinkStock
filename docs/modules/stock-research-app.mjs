"use strict";

import stockResearchContract from "./stock-research-contract.js";

const { CACHE_KEY, CACHE_VARIANTS_KEY, CACHE_BYPASS_KEY, BLOCKED_KEY } = stockResearchContract;

function researchUniverseDescription(value) {
  const perMarket = stockResearchContract.normalizeUniverseSize(value) / 2;
  return `시총 상위 ${perMarket}+${perMarket} 중 상대적 안정성 필터를 통과한 공부 후보입니다. 매수 추천이 아닙니다.`;
}

function createStockResearchApp(scope = globalThis, options = {}) {
  let controller = null;

  function getBlockedCount() {
    try {
      const payload = JSON.parse(scope.localStorage.getItem(BLOCKED_KEY) || "null");
      return Array.isArray(payload?.entries) ? payload.entries.length : 0;
    } catch (_) {
      return 0;
    }
  }

  function syncBlockedButton(count = null) {
    const modalButton = scope.document.getElementById("stockResearchModalBlockedClearBtn");
    if (!modalButton) return;
    let blockedCount = Number(count);
    if (!Number.isFinite(blockedCount)) blockedCount = getBlockedCount();
    modalButton.disabled = blockedCount <= 0;
    modalButton.textContent = blockedCount > 0
      ? `차단 ${blockedCount} 리셋`
      : "차단 0 종목";
  }

  async function ensureController() {
    if (controller) return controller;
    const feature = await options.ensureFeature();
    controller = feature.controller.createController(scope, {
      ...options.controllerOptions(),
      research: feature.research,
      bindOpenButton: false,
      bindSettingsButtons: false,
      onBlockedStateChanged: syncBlockedButton,
    });
    controller.setup();
    return controller;
  }

  function report(prefix, error) {
    options.onError?.(`${prefix}: ${error?.message || error}`);
  }

  async function clearCache(clearOptions = {}) {
    if (controller) return controller.clearCache(clearOptions);
    try {
      scope.localStorage?.removeItem(CACHE_KEY);
      scope.localStorage?.removeItem(CACHE_VARIANTS_KEY);
      scope.localStorage?.removeItem(CACHE_BYPASS_KEY);
    } catch (_) {}
    return true;
  }

  function getUniverseSize() {
    return controller?.getUniverseSize?.()
      ?? stockResearchContract.loadUniverseSize(scope.localStorage);
  }

  function syncUniverseDescription(value = getUniverseSize()) {
    const description = scope.document.getElementById("stockResearchDisclaimer");
    if (description) description.textContent = researchUniverseDescription(value);
  }

  function setUniverseSize(value) {
    const saved = controller?.setUniverseSize?.(value)
      ?? stockResearchContract.saveUniverseSize(scope.localStorage, value);
    syncUniverseDescription(saved);
    return saved;
  }

  function setup() {
    const button = scope.document.getElementById("stockResearchBtn");
    const modalBlockedButton = scope.document.getElementById("stockResearchModalBlockedClearBtn");
    syncBlockedButton();
    syncUniverseDescription();
    button?.addEventListener("click", async () => {
      if (!options.canRun() || button.getAttribute("aria-busy") === "true") return;
      button.setAttribute("aria-busy", "true");
      try {
        await (await ensureController()).open();
      } catch (error) {
        report("종목탐구 준비 오류", error);
      } finally {
        button.setAttribute("aria-busy", "false");
      }
    });
    modalBlockedButton?.addEventListener("click", async () => {
      if (modalBlockedButton.disabled) return;
      try { (await ensureController()).clearBlocked(); }
      catch (error) { report("차단종목 초기화 오류", error); }
    });
  }

  return Object.freeze({
    clearCache,
    ensureController,
    getBlockedCount,
    getUniverseSize,
    setUniverseSize,
    setup,
    syncBlockedButton,
  });
}

export {
  createStockResearchApp,
  researchUniverseDescription,
  stockResearchContract,
};
