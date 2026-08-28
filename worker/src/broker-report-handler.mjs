import {
  buildHankyungReportListUrl,
  buildHankyungReportPdfUrl,
  buildNaverReportListUrl,
  buildNaverReportPdfUrl,
  decodeNaverReportListBytes,
  parseHankyungReportListHtml,
  parseNaverReportListHtml,
  reportAgeDays,
} from "../../shared/broker-report-source.mjs";
import {
  corsHeaders,
  isValidIsoDate,
  jsonResponse,
  readBoundedResponseBytes,
  readBoundedResponseText,
  readCacheBestEffort,
  writeCachesBestEffort,
} from "./http-runtime.mjs";

const REPORT_LIST_MAX_BYTES = 2 * 1024 * 1024;
const REPORT_PDF_MAX_BYTES = 12 * 1024 * 1024;
const REPORT_PDF_CACHE_VERSION = 1;
const REPORT_PDF_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function brokerReportsResponse(ticker, url, origin) {
  const days = Number(url.searchParams.get("days")) <= 90 ? 90 : 180;
  const requestedAsOf = String(url.searchParams.get("asOf") || "").slice(0, 10);
  const name = String(url.searchParams.get("name") || "").trim();
  const source = url.searchParams.get("source") === "naver" ? "naver" : "hankyung";
  const asOf = isValidIsoDate(requestedAsOf) ? requestedAsOf : new Date().toISOString().slice(0, 10);
  const sourceUrl = source === "naver"
    ? buildNaverReportListUrl(ticker)
    : buildHankyungReportListUrl(ticker, { days, asOf, name });
  try {
    const upstream = await fetch(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        ...(source === "naver" ? { Referer: "https://finance.naver.com/" } : {}),
        "User-Agent": "ThinkStock/2 broker-research",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) {
      throw new Error(`${source === "naver" ? "Naver Finance" : "Hankyung Consensus"} HTTP ${upstream.status}`);
    }
    const html = source === "naver"
      ? decodeNaverReportListBytes(await readBoundedResponseBytes(
        upstream,
        REPORT_LIST_MAX_BYTES,
        "Broker report list",
      ))
      : await readBoundedResponseText(upstream, REPORT_LIST_MAX_BYTES, "Broker report list");
    const reports = (source === "naver"
      ? parseNaverReportListHtml(html, ticker)
      : parseHankyungReportListHtml(html, ticker, name))
      .filter((report) => reportAgeDays(report.publishedDate, asOf) < days);
    return jsonResponse({
      ok: true,
      ticker,
      days,
      reports,
      source: source === "naver" ? "Naver Finance" : "Hankyung Consensus",
    }, 200, origin);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: `Broker report list failed: ${error?.message || error}`,
    }, 503, origin);
  }
}

function reportPdfCacheKey(url, source, reportId) {
  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = `/__thinkstock-cache/broker-report-pdf/v${REPORT_PDF_CACHE_VERSION}/${source}/${reportId}`;
  return new Request(cacheUrl.toString(), { method: "GET" });
}

function reportPdfGatewayResponse(body, reportId, origin, cacheStatus, contentLength = "") {
  const headers = {
    ...corsHeaders(origin),
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename=broker-report-${reportId}.pdf`,
    "Content-Type": "application/pdf",
    "X-Content-Type-Options": "nosniff",
    "X-ThinkStock-Report-Cache": cacheStatus,
  };
  if (contentLength) headers["Content-Length"] = String(contentLength);
  return new Response(body, { status: 200, headers });
}

export async function brokerReportPdfResponse(url, origin, workerContext = null) {
  let sourceUrl = "";
  let reportId = "";
  const source = url.searchParams.get("source") === "naver" ? "naver" : "hankyung";
  try {
    reportId = String(url.searchParams.get("reportId") || "").trim();
    if (source === "naver") {
      if (!/^naver-\d{1,12}$/.test(reportId)) throw new Error("Broker report id is invalid");
      sourceUrl = buildNaverReportPdfUrl(url.searchParams.get("sourceUrl"));
    } else {
      sourceUrl = buildHankyungReportPdfUrl(reportId);
    }
  } catch (_) {
    return jsonResponse({ ok: false, error: "Broker report id is invalid" }, 400, origin);
  }
  try {
    const cache = globalThis.caches?.default || null;
    const cacheKey = cache ? reportPdfCacheKey(url, source, reportId) : null;
    const cached = cacheKey
      ? await readCacheBestEffort("broker-report-pdf", () => cache.match(cacheKey))
      : null;
    if (cached?.body) {
      return reportPdfGatewayResponse(
        cached.body,
        reportId,
        origin,
        "HIT",
        cached.headers.get("Content-Length") || "",
      );
    }
    const upstream = await fetch(sourceUrl, {
      headers: {
        Accept: "application/pdf",
        ...(source === "naver" ? { Referer: "https://finance.naver.com/" } : {}),
        "User-Agent": "ThinkStock/2 broker-research",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok) {
      throw new Error(`${source === "naver" ? "Naver Finance" : "Hankyung Consensus"} PDF HTTP ${upstream.status}`);
    }
    const bytes = await readBoundedResponseBytes(upstream, REPORT_PDF_MAX_BYTES, "Broker report PDF");
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      throw new Error("Broker report response is not a PDF");
    }
    if (cacheKey) {
      const cacheWrite = writeCachesBestEffort("broker-report-pdf", [() => cache.put(
        cacheKey,
        new Response(bytes.slice(), {
          status: 200,
          headers: {
            "Cache-Control": `public, max-age=${REPORT_PDF_CACHE_TTL_SECONDS}, immutable`,
            "Content-Length": String(bytes.byteLength),
            "Content-Type": "application/pdf",
            "X-Content-Type-Options": "nosniff",
          },
        }),
      )]);
      if (workerContext?.waitUntil) workerContext.waitUntil(cacheWrite);
      else await cacheWrite;
    }
    return reportPdfGatewayResponse(
      bytes,
      reportId,
      origin,
      cacheKey ? "MISS" : "BYPASS",
      bytes.byteLength,
    );
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: `Broker report PDF failed: ${error?.message || error}`,
    }, 503, origin);
  }
}
