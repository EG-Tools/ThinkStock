function createAuxiliaryChartApp(scope = globalThis, options = {}) {
  const registry = options.registry;
  const runtimeKey = options.runtimeKey;
  const renderQueueKey = options.renderQueueKey;
  let renderRevision = 0;

  function getMacdModelForSeries(series, buildMacdOscillator) {
    const ticker = String(series || "").toUpperCase();
    if (!options.supportsTechnicalSeries?.(ticker)
      || typeof buildMacdOscillator !== "function") return null;
    const records = options.getPriceRows?.() || [];
    const sourceFingerprint = options.fingerprintDatedSeries?.(
      records,
      [ticker],
      {
        tail: 520,
        logicVersion: `macd-v3-disparity-${options.getDisparityDays?.()}`,
      },
    );
    return options.macdModelCache.resolve(ticker, sourceFingerprint, () => buildMacdOscillator({
      dates: records.map((row) => row?.date),
      prices: records.map((row) => row?.[ticker]),
      disparityPeriod: options.getDisparityDays?.(),
    }));
  }

  function getRuntime() {
    return registry.getAsync(runtimeKey, async () => {
      const feature = await options.loadFeature();
      const runtimeModule = feature?.runtime;
      const modelModule = feature?.model;
      const macdModule = feature?.macd;
      if (!runtimeModule?.createAuxiliaryChartRuntime
        || !modelModule
        || typeof macdModule?.buildMacdOscillator !== "function") {
        throw new Error("보조차트 기능 모듈을 불러오지 못했습니다.");
      }
      return runtimeModule.createAuxiliaryChartRuntime(scope, options.createRuntimeOptions({
        feature,
        modelModule,
        macdModule,
        getMacdModelForSeries: (series) => getMacdModelForSeries(
          series,
          macdModule.buildMacdOscillator,
        ),
        scheduleRender,
      }));
    });
  }

  function invalidate() {
    registry.peek(runtimeKey)?.invalidateAdr?.();
  }

  function getRenderQueue() {
    return registry.get(renderQueueKey, () => options.createLatestFrameQueue(scope, {
      apply: async (requests) => {
        const latest = requests.reduce((selected, request) => (
          !selected || Number(request?.revision) > Number(selected?.revision) ? request : selected
        ), null);
        const xRange = Array.isArray(latest?.xRange) ? latest.xRange.slice(0, 2) : null;
        const runtime = await getRuntime();
        let targets = [...new Set(requests.map((request) => String(request?.target || ""))
          .filter(Boolean))];
        if (requests.every((request) => request?.refreshOnly === true)) {
          const refreshTargets = new Set(runtime.viewportRefreshTargets?.(xRange) || []);
          targets = targets.filter((target) => refreshTargets.has(target));
        }
        if (targets.length) await runtime.renderAll(xRange, { targets });
      },
      onError: options.onError,
    }));
  }

  function scheduleRender(xRange = null, scheduleOptions = {}) {
    const targets = Array.isArray(scheduleOptions.targets) && scheduleOptions.targets.length
      ? [...new Set(scheduleOptions.targets.map(String).filter(Boolean))]
      : ["macd", "auxiliary"];
    const revision = renderRevision += 1;
    const range = Array.isArray(xRange) ? xRange.slice(0, 2) : null;
    targets.forEach((target) => getRenderQueue().schedule(target, {
      refreshOnly: scheduleOptions.refreshOnly === true,
      revision,
      target,
      xRange: range,
    }));
    return targets.length > 0;
  }

  async function refreshViewport() {
    const runtime = registry.peek(runtimeKey);
    const xRange = options.getMainRange?.();
    if (!runtime || xRange?.length !== 2) return;
    if (options.scheduleCommittedViewport?.(xRange)) {
      await options.flushCommittedViewport?.();
    }
    const targets = runtime.viewportRefreshTargets?.(xRange) || [];
    if (!targets.length) return;
    scheduleRender(xRange, { targets, refreshOnly: true });
    await getRenderQueue().whenSettled();
  }

  function flushCoMovement() {
    if (!options.isCoMovementVisible?.()) return null;
    return options.getCoMovementRuntime?.()?.flush?.() || null;
  }

  async function refreshCompanions() {
    await refreshViewport();
    await flushCoMovement();
  }

  return Object.freeze({
    flushCoMovement,
    getMacdModelForSeries,
    getRenderQueue,
    getRuntime,
    invalidate,
    refreshCompanions,
    refreshViewport,
    scheduleRender,
  });
}

export { createAuxiliaryChartApp };
