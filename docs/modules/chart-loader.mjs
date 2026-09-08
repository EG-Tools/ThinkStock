const globalScope = typeof self !== "undefined" ? self : globalThis;

  const PLOTLY_CONFIG = Object.freeze({
    responsive: true,
    displayModeBar: false,
    displaylogo: false,
    scrollZoom: false,
    doubleClick: false,
  });
  const PLOTLY_THEME = Object.freeze({
    axisColor: "#666",
    fontColor: "#ccc",
    fontFamily: "Apple SD Gothic Neo, Pretendard, sans-serif",
    gridColor: "rgba(255,255,255,0.06)",
    hoverBackground: "rgba(34,34,34,0.45)",
    hoverBorder: "rgba(140,140,140,0.35)",
    hoverColor: "#eee",
    hoverDateFormat: "%Y.%-m.%-d",
    hoverDistance: 26,
    hoverFontSize: 12,
    paperBackground: "transparent",
    plotBackground: "#111111",
  });
  const currentScriptUrl = globalScope.document?.currentScript?.src || "";
  const cacheBuster = (() => {
    try {
      return new URL(currentScriptUrl, globalScope.location?.href || "http://localhost/").search || "";
    } catch (_) {
      return "";
    }
  })();
  const PLOTLY_SCRIPT_URL = `./vendor/plotly-thinkstock-2.35.2.min.js${cacheBuster}`;
  const PLOTLY_LOAD_TIMEOUT_MS = 12000;
  let plotlyLoadPromise = null;
  let visualThemeCache = null;

  function removePlotlyScript(script) {
    if (!script) return;
    try {
      if (typeof script.remove === "function") script.remove();
      else script.parentNode?.removeChild?.(script);
    } catch (_) {
      script.parentNode?.removeChild?.(script);
    }
  }

  function ensurePlotlyLoaded() {
    if (globalScope.Plotly) return Promise.resolve(globalScope.Plotly);
    if (plotlyLoadPromise) return plotlyLoadPromise;

    plotlyLoadPromise = new Promise((resolve, reject) => {
      const document = globalScope.document;
      if (!document) {
        reject(new Error("Plotly document is unavailable"));
        return;
      }
      let script = document.querySelector(
        'script[data-thinkstock-plotly="true"], script[src*="plotly-thinkstock-2.35.2.min.js"]'
      );
      if (script?.dataset?.thinkstockPlotlyState === "failed") {
        removePlotlyScript(script);
        script = null;
      }
      if (!script) {
        script = document.createElement("script");
        script.src = document.querySelector("link[data-thinkstock-plotly-preload]")?.href
          || PLOTLY_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.dataset.thinkstockPlotly = "true";
      }
      let settled = false;
      let timeoutId = 0;
      const cleanup = () => {
        script.removeEventListener?.("load", complete);
        script.removeEventListener?.("error", fail);
        if (timeoutId) globalScope.clearTimeout?.(timeoutId);
        timeoutId = 0;
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        script.dataset.thinkstockPlotlyState = "failed";
        removePlotlyScript(script);
        reject(new Error("Plotly failed to load"));
      };
      const complete = () => {
        if (settled) return;
        if (globalScope.Plotly) {
          settled = true;
          cleanup();
          script.dataset.thinkstockPlotlyState = "loaded";
          resolve(globalScope.Plotly);
        } else {
          fail();
        }
      };
      script.addEventListener("load", complete, { once: true });
      script.addEventListener("error", fail, { once: true });
      timeoutId = globalScope.setTimeout?.(fail, PLOTLY_LOAD_TIMEOUT_MS) || 0;
      if (!script.isConnected) document.head.appendChild(script);
    }).catch((error) => {
      plotlyLoadPromise = null;
      throw error;
    });

    return plotlyLoadPromise;
  }

  function ensurePlotlyReady() {
    if (globalScope.Plotly) return Promise.resolve(globalScope.Plotly);
    return ensurePlotlyLoaded().catch((error) => {
      throw new Error(error?.message || "차트 엔진을 불러오지 못했습니다. 앱을 새로고침해 주세요.");
    });
  }

  function cssThemeValue(property, fallback) {
    try {
      const root = globalScope.document?.documentElement;
      const value = root && globalScope.getComputedStyle?.(root)?.getPropertyValue(property)?.trim();
      return value || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function visualTheme() {
    if (visualThemeCache) return visualThemeCache;
    visualThemeCache = Object.freeze({
      ...PLOTLY_THEME,
      axisColor: cssThemeValue("--chart-axis-color", PLOTLY_THEME.axisColor),
      fontColor: cssThemeValue("--chart-font-color", PLOTLY_THEME.fontColor),
      fontFamily: cssThemeValue("--chart-font-family", PLOTLY_THEME.fontFamily),
      gridColor: cssThemeValue("--chart-grid-color", PLOTLY_THEME.gridColor),
      hoverBackground: cssThemeValue("--chart-hover-bg", PLOTLY_THEME.hoverBackground),
      hoverBorder: cssThemeValue("--chart-hover-border", PLOTLY_THEME.hoverBorder),
      hoverColor: cssThemeValue("--chart-hover-color", PLOTLY_THEME.hoverColor),
      plotBackground: cssThemeValue("--chart-plot-bg", PLOTLY_THEME.plotBackground),
    });
    return visualThemeCache;
  }

  function layoutStyle(options = {}) {
    const theme = visualTheme();
    return {
      paper_bgcolor: options.paperBackground ?? theme.paperBackground,
      plot_bgcolor: options.plotBackground ?? theme.plotBackground,
      hoverdistance: Number.isFinite(Number(options.hoverDistance))
        ? Number(options.hoverDistance)
        : theme.hoverDistance,
      font: {
        color: options.fontColor ?? theme.fontColor,
        family: options.fontFamily ?? theme.fontFamily,
        ...(Number.isFinite(Number(options.fontSize)) ? { size: Number(options.fontSize) } : {}),
      },
    };
  }

  function axisStyle(options = {}) {
    const theme = visualTheme();
    return {
      showgrid: options.showGrid !== false,
      gridcolor: options.gridColor ?? theme.gridColor,
      gridwidth: Number(options.gridWidth) || 1,
      zeroline: false,
      color: options.axisColor ?? theme.axisColor,
      tickfont: { size: Number(options.tickFontSize) || 10 },
    };
  }

  function hoverLabel(showPopup, fontSize) {
    const theme = visualTheme();
    return showPopup
      ? {
        bgcolor: theme.hoverBackground,
        bordercolor: theme.hoverBorder,
        font: {
          color: theme.hoverColor,
          family: theme.fontFamily,
          size: Number(fontSize) || theme.hoverFontSize,
        },
      }
      : {
        bgcolor: "rgba(0,0,0,0)",
        bordercolor: "rgba(0,0,0,0)",
        font: { color: "rgba(0,0,0,0)", size: 1 },
      };
  }

  export const chartLoader = Object.freeze({
    PLOTLY_CONFIG,
    PLOTLY_THEME,
    axisStyle,
    ensurePlotlyLoaded,
    ensurePlotlyReady,
    hoverLabel,
    layoutStyle,
    visualTheme,
  });

export {
  PLOTLY_CONFIG,
  PLOTLY_THEME,
  axisStyle,
  ensurePlotlyLoaded,
  ensurePlotlyReady,
  hoverLabel,
  layoutStyle,
  visualTheme,
};
