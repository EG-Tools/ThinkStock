(function initThinkStockDartRequestRuntime(globalScope) {
  "use strict";

  function createDartRequestRuntime(registry) {
    if (!registry?.run) throw new Error("shared request registry is required");

    const requestKey = (kind, identity = "global") => (
      `dart:${String(kind || "request")}:${String(identity || "global").toUpperCase()}`
    );

    function run(kind, identity, factory, options = {}) {
      const key = requestKey(kind, identity);
      const force = options.force === true;
      return registry.run(key, factory, {
        signal: options.signal || null,
        tag: force ? "force" : "normal",
        afterCurrent: force && registry.has(key) && registry.tag(key) !== "force",
      });
    }

    function identities(kind) {
      const prefix = requestKey(kind, "").replace(/GLOBAL$/, "");
      return registry.keys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    }

    return Object.freeze({
      has: (kind, identity) => registry.has(requestKey(kind, identity)),
      identities,
      run,
      tag: (kind, identity) => registry.tag(requestKey(kind, identity)),
    });
  }

  globalScope.ThinkStockDartRequestRuntime = Object.freeze({ createDartRequestRuntime });
}(typeof self !== "undefined" ? self : globalThis));
