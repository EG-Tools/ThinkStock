function createAuxiliaryChartApp(scope = globalThis, options = {}) {
  const registry = options.registry;
  const runtimeKey = options.runtimeKey;
  const renderQueueKey = options.renderQueueKey;
  let renderRevision = 0;
  const technicalInputsBySeries = new Map();

  function technicalInputs(ticker) {
    const records = options.getPriceRows?.() || [];
    const volumeSeries = options.getVolumeSeries?.(ticker);
    const sourceRevision = String(options.getPriceSourceRevision?.() || "");
    const cached = technicalInputsBySeries.get(ticker);
    if (sourceRevision && cached?.sourceRevision === sourceRevision) return cached;
    const sourceRows = records.map((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const volume = typeof volumeSeries?.get === "function"
        ? volumeSeries.get(date)
        : volumeSeries?.[date];
      return { date, [ticker]: row?.[ticker], volume };
    });
    const input = {
      dates: sourceRows.map((row) => row.date),
      fingerprints: new Map(),
      prices: sourceRows.map((row) => row[ticker]),
      sourceRevision,
      sourceRows,
      volumes: sourceRows.map((row) => row.volume),
    };
    technicalInputsBySeries.delete(ticker);
    technicalInputsBySeries.set(ticker, input);
    while (technicalInputsBySeries.size > 40) {
      technicalInputsBySeries.delete(technicalInputsBySeries.keys().next().value);
    }
    return input;
  }

  function getMacdModelForSeries(series, buildMacdOscillator) {
    const ticker = String(series || "").toUpperCase();
    if (!options.supportsTechnicalSeries?.(ticker)
      || typeof buildMacdOscillator !== "function") return null;
    const input = technicalInputs(ticker);
    const logicVersion = `technical-v4-obv-disparity-${options.getDisparityDays?.()}`;
    if (!input.fingerprints.has(logicVersion)) {
      input.fingerprints.set(logicVersion, options.fingerprintDatedSeries?.(
        input.sourceRows,
        [ticker, "volume"],
        { tail: 520, logicVersion },
      ));
    }
    const sourceFingerprint = input.fingerprints.get(logicVersion);
    return options.macdModelCache.resolve(ticker, sourceFingerprint, () => buildMacdOscillator({
      dates: input.dates,
      prices: input.prices,
      volumes: input.volumes,
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
    technicalInputsBySeries.clear();
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
