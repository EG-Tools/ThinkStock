(function initThinkStockDisclosureProgress(globalScope) {
  "use strict";

  function createDisclosureProgress(scope = globalScope, options = {}) {
    const getRoot = options.getRoot || (() => scope.document?.getElementById("disclosureProgress"));
    const getText = options.getText || (() => scope.document?.getElementById("disclosureProgressText"));
    const getBar = options.getBar || (() => scope.document?.getElementById("disclosureProgressBar"));
    const setTimer = options.setTimer || scope.setTimeout?.bind(scope);
    const clearTimer = options.clearTimer || scope.clearTimeout?.bind(scope);
    const revealDelayMs = Math.max(0, Number(options.revealDelayMs) || 180);
    const hideDelayMs = Math.max(0, Number(options.hideDelayMs) || 650);
    const createProgressView = options.createProgressView
      || scope.ThinkStockProgressView?.createProgressView
      || globalScope.ThinkStockProgressView?.createProgressView;
    if (typeof createProgressView !== "function") {
      throw new Error("progress view module is unavailable");
    }
    const view = createProgressView(scope, { getRoot, getText, getBar });
    const tasks = new Map();
    let revealTimer = 0;
    let hideTimer = 0;
    let sessionAnchor = "";

    function clearScheduled(timer) {
      if (timer) clearTimer?.(timer);
      return 0;
    }

    function activeTasks() {
      return [...tasks.values()].filter((task) => !task.done);
    }

    function resolveAnchor(key, label = "") {
      const taskKey = String(key || "").trim().toLowerCase();
      if (taskKey.startsWith("insider:")) return "insider";
      if (taskKey.startsWith("disclosure:")) return "disclosure";
      return String(label || "").includes("내부거래") ? "insider" : "disclosure";
    }

    function applyAnchor() {
      view.setAnchor(sessionAnchor);
    }

    function clearSession() {
      tasks.clear();
      sessionAnchor = "";
      applyAnchor();
    }

    function percent() {
      if (!tasks.size) return 0;
      const total = [...tasks.values()].reduce((sum, task) => sum + task.progress, 0);
      return Math.max(0, Math.min(100, Math.round((total / tasks.size) * 100)));
    }

    function paint() {
      const value = percent();
      const active = activeTasks();
      applyAnchor();
      const current = active.at(-1);
      view.paint(value, current?.label ? `${current.label} ${value}%` : `공시 ${value}%`);
      return value;
    }

    function reveal() {
      revealTimer = 0;
      if (!activeTasks().length) return;
      view.setVisible(true);
    }

    function scheduleReveal() {
      if (revealTimer || !activeTasks().length) return;
      revealTimer = setTimer?.(reveal, revealDelayMs) || 0;
    }

    function scheduleHide() {
      revealTimer = clearScheduled(revealTimer);
      const root = getRoot();
      if (!root || root.hidden) {
        clearSession();
        return;
      }
      hideTimer = clearScheduled(hideTimer);
      hideTimer = setTimer?.(() => {
        hideTimer = 0;
        view.setVisible(false);
        clearSession();
      }, hideDelayMs) || 0;
    }

    function begin(key, label = "공시") {
      const taskKey = String(key || "").trim();
      if (!taskKey) return false;
      if (!activeTasks().length) {
        tasks.clear();
        sessionAnchor = resolveAnchor(taskKey, label);
      }
      hideTimer = clearScheduled(hideTimer);
      tasks.set(taskKey, {
        progress: 0,
        done: false,
        label: String(label || "공시"),
        anchor: resolveAnchor(taskKey, label),
      });
      paint();
      scheduleReveal();
      return true;
    }

    function update(key, progress, label = "") {
      const taskKey = String(key || "").trim();
      const task = tasks.get(taskKey);
      if (!task || task.done) return false;
      task.progress = Math.max(task.progress, Math.max(0, Math.min(1, Number(progress) || 0)));
      if (label) task.label = String(label);
      paint();
      return true;
    }

    function complete(key, label = "공시") {
      const taskKey = String(key || "").trim();
      const task = tasks.get(taskKey);
      if (!task) return false;
      task.progress = 1;
      task.done = true;
      task.label = String(label || task.label || "공시");
      paint();
      if (!activeTasks().length) scheduleHide();
      return true;
    }

    function cancel(key = "") {
      const taskKey = String(key || "").trim();
      if (taskKey) {
        tasks.delete(taskKey);
        const active = activeTasks();
        if (active.length && !active.some((task) => task.anchor === sessionAnchor)) {
          sessionAnchor = active.at(-1)?.anchor || "";
        }
        paint();
        if (active.length) return;
      }
      revealTimer = clearScheduled(revealTimer);
      hideTimer = clearScheduled(hideTimer);
      clearSession();
      view.reset({ hide: true });
    }

    function snapshot() {
      return {
        active: activeTasks().length,
        total: tasks.size,
        percent: percent(),
        visible: getRoot()?.hidden === false,
      };
    }

    return Object.freeze({ begin, cancel, complete, snapshot, update });
  }

  globalScope.ThinkStockDisclosureProgress = Object.freeze({ createDisclosureProgress });
}(typeof self !== "undefined" ? self : globalThis));
