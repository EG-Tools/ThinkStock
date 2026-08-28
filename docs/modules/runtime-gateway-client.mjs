import { createSharedRequestRegistry } from "./shared-request-registry.mjs";
import { throwIfAborted } from "./browser-request-runtime.mjs";

"use strict";

  function withRefreshFlag(endpoint, forceNetwork) {
    if (!forceNetwork) return endpoint;
    return `${endpoint}${endpoint.includes("?") ? "&" : "?"}refresh=1`;
  }

  function withQuery(endpoint, values = {}) {
    if (!endpoint) return endpoint;
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value == null || value === "" || value === false) return;
      query.set(key, value === true ? "1" : String(value));
    });
    const suffix = query.toString();
    return suffix ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${suffix}` : endpoint;
  }

  function createRuntimeGatewayClient(options = {}) {
    const fetchWithTimeout = options.fetchWithTimeout;
    if (typeof fetchWithTimeout !== "function") throw new Error("fetchWithTimeout is required");
    const requestRegistry = options.requestRegistry || createSharedRequestRegistry();

    function accessToken() {
      return String(options.getAccessToken?.() || "").trim();
    }

    function requestJson(config = {}) {
      const useLocal = options.isLocal === true && Boolean(config.localEndpoint);
      const authenticated = config.authenticated !== false;
      const baseEndpoint = useLocal ? config.localEndpoint : config.remoteEndpoint;
      const forceNetwork = config.forceNetwork === true;
      const endpoint = withRefreshFlag(baseEndpoint, forceNetwork);
      if (!endpoint) throw new Error(`${config.label || "Runtime data"} endpoint is missing`);
      const token = useLocal || !authenticated ? "" : accessToken();
      const timeoutMs = Number(config.timeoutMs) || Number(options.defaultTimeoutMs) || 12000;
      const execute = async (signal) => {
        const headers = useLocal || !authenticated ? {} : { Authorization: `Bearer ${token}` };
        const response = await fetchWithTimeout(endpoint, {
          cache: "no-store",
          headers,
          signal: signal || null,
        }, timeoutMs);
        const apiContract = options.apiContract;
        if (apiContract?.runtimeApiCompatibility) {
          const headerName = apiContract.RUNTIME_API_VERSION_HEADER || "X-ThinkStock-API-Version";
          const compatibility = apiContract.runtimeApiCompatibility(response.headers.get(headerName), {
            allowMissing: options.allowLegacyApi !== false,
          });
          if (!compatibility.compatible) {
            options.onVersionMismatch?.(compatibility);
            throw new Error(`ThinkStock data server API ${compatibility.version || "unknown"} is incompatible`);
          }
        }
        const rawPayload = await response.json().catch(() => null);
        // A superseded request can finish decoding just after its fetch is aborted.
        // Reject it here so an older response never reaches a state merger.
        throwIfAborted(signal, "The operation was aborted");
        if (!response.ok) {
          if (response.status === 401) options.onUnauthorized?.();
          const error = new Error(rawPayload?.error || `${config.label || "Runtime data"} HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        if (typeof config.normalize !== "function") return rawPayload;
        try {
          return config.normalize(rawPayload);
        } catch (error) {
          options.onContractError?.(config.contractSource || config.label || "runtime", error, config.meta || {});
          throw error;
        }
      };
      if (!requestRegistry) return execute(config.signal || null);
      // Refresh is a stronger version of the same logical request. Keep one key so
      // an explicit refresh queues behind an older normal request instead of racing it.
      const requestKey = `${useLocal ? "local" : "remote"}|${baseEndpoint}|${timeoutMs}|${authenticated ? token : "public"}`;
      return requestRegistry.run(requestKey, execute, {
        signal: config.signal || null,
        tag: forceNetwork ? "force" : "normal",
        afterCurrent: forceNetwork && requestRegistry.has?.(requestKey)
          && requestRegistry.tag?.(requestKey) !== "force",
      });
    }

    return Object.freeze({
      requestJson,
      requestStats: () => requestRegistry?.stats?.() || null,
      fetchBootstrap(requestOptions = {}) {
        const tickers = [...new Set((Array.isArray(requestOptions.tickers) ? requestOptions.tickers : [])
          .map((ticker) => String(ticker || "").trim().toUpperCase())
          .filter(Boolean))];
        return requestJson({
          label: "runtime bootstrap",
          contractSource: "bootstrap-contract",
          remoteEndpoint: withQuery(options.endpoints.bootstrap, {
            tickers: tickers.join(","),
            since: String(requestOptions.since || "").slice(0, 10),
          }),
          forceNetwork: requestOptions.forceNetwork,
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
          normalize: options.contract?.normalizeBootstrapPayload,
          meta: { tickers },
        });
      },
      fetchPrice(ticker, requestOptions = {}) {
        const endpoint = `${options.endpoints.price}?ticker=${encodeURIComponent(String(ticker || ""))}`;
        return requestJson({
          label: "KRX price",
          contractSource: "price-contract",
          remoteEndpoint: endpoint,
          forceNetwork: requestOptions.forceNetwork,
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
          normalize: options.contract?.normalizePricePayload,
          meta: { ticker },
        });
      },
      fetchPrices(tickers, requestOptions = {}) {
        const targets = [...new Set((Array.isArray(tickers) ? tickers : [])
          .map((ticker) => String(ticker || "").trim().toUpperCase())
          .filter(Boolean))];
        const endpoint = `${options.endpoints.priceBatch}?tickers=${encodeURIComponent(targets.join(","))}`;
        return requestJson({
          label: "KRX prices",
          contractSource: "price-batch-contract",
          remoteEndpoint: endpoint,
          forceNetwork: requestOptions.forceNetwork,
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
          normalize: options.contract?.normalizePriceBatchPayload,
          meta: { tickers: targets },
        });
      },
      fetchIndices(requestOptions = {}) {
        return requestJson({
          label: "KRX index",
          localEndpoint: withQuery(options.localEndpoints?.indices, { since: requestOptions.since }),
          remoteEndpoint: withQuery(options.endpoints.indices, { since: requestOptions.since }),
          forceNetwork: requestOptions.forceNetwork,
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
        });
      },
      fetchMacro(requestOptions = {}) {
        return requestJson({
          label: "ECOS",
          contractSource: "macro-contract",
          localEndpoint: options.localEndpoints?.macro,
          remoteEndpoint: options.endpoints.macro,
          forceNetwork: requestOptions.forceNetwork,
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
          normalize: options.contract?.normalizeMacroPayload,
        });
      },
      fetchCredit(requestOptions = {}) {
        return requestJson({
          label: "credit",
          contractSource: "credit-contract",
          localEndpoint: options.localEndpoints?.credit,
          remoteEndpoint: options.endpoints.credit,
          forceNetwork: requestOptions.forceNetwork,
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
          normalize: options.contract?.normalizeCreditPayload,
        });
      },
      fetchCrisisSignal(requestOptions = {}) {
        return requestJson({
          label: "FRED",
          authenticated: false,
          contractSource: "crisis-signal-contract",
          localEndpoint: options.localEndpoints?.crisisSignal,
          remoteEndpoint: options.endpoints.crisisSignal,
          forceNetwork: requestOptions.forceNetwork,
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
          normalize: options.contract?.normalizeCrisisSignalPayload,
        });
      },
      fetchDisclosures(request = {}, requestOptions = {}) {
        const query = {
          ticker: String(request.ticker || "").trim().toUpperCase(),
          corpCode: String(request.corpCode || "").trim(),
          progressive: request.progressive !== false,
          since: String(request.since || "").slice(0, 10),
          page: Math.max(1, Math.round(Number(request.page) || 1)),
          force: requestOptions.forceNetwork === true,
        };
        return requestJson({
          label: "DART disclosures",
          localEndpoint: withQuery(options.localEndpoints?.disclosures, query),
          remoteEndpoint: withQuery(options.endpoints.disclosures, query),
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
        });
      },
      fetchInsiderTrades(request = {}, requestOptions = {}) {
        const query = {
          ticker: String(request.ticker || "").trim().toUpperCase(),
          corpCode: String(request.corpCode || "").trim(),
          force: requestOptions.forceNetwork === true,
        };
        return requestJson({
          label: "DART insider trades",
          localEndpoint: withQuery(options.localEndpoints?.insiderTrades, query),
          remoteEndpoint: withQuery(options.endpoints.insiderTrades, query),
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
        });
      },
      fetchEpsHistory(request = {}, requestOptions = {}) {
        const query = {
          ticker: String(request.ticker || "").trim().toUpperCase(),
          corpCode: String(request.corpCode || "").trim(),
          year: Math.trunc(Number(request.year)),
          force: requestOptions.forceNetwork === true,
        };
        return requestJson({
          label: "DART EPS",
          localEndpoint: withQuery(options.localEndpoints?.epsHistory, query),
          remoteEndpoint: withQuery(options.endpoints.epsHistory, query),
          signal: requestOptions.signal,
          timeoutMs: requestOptions.timeoutMs,
        });
      },
    });
  }

export {
  createRuntimeGatewayClient,
  withQuery,
  withRefreshFlag,
};
