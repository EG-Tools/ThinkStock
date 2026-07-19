(function initThinkStockServiceWorkerClient(global) {
  function createServiceWorkerClient(scope = global) {
    let registrationScheduled = false;

    function requestDataRefresh(timeoutMs = 15000) {
      return new Promise((resolve) => {
        try {
          const controller = scope.navigator?.serviceWorker?.controller;
          const MessageChannelClass = scope.MessageChannel;
          if (!controller || typeof MessageChannelClass !== "function") {
            resolve({ ok: false, unavailable: true });
            return;
          }

          const channel = new MessageChannelClass();
          let settled = false;
          const done = (result) => {
            if (settled) return;
            settled = true;
            scope.clearTimeout(timer);
            resolve(result && typeof result === "object"
              ? result
              : { ok: Boolean(result), refreshed: 0, reused: 0, failed: 0 });
          };
          channel.port1.onmessage = (event) => done(event?.data || { ok: false });
          const timer = scope.setTimeout(() => done({ ok: false, timeout: true }), timeoutMs);
          controller.postMessage("REFRESH_DATA", [channel.port2]);
        } catch (_) {
          resolve({ ok: false, unavailable: true });
        }
      });
    }

    function scheduleRegistration() {
      const serviceWorker = scope.navigator?.serviceWorker;
      if (registrationScheduled || !serviceWorker) return false;
      registrationScheduled = true;
      const register = () => serviceWorker.register("./sw.js").catch(() => null);
      if (scope.document?.readyState === "complete") register();
      else scope.addEventListener?.("load", register, { once: true });
      return true;
    }

    return { requestDataRefresh, scheduleRegistration };
  }

  global.ThinkStockServiceWorkerClient = { createServiceWorkerClient };
}(typeof self !== "undefined" ? self : globalThis));
