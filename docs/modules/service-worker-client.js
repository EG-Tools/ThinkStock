(function initThinkStockServiceWorkerClient(global) {
  function createServiceWorkerClient(scope = global) {
    let registrationScheduled = false;

    function isLocalRuntime() {
      const hostname = String(scope.location?.hostname || "").toLowerCase();
      const search = String(scope.location?.search || "");
      const allowsE2eServiceWorker = /(?:^\?|&)e2e=1(?:&|$)/.test(search)
        && /(?:^\?|&)sw=1(?:&|$)/.test(search);
      if (allowsE2eServiceWorker) return false;
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    }

    async function releaseLocalServiceWorker() {
      const serviceWorker = scope.navigator?.serviceWorker;
      const registrations = typeof serviceWorker?.getRegistrations === "function"
        ? await serviceWorker.getRegistrations().catch(() => [])
        : [];
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
      if (typeof scope.caches?.keys === "function") {
        const cacheNames = await scope.caches.keys().catch(() => []);
        await Promise.all(cacheNames
          .filter((name) => String(name).startsWith("thinkstock-"))
          .map((name) => scope.caches.delete(name).catch(() => false)));
      }
      const reloadKey = "thinkstock-local-sw-released-v1";
      if (serviceWorker?.controller && scope.sessionStorage?.getItem(reloadKey) !== "1") {
        scope.sessionStorage?.setItem(reloadKey, "1");
        scope.location?.reload?.();
      }
    }

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
      const register = () => (isLocalRuntime()
        ? releaseLocalServiceWorker().catch(() => null)
        : serviceWorker.register("./sw.js").catch(() => null));
      if (scope.document?.readyState === "complete") register();
      else scope.addEventListener?.("load", register, { once: true });
      return true;
    }

    return { requestDataRefresh, scheduleRegistration, releaseLocalServiceWorker };
  }

  global.ThinkStockServiceWorkerClient = { createServiceWorkerClient };
}(typeof self !== "undefined" ? self : globalThis));
