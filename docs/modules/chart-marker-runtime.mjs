import {
  EVENT_MARKER_OVERLAY_KINDS,
  EVENT_MARKER_FONT_FAMILY,
  buildEventMarkerTextFont,
} from "./chart-render-contract.mjs";
import { APP_DATA_COMPONENT_GROUPS } from "./app-data-store.mjs";

const defaultScope = typeof self !== "undefined" ? self : globalThis;
export const MINIMUM_TIMING_VOLUME_POINTS = 20;
const TIMING_PAYLOAD = Object.freeze({
  NAME: 0,
  REASONS: 1,
  METRIC_A: 2,
  METRIC_B: 3,
  METRIC_C: 4,
  GRADE: 5,
  REGIME: 6,
  EVIDENCE: 7,
  FAMILY: 8,
  BEHAVIOR: 9,
  STAGE: 10,
  RELIABILITY_STATUS: 11,
  RELIABILITY_SAMPLE: 12,
  RELIABILITY_OUTCOME: 13,
});
const TIMING_RELIABILITY_HORIZON = 20;

function timingReliabilityPercent(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const scaled = (options.absolute ? Math.abs(number) : number) * 100;
  return `${options.signed && scaled > 0 ? "+" : ""}${scaled.toFixed(1)}%`;
}

export function buildMarketTimingReliability(signal, quality, side) {
  const normalizedSide = side === "sell" ? "sell" : "buy";
  const mode = String(signal?.entryMode || "standard").trim() || "standard";
  const row = quality?.validation?.holdoutByEntryMode?.[normalizedSide]?.[mode]
    ?.horizons?.[TIMING_RELIABILITY_HORIZON] || null;
  const samples = Math.max(0, Number(row?.samples) || 0);
  const hitRate = Number(row?.hitRate);
  const lowerBound = Number(row?.hitRateLowerBound);
  const meanReturn = Number(row?.meanDirectionalReturn);
  const worstAdverse = Number(row?.worstMaxAdverseReturn);
  let status = "검증 대기";
  if (samples > 0 && samples < 5) status = "표본 부족";
  else if (samples >= 8
    && Number.isFinite(lowerBound) && lowerBound >= 0.35
    && Number.isFinite(meanReturn) && meanReturn > 0) status = "참고 가능";
  else if (samples >= 5 && Number.isFinite(meanReturn) && meanReturn > 0) status = "제한적 참고";
  else if (samples >= 5) status = "검증 약함";
  const sampleLine = samples
    ? `동일 유형 ${samples}회 · ${TIMING_RELIABILITY_HORIZON}일 적중 ${timingReliabilityPercent(hitRate, { absolute: true })}`
    : "동일 유형의 완료된 검증 표본 없음";
  const riskLabel = normalizedSide === "sell" ? "최대 역행 상승" : "최대 하락";
  const outcomeLine = samples
    ? `${TIMING_RELIABILITY_HORIZON}일 평균 성과 ${timingReliabilityPercent(meanReturn, { signed: true })} · ${riskLabel} ${timingReliabilityPercent(worstAdverse)}`
    : "새 결과가 쌓이면 실제 성과를 표시합니다";
  return Object.freeze({
    status,
    lines: Object.freeze([`실제 신뢰 · ${status}`, sampleLine, outcomeLine]),
  });
}

export function createMarketTimingInputGate(options = {}) {
  const coreTickers = Array.isArray(options.coreTickers) ? options.coreTickers : ["^KS11", "^KQ11"];
  const priceRuntime = options.priceRuntime || null;
  const hasBaseInputs = () => {
    if (typeof options.hasBaseInputs === "function") return options.hasBaseInputs() === true;
    const data = options.getData?.() || {};
    return Boolean(data.pricePayload?.records?.length
      && data.macroRows?.length && data.creditRows?.length && data.adrRows?.length);
  };
  const hasVolumeHistory = (ticker) => (
    options.hasVolumeHistory?.(ticker, MINIMUM_TIMING_VOLUME_POINTS)
    ?? priceRuntime?.hasVolumeHistory?.(ticker, MINIMUM_TIMING_VOLUME_POINTS)
  ) === true;
  const hasFullHistory = (ticker) => (
    options.hasFullHistory?.(ticker)
    ?? priceRuntime?.fullHistoryReady?.(ticker)
  ) !== false;
  const isStockSeries = options.isStockSeries || ((ticker) => /^\d{6}\.(KS|KQ)$/.test(ticker));
  const normalizeTickers = (targets = []) => [...new Set([
    ...coreTickers,
    ...(Array.isArray(targets) ? targets : []),
  ].map((ticker) => String(ticker || "").trim().toUpperCase())
    .filter((ticker) => options.isForecastSeries?.(ticker) !== false))];
  const missingVolumes = (targets = []) => normalizeTickers(targets).filter((ticker) => (
    !hasVolumeHistory(ticker)
  ));
  const missingHistories = (targets = []) => normalizeTickers(targets).filter((ticker) => (
    isStockSeries(ticker) && !hasFullHistory(ticker)
  ));

  function ready(targets = []) {
    return hasBaseInputs()
      && missingVolumes(targets).length === 0
      && missingHistories(targets).length === 0;
  }

  async function ensure({ targets = [] } = {}) {
    if (ready(targets)) return true;
    const missing = missingVolumes(targets);
    const missingIndices = missing.filter((ticker) => coreTickers.includes(ticker));
    const missingStocks = [...new Set([
      ...missing.filter(isStockSeries),
      ...missingHistories(targets),
    ])];
    const tasks = [];
    if (!hasBaseInputs()) tasks.push(options.loadBaseInputs?.());
    if (missingIndices.length) tasks.push(options.loadIndexVolumes?.(missingIndices));
    missingStocks.forEach((ticker) => tasks.push(
      options.loadStockHistory?.(ticker)
      ?? priceRuntime?.load?.(ticker, {
        ...(options.getDisplayName ? { displayName: options.getDisplayName(ticker) || ticker } : {}),
        requireFullHistory: true,
      }),
    ));
    await Promise.allSettled(tasks.filter(Boolean));
    return ready(targets);
  }

  return Object.freeze({ ensure, missingHistories, missingVolumes, ready });
}

function sortedVolumeEntries(volumeMaps, ticker) {
  return [...(volumeMaps?.get?.(ticker)?.entries?.() || [])]
    .filter(([date, volume]) => (
      /^\d{4}-\d{2}-\d{2}$/.test(String(date || "").slice(0, 10))
      && Number.isFinite(Number(volume))
      && Number(volume) >= 0
    ))
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

function volumeTimelineRevision(entries) {
  if (!entries.length) return "0";
  const first = entries[0];
  const latest = entries.at(-1);
  return [
    entries.length,
    String(first?.[0] || ""),
    String(latest?.[0] || ""),
    Number(latest?.[1]) || 0,
  ].join(":");
}

export function marketTimingProgressDescriptor(targets, resolveLabel = (value) => value) {
  const normalizedTargets = [...new Set((targets || [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean))];
  if (!normalizedTargets.length) return null;
  const firstLabel = String(resolveLabel(normalizedTargets[0]) || normalizedTargets[0] || "종목");
  return Object.freeze({
    key: `signal:${normalizedTargets.join(",")}`,
    label: normalizedTargets.length > 1
      ? `${firstLabel} 외 ${normalizedTargets.length - 1}종 신호 로딩중`
      : `${firstLabel} 신호 로딩중`,
    targets: Object.freeze(normalizedTargets),
  });
}

  const DAY_MS = 24 * 60 * 60 * 1000;
  const EVENT_MARKER_DESCRIPTORS = Object.freeze([
    Object.freeze({ id: "crisis", kind: "crisis", layer: "timing", identity: "crisis-signal" }),
    Object.freeze({ id: "timing-buy", kind: "timing-buy", layer: "timing", identity: "market-timing-buy" }),
    Object.freeze({ id: "timing-sell", kind: "timing-sell", layer: "timing", identity: "market-timing-sell" }),
    Object.freeze({ id: "insider", kind: "insider", layer: "insider", key: "insiderTradeSide" }),
    Object.freeze({ id: "disclosure", kind: "disclosure", layer: "disclosure" }),
  ]);
  const EVENT_MARKER_KIND_SET = new Set(EVENT_MARKER_OVERLAY_KINDS);
  const CHART_MARKER_DEFAULTS = Object.freeze({
    colors: Object.freeze({
      crisis: "#60a5fa",
      disclosure: "#fde047",
      timingBuy: "#f9a8d4",
      timingSell: "#7dd3fc",
    }),
    constants: Object.freeze({
      disclosureIconText: "◆",
      disclosureTextSize: 13,
      disclosureTraceName: "공시",
      eventMarkerDownText: "▼",
      eventMarkerTextSize: 15,
      eventMarkerUpText: "▲",
      eventMarkerGapRatio: 0.02,
      insiderLineGapRatio: 2,
      insiderTimingCollisionDistanceRatio: 0.9,
      insiderTimingCollisionOffsetRatio: 2.2,
      pairedInsiderBuyOffsetRatio: 0.3,
      pairedInsiderSellOffsetRatio: 0.95,
      timingGapMultiplier: 1.1,
    }),
    highlightSizeDelta: 3,
  });

  function eventMarkerKind(trace) {
    const kind = String(trace?.meta?.overlayKind || "");
    return EVENT_MARKER_KIND_SET.has(kind) ? kind : "";
  }

  function eventMarkerDescriptor(traceOrKind) {
    const kind = typeof traceOrKind === "string" ? traceOrKind : eventMarkerKind(traceOrKind);
    return EVENT_MARKER_DESCRIPTORS.find((descriptor) => descriptor.kind === kind) || null;
  }

  function eventMarkerLayer(traceOrKind) {
    return eventMarkerDescriptor(traceOrKind)?.layer || "";
  }

  function eventMarkerIdentity(trace) {
    const kind = eventMarkerKind(trace);
    if (!kind) return "";
    if (kind === "insider") {
      return `insider:${String(trace?.meta?.insiderTradeSide || "")}`;
    }
    return eventMarkerDescriptor(kind)?.identity || kind;
  }

  function isEventMarkerTrace(trace) {
    return Boolean(eventMarkerKind(trace));
  }

  function isTimingSignalTrace(trace) {
    return eventMarkerLayer(trace) === "timing";
  }

  function isDirectlyInteractiveEventMarkerTrace(trace) {
    return isEventMarkerTrace(trace);
  }

  function createEventMarkerSpecs(bindings = {}) {
    return EVENT_MARKER_DESCRIPTORS.map((descriptor) => {
      const binding = bindings[descriptor.id] || {};
      return {
        id: descriptor.id,
        layer: descriptor.layer,
        enabled: Boolean(binding.enabled),
        matches: (trace) => eventMarkerKind(trace) === descriptor.kind,
        ...(descriptor.key
          ? { keyOf: (trace) => trace?.meta?.[descriptor.key] }
          : {}),
        build: binding.build,
      };
    });
  }

  function materializeEventMarkerTraces(specs = []) {
    return (Array.isArray(specs) ? specs : []).flatMap((spec) => {
      if (!spec?.enabled) return [];
      const value = typeof spec.build === "function" ? spec.build() : spec.traces;
      return Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
    });
  }

  function collectCrisisSignalEntries(rows) {
    const stageRank = { stable: 0, caution: 1, warning: 2, crisis: 3 };
    let previousRank = 0;
    const events = [];
    (rows || []).forEach((row) => {
      const score = Number(row?.score);
      const rank = stageRank[row?.stage]
        ?? (score >= 75 ? 3 : score >= 50 ? 2 : score >= 25 ? 1 : 0);
      if (rank >= 2 && rank > previousRank) events.push(row);
      previousRank = rank;
    });
    return events;
  }

  function createEventMarkerRenderState() {
    return Object.seal({
      highlight: null,
      disclosureStats: { total: 0, candidates: 0, markers: 0 },
      insiderStats: { total: 0, candidates: 0, markers: 0 },
      partialUpdateCount: 0,
      highlightDomUpdateCount: 0,
    });
  }

  function findPointOnOrAfterDate(eventDate, ticker, pointIndex, maxDays = 14) {
    const points = pointIndex?.[ticker];
    if (!points?.length) return null;
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (points[middle].date < eventDate) low = middle + 1;
      else high = middle;
    }
    const point = points[low];
    if (!point) return null;
    const eventMs = Date.parse(`${eventDate}T00:00:00Z`);
    const pointMs = Date.parse(`${point.date}T00:00:00Z`);
    return Number.isFinite(eventMs)
      && Number.isFinite(pointMs)
      && pointMs - eventMs <= maxDays * DAY_MS
      ? {
        date: point.date,
        y: point.y,
        ...(Number.isFinite(point.baseY) ? { baseY: point.baseY } : {}),
      }
      : null;
  }

  function compactTimingReasons(reasonGroups, fallback = "복합 조건 충족", limit = 2, separator = " · ") {
    const reasons = [];
    (Array.isArray(reasonGroups) ? reasonGroups : []).forEach((group) => {
      (Array.isArray(group) ? group : []).forEach((rawReason) => {
        const reason = String(rawReason || "").trim();
        if (!reason || reasons.includes(reason)) return;
        reasons.push(reason.length > 14 ? `${reason.slice(0, 13)}…` : reason);
      });
    });
    return reasons.slice(0, Math.max(1, limit)).join(separator) || fallback;
  }

  function timingRegimeLabel(value) {
    return ({
      expansion: "상승",
      slowdown: "둔화",
      stress: "위험",
      recovery: "회복",
      overheat: "과열",
      range: "횡보",
    })[String(value || "")] || "혼조";
  }

  function timingFamilyLabel(value) {
    return ({
      "shock-reversal": "급락 과매도 경고",
      "systemic-capitulation": "시장 투매 감속",
      "capitulation-reversal": "투매 반전",
      "range-floor-reversal": "박스권 하단",
      "trend-pullback": "추세 눌림",
      "relative-washout": "상대 과매도",
      "correction-reversal": "조정 반전",
      "blowoff-exhaustion": "급등 소진",
      "blowoff-continuation": "과열 연장",
      "range-ceiling-rollover": "박스권 상단",
      "trend-exhaustion": "추세 소진",
      "distribution-rollover": "분배 전환",
      "crowding-rollover": "쏠림 전환",
      "overheat-rollover": "과열 전환",
    })[String(value || "")] || "복합 판정";
  }

  function timingGradeLabel(value, evidenceCount = 0, warning = false) {
    const explicit = ({
      강: "강",
      중: "중",
      약: "약",
      이례: "강",
      보통: "중",
    })[String(value || "").trim()];
    if (explicit) return explicit;
    const evidence = Number(evidenceCount) || 0;
    if (warning || evidence >= 6) return "강";
    return evidence >= 3 ? "중" : "약";
  }

  function normalizedTimingGrade(signal) {
    return timingGradeLabel(
      signal?.signalGrade,
      signal?.evidenceCount,
      signal?.signalRole === "warning",
    );
  }

  function timingSignalStage(signal, side, signalLifecycle) {
    const sideLabel = side === "sell" ? "매도" : "매수";
    let stage = signalLifecycle?.realtime
      ? `실시간 ${sideLabel} 신호`
      : String(signal?.signalStage || "").trim();
    if (!stage) {
      const triggerReasons = side === "sell"
        ? signal?.sellTriggerReasons
        : signal?.triggerReasons;
      if (signal?.signalRole === "warning") stage = `${sideLabel} 선행 경고`;
      else if (Array.isArray(triggerReasons) && triggerReasons.length) {
        stage = side === "sell" ? "매도 하락 확인" : "매수 반전 확인";
      } else {
        stage = side === "sell" ? "분배 가능 구간" : "매집 가능 구간";
      }
    }
    return stage;
  }

  function timingReasonEvents(value, fallback) {
    const reasons = String(value || fallback)
      .split(/<br\s*\/?\s*>\s*·?\s*|\s+·\s+/i)
      .map((reason) => reason.trim())
      .filter(Boolean);
    return reasons.map((reason, index) => ({
      title: index === 0 ? `근거: ${reason}` : `· ${reason}`,
    }));
  }

  function buildTimingSignalPopoverGroup(point) {
    const values = Array.isArray(point?.customdata) ? point.customdata : [];
    const date = String(point?.x || "").slice(0, 10);
    const kind = eventMarkerKind(point?.data);
    const reliabilityEvents = [
      values[TIMING_PAYLOAD.RELIABILITY_STATUS],
      values[TIMING_PAYLOAD.RELIABILITY_SAMPLE],
      values[TIMING_PAYLOAD.RELIABILITY_OUTCOME],
    ].filter(Boolean).map((title) => ({ title }));
    if (kind === "timing-buy") {
      const title = values[TIMING_PAYLOAD.STAGE] || "매수 신호";
      return {
        name: values[TIMING_PAYLOAD.NAME] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `${title} · 근거 ${timingGradeLabel(
            values[TIMING_PAYLOAD.GRADE],
            values[TIMING_PAYLOAD.EVIDENCE],
          )}` },
          ...reliabilityEvents,
          ...timingReasonEvents(values[TIMING_PAYLOAD.REASONS], "과매도·반전"),
          { title: `ADR ${values[TIMING_PAYLOAD.METRIC_A] ?? "-"} · 공포 ${values[TIMING_PAYLOAD.METRIC_B] ?? "-"} · MACD ${values[TIMING_PAYLOAD.METRIC_C] ?? "-"}` },
          { title: `시장 ${timingRegimeLabel(values[TIMING_PAYLOAD.REGIME])} · 근거 ${values[TIMING_PAYLOAD.EVIDENCE] ?? "-"}개` },
          { title: `${timingFamilyLabel(values[TIMING_PAYLOAD.FAMILY])} · ${values[TIMING_PAYLOAD.BEHAVIOR] || "혼합형"}` },
        ],
      };
    }
    if (kind === "timing-sell") {
      const title = values[TIMING_PAYLOAD.STAGE] || "매도 신호";
      return {
        name: values[TIMING_PAYLOAD.NAME] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `${title} · 근거 ${timingGradeLabel(
            values[TIMING_PAYLOAD.GRADE],
            values[TIMING_PAYLOAD.EVIDENCE],
          )}` },
          ...reliabilityEvents,
          ...timingReasonEvents(values[TIMING_PAYLOAD.REASONS], "과열·추세 둔화"),
          { title: `신용20일 ${values[TIMING_PAYLOAD.METRIC_A] ?? "-"}% · 고점대비 ${values[TIMING_PAYLOAD.METRIC_B] ?? "-"}%` },
          { title: `시장 ${timingRegimeLabel(values[TIMING_PAYLOAD.REGIME])} · 근거 ${values[TIMING_PAYLOAD.EVIDENCE] ?? "-"}개` },
          { title: `${timingFamilyLabel(values[TIMING_PAYLOAD.FAMILY])} · ${values[TIMING_PAYLOAD.BEHAVIOR] || "혼합형"}` },
        ],
      };
    }
    if (kind === "crisis") {
      return {
        name: values[0] || point.data.name || "타이밍",
        plotDate: date,
        events: [
          { title: `침체 ${values[1] ?? "경고"} · 종합 ${values[2] ?? "-"}점` },
          { title: `금리 ${values[3] ?? "-"} · 고용 ${values[4] ?? "-"} · 신용 ${values[5] ?? "-"}` },
        ],
      };
    }
    return null;
  }

  function buildEventMarkerPopoverGroup(point) {
    const pointIndex = point?.pointIndex ?? point?.pointNumber;
    const embedded = point?.data?.meta?.eventGroups?.[pointIndex];
    if (embedded?.events?.length) return embedded;
    return isTimingSignalTrace(point?.data) ? buildTimingSignalPopoverGroup(point) : null;
  }

  function createChartMarkerRuntime(scope = defaultScope, options = {}) {
    const {
      colors: colorOverrides = {},
      constants: constantOverrides = {},
      chartEventLayer,
      chartSession,
      buildInsiderMarkerTraces,
      dataRevisionSignature,
      areMarketTimingInputsReady,
      ensureMarketTimingInputs,
      ensureMarketTimingFeature,
      escapeHtml,
      getAdrRows,
      getCreditRows,
      getCrisisRows,
      getDisclosureRows,
      getEventRevisions,
      getInsiderTradeRows,
      getMacroRows,
      getMarketTimingService,
      getPricePayload,
      getSignalLifecycle,
      getTickerVolumeSeriesByTicker,
      getUseViewportMarkerGap,
      getViewportYRange,
      isForecastSeries,
      labelName,
      netSameReporterInsiderTrades,
      recordPerfSample,
      recordRuntimeError,
      shouldPrepareMarketTimingModels = () => true,
      signalProgress,
      seriesColor,
      startPerfSample,
      toNum,
      toUtcMs,
    } = options;
    const colors = { ...CHART_MARKER_DEFAULTS.colors, ...colorOverrides };
    const constants = { ...CHART_MARKER_DEFAULTS.constants, ...constantOverrides };
    if (!chartEventLayer || !chartSession || typeof toUtcMs !== "function") {
      throw new Error("chart marker runtime dependencies are incomplete");
    }

    const eventMarkerGapRatio = Number(constants.eventMarkerGapRatio) || 0.02;
    const timingGapMultiplier = Number(constants.timingGapMultiplier) || 1.1;
    const insiderLineGapRatio = Number(constants.insiderLineGapRatio) || 2;
    const pairedInsiderBuyOffsetRatio = Number(constants.pairedInsiderBuyOffsetRatio) || 0.3;
    const pairedInsiderSellOffsetRatio = Number(constants.pairedInsiderSellOffsetRatio) || 0.95;
    const insiderTimingCollisionDistanceRatio = Number(constants.insiderTimingCollisionDistanceRatio) || 0.9;
    const insiderTimingCollisionOffsetRatio = Number(constants.insiderTimingCollisionOffsetRatio) || 2.2;
    const eventMarkerUpText = String(constants.eventMarkerUpText || "▲");
    const eventMarkerDownText = String(constants.eventMarkerDownText || "▼");
    const eventMarkerTextSize = Number(constants.eventMarkerTextSize) || 13;
    const pointIndexCache = new WeakMap();
    let lastTimingPreparationKey = "";
    let pendingTimingPreparation = null;
    let timingPreparationGeneration = 0;
    const timingPreparationTargetGenerations = new Map();
    const timingProgressTasks = new Map();

    function normalizeTimingTarget(value) {
      return String(value || "").trim().toUpperCase();
    }

    function timingTargetGeneration(target) {
      return timingPreparationTargetGenerations.get(normalizeTimingTarget(target)) || 0;
    }

    function captureTimingPreparationGeneration(targets) {
      return Object.freeze({
        global: timingPreparationGeneration,
        targets: Object.freeze((targets || []).map((target) => (
          Object.freeze([normalizeTimingTarget(target), timingTargetGeneration(target)])
        ))),
      });
    }

    function isTimingPreparationGenerationCurrent(snapshot) {
      return snapshot?.global === timingPreparationGeneration
        && snapshot.targets.every(([target, generation]) => (
          timingTargetGeneration(target) === generation
        ));
    }

    function timingPreparationGenerationKey(snapshot) {
      return [
        snapshot?.global || 0,
        ...(snapshot?.targets || []).map(([target, generation]) => `${target}:${generation}`),
      ].join("|");
    }

    function cancelMarketTimingPreparation(seriesKey = "") {
      const target = normalizeTimingTarget(seriesKey);
      const taskKeys = [...timingProgressTasks.entries()]
        .filter(([, task]) => !target || task.targets.has(target))
        .map(([taskKey]) => taskKey);
      const pendingMatches = pendingTimingPreparation
        && (!target || pendingTimingPreparation.targets.has(target));
      if (!taskKeys.length && !pendingMatches) return false;

      if (target) {
        timingPreparationTargetGenerations.set(target, timingTargetGeneration(target) + 1);
      } else {
        timingPreparationGeneration += 1;
      }
      taskKeys.forEach((taskKey) => {
        timingProgressTasks.delete(taskKey);
        signalProgress?.cancel?.(taskKey);
      });
      if (pendingMatches) pendingTimingPreparation = null;
      return true;
    }

    function beginMarketTimingProgress(targets) {
      const descriptor = marketTimingProgressDescriptor(targets, labelName);
      if (!descriptor) return false;
      // A prepared toggle can expose progress before the calculation starts.
      // Reuse that session so another entry point cannot steal completion.
      if (timingProgressTasks.has(descriptor.key)) return true;
      const token = {};
      const started = signalProgress?.begin?.(descriptor.key, descriptor.label) === true;
      if (started) {
        timingProgressTasks.set(descriptor.key, {
          targets: new Set(descriptor.targets),
          token,
        });
      }
      return started;
    }

    function markerRenderFingerprint(frame, kind, suffix = "") {
      return [
        frame?.renderRevision || "",
        String(kind || "marker"),
        String(suffix || ""),
        chartSession.hoverShowPopup ? "hover" : "plain",
      ].join("|");
    }

    function stampMarkerTrace(trace, frame, kind, suffix = "") {
      if (!trace) return trace;
      trace.meta = {
        ...(trace.meta || {}),
        renderFingerprint: markerRenderFingerprint(frame, kind, suffix),
      };
      return trace;
    }

    function transformSignature(indexedTickers) {
      return [...indexedTickers]
        .map(String)
        .sort()
        .map((ticker) => {
          const offset = Number(chartSession.seriesOffsets?.[ticker]);
          const scale = Number(chartSession.seriesScales?.[ticker]);
          return `${ticker}:${Number.isFinite(offset) ? offset : 0}:${Number.isFinite(scale) ? scale : 1}`;
        })
        .join("|");
    }

    function cachedPointIndex(seriesModels, indexedTickers) {
      if (!Array.isArray(seriesModels)) {
        return chartEventLayer.buildPointIndex(seriesModels || [], indexedTickers, toUtcMs);
      }
      const key = [...indexedTickers].map(String).sort().join("|");
      const geometryKey = transformSignature(indexedTickers);
      let cached = pointIndexCache.get(seriesModels);
      if (!cached || cached.geometryKey !== geometryKey) {
        cached = { geometryKey, entries: new Map() };
        pointIndexCache.set(seriesModels, cached);
      }
      if (cached.entries.has(key)) return cached.entries.get(key);
      const value = chartEventLayer.buildPointIndex(seriesModels, indexedTickers, toUtcMs);
      cached.entries.set(key, value);
      return value;
    }

    function visibleTimingSeries(selected, seriesModels) {
      const available = new Set((seriesModels || [])
        .map((model) => String(model?.series || "").toUpperCase()));
      return (selected || []).filter((ticker) => (
        isForecastSeries(ticker)
        && available.has(ticker)
        && !chartSession.hiddenSeries.has(ticker)
      ));
    }

    function createFrame({
      selected,
      seriesModels,
      start,
      end,
      markerStart = start,
      markerEnd = end,
      viewportRange = null,
    }) {
      const selectedSet = new Set(selected || []);
      const available = new Set((seriesModels || [])
        .map((model) => String(model?.series || "").toUpperCase()));
      const visibleTickers = new Set([...selectedSet].filter((ticker) => (
        available.has(ticker) && !chartSession.hiddenSeries.has(ticker)
      )));
      const timingSeries = chartSession.showRecessionSignals
        ? visibleTimingSeries(selected, seriesModels)
        : [];
      const indexedTickers = new Set(timingSeries);
      const addEventTickers = (rows) => {
        if (indexedTickers.size >= visibleTickers.size) return;
        for (const row of rows || []) {
          const ticker = String(row?.ticker || "").trim().toUpperCase();
          if (visibleTickers.has(ticker)) indexedTickers.add(ticker);
          if (indexedTickers.size >= visibleTickers.size) break;
        }
      };
      if (chartSession.showDisclosures) addEventTickers(getDisclosureRows?.() || []);
      if (chartSession.showInsiderTrades) addEventTickers(getInsiderTradeRows?.() || []);
      const hasIndexedMarkers = indexedTickers.size > 0;
      const eventRevisions = getEventRevisions?.() || {};
      const revisionSignature = Object.entries(eventRevisions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}:${Number(value) || 0}`)
        .join("|");
      const resolvedViewportRange = Array.isArray(viewportRange)
        ? viewportRange
        : getViewportYRange?.();
      const markerGap = hasIndexedMarkers
        ? chartEventLayer.markerGap(seriesModels || [], markerStart, markerEnd, {
          ratio: eventMarkerGapRatio,
          hiddenSeries: chartSession.hiddenSeries,
          useViewport: Boolean(getUseViewportMarkerGap?.()),
          viewportRange: resolvedViewportRange,
        })
        : 0;
      const visibleColorSignature = [...visibleTickers]
        .sort()
        .map((ticker) => `${ticker}:${seriesColor(ticker)}`)
        .join("|");
      const renderRevision = [
        dataRevisionSignature?.("price", "macro", "credit", "adr", "crisis", "disclosure") || "",
        revisionSignature,
        start,
        end,
        markerStart,
        markerEnd,
        transformSignature(indexedTickers),
        markerGap,
        visibleColorSignature,
      ].join("|");
      return {
        selected: [...(selected || [])],
        selectedSet,
        seriesModels: seriesModels || [],
        start,
        end,
        markerStart,
        markerEnd,
        timingSeries,
        crisisEvents: chartSession.showRecessionSignals
          ? collectCrisisSignalEntries(getCrisisRows?.() || [])
          : [],
        pointIndex: hasIndexedMarkers
          ? cachedPointIndex(seriesModels || [], indexedTickers)
          : {},
        markerGap,
        renderRevision,
      };
    }

    function getMarketTimingModel(ticker) {
      return getMarketTimingService?.()?.get(ticker) || null;
    }

    function buildCrisis(frame) {
      const crisisRows = getCrisisRows?.() || [];
      if (!chartSession.showRecessionSignals || !crisisRows.length || !frame.seriesModels.length) {
        return { trace: null, count: 0 };
      }
      const indexes = ["^KS11", "^KQ11"].filter((ticker) => (
        frame.selectedSet.has(ticker) && !chartSession.hiddenSeries.has(ticker)
      ));
      if (!indexes.length || !frame.crisisEvents.length) return { trace: null, count: 0 };
      const points = [];
      frame.crisisEvents.forEach((event) => {
        if (event.date > frame.end) return;
        indexes.forEach((ticker) => {
          const point = findPointOnOrAfterDate(event.date, ticker, frame.pointIndex);
          if (!point || point.date < frame.start || point.date > frame.end) return;
          points.push({
            event,
            ticker,
            date: point.date,
            anchorY: point.baseY ?? point.y,
            y: point.y + frame.markerGap * timingGapMultiplier,
          });
        });
      });
      if (!points.length) return { trace: null, count: 0 };
      const stageName = (stage) => stage === "crisis" ? "위기" : "경고";
      return {
        count: points.length,
        trace: stampMarkerTrace({
          x: points.map((point) => point.date),
          y: points.map((point) => point.y),
          customdata: points.map(({ event, ticker }) => [
            labelName(ticker),
            stageName(event.stage),
            event.score,
            event.curve,
            event.labor,
            event.credit,
          ]),
          text: points.map(() => eventMarkerDownText),
          type: "scatter",
          mode: "text",
          name: "침체 위기신호",
          showlegend: false,
          cliponaxis: false,
          yaxis: "y",
          hoverinfo: chartSession.hoverShowPopup ? undefined : "none",
          hovertemplate: chartSession.hoverShowPopup
            ? "<b>%{customdata[0]} 침체 %{customdata[1]} %{customdata[2]}점</b>"
              + "<br>금리 %{customdata[3]} · 고용 %{customdata[4]} · 신용 %{customdata[5]}<extra></extra>"
            : undefined,
          meta: {
            overlayKind: "crisis",
            pointTickers: points.map((point) => point.ticker),
            markerGapFactors: points.map(() => timingGapMultiplier),
            markerAnchorValues: points.map((point) => point.anchorY),
          },
          textposition: "middle center",
          textfont: buildEventMarkerTextFont(colors.crisis, eventMarkerTextSize),
        }, frame, "crisis", points.length),
      };
    }

    function buildTiming(frame, side) {
      if (!chartSession.showRecessionSignals || !frame.seriesModels.length || !frame.timingSeries.length) {
        return { trace: null, count: 0 };
      }
      const sell = side === "sell";
      const overlayKind = `timing-${sell ? "sell" : "buy"}`;
      const points = [];
      frame.timingSeries.forEach((ticker) => {
        const model = getMarketTimingModel(ticker);
        const signals = sell ? model?.sellSignals : model?.signals;
        const latestPriceDate = frame.pointIndex?.[ticker]?.at?.(-1)?.date || "";
        (signals || []).forEach((signal) => {
          if (signal.date > frame.end) return;
          const point = findPointOnOrAfterDate(signal.date, ticker, frame.pointIndex, 4);
          if (!point || point.date < frame.start || point.date > frame.end) return;
          points.push({
            reliability: buildMarketTimingReliability(signal, model?.quality, side),
            signal,
            signalLifecycle: getSignalLifecycle?.({
              ticker,
              signalDate: signal.date,
              latestPriceDate,
            }) || null,
            ticker,
            date: point.date,
            anchorY: point.baseY ?? point.y,
            y: point.y + frame.markerGap * timingGapMultiplier * (sell ? 1 : -1),
          });
        });
      });
      if (!points.length) return { trace: null, count: 0 };
      points.sort((left, right) => (
        left.date.localeCompare(right.date) || left.ticker.localeCompare(right.ticker)
      ));
      const printable = (value, digits = 1, suffix = "") => (
        Number.isFinite(toNum(value)) ? `${toNum(value).toFixed(digits)}${suffix}` : "-"
      );
      const customdata = sell
        ? points.map(({ reliability, signal, signalLifecycle, ticker }) => [
          labelName(ticker),
          compactTimingReasons([
            signal.sellSetupReasons,
            signal.sellDeteriorationReasons,
            signal.sellTriggerReasons,
          ], "과열·추세 둔화"),
          Number.isFinite(signal.creditChange) ? signal.creditChange.toFixed(1) : "-",
          Number.isFinite(signal.priceDrawdown60) ? signal.priceDrawdown60.toFixed(1) : "-",
          "-",
          normalizedTimingGrade(signal),
          signal.marketRegime || "range",
          Number.isFinite(signal.evidenceCount) ? signal.evidenceCount : "-",
          signal.signalFamily || "overheat-rollover",
          signal.behaviorProfile?.label || "혼합형",
          timingSignalStage(signal, "sell", signalLifecycle),
          ...reliability.lines,
        ])
        : points.map(({ reliability, signal, signalLifecycle, ticker }) => [
          labelName(ticker),
          compactTimingReasons([
            signal.setupReasons,
            signal.sentimentTurnReasons,
            signal.stabilizationReasons,
            signal.triggerReasons,
          ], "과매도·반전"),
          printable(signal.adrMin),
          printable(signal.fearMin),
          printable(signal.oscillator, 3),
          normalizedTimingGrade(signal),
          signal.marketRegime || "range",
          Number.isFinite(signal.evidenceCount) ? signal.evidenceCount : "-",
          signal.signalFamily || "correction-reversal",
          signal.behaviorProfile?.label || "혼합형",
          timingSignalStage(signal, "buy", signalLifecycle),
          ...reliability.lines,
        ]);
      const hoverHeadlineTemplates = customdata.map(() => (
        "<b>%{customdata[10]} · 근거 %{customdata[5]}</b>"
      ));
      const hoverDetailTemplates = customdata.map((values) => {
        const reasons = String(escapeHtml?.(values[TIMING_PAYLOAD.REASONS])
          ?? values[TIMING_PAYLOAD.REASONS]).replace(" · ", "<br>· ");
        return sell
          ? `근거: ${reasons}`
            + "<br>신용20일 %{customdata[2]}% · 고점대비 %{customdata[3]}%"
            + "<br>%{customdata[11]}<br>%{customdata[12]}<br>%{customdata[13]}<extra></extra>"
          : `근거: ${reasons}`
            + "<br>ADR %{customdata[2]} · 공포 %{customdata[3]} · MACD %{customdata[4]}"
            + "<br>%{customdata[11]}<br>%{customdata[12]}<br>%{customdata[13]}<extra></extra>";
      });
      const hovertemplate = customdata.map((_values, pointIndex) => {
        return `${hoverHeadlineTemplates[pointIndex]}<br><b>%{customdata[0]}</b><br>${hoverDetailTemplates[pointIndex]}`;
      });
      const trace = stampMarkerTrace({
        x: points.map((point) => point.date),
        y: points.map((point) => point.y),
        customdata,
        text: points.map(() => (sell ? eventMarkerDownText : eventMarkerUpText)),
        type: "scatter",
        mode: "text",
        name: `타이밍 ${sell ? "매도" : "매수"}신호`,
        showlegend: false,
        cliponaxis: false,
        yaxis: "y",
        hoverinfo: chartSession.hoverShowPopup ? undefined : "none",
        hovertemplate: chartSession.hoverShowPopup ? hovertemplate : undefined,
        meta: {
          overlayKind,
          hoverHeadlineTemplates,
          hoverDetailTemplates,
          pointTickers: points.map((point) => point.ticker),
          markerGapFactors: points.map(() => timingGapMultiplier * (sell ? 1 : -1)),
          markerAnchorValues: points.map((point) => point.anchorY),
        },
        textposition: "middle center",
        textfont: buildEventMarkerTextFont(
          sell ? colors.timingSell : colors.timingBuy,
          eventMarkerTextSize,
        ),
      }, frame, overlayKind, (
        `${points.length}:${points.filter((point) => point.signalLifecycle?.realtime).length}`
      ));
      return { trace, count: points.length };
    }

    function buildDisclosure(frame) {
      const disclosureRows = getDisclosureRows?.() || [];
      const stats = { total: disclosureRows.length, candidates: 0, markers: 0 };
      if (!disclosureRows.length || !frame.seriesModels.length) {
        return { trace: null, stats, groups: new Map() };
      }
      const candidates = disclosureRows.filter((event) => (
        frame.selectedSet.has(event.ticker)
        && !chartSession.hiddenSeries.has(event.ticker)
        && event.date >= frame.start
        && event.date <= frame.end
      ));
      stats.candidates = candidates.length;
      const grouped = new Map();
      candidates.forEach((event) => {
        const point = chartEventLayer.findPointOnDate(event.date, event.ticker, frame.pointIndex);
        if (!point) return;
        const key = `${event.ticker}|${point.date}`;
        const group = grouped.get(key) || {
          ticker: event.ticker,
          name: event.name || labelName(event.ticker),
          color: seriesColor(event.ticker),
          plotDate: point.date,
          anchorY: point.baseY ?? point.y,
          y: point.y + frame.markerGap,
          events: [],
        };
        group.events.push(event);
        grouped.set(key, group);
      });
      const groups = [...grouped.values()].sort((left, right) => (
        left.plotDate.localeCompare(right.plotDate)
      ));
      stats.markers = groups.length;
      const groupsById = new Map();
      if (!groups.length) return { trace: null, stats, groups: groupsById };
      const groupIds = groups.map((group) => {
        const id = `d|${group.ticker}|${group.plotDate}`;
        groupsById.set(id, group);
        return id;
      });
      return {
        stats,
        groups: groupsById,
        trace: stampMarkerTrace({
          x: groups.map((group) => group.plotDate),
          y: groups.map((group) => group.y),
          text: groups.map(() => String(constants.disclosureIconText || "◆")),
          customdata: groupIds.map((id) => [id]),
          type: "scatter",
          mode: "text",
          name: constants.disclosureTraceName,
          showlegend: false,
          cliponaxis: false,
          yaxis: "y",
          hovertemplate: groups.map((group) => {
            const first = group.events[0];
            const more = group.events.length > 1 ? ` 외 ${group.events.length - 1}건` : "";
            return `<span style="color:#f59e0b"><b>공시</b></span>`
              + `<br>${escapeHtml(first.type)}: ${escapeHtml(first.title)}${more}`
              + "<extra></extra>";
          }),
          meta: {
            overlayKind: "disclosure",
            pointTickers: groups.map((group) => group.ticker),
            markerGapFactors: groups.map(() => 1),
            markerAnchorValues: groups.map((group) => group.anchorY),
            // Keep each popup payload with the rendered trace. Async marker
            // refreshes may replace the shared lookup map before this trace is
            // replaced, but a visible marker must always remain clickable.
            eventGroups: groups,
          },
          textposition: "middle center",
          textfont: buildEventMarkerTextFont(
            groups.map((group) => group.color || colors.disclosure),
            constants.disclosureTextSize,
          ),
        }, frame, "disclosure", groups.length),
      };
    }

    function collectTimingMarkerYByKey(frame) {
      const markerYs = new Map();
      if (!chartSession.showRecessionSignals) return markerYs;
      const add = (ticker, point, offset) => {
        if (!point || point.date < frame.start || point.date > frame.end) return;
        const key = `${ticker}|${point.date}`;
        const values = markerYs.get(key) || [];
        values.push(point.y + offset);
        markerYs.set(key, values);
      };
      frame.timingSeries.forEach((ticker) => {
        const model = getMarketTimingModel(ticker);
        (model?.signals || []).forEach((signal) => {
            if (signal.date <= frame.end) add(
              ticker,
              findPointOnOrAfterDate(signal.date, ticker, frame.pointIndex, 4),
              -frame.markerGap * timingGapMultiplier,
            );
        });
        (model?.sellSignals || []).forEach((signal) => {
            if (signal.date <= frame.end) add(
              ticker,
              findPointOnOrAfterDate(signal.date, ticker, frame.pointIndex, 4),
              frame.markerGap * timingGapMultiplier,
            );
        });
      });
      ["^KS11", "^KQ11"].filter((ticker) => (
        frame.selectedSet.has(ticker) && !chartSession.hiddenSeries.has(ticker)
      )).forEach((ticker) => {
        frame.crisisEvents.forEach((event) => {
          if (event.date <= frame.end) add(
            ticker,
            findPointOnOrAfterDate(event.date, ticker, frame.pointIndex),
            frame.markerGap * timingGapMultiplier,
          );
        });
      });
      return markerYs;
    }

    function buildInsider(frame) {
      const insiderRows = getInsiderTradeRows?.() || [];
      const stats = { total: insiderRows.length, candidates: 0, markers: 0 };
      if (!insiderRows.length || !frame.seriesModels.length) return { traces: [], stats };
      const candidates = netSameReporterInsiderTrades(insiderRows.filter((event) => (
        frame.selectedSet.has(event.ticker)
        && !chartSession.hiddenSeries.has(event.ticker)
        && event.date >= frame.start
        && event.date <= frame.end
      )));
      stats.candidates = candidates.length;
      const grouped = new Map();
      candidates.forEach((event) => {
        const point = chartEventLayer.findPointOnDate(event.date, event.ticker, frame.pointIndex);
        if (!point) return;
        const side = event.side === "sell" ? "sell" : "buy";
        const key = `${event.ticker}|${point.date}|${side}`;
        const group = grouped.get(key) || {
          ticker: event.ticker,
          name: labelName(event.ticker),
          side,
          plotDate: point.date,
          y: point.y - frame.markerGap * insiderLineGapRatio,
          anchorY: point.baseY ?? point.y,
          events: [],
        };
        group.events.push(event);
        grouped.set(key, group);
      });
      const groups = [...grouped.values()];
      const sidesByMarker = new Map();
      groups.forEach((group) => {
        const key = `${group.ticker}|${group.plotDate}`;
        const sides = sidesByMarker.get(key) || new Set();
        sides.add(group.side);
        sidesByMarker.set(key, sides);
      });
      groups.forEach((group) => {
        const paired = sidesByMarker.get(`${group.ticker}|${group.plotDate}`)?.size > 1;
        group.paired = paired;
        if (!paired) return;
        const offsetRatio = group.side === "buy"
          ? pairedInsiderBuyOffsetRatio
          : pairedInsiderSellOffsetRatio;
        const offset = frame.markerGap * offsetRatio;
        group.y += group.side === "buy" ? offset : -offset;
      });
      const timingMarkerYByKey = collectTimingMarkerYByKey(frame);
      groups.forEach((group) => {
        const timingYs = timingMarkerYByKey.get(`${group.ticker}|${group.plotDate}`) || [];
        const overlapsTiming = timingYs.some((timingY) => (
          Math.abs(group.y - timingY) < frame.markerGap * insiderTimingCollisionDistanceRatio
        ));
        if (overlapsTiming) {
          group.y = group.anchorY - frame.markerGap * insiderTimingCollisionOffsetRatio;
        }
      });
      groups.sort((left, right) => (
        left.plotDate.localeCompare(right.plotDate) || left.side.localeCompare(right.side)
      ));
      stats.markers = groups.length;
      const groupsByPoint = new Map(groups.map((group) => [
        `${group.side}|${group.ticker}|${group.plotDate}`,
        group,
      ]));
      return {
        traces: buildInsiderMarkerTraces(groups, { textSize: eventMarkerTextSize })
          .map((trace) => {
            const side = String(trace?.meta?.insiderTradeSide || "");
            const pointTickers = Array.isArray(trace?.meta?.pointTickers)
              ? trace.meta.pointTickers
              : [];
            trace.meta = {
              ...(trace.meta || {}),
              markerGapFactors: (trace.x || []).map((date, index) => {
                const group = groupsByPoint.get(`${side}|${pointTickers[index] || ""}|${date || ""}`);
                if (!group || !(frame.markerGap > 0)) return -insiderLineGapRatio;
                return (group.y - group.anchorY) / frame.markerGap;
              }),
              markerAnchorValues: (trace.x || []).map((date, index) => (
                groupsByPoint.get(`${side}|${pointTickers[index] || ""}|${date || ""}`)?.anchorY
              )),
            };
            return stampMarkerTrace(
              trace,
              frame,
              `insider-${side || trace?.name || "marker"}`,
              groups.length,
            );
          }),
        stats,
      };
    }

    function createSpecs(args = [], enabledState = {}, frameOptions = {}) {
      const enabled = {
        disclosure: Boolean(enabledState.disclosure),
        insider: Boolean(enabledState.insider),
        timing: Boolean(enabledState.timing),
      };
      const [
        selected,
        seriesModels,
        start,
        end,
        markerStart = start,
        markerEnd = end,
      ] = Array.isArray(args) ? args : [];
      const frame = Object.values(enabled).some(Boolean)
        ? createFrame({
          selected,
          seriesModels,
          start,
          end,
          markerStart,
          markerEnd,
          viewportRange: frameOptions.viewportRange,
        })
        : null;
      const withResult = (builder, onResult, select) => () => {
        const result = builder(frame);
        onResult?.(result);
        return select(result);
      };
      return createEventMarkerSpecs({
        crisis: {
          enabled: enabled.timing,
          build: withResult(
            buildCrisis,
            (result) => options.onCrisisCount?.(result.count),
            (result) => result.trace,
          ),
        },
        "timing-buy": {
          enabled: enabled.timing,
          build: withResult(
            (value) => buildTiming(value, "buy"),
            (result) => options.onTimingBuyCount?.(result.count),
            (result) => result.trace,
          ),
        },
        "timing-sell": {
          enabled: enabled.timing,
          build: withResult(
            (value) => buildTiming(value, "sell"),
            (result) => options.onTimingSellCount?.(result.count),
            (result) => result.trace,
          ),
        },
        insider: {
          enabled: enabled.insider,
          build: withResult(
            buildInsider,
            (result) => options.onInsiderStats?.(result.stats),
            (result) => result.traces,
          ),
        },
        disclosure: {
          enabled: enabled.disclosure,
          build: withResult(
            buildDisclosure,
            (result) => options.onDisclosureStats?.(result.stats),
            (result) => result.trace,
          ),
        },
      });
    }

    async function prepareMarketTimingModels(selected, seriesModels, preparationOptions = {}) {
      const targets = visibleTimingSeries(selected, seriesModels);
      if (!chartSession.showRecessionSignals
        || !targets.length) return;
      const preparationGeneration = captureTimingPreparationGeneration(targets);
      const preparationGenerationKey = timingPreparationGenerationKey(preparationGeneration);
      const progressDescriptor = marketTimingProgressDescriptor(targets, labelName);
      const taskKey = progressDescriptor.key;
      const taskLabel = progressDescriptor.label;
      let progressStarted = false;
      let progressToken = null;
      const ownsProgress = () => (
        timingProgressTasks.get(taskKey)?.token === progressToken
      );
      const adoptProgress = () => {
        const task = timingProgressTasks.get(taskKey);
        if (!task) return false;
        progressToken = task.token;
        progressStarted = true;
        return true;
      };
      const isCurrentPreparation = () => (
        isTimingPreparationGenerationCurrent(preparationGeneration)
      );
      const beginProgress = () => {
        if (progressStarted) return;
        if (adoptProgress()) return;
        progressToken = {};
        progressStarted = signalProgress?.begin?.(taskKey, taskLabel) === true;
        if (progressStarted) {
          timingProgressTasks.set(taskKey, {
            targets: new Set(targets.map(normalizeTimingTarget)),
            token: progressToken,
          });
        }
      };
      const cancelProgress = () => {
        if (!progressStarted || !ownsProgress()) return;
        timingProgressTasks.delete(taskKey);
        signalProgress?.cancel?.(taskKey);
      };
      const completeProgress = () => {
        if (!progressStarted || !ownsProgress()) return;
        timingProgressTasks.delete(taskKey);
        signalProgress?.complete?.(taskKey, taskLabel);
      };

      // Adopt progress exposed by the toggle before checking prerequisites, so
      // every early exit can also close that same visible task.
      adoptProgress();
      if (shouldPrepareMarketTimingModels() === false) {
        cancelProgress();
        return;
      }

      if (areMarketTimingInputsReady?.(targets) === false) {
        beginProgress();
        signalProgress?.update?.(taskKey, 0.04, taskLabel);
        try {
          const ready = await ensureMarketTimingInputs?.({ targets: [...targets] });
          if (!isCurrentPreparation()
            || ready === false
            || shouldPrepareMarketTimingModels() === false) {
            cancelProgress();
            return;
          }
        } catch (error) {
          cancelProgress();
          recordRuntimeError("market-timing-inputs", error, { targets: targets.length });
          return;
        }
      }

      const pricePayload = getPricePayload?.();
      const records = Array.isArray(pricePayload?.records)
        ? pricePayload.records
        : [];
      if (!records.length) {
        cancelProgress();
        return;
      }

      const sourceSeries = visibleTimingSeries(
        Array.isArray(preparationOptions.sourceSeries)
          ? preparationOptions.sourceSeries
          : selected,
        seriesModels,
      );
      const sourceTickers = [...new Set([
        "^KS11",
        "^KQ11",
        ...sourceSeries,
        ...targets,
      ].filter(isForecastSeries))].sort();
      const volumeMaps = getTickerVolumeSeriesByTicker?.() || new Map();
      const volumeEntriesByTicker = new Map(sourceTickers.map((ticker) => [
        ticker,
        sortedVolumeEntries(volumeMaps, ticker),
      ]));
      const missingVolumeTargets = sourceTickers.filter((ticker) => (
        (volumeEntriesByTicker.get(ticker)?.length || 0) < MINIMUM_TIMING_VOLUME_POINTS
      ));
      if (missingVolumeTargets.length) {
        cancelProgress();
        return;
      }
      const volatilityRows = getAdrRows?.() || [];
      const macroRows = getMacroRows?.() || [];
      const creditRows = getCreditRows?.() || [];
      const crisisRows = getCrisisRows?.() || [];
      if (!volatilityRows.length || !macroRows.length || !creditRows.length) {
        cancelProgress();
        return;
      }

      if (!getMarketTimingService?.()) {
        beginProgress();
        signalProgress?.update?.(taskKey, 0.08, taskLabel);
        try {
          await ensureMarketTimingFeature();
          if (!isCurrentPreparation()) {
            cancelProgress();
            return;
          }
        } catch (error) {
          cancelProgress();
          throw error;
        }
      }
      const service = getMarketTimingService?.();
      if (!service) {
        cancelProgress();
        return;
      }
      const sourceRevision = dataRevisionSignature(...APP_DATA_COMPONENT_GROUPS.analysis);
      const volumeRevision = sourceTickers.map((ticker) => (
        `${ticker}:${volumeTimelineRevision(volumeEntriesByTicker.get(ticker) || [])}`
      )).join(",");
      const first = records[0] || {};
      const latest = records.at(-1) || {};
      const signature = [
        "market-timing-v9",
        sourceRevision,
        `volume:${volumeRevision}`,
        sourceTickers.join(","),
        first.date || "",
        latest.date || "",
      ].join("|");
      const preparationKey = `${signature}|${targets.join(",")}`;
      if (lastTimingPreparationKey === preparationKey
        && targets.every((ticker) => service.has?.(ticker))) {
        cancelProgress();
        return;
      }
      if (pendingTimingPreparation?.key === preparationKey
        && pendingTimingPreparation.generationKey === preparationGenerationKey) {
        return pendingTimingPreparation.promise;
      }
      beginProgress();
      signalProgress?.update?.(taskKey, 0.22, taskLabel);
      let sources;
      if (service.stats().signature !== signature) {
        const dates = records.map((row) => String(row?.date || "").slice(0, 10));
        const pricesByTicker = Object.fromEntries(sourceTickers.map((ticker) => [
          ticker,
          records.map((row) => row?.[ticker] ?? null),
        ]));
        const volumesByTicker = Object.fromEntries(sourceTickers.flatMap((ticker) => {
          const entries = volumeEntriesByTicker.get(ticker) || [];
          return entries.length ? [[ticker, entries]] : [];
        }));
        sources = {
          dates,
          pricesByTicker,
          volumesByTicker,
          adrRows: volatilityRows,
          volatilityRows,
          macroRows,
          creditRows,
          crisisRows,
        };
      }
      signalProgress?.update?.(taskKey, 0.42, taskLabel);
      const startedAt = startPerfSample();
      const preparation = (async () => {
        await service.prepare({
          signature,
          targets,
          ...(sources ? { sources } : {}),
        });
        if (!isCurrentPreparation()) return false;
        signalProgress?.update?.(taskKey, 0.92, taskLabel);
        lastTimingPreparationKey = preparationKey;
        recordPerfSample("prepareMarketTimingModels", startedAt, {
          targets: targets.length,
          models: service.stats().modelCount,
        });
        return true;
      })();
      pendingTimingPreparation = {
        generationKey: preparationGenerationKey,
        key: preparationKey,
        promise: preparation,
        targets: new Set(targets.map(normalizeTimingTarget)),
      };
      try {
        const completed = await preparation;
        if (!completed || !isCurrentPreparation()) {
          cancelProgress();
          return;
        }
        completeProgress();
      } catch (error) {
        cancelProgress();
        recordRuntimeError("market-timing-worker", error, { targets: targets.length });
      } finally {
        if (pendingTimingPreparation?.promise === preparation) pendingTimingPreparation = null;
      }
    }

    return Object.freeze({
      buildCrisis,
      buildDisclosure,
      buildInsider,
      buildTimingBuy: (frame) => buildTiming(frame, "buy"),
      buildTimingSell: (frame) => buildTiming(frame, "sell"),
      beginMarketTimingProgress,
      cancelMarketTimingPreparation,
      collectCrisisSignalEntries,
      createFrame,
      createSpecs,
      findPointOnOrAfterDate,
      prepareMarketTimingModels,
      visibleTimingSeries,
    });
  }

  export const chartMarkerRuntime = Object.freeze({
    CHART_MARKER_DEFAULTS,
    EVENT_MARKER_DESCRIPTORS,
    EVENT_MARKER_FONT_FAMILY,
    MINIMUM_TIMING_VOLUME_POINTS,
    buildEventMarkerTextFont,
    buildEventMarkerPopoverGroup,
    collectCrisisSignalEntries,
    buildTimingSignalPopoverGroup,
    compactTimingReasons,
    createEventMarkerRenderState,
    createEventMarkerSpecs,
    createChartMarkerRuntime,
    createMarketTimingInputGate,
    eventMarkerDescriptor,
    eventMarkerIdentity,
    eventMarkerKind,
    eventMarkerLayer,
    findPointOnOrAfterDate,
    isDirectlyInteractiveEventMarkerTrace,
    isEventMarkerTrace,
    isTimingSignalTrace,
    materializeEventMarkerTraces,
    marketTimingProgressDescriptor,
  });

  // One baked graph owns every marker-to-price date binding for an element.
  let markerBindingGraphCache = new WeakMap();
  const markerBindingGraphCounters = { hits: 0, misses: 0 };

  function asTraceList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }

  function markerValueMatches(left, right) {
    if (left === right) return true;
    if (left == null || right == null || typeof left !== typeof right) return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && markerArrayMatches(left, right);
    }
    if (typeof left !== "object") return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => (
      Object.hasOwn(right, key) && markerValueMatches(left[key], right[key])
    ));
  }

  function markerArrayMatches(left, right) {
    if (left === right) return true;
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!markerValueMatches(left[index], right[index])) return false;
    }
    return true;
  }

  function markerPayloadMatches(current, next) {
    return ["x", "customdata", "text", "hovertext", "ids"].every((key) => (
      markerArrayMatches(current?.[key] ?? null, next?.[key] ?? null)
    )) && markerArrayMatches(
      current?.meta?.markerAnchorValues ?? null,
      next?.meta?.markerAnchorValues ?? null,
    );
  }

  function collectYUpdates(element, specs = []) {
    const traceIndexes = [];
    const yUpdates = [];
    const updated = [];
    let structureChanged = false;
    const currentTraces = Array.isArray(element?.data) ? element.data : [];

    (Array.isArray(specs) ? specs : []).forEach((spec) => {
      if (!spec?.enabled || typeof spec.matches !== "function") return;
      const nextTraces = asTraceList(typeof spec.build === "function" ? spec.build() : spec.traces);
      const currentIndexes = currentTraces.flatMap((trace, index) => (
        spec.matches(trace) ? [index] : []
      ));
      const keyOf = typeof spec.keyOf === "function" ? spec.keyOf : null;

      currentIndexes.forEach((traceIndex, index) => {
        const current = currentTraces[traceIndex];
        const next = keyOf
          ? nextTraces.find((trace) => keyOf(trace) === keyOf(current))
          : nextTraces[index];
        if (!next || !Array.isArray(next.y)) {
          structureChanged = true;
          return;
        }
        if (!markerPayloadMatches(current, next)) {
          structureChanged = true;
          return;
        }
        if (markerArrayMatches(current.y, next.y)) return;
        traceIndexes.push(traceIndex);
        yUpdates.push(next.y);
        if (spec.id && !updated.includes(spec.id)) updated.push(spec.id);
      });
      if (nextTraces.length !== currentIndexes.length) structureChanged = true;
    });

    return { traceIndexes, yUpdates, updated, structureChanged };
  }

  function markerBindingGraphMatches(cached, traces) {
    if (!cached
      || cached.traceCount !== traces.length
      || !cached.traceRefs.every((trace, index) => trace === traces[index])) return false;
    return cached.sourceEntries.every((entry) => {
      const trace = traces[entry.traceIndex];
      return trace === entry.trace
        && trace?.x === entry.x
        && trace?.meta?.seriesKey === entry.seriesKey
        && trace?.x?.length === entry.pointCount
        && trace?.x?.[0] === entry.firstX
        && trace?.x?.[entry.pointCount - 1] === entry.lastX;
    }) && cached.markerEntries.every((entry) => {
      const trace = traces[entry.traceIndex];
      return trace === entry.trace
        && trace?.x === entry.x
        && trace?.meta?.pointTickers === entry.pointTickers
        && (Array.isArray(trace?.meta?.markerGapFactors)
          ? trace.meta.markerGapFactors
          : null) === entry.gapFactors
        && (Array.isArray(trace?.meta?.markerAnchorValues)
          ? trace.meta.markerAnchorValues
          : null) === entry.anchorValues
        && trace?.x?.length === entry.pointCount
        && trace?.x?.[0] === entry.firstX
        && trace?.x?.[entry.pointCount - 1] === entry.lastX;
    });
  }

  /** Bakes every event date to one owning price index per chart structure. */
  function buildMarkerBindingGraph(traces) {
    const sourceBySeries = new Map();
    const sourceEntries = [];
    traces.forEach((trace, traceIndex) => {
      if (trace?.meta?.overlayKind !== "price" || !trace?.meta?.seriesKey
        || !Array.isArray(trace.x)) return;
      const dateIndexes = new Map();
      trace.x.forEach((date, sourceIndex) => dateIndexes.set(String(date || ""), sourceIndex));
      sourceBySeries.set(String(trace.meta.seriesKey), { traceIndex, dateIndexes });
      sourceEntries.push({
        trace,
        traceIndex,
        x: trace.x,
        seriesKey: trace.meta.seriesKey,
        pointCount: trace.x.length,
        firstX: trace.x[0],
        lastX: trace.x[trace.x.length - 1],
      });
    });

    const markerEntries = [];
    const bindings = [];
    const bindingsBySeries = new Map();
    traces.forEach((trace, markerTraceIndex) => {
      if (!isEventMarkerTrace(trace)) return;
      const pointTickers = Array.isArray(trace?.meta?.pointTickers)
        ? trace.meta.pointTickers
        : [];
      const gapFactors = Array.isArray(trace?.meta?.markerGapFactors)
        ? trace.meta.markerGapFactors
        : null;
      const anchorValues = Array.isArray(trace?.meta?.markerAnchorValues)
        ? trace.meta.markerAnchorValues
        : null;
      const pointCount = Math.min(
        trace?.x?.length || 0,
        trace?.y?.length || 0,
        pointTickers.length,
      );
      if (!pointCount) return;
      const points = [];
      for (let markerIndex = 0; markerIndex < pointCount; markerIndex += 1) {
        const seriesKey = String(pointTickers[markerIndex] || "");
        const source = sourceBySeries.get(seriesKey);
        const sourceIndex = source?.dateIndexes.get(String(trace.x[markerIndex] || ""));
        const factor = Number(gapFactors?.[markerIndex]);
        const anchorY = Number(anchorValues?.[markerIndex]);
        if (!Number.isInteger(sourceIndex) && !Number.isFinite(anchorY)) continue;
        const point = {
          anchorY: Number.isFinite(anchorY) ? anchorY : null,
          factor: Number.isFinite(factor) ? factor : null,
          markerIndex,
          seriesKey,
          sourceIndex: Number.isInteger(sourceIndex) ? sourceIndex : -1,
          sourceTraceIndex: Number.isInteger(sourceIndex) ? source.traceIndex : -1,
        };
        points.push(point);
        let seriesBindings = bindingsBySeries.get(seriesKey);
        if (!seriesBindings) {
          seriesBindings = new Map();
          bindingsBySeries.set(seriesKey, seriesBindings);
        }
        let seriesBinding = seriesBindings.get(markerTraceIndex);
        if (!seriesBinding) {
          seriesBinding = { markerTraceIndex, points: [] };
          seriesBindings.set(markerTraceIndex, seriesBinding);
        }
        seriesBinding.points.push(point);
      }
      markerEntries.push({
        trace,
        traceIndex: markerTraceIndex,
        x: trace.x,
        pointTickers,
        gapFactors,
        anchorValues,
        pointCount,
        firstX: trace.x[0],
        lastX: trace.x[pointCount - 1],
      });
      if (points.length) bindings.push({ markerTraceIndex, points });
    });
    return {
      bindings,
      bindingsBySeries: new Map([...bindingsBySeries].map(([seriesKey, entries]) => (
        [seriesKey, [...entries.values()]]
      ))),
      markerEntries,
      sourceEntries,
      traceCount: traces.length,
      traceRefs: traces.slice(),
    };
  }

  function markerBindingGraph(element, traces) {
    let cached = markerBindingGraphCache.get(element);
    if (!markerBindingGraphMatches(cached, traces)) {
      cached = buildMarkerBindingGraph(traces);
      markerBindingGraphCache.set(element, cached);
      markerBindingGraphCounters.misses += 1;
    } else {
      markerBindingGraphCounters.hits += 1;
    }
    return cached;
  }

  /** Keeps every dated event marker attached to its owning price trace during live fitting. */
  function collectViewportAnchoredYUpdates(element, options = {}) {
    const sourceTraces = Array.isArray(element?.data) ? element.data : [];
    const traces = Array.isArray(options.traces) ? options.traces : sourceTraces;
    const viewportRange = Array.isArray(options.viewportRange)
      ? options.viewportRange.slice(0, 2).map(Number)
      : [];
    const span = viewportRange.length === 2
      ? Math.abs(viewportRange[1] - viewportRange[0])
      : 0;
    const gapRatio = Number.isFinite(Number(options.gapRatio))
      ? Number(options.gapRatio)
      : CHART_MARKER_DEFAULTS.constants.eventMarkerGapRatio;
    if (!(span > 1e-9) || !(gapRatio > 0)) return { traceIndexes: [], yUpdates: [] };

    const markerGap = span * gapRatio;
    const transformBySeries = new Map((options.seriesUpdates || []).flatMap((update) => (
      update?.seriesKey && update?.viewportTransform
        ? [[String(update.seriesKey), update.viewportTransform]]
        : []
    )));
    const traceIndexes = [];
    const yUpdates = [];
    markerBindingGraph(element, sourceTraces).bindings.forEach(({ markerTraceIndex, points }) => {
      const trace = traces[markerTraceIndex];
      if (!trace || !Array.isArray(trace.y)) return;
      let changed = false;
      const nextY = trace.y.slice();
      points.forEach(({
        anchorY,
        factor,
        markerIndex,
        seriesKey,
        sourceIndex,
        sourceTraceIndex,
      }) => {
        if (!Number.isFinite(factor)) return;
        const attachedY = Number(traces[sourceTraceIndex]?.y?.[sourceIndex]);
        const transform = transformBySeries.get(seriesKey);
        const transformedAnchor = transform && Number.isFinite(anchorY)
          ? 100
            + ((anchorY - transform.center) * transform.viewportScale * transform.seriesScale)
            + transform.offset
          : anchorY;
        const sourceY = Number.isFinite(attachedY) ? attachedY : transformedAnchor;
        if (!Number.isFinite(sourceY)) return;
        const value = sourceY + markerGap * factor;
        if (Math.abs(value - Number(trace.y[markerIndex])) <= 1e-9) return;
        nextY[markerIndex] = value;
        changed = true;
      });
      if (!changed) return;
      traceIndexes.push(markerTraceIndex);
      yUpdates.push(nextY);
    });
    return { traceIndexes, yUpdates };
  }

  function clearMarkerBindingCache(element = null) {
    if (element) markerBindingGraphCache.delete(element);
    else markerBindingGraphCache = new WeakMap();
  }

  function markerBindingCacheStats() {
    return { ...markerBindingGraphCounters };
  }

  function collectSeriesYDeltaUpdates(element, options = {}) {
    const traces = Array.isArray(element?.data) ? element.data : [];
    const seriesKey = String(options.seriesKey || "");
    const sourceTrace = traces[Number(options.sourceTraceIndex)];
    const nextSourceY = Array.isArray(options.nextY) ? options.nextY : [];
    if (!seriesKey || !sourceTrace || !Array.isArray(sourceTrace.x)
      || !Array.isArray(sourceTrace.y) || !nextSourceY.length) {
      return { traceIndexes: [], yUpdates: [] };
    }

    const sourceCount = Math.min(sourceTrace.x.length, sourceTrace.y.length, nextSourceY.length);
    const traceIndexes = [];
    const yUpdates = [];
    const bindings = markerBindingGraph(element, traces).bindingsBySeries.get(seriesKey) || [];
    bindings.forEach((binding) => {
      const trace = traces[binding.markerTraceIndex];
      if (!trace || !Array.isArray(trace.y)) return;
      let y = null;
      let changed = false;
      binding.points.forEach(({ markerIndex, sourceIndex }) => {
        if (sourceIndex < 0 || sourceIndex >= sourceCount) return;
        const currentSource = Number(sourceTrace.y[sourceIndex]);
        const nextSource = Number(nextSourceY[sourceIndex]);
        const currentMarker = Number(trace.y[markerIndex]);
        const delta = nextSource - currentSource;
        if (!Number.isFinite(delta) || !Number.isFinite(currentMarker) || delta === 0) return;
        if (!y) y = trace.y.slice();
        y[markerIndex] = currentMarker + delta;
        changed = true;
      });
      if (!changed) return;
      traceIndexes.push(binding.markerTraceIndex);
      yUpdates.push(y);
    });
    return { traceIndexes, yUpdates };
  }

  export const chartMarkerLayout = Object.freeze({
    clearMarkerBindingCache,
    collectSeriesYDeltaUpdates,
    collectViewportAnchoredYUpdates,
    collectYUpdates,
    markerBindingCacheStats,
    markerArrayMatches,
    markerPayloadMatches,
  });
