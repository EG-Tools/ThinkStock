(function initThinkStockAdminFeatureAccess(globalScope) {
  "use strict";

  const SESSION_TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

  function createAdminFeatureAccess(scope = globalScope, options = {}) {
    const storage = options.storage || scope.localStorage;
    const sessionKey = String(options.sessionKey || "");
    const deviceKey = String(options.deviceKey || "");
    const buttonIds = Object.freeze([...(options.buttonIds || [])]);
    const now = () => Number(options.now?.() ?? Date.now());
    let granted = false;
    let session = null;
    let restorePromise = null;

    function read(key) {
      if (!key) return "";
      try { return String(storage?.getItem(key) || ""); } catch (_) { return ""; }
    }

    function write(key, value) {
      if (!key) return;
      try { storage?.setItem(key, value); } catch (_) {}
    }

    function remove(key) {
      if (!key) return;
      try { storage?.removeItem(key); } catch (_) {}
    }

    function publish() {
      options.onStateChange?.(granted);
      return granted;
    }

    function createDeviceId() {
      const provided = String(options.createDeviceId?.() || "").trim();
      if (DEVICE_ID_PATTERN.test(provided)) return provided;
      const uuid = String(scope.crypto?.randomUUID?.() || "").trim();
      if (DEVICE_ID_PATTERN.test(uuid)) return uuid;
      const bytes = new Uint8Array(16);
      scope.crypto?.getRandomValues?.(bytes);
      const fallback = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
      return DEVICE_ID_PATTERN.test(fallback) ? fallback : `device-${now()}`;
    }

    function deviceId() {
      const stored = read(deviceKey);
      if (DEVICE_ID_PATTERN.test(stored)) return stored;
      const created = createDeviceId();
      write(deviceKey, created);
      return created;
    }

    function normalizeSession(value) {
      let record = value;
      if (typeof value === "string") {
        try { record = JSON.parse(value); } catch (_) { return null; }
      }
      const token = String(record?.sessionToken || "");
      const expiresAt = Number(record?.expiresAt);
      const recordDeviceId = String(record?.deviceId || "");
      if (!SESSION_TOKEN_PATTERN.test(token) || !Number.isFinite(expiresAt)
        || expiresAt <= now() || recordDeviceId !== deviceId()) return null;
      return Object.freeze({ sessionToken: token, expiresAt, deviceId: recordDeviceId });
    }

    function readSession() {
      const value = normalizeSession(read(sessionKey));
      if (!value) remove(sessionKey);
      return value;
    }

    function storeSession(payload) {
      const value = normalizeSession({
        sessionToken: payload?.sessionToken,
        expiresAt: payload?.expiresAt,
        deviceId: deviceId(),
      });
      if (!value) return false;
      session = value;
      write(sessionKey, JSON.stringify(value));
      granted = true;
      publish();
      return true;
    }

    function clear() {
      session = null;
      granted = false;
      remove(sessionKey);
      return publish();
    }

    function load() {
      session = readSession();
      granted = Boolean(session);
      return publish();
    }

    async function request(action, values = {}) {
      if (typeof options.requestSession !== "function") {
        return Object.freeze({ ok: false, status: 503 });
      }
      try {
        const result = await options.requestSession({ action, deviceId: deviceId(), ...values });
        return result && typeof result === "object"
          ? result
          : Object.freeze({ ok: false, status: 503 });
      } catch (_) {
        return Object.freeze({ ok: false, status: 0 });
      }
    }

    async function restore() {
      if (restorePromise) return restorePromise;
      restorePromise = (async () => {
        session = readSession();
        if (session) {
          granted = true;
          publish();
          const refreshed = await request("refresh", { sessionToken: session.sessionToken });
          if (refreshed.ok && storeSession(refreshed)) return Object.freeze({ ok: true, renewed: true });
          if ([401, 403].includes(Number(refreshed.status))) clear();
          return Object.freeze({ ok: granted, cached: granted, status: Number(refreshed.status) || 0 });
        }

        granted = false;
        publish();
        return Object.freeze({ ok: false, status: 0 });
      })().finally(() => { restorePromise = null; });
      return restorePromise;
    }

    async function authenticate(code) {
      const result = await request("login", { code: String(code || "") });
      if (!result.ok || !storeSession(result)) {
        granted = false;
        publish();
        return Object.freeze({ ok: false, status: Number(result.status) || 0 });
      }
      return Object.freeze({ ok: true, status: Number(result.status) || 200 });
    }

    function sync() {
      const controlsReady = Boolean(options.controlsReady?.());
      const enabled = granted && controlsReady;
      buttonIds.forEach((id) => {
        const button = options.getElement?.(id) || scope.document?.getElementById?.(id);
        if (!button) return;
        if (button.dataset.adminFeatureTitle == null) {
          button.dataset.adminFeatureTitle = button.title || "";
        }
        button.disabled = !enabled;
        button.classList.toggle("is-admin-locked", !granted);
        button.setAttribute("aria-disabled", enabled ? "false" : "true");
        if (!controlsReady) button.title = "앱 기능을 준비하고 있습니다.";
        else if (!granted) button.title = "관리자 모드에서 사용할 수 있습니다.";
        else button.title = button.dataset.adminFeatureTitle;
      });
      return enabled;
    }

    return Object.freeze({
      authenticate,
      clear,
      isGranted: () => granted,
      load,
      restore,
      session: () => session,
      sync,
    });
  }

  globalScope.ThinkStockAdminFeatureAccess = Object.freeze({ createAdminFeatureAccess });
}(typeof self !== "undefined" ? self : globalThis));
