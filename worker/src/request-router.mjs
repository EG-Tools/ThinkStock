const ROUTES = Object.freeze([
  { id: "health", path: "/health", methods: ["GET"], authenticated: false },
  { id: "dart-disclosures", path: "/api/dart/disclosures", methods: ["GET"], ticker: true, corpCode: true, provider: "dart" },
  { id: "insider-trades", path: "/api/dart/insider-trades", methods: ["GET"], ticker: true, corpCode: true, provider: "dart" },
  { id: "auth-check", path: "/api/auth/check", methods: ["GET"] },
  { id: "admin-session", path: "/api/admin/session", methods: ["POST"] },
  { id: "consensus", path: "/api/consensus", methods: ["GET"], ticker: true },
  { id: "analysis", path: "/api/analysis", methods: ["GET"], ticker: true },
  { id: "broker-reports", path: "/api/broker-reports", methods: ["GET"], ticker: true },
  { id: "broker-report-pdf", path: "/api/broker-report-pdf", methods: ["GET"] },
  { id: "bootstrap", path: "/api/bootstrap", methods: ["GET"] },
  { id: "prices", path: "/api/prices", methods: ["GET"], ticker: true },
  { id: "prices-batch", path: "/api/prices/batch", methods: ["GET"] },
  { id: "research-universe", path: "/api/research/universe", methods: ["GET"] },
  { id: "research-summary", path: "/api/research/summary", methods: ["GET", "POST"] },
  { id: "research-history", path: "/api/research/history", methods: ["GET"], ticker: true },
  { id: "research-profile", path: "/api/research/profile", methods: ["GET"], ticker: true },
  { id: "indices", path: "/api/indices", methods: ["GET"] },
  { id: "adr", path: "/api/adr", methods: ["GET"] },
  { id: "macro", path: "/api/macro", methods: ["GET"] },
  { id: "credit", path: "/api/credit", methods: ["GET"] },
  { id: "credit-sync", path: "/api/credit/sync", methods: ["POST"] },
  { id: "crisis-signal", path: "/api/crisis-signal", methods: ["GET"], authenticated: false },
  { id: "forecast-journal", path: "/api/forecast-journal", methods: ["GET", "POST"], ticker: true },
]);

export function matchRequestRoute(pathname, method = "GET") {
  const path = String(pathname || "");
  const verb = String(method || "GET").toUpperCase();
  const route = ROUTES.find((candidate) => (
    candidate.path === path && candidate.methods.includes(verb)
  ));
  return route ? Object.freeze({ authenticated: true, ...route }) : null;
}

export function queryFlag(value) {
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

export function dispatchRequestRoute(route, handlers, context) {
  const handler = handlers?.[route?.id];
  return typeof handler === "function" ? handler(context, route) : null;
}

export const WORKER_ROUTES = ROUTES;
