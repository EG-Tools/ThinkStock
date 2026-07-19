(function initThinkStockMainChartRenderer(globalScope) {
  "use strict";

  function traceIdentity(trace) {
    if (trace?.meta?.isDisclosureTrace) return "disclosure";
    const seriesKey = String(trace?.meta?.seriesKey || "");
    return seriesKey ? `series:${seriesKey}` : "";
  }

  function canApplyPartialUpdate(element, traces) {
    if (!element?._fullLayout?.xaxis || !element?._fullLayout?.yaxis || !Array.isArray(element.data)) {
      return false;
    }
    if (!Array.isArray(traces) || element.data.length !== traces.length || !traces.length) return false;
    return traces.every((trace, index) => (
      traceIdentity(trace)
      && traceIdentity(trace) === traceIdentity(element.data[index])
      && trace.type === element.data[index]?.type
      && trace.mode === element.data[index]?.mode
    ));
  }

  function restylePayload(traces) {
    return {
      x: traces.map((trace) => trace.x || []),
      y: traces.map((trace) => trace.y || []),
      text: traces.map((trace) => trace.text ?? null),
      customdata: traces.map((trace) => trace.customdata ?? null),
      hoverinfo: traces.map((trace) => trace.hoverinfo ?? null),
      hovertemplate: traces.map((trace) => trace.hovertemplate ?? null),
      visible: traces.map((trace) => trace.visible ?? true),
    };
  }

  function relayoutPayload(layout) {
    const payload = {
      hovermode: layout.hovermode,
      "xaxis.autorange": false,
      "xaxis.range": [...layout.xaxis.range],
    };
    if (Array.isArray(layout.yaxis.range) && layout.yaxis.range.length === 2) {
      payload["yaxis.autorange"] = false;
      payload["yaxis.range"] = [...layout.yaxis.range];
    } else {
      payload["yaxis.autorange"] = true;
    }
    return payload;
  }

  async function render(plotly, element, traces, layout, config) {
    if (canApplyPartialUpdate(element, traces)) {
      try {
        await plotly.update(
          element,
          restylePayload(traces),
          relayoutPayload(layout),
          traces.map((_, index) => index),
        );
        return { mode: "partial", attemptedPartial: true };
      } catch (_) {
        // A plugin may mutate the trace structure between compatibility check and update.
      }
    }
    await plotly.react(element, traces, layout, config);
    return { mode: "full", attemptedPartial: false };
  }

  globalScope.ThinkStockMainChartRenderer = Object.freeze({
    canApplyPartialUpdate,
    relayoutPayload,
    render,
    restylePayload,
    traceIdentity,
  });
}(typeof self !== "undefined" ? self : globalThis));
