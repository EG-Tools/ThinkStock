(function initThinkStockChartLoader(globalScope) {
  "use strict";

  const PLOTLY_CONFIG = Object.freeze({
    responsive: true,
    displayModeBar: false,
    displaylogo: false,
    scrollZoom: false,
    doubleClick: false,
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
  let plotlyLoadPromise = null;

  function ensurePlotlyLoaded() {
    if (globalScope.Plotly) return Promise.resolve(globalScope.Plotly);
    if (plotlyLoadPromise) return plotlyLoadPromise;

    plotlyLoadPromise = new Promise((resolve, reject) => {
      const document = globalScope.document;
      if (!document) {
        reject(new Error("Plotly document is unavailable"));
        return;
      }
      const existingScript = document.querySelector(
        'script[data-thinkstock-plotly="true"], script[src*="plotly-thinkstock-2.35.2.min.js"]'
      );
      const complete = () => {
        if (globalScope.Plotly) {
          resolve(globalScope.Plotly);
        } else {
          reject(new Error("Plotly initialized without exposing Plotly"));
        }
      };

      if (existingScript) {
        existingScript.addEventListener("load", complete, { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Plotly failed to load")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = PLOTLY_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.dataset.thinkstockPlotly = "true";
      script.addEventListener("load", complete, { once: true });
      script.addEventListener("error", () => reject(new Error("Plotly failed to load")), { once: true });
      document.head.appendChild(script);
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

  function hoverLabel(showPopup, fontSize) {
    return showPopup
      ? {
        bgcolor: "rgba(34,34,34,0.45)",
        bordercolor: "rgba(140,140,140,0.35)",
        font: { color: "#eee", ...(fontSize ? { size: fontSize } : {}) },
      }
      : {
        bgcolor: "rgba(0,0,0,0)",
        bordercolor: "rgba(0,0,0,0)",
        font: { color: "rgba(0,0,0,0)", size: 1 },
      };
  }

  globalScope.ThinkStockChartLoader = Object.freeze({
    PLOTLY_CONFIG,
    ensurePlotlyLoaded,
    ensurePlotlyReady,
    hoverLabel,
  });
}(typeof self !== "undefined" ? self : globalThis));
