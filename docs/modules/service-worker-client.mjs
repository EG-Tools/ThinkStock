"use strict";

function createServiceWorkerClient(scope = globalThis) {
    let registrationScheduled = false;
    let controllerReloading = false;
    const localCleanupKey = "thinkstock-local-sw-clean-v2";

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
      const cleanupComplete = scope.localStorage?.getItem?.(localCleanupKey) === "1";
      if (cleanupComplete && !serviceWorker?.controller) {
        return { skipped: true, registrations: 0, caches: 0 };
      }
      const registrations = typeof serviceWorker?.getRegistrations === "function"
        ? await serviceWorker.getRegistrations().catch(() => [])
        : [];
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
      let deletedCacheCount = 0;
      if (typeof scope.caches?.keys === "function") {
        const cacheNames = await scope.caches.keys().catch(() => []);
        const staleNames = cacheNames.filter((name) => String(name).startsWith("thinkstock-"));
        const deleted = await Promise.all(staleNames
          .map((name) => scope.caches.delete(name).catch(() => false)));
        deletedCacheCount = deleted.filter(Boolean).length;
      }
      try { scope.localStorage?.setItem?.(localCleanupKey, "1"); } catch (_) {}
      const reloadKey = "thinkstock-local-sw-released-v1";
      if (serviceWorker?.controller && scope.sessionStorage?.getItem(reloadKey) !== "1") {
        scope.sessionStorage?.setItem(reloadKey, "1");
        scope.location?.reload?.();
      }
      return { skipped: false, registrations: registrations.length, caches: deletedCacheCount };
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
      const register = async () => {
        if (isLocalRuntime()) return releaseLocalServiceWorker().catch(() => null);
        try { scope.localStorage?.removeItem?.(localCleanupKey); } catch (_) {}
        serviceWorker.addEventListener?.("controllerchange", () => {
          if (controllerReloading) return;
          controllerReloading = true;
          scope.location?.reload?.();
        });
        const registration = await serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => null);
        await registration?.update?.().catch(() => null);
        return registration;
      };
      if (scope.document?.readyState === "complete") register();
      else scope.addEventListener?.("load", register, { once: true });
      return true;
    }

    return { requestDataRefresh, scheduleRegistration, releaseLocalServiceWorker };
  }

export { createServiceWorkerClient };
