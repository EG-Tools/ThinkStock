(function initThinkStockAiScenarioPaths(globalScope) {
  "use strict";

  const EPSILON = 1e-9;
  const ROLES = Object.freeze(["upside", "sideways", "downside"]);
  const PATTERNS = Object.freeze({
    steady_up: Object.freeze({ label: "완만한 상승", shortLabel: "완만한 상승" }),
    dip_then_rise: Object.freeze({ label: "하락 후 상승", shortLabel: "하락→상승" }),
    sideways_then_rise: Object.freeze({ label: "횡보 후 상승", shortLabel: "횡보→상승" }),
    surge_then_hold: Object.freeze({ label: "급등 후 횡보", shortLabel: "급등→횡보" }),
    rise_then_pullback: Object.freeze({ label: "상승 후 조정", shortLabel: "상승→조정" }),
    rise_then_fall: Object.freeze({ label: "상승 후 하락", shortLabel: "상승→하락" }),
    sideways_then_fall: Object.freeze({ label: "횡보 후 하락", shortLabel: "횡보→하락" }),
    drop_then_hold: Object.freeze({ label: "하락 후 횡보", shortLabel: "하락→횡보" }),
    steady_down: Object.freeze({ label: "완만한 하락", shortLabel: "완만한 하락" }),
    drop_then_rebound: Object.freeze({ label: "급락 후 반등", shortLabel: "급락→반등" }),
    rise_then_hold: Object.freeze({ label: "상승 후 횡보", shortLabel: "상승→횡보" }),
    drop_then_recover: Object.freeze({ label: "하락 후 회복", shortLabel: "하락→회복" }),
    overheat_rebound: Object.freeze({ label: "급락 후 재반등", shortLabel: "급락→재반등" }),
    overheat_range: Object.freeze({ label: "급락 후 박스권 복귀", shortLabel: "급락→박스권" }),
    overheat_drift: Object.freeze({ label: "급락 후 완만한 하락", shortLabel: "급락→완만한 하락" }),
    washout_rebound: Object.freeze({ label: "급반등 후 상승", shortLabel: "급반등→상승" }),
    washout_range: Object.freeze({ label: "급반등 후 횡보", shortLabel: "급반등→횡보" }),
    washout_retest: Object.freeze({ label: "급반등 후 재하락", shortLabel: "급반등→재하락" }),
    range: Object.freeze({ label: "박스권 횡보", shortLabel: "박스권" }),
  });

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function standardDeviation(values) {
    if (values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
      / (values.length - 1));
  }

  function weightedMedian(items) {
    const sorted = items
      .filter((item) => Number.isFinite(item.value) && item.weight > 0)
      .sort((left, right) => left.value - right.value);
    if (!sorted.length) return 0;
    const total = sorted.reduce((sum, item) => sum + item.weight, 0);
    let accumulated = 0;
    for (const item of sorted) {
      accumulated += item.weight;
      if (accumulated >= total / 2) return item.value;
    }
    return sorted.at(-1).value;
  }

  function smoothPath(values, passes = 2) {
    let output = values.slice();
    for (let pass = 0; pass < passes; pass += 1) {
      output = output.map((value, index) => {
        if (index === 0 || index === output.length - 1) return value;
        return (output[index - 1] * 0.2) + (value * 0.6) + (output[index + 1] * 0.2);
      });
    }
    return output;
  }

  function interpolateAnchors(anchors, day) {
    for (let index = 1; index < anchors.length; index += 1) {
      if (day > anchors[index].day) continue;
      const left = anchors[index - 1];
      const right = anchors[index];
      const position = (day - left.day) / Math.max(1, right.day - left.day);
      const eased = position * position * (3 - (2 * position));
      return left.value + ((right.value - left.value) * eased);
    }
    return anchors.at(-1)?.value || 0;
  }

  function pathValueAt(values, ratio) {
    const index = clamp(Math.round((values.length - 1) * ratio), 0, values.length - 1);
    return values[index];
  }

  function classifyHistoricalPath(values, flatBand = 0.06) {
    const path = (Array.isArray(values) ? values : []).map(finite);
    if (path.length < 8 || path.some((value) => value === null)) return null;
    const endpoint = path.at(-1);
    const changes = path.slice(1).map((value, index) => value - path[index]);
    const pathScale = Math.max(
      flatBand,
      standardDeviation(changes) * Math.sqrt(path.length - 1),
      0.025,
    );
    let peak = { value: path[0], index: 0 };
    let trough = { value: path[0], index: 0 };
    path.forEach((value, index) => {
      if (value > peak.value) peak = { value, index };
      if (value < trough.value) trough = { value, index };
    });
    const horizon = Math.max(1, path.length - 1);
    const early = pathValueAt(path, 0.25);
    const middle = pathValueAt(path, 0.5);
    const late = pathValueAt(path, 0.75);
    const significant = Math.max(flatBand * 0.7, pathScale * 0.45);
    const role = endpoint > flatBand
      ? "upside"
      : (endpoint < -flatBand ? "downside" : "sideways");
    let key = role === "upside" ? "steady_up" : (role === "downside" ? "steady_down" : "range");

    if (role === "upside") {
      if (
        trough.index <= horizon * 0.55
        && trough.value <= -significant
        && endpoint - trough.value >= significant * 1.35
      ) key = "dip_then_rise";
      else if (
        peak.index <= horizon * 0.5
        && peak.value >= Math.max(endpoint * 1.12, significant * 1.5)
        && Math.abs(endpoint - late) <= significant * 0.8
      ) key = "surge_then_hold";
      else if (Math.abs(middle) <= significant * 0.65 && endpoint - middle >= significant) {
        key = "sideways_then_rise";
      } else if (
        peak.index >= horizon * 0.35
        && peak.value - endpoint >= significant * 0.65
      ) {
        key = "rise_then_pullback";
      }
    } else if (role === "downside") {
      if (
        peak.index <= horizon * 0.65
        && peak.value >= significant
        && peak.value - endpoint >= significant * 1.35
      ) key = "rise_then_fall";
      else if (Math.abs(middle) <= significant * 0.65 && middle - endpoint >= significant) {
        key = "sideways_then_fall";
      } else if (
        trough.index <= horizon * 0.6
        && Math.abs(endpoint - trough.value) <= significant * 0.7
        && Math.abs(endpoint - late) <= significant * 0.65
      ) key = "drop_then_hold";
      else if (
        trough.index <= horizon * 0.85
        && endpoint - trough.value >= significant * 0.65
      ) key = "drop_then_rebound";
    } else if (
      peak.value >= significant * 1.25
      && peak.index <= horizon * 0.7
      && peak.value - endpoint >= significant
    ) {
      key = peak.index <= horizon * 0.4 && Math.abs(endpoint - late) <= significant * 0.75
        ? "rise_then_hold"
        : "rise_then_fall";
    } else if (
      trough.value <= -significant * 1.25
      && trough.index <= horizon * 0.7
      && endpoint - trough.value >= significant
    ) {
      key = Math.abs(endpoint - late) <= significant * 0.75
        ? "drop_then_hold"
        : "drop_then_recover";
    }

    return {
      role,
      key,
      endpoint,
      early,
      middle,
      late,
      peak: peak.value,
      peakDay: peak.index,
      trough: trough.value,
      troughDay: trough.index,
      pathScale,
    };
  }

  function buildHistoricalPathLibrary({
    prices,
    candidates,
    horizon = 126,
    projectedVolatility = 0.01,
  } = {}) {
    const sourcePrices = Array.isArray(prices) ? prices.map(finite) : [];
    const flatBand = clamp(projectedVolatility * Math.sqrt(horizon) * 0.35, 0.05, 0.1);
    const groups = Object.fromEntries(ROLES.map((role) => [role, {}]));
    let sampleCount = 0;
    (Array.isArray(candidates) ? candidates : []).forEach((candidate, rank) => {
      const anchor = Number(candidate?.sample?.anchor ?? candidate?.anchor);
      if (!Number.isInteger(anchor) || anchor < 0 || anchor + horizon >= sourcePrices.length) return;
      const basePrice = sourcePrices[anchor];
      if (!(basePrice > 0)) return;
      const values = [];
      for (let day = 0; day <= horizon; day += 1) {
        const price = sourcePrices[anchor + day];
        if (!(price > 0)) return;
        values.push(Math.log(price / basePrice));
      }
      const descriptor = classifyHistoricalPath(values, flatBand);
      if (!descriptor) return;
      const distance = Math.max(0, finite(candidate?.distance) ?? (rank / 10));
      const rankWeight = 1 / (1 + (rank * 0.035));
      const weight = clamp(1 / Math.max(0.2, distance), 0.2, 5) * rankWeight;
      const endpoint = values.at(-1);
      const residual = values.map((value, day) => value - (endpoint * (day / horizon)));
      const bucket = groups[descriptor.role][descriptor.key]
        || (groups[descriptor.role][descriptor.key] = []);
      bucket.push({ anchor, descriptor, distance, residual, weight });
      sampleCount += 1;
    });
    return { groups, sampleCount, flatBand, horizon };
  }

  function patternBias(key, role, signals) {
    const momentum = clamp(finite(signals?.momentum) || 0, -0.2, 0.2);
    const support = clamp(finite(signals?.support) || 0, -1, 1);
    const risk = clamp(finite(signals?.risk) || 0, -1, 1);
    const range = clamp(finite(signals?.range) || 0, 0, 1);
    let bias = ["steady_up", "steady_down", "range"].includes(key) ? 0.88 : 1.08;
    if (key === "dip_then_rise") bias += Math.max(0, -momentum * 3) + Math.max(0, support - risk) * 0.35;
    if (key === "sideways_then_rise") bias += range * 0.35 + Math.max(0, support) * 0.2;
    if (key === "surge_then_hold") bias += Math.max(0, momentum * 2.5) + range * 0.25;
    if (key === "rise_then_pullback") bias += Math.max(0, momentum * 2) + Math.max(0, risk) * 0.25;
    if (key === "rise_then_fall") bias += Math.max(0, momentum * 2.5) + Math.max(0, risk - support) * 0.4;
    if (key === "sideways_then_fall") bias += range * 0.35 + Math.max(0, risk) * 0.25;
    if (key === "drop_then_hold") bias += Math.max(0, -momentum * 2.5) + range * 0.25;
    if (key === "drop_then_rebound") bias += Math.max(0, -momentum * 2) + Math.max(0, support) * 0.3;
    if (key === "drop_then_recover") bias += Math.max(0, -momentum * 2) + Math.max(0, support) * 0.25;
    if (key === "rise_then_hold") bias += Math.max(0, momentum * 2) + range * 0.25;
    if (role === "upside" && risk > support + 0.35 && key === "steady_up") bias *= 0.7;
    if (role === "downside" && support > risk + 0.35 && key === "steady_down") bias *= 0.7;
    return clamp(bias, 0.45, 1.8);
  }

  function fallbackPattern(role, signals) {
    const momentum = finite(signals?.momentum) || 0;
    const support = finite(signals?.support) || 0;
    const risk = finite(signals?.risk) || 0;
    const range = clamp(finite(signals?.range) || 0, 0, 1);
    if (role === "upside") {
      if (momentum < -0.025 || support > risk + 0.18) return "dip_then_rise";
      if (momentum > 0.055 && range > 0.25) return "surge_then_hold";
      if (range > 0.4) return "sideways_then_rise";
      return "steady_up";
    }
    if (role === "downside") {
      if (momentum > 0.035 || risk > support + 0.18) return "rise_then_fall";
      if (range > 0.4) return "sideways_then_fall";
      if (momentum < -0.055) return "drop_then_hold";
      return "steady_down";
    }
    if (momentum > 0.045) return "rise_then_hold";
    if (momentum < -0.045) return support >= risk ? "drop_then_recover" : "drop_then_hold";
    return "range";
  }

  function shockPattern(role, signals) {
    const shock = finite(signals?.shock) || 0;
    if (Math.abs(shock) < 0.75) return "";
    if (shock > 0) {
      return { upside: "overheat_rebound", sideways: "overheat_range", downside: "overheat_drift" }[role] || "";
    }
    return { upside: "washout_rebound", sideways: "washout_range", downside: "washout_retest" }[role] || "";
  }

  function aggregateResidual(items, horizon, projectedVolatility) {
    const selected = items.slice(0, 18);
    const totalWeight = selected.reduce((sum, item) => sum + item.weight, 0);
    let residual = Array.from({ length: horizon + 1 }, (_, day) => {
      const values = selected.map((item) => ({ value: item.residual[day], weight: item.weight }));
      const average = totalWeight > EPSILON
        ? values.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight
        : 0;
      return (weightedMedian(values) * 0.7) + (average * 0.3);
    });
    residual = smoothPath(residual, 2);
    const dailyChanges = residual.slice(1).map((value, index) => value - residual[index]);
    const currentVolatility = standardDeviation(dailyChanges);
    const targetVolatility = clamp(projectedVolatility * 0.62, 0.0012, 0.018);
    const scale = currentVolatility > EPSILON
      ? clamp(targetVolatility / currentVolatility, 0.65, 2.8)
      : 1;
    const swingLimit = clamp(projectedVolatility * Math.sqrt(horizon) * 1.45, 0.05, 0.28);
    residual = residual.map((value, day) => (
      day === 0 || day === horizon ? 0 : clamp(value * scale, -swingLimit, swingLimit)
    ));
    return smoothPath(residual, 1).map((value, day) => (
      day === 0 || day === horizon ? 0 : value
    ));
  }

  function selectMorphology(role, library, signals, projectedVolatility, excludedKeys = new Set()) {
    const forcedKey = shockPattern(role, signals);
    if (forcedKey && !excludedKeys.has(forcedKey)) {
      const definition = PATTERNS[forcedKey];
      return {
        key: forcedKey,
        label: definition.label,
        shortLabel: definition.shortLabel,
        source: "short-term-shock-regime",
        analogCount: 0,
        support: clamp(Math.abs(finite(signals?.shock) || 0) / 1.5, 0, 1),
        residual: null,
      };
    }
    const groups = library?.groups?.[role] || {};
    const entries = Object.entries(groups).map(([key, items]) => {
      const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
      return {
        key,
        items: items.slice().sort((left, right) => left.distance - right.distance),
        totalWeight,
        score: totalWeight * patternBias(key, role, signals),
      };
    }).sort((left, right) => right.score - left.score);
    const roleWeight = entries.reduce((sum, entry) => sum + entry.totalWeight, 0);
    const selected = entries.find((entry) => !excludedKeys.has(entry.key) && entry.items.length >= 2)
      || entries.find((entry) => !excludedKeys.has(entry.key) && entry.items.length >= 1)
      || entries.find((entry) => entry.items.length >= 2)
      || entries.find((entry) => entry.items.length >= 1);
    const useHistory = selected
      && (selected.items.length >= 2 || selected.totalWeight / Math.max(EPSILON, roleWeight) >= 0.34);
    const fallbackCandidates = {
      upside: [fallbackPattern(role, signals), "dip_then_rise", "sideways_then_rise", "surge_then_hold", "rise_then_pullback", "steady_up"],
      sideways: [fallbackPattern(role, signals), "range", "rise_then_hold", "drop_then_recover", "drop_then_hold"],
      downside: [fallbackPattern(role, signals), "rise_then_fall", "sideways_then_fall", "drop_then_hold", "drop_then_rebound", "steady_down"],
    }[role];
    const historyKey = useHistory ? selected.key : "";
    const key = historyKey && !excludedKeys.has(historyKey)
      ? historyKey
      : (fallbackCandidates.find((candidate) => !excludedKeys.has(candidate)) || historyKey || fallbackCandidates[0]);
    const historyMatchesSelection = useHistory && key === selected.key;
    const definition = PATTERNS[key] || PATTERNS.range;
    return {
      key,
      label: definition.label,
      shortLabel: definition.shortLabel,
      source: historyMatchesSelection ? "conditional-analogs" : "regime-fallback",
      analogCount: historyMatchesSelection ? selected.items.length : 0,
      support: historyMatchesSelection ? selected.totalWeight / Math.max(EPSILON, roleWeight) : 0,
      residual: historyMatchesSelection
        ? aggregateResidual(selected.items, library.horizon, projectedVolatility)
        : null,
    };
  }

  function fallbackTemplate(key, endpoint, horizon, amplitude) {
    const day = (ratio) => Math.round(horizon * ratio);
    const positive = Math.max(amplitude * 0.85, Math.abs(endpoint) * 0.7);
    const negative = -Math.max(amplitude * 0.85, Math.abs(endpoint) * 0.7);
    const templates = {
      steady_up: [[0, 0], [0.22, endpoint * 0.16], [0.5, endpoint * 0.44], [0.78, endpoint * 0.76], [1, endpoint]],
      dip_then_rise: [[0, 0], [0.2, negative * 0.7], [0.42, negative * 0.35], [0.72, endpoint * 0.42], [1, endpoint]],
      sideways_then_rise: [[0, 0], [0.28, endpoint * 0.03], [0.55, endpoint * 0.08], [0.78, endpoint * 0.42], [1, endpoint]],
      surge_then_hold: [[0, 0], [0.2, positive * 0.9], [0.42, Math.max(endpoint * 0.92, positive)], [0.72, endpoint * 0.96], [1, endpoint]],
      rise_then_pullback: [[0, 0], [0.22, endpoint * 0.32], [0.55, Math.max(endpoint * 1.18, positive)], [0.78, endpoint * 1.08], [1, endpoint]],
      rise_then_fall: [[0, 0], [0.24, positive * 0.75], [0.48, positive], [0.72, endpoint * 0.35], [1, endpoint]],
      sideways_then_fall: [[0, 0], [0.3, endpoint * 0.02], [0.56, endpoint * 0.08], [0.78, endpoint * 0.48], [1, endpoint]],
      drop_then_hold: [[0, 0], [0.2, negative * 0.9], [0.42, Math.min(endpoint * 0.92, negative)], [0.72, endpoint * 0.96], [1, endpoint]],
      steady_down: [[0, 0], [0.22, endpoint * 0.16], [0.5, endpoint * 0.44], [0.78, endpoint * 0.76], [1, endpoint]],
      drop_then_rebound: [[0, 0], [0.24, endpoint * 0.5], [0.58, Math.min(endpoint * 1.22, negative)], [0.8, endpoint * 1.08], [1, endpoint]],
      rise_then_hold: [[0, 0], [0.2, positive * 0.8], [0.45, positive], [0.72, endpoint + (positive * 0.15)], [1, endpoint]],
      drop_then_recover: [[0, 0], [0.22, negative], [0.48, negative * 0.8], [0.76, endpoint + (negative * 0.18)], [1, endpoint]],
      overheat_rebound: [[0, 0], [0.1, negative], [0.27, negative * 0.58], [0.56, endpoint * 0.28], [1, endpoint]],
      overheat_range: [[0, 0], [0.12, negative], [0.32, negative * 0.72], [0.64, endpoint + (negative * 0.16)], [1, endpoint]],
      overheat_drift: [[0, 0], [0.12, negative], [0.32, negative * 0.72], [0.68, endpoint * 0.72], [1, endpoint]],
      washout_rebound: [[0, 0], [0.1, positive], [0.3, positive * 0.72], [0.62, endpoint * 0.78], [1, endpoint]],
      washout_range: [[0, 0], [0.12, positive], [0.34, positive * 0.72], [0.66, endpoint + (positive * 0.16)], [1, endpoint]],
      washout_retest: [[0, 0], [0.12, positive], [0.34, positive * 0.62], [0.68, endpoint * 0.7], [1, endpoint]],
      range: [[0, 0], [0.22, amplitude * 0.32], [0.48, -amplitude * 0.28], [0.74, amplitude * 0.2], [1, endpoint]],
    };
    const anchors = (templates[key] || templates.range).map(([ratio, value]) => ({ day: day(ratio), value }));
    return Array.from({ length: horizon + 1 }, (_, index) => interpolateAnchors(anchors, index));
  }

  function buildScenarioPath({
    endpoint,
    morphology,
    horizon,
    projectedVolatility,
    baseShape,
  }) {
    const amplitude = clamp(projectedVolatility * Math.sqrt(horizon) * 0.72, 0.035, 0.2);
    const template = fallbackTemplate(morphology.key, endpoint, horizon, amplitude);
    const genericPattern = ["steady_up", "steady_down", "range"].includes(morphology.key);
    const historyWeight = morphology.residual
      ? (genericPattern ? 0.38 : clamp(0.48 + (morphology.support * 0.22), 0.48, 0.7))
      : 0;
    let path = template.map((templateValue, day) => {
      const historicalValue = (endpoint * (day / horizon)) + (morphology.residual?.[day] || 0);
      return (templateValue * (1 - historyWeight))
        + (historicalValue * historyWeight)
        + ((baseShape?.[day] || 0) * 0.06);
    });
    const excursionLimit = clamp(
      Math.max(Math.abs(endpoint) * 1.4, projectedVolatility * Math.sqrt(horizon) * 2.4, 0.12),
      0.12,
      0.7,
    );
    path = smoothPath(path, 1).map((value, day) => (
      day === 0 ? 0 : (day === horizon ? endpoint : clamp(value, -excursionLimit, excursionLimit))
    ));
    return path;
  }

  function buildScenarioMorphologies({
    library,
    endpoints,
    horizon = 126,
    projectedVolatility = 0.01,
    baseShape = [],
    signals = {},
  } = {}) {
    const usedKeys = new Set();
    const output = {};
    ROLES.forEach((role) => {
      const morphology = selectMorphology(
        role,
        library,
        signals,
        projectedVolatility,
        usedKeys,
      );
      usedKeys.add(morphology.key);
      output[role] = {
        ...morphology,
        path: buildScenarioPath({
          endpoint: finite(endpoints?.[role]) || 0,
          morphology,
          horizon,
          projectedVolatility,
          baseShape,
        }),
      };
    });
    return output;
  }

  globalScope.ThinkStockAiScenarioPaths = Object.freeze({
    PATTERNS,
    buildHistoricalPathLibrary,
    buildScenarioMorphologies,
    classifyHistoricalPath,
  });
}(typeof self !== "undefined" ? self : globalThis));
