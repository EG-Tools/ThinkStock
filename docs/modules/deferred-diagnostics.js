(function initThinkStockDeferredDiagnostics(globalScope) {
  "use strict";

  const scriptLoads = new Map();

  function loadScriptGlobal(scope, scriptUrl, globalName, datasetKey = "thinkstockLazyModule") {
    if (scope[globalName]) return Promise.resolve(scope[globalName]);
    const key = String(scriptUrl || "");
    if (!key) return Promise.reject(new Error(`${globalName} URL is missing`));
    if (scriptLoads.has(key)) return scriptLoads.get(key);

    const promise = new Promise((resolve, reject) => {
      const selector = `script[data-${datasetKey.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}="true"]`;
      let script = scope.document?.querySelector?.(selector);
      let shouldAppend = false;
      const complete = () => {
        if (scope[globalName]) resolve(scope[globalName]);
        else reject(new Error(`${globalName} failed to load`));
      };
      const fail = () => reject(new Error(`${globalName} failed to load`));
      if (!script) {
        script = scope.document.createElement("script");
        script.src = key;
        script.async = true;
        script.dataset[datasetKey] = "true";
        shouldAppend = true;
      }
      if (scope[globalName]) {
        complete();
        return;
      }
      script.addEventListener("load", complete, { once: true });
      script.addEventListener("error", fail, { once: true });
      if (shouldAppend) scope.document.head.appendChild(script);
    }).catch((error) => {
      scriptLoads.delete(key);
      throw error;
    });
    scriptLoads.set(key, promise);
    return promise;
  }

  function createDeferredDiagnostics(scope = globalScope, options = {}) {
    const scriptUrl = String(options.scriptUrl || "");
    const createOptions = options.createOptions || {};
    let instance = null;
    let loadPromise = null;
    let loadTimer = 0;
    let idleHandle = 0;

    function createInstance() {
      const module = scope.ThinkStockPerformanceDiagnostics;
      if (!module?.createPerformanceDiagnostics) {
        throw new Error("Performance diagnostics module failed to load");
      }
      if (!instance) instance = module.createPerformanceDiagnostics(scope, createOptions);
      return instance;
    }

    function ensure() {
      if (instance) return Promise.resolve(instance);
      if (scope.ThinkStockPerformanceDiagnostics) {
        return Promise.resolve(createInstance());
      }
      if (loadPromise) return loadPromise;
      if (!scriptUrl) return Promise.reject(new Error("Performance diagnostics URL is missing"));

      loadPromise = loadScriptGlobal(
        scope,
        scriptUrl,
        "ThinkStockPerformanceDiagnostics",
        "thinkstockPerformanceDiagnostics",
      ).then(() => createInstance()).catch((error) => {
        loadPromise = null;
        throw error;
      });
      return loadPromise;
    }

    function scheduleAutomaticCapture(metadata = {}, scheduleOptions = {}) {
      const delayMs = Math.max(1000, Number(scheduleOptions.delayMs) || 30000);
      const idleTimeoutMs = Math.max(1000, Number(scheduleOptions.idleTimeoutMs) || 10000);
      if (loadTimer) scope.clearTimeout?.(loadTimer);
      loadTimer = scope.setTimeout?.(() => {
        loadTimer = 0;
        const run = () => {
          idleHandle = 0;
          ensure()
            .then((diagnostics) => diagnostics.startAutomaticCapture(metadata))
            .catch(() => {});
        };
        if (typeof scope.requestIdleCallback === "function") {
          idleHandle = scope.requestIdleCallback(run, { timeout: idleTimeoutMs });
        } else {
          idleHandle = scope.setTimeout?.(run, 250) || 0;
        }
      }, delayMs) || 0;
    }

    function cancelScheduledCapture() {
      if (loadTimer) scope.clearTimeout?.(loadTimer);
      if (idleHandle) {
        if (typeof scope.cancelIdleCallback === "function") scope.cancelIdleCallback(idleHandle);
        else scope.clearTimeout?.(idleHandle);
      }
      loadTimer = 0;
      idleHandle = 0;
    }

    return Object.freeze({
      ensure,
      scheduleAutomaticCapture,
      cancelScheduledCapture,
      isLoaded: () => Boolean(instance),
    });
  }

  globalScope.ThinkStockDeferredDiagnostics = Object.freeze({
    createDeferredDiagnostics,
    loadScriptGlobal,
  });
}(typeof self !== "undefined" ? self : globalThis));
