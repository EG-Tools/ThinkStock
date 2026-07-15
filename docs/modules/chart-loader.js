(function () {
  const currentScriptUrl = document.currentScript?.src || "";
  const cacheBuster = (() => {
    try {
      return new URL(currentScriptUrl, window.location.href).search || "";
    } catch (_) {
      return "";
    }
  })();
  const PLOTLY_SCRIPT_URL = `./vendor/plotly-basic-2.35.2.min.js${cacheBuster}`;
  let plotlyLoadPromise = null;

  function ensurePlotlyLoaded() {
    if (window.Plotly) return Promise.resolve(window.Plotly);
    if (plotlyLoadPromise) return plotlyLoadPromise;

    plotlyLoadPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(
        'script[data-thinkstock-plotly="true"], script[src*="plotly-basic-2.35.2.min.js"]'
      );
      const complete = () => {
        if (window.Plotly) {
          resolve(window.Plotly);
        } else {
          reject(new Error("Plotly initialized without exposing window.Plotly"));
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

  window.ThinkStockChartLoader = {
    ensurePlotlyLoaded,
  };
})();
