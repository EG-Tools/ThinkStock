const ROUTES = Object.freeze([
  { id: "health", path: "/health", methods: ["GET"], authenticated: false },
  { id: "dart-disclosures", path: "/api/dart/disclosures", methods: ["GET"], ticker: true, corpCode: true },
  { id: "insider-trades", path: "/api/dart/insider-trades", methods: ["GET"], ticker: true, corpCode: true },
  { id: "auth-check", path: "/api/auth/check", methods: ["GET"] },
  { id: "consensus", path: "/api/consensus", methods: ["GET"], ticker: true },
  { id: "analysis", path: "/api/analysis", methods: ["GET"], ticker: true },
  { id: "prices", path: "/api/prices", methods: ["GET"], ticker: true },
  { id: "indices", path: "/api/indices", methods: ["GET"] },
  { id: "macro", path: "/api/macro", methods: ["GET"] },
  { id: "credit", path: "/api/credit", methods: ["GET"] },
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

export const WORKER_ROUTES = ROUTES;
