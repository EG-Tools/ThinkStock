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
      name: traces.map((trace) => trace.name ?? ""),
      text: traces.map((trace) => trace.text ?? null),
      customdata: traces.map((trace) => trace.customdata ?? null),
      meta: traces.map((trace) => trace.meta ?? null),
      line: traces.map((trace) => trace.line ?? null),
      marker: traces.map((trace) => trace.marker ?? null),
      connectgaps: traces.map((trace) => trace.connectgaps ?? false),
      cliponaxis: traces.map((trace) => trace.cliponaxis ?? true),
      showlegend: traces.map((trace) => trace.showlegend ?? true),
      legendgroup: traces.map((trace) => trace.legendgroup ?? ""),
      yaxis: traces.map((trace) => trace.yaxis ?? "y"),
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
    let attemptedPartial = false;
    if (canApplyPartialUpdate(element, traces)) {
      attemptedPartial = true;
      try {
        await plotly.update(
          element,
          restylePayload(traces),
          relayoutPayload(layout),
          traces.map((_, index) => index),
        );
        return { mode: "partial", attemptedPartial };
      } catch (_) {
        // A plugin may mutate the trace structure between compatibility check and update.
      }
    }
    await plotly.react(element, traces, layout, config);
    return { mode: "full", attemptedPartial };
  }

  globalScope.ThinkStockMainChartRenderer = Object.freeze({
    canApplyPartialUpdate,
    relayoutPayload,
    render,
    restylePayload,
    traceIdentity,
  });
}(typeof self !== "undefined" ? self : globalThis));
