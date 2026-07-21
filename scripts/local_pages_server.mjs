import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = path.join(ROOT, "docs");
const ENV_FILE = path.join(ROOT, ".env.local");
const CACHE_DIR = path.join(ROOT, ".thinkstock-cache", "dart");
const CORP_CODE_DIR = path.join(DOCS_DIR, "data", "dart_corp_codes");
const DART_DISCLOSURE_URL = "https://opendart.fss.or.kr/api/list.json";
const DART_TYPES = ["A", "B", "C", "E", "I"];
const DISCLOSURE_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DART_PAGES = 100;
const TICKER_PATTERN = /^(\d{6})\.(KS|KQ)$/;
const IMPORTANT_DISCLOSURE_PATTERN = /반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};


export function parseEnvText(text) {
  const values = {};
  String(text || "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const splitAt = line.indexOf("=");
    const key = line.slice(0, splitAt).trim();
    const value = line.slice(splitAt + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key) values[key] = value;
  });
  return values;
}

export function isPrivateAddress(rawAddress) {
  let address = String(rawAddress || "").trim().toLowerCase();
  if (address.startsWith("::ffff:")) address = address.slice(7);
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) {
    return true;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function isAllowedOrigin(rawOrigin) {
  const origin = String(rawOrigin || "").trim();
  if (["capacitor://localhost", "ionic://localhost"].includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol)
      && (parsed.hostname === "localhost" || isPrivateAddress(parsed.hostname));
  } catch (_) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateYearsBefore(years) {
  const now = new Date();
  const month = now.getUTCMonth();
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, month, now.getUTCDate()));
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function todayApiDate() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

async function readJson(filePath) {
  try {
    const payload = JSON.parse(await readFile(filePath, "utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch (_) {
    return null;
  }
}

async function writeJsonAtomic(filePath, payload) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(payload), "utf8");
  await rename(temporary, filePath);
}

export class DartGateway {
  constructor(apiKey, options = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.cacheDir = options.cacheDir || CACHE_DIR;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.disclosureTtlMs = Number(options.disclosureTtlMs ?? DISCLOSURE_TTL_MS);
    this.pending = new Map();
    this.corpShards = new Map();
  }

  async initialize() {
    await mkdir(this.cacheDir, { recursive: true });
    const cutoff = Date.now() - STALE_CACHE_MAX_AGE_MS;
    const names = await readdir(this.cacheDir).catch(() => []);
    await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      const filePath = path.join(this.cacheDir, name);
      try {
        if ((await stat(filePath)).mtimeMs < cutoff) await unlink(filePath);
      } catch (_) {}
    }));
  }

  async corpCode(stockCode) {
    const prefix = String(stockCode || "").slice(0, 2);
    if (!/^\d{2}$/.test(prefix)) return "";
    if (!this.corpShards.has(prefix)) {
      const payload = await readJson(path.join(CORP_CODE_DIR, `${prefix}.json`));
      this.corpShards.set(prefix, payload?.codes || {});
    }
    return String(this.corpShards.get(prefix)?.[stockCode] || "").trim();
  }

  async requestJson(params) {
    const url = `${DART_DISCLOSURE_URL}?${new URLSearchParams(params)}`;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          headers: { "User-Agent": "ThinkStock-Local/1.0" },
          signal: AbortSignal.timeout(30000),
        });
        if (response.ok) return await response.json();
        const error = new Error(`DART HTTP ${response.status}`);
        error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      } catch (error) {
        lastError = error;
        if (error?.retryable === false || attempt >= 2) break;
        await sleep(500 * (2 ** attempt));
      }
    }
    throw new Error(`DART 접속에 실패했습니다: ${lastError?.message || "unknown error"}`);
  }

  static recordFromItem(ticker, item) {
    const rawDate = String(item?.rcept_dt || "").trim();
    const title = String(item?.report_nm || "").trim();
    if (!/^\d{8}$/.test(rawDate) || !IMPORTANT_DISCLOSURE_PATTERN.test(title)) return null;
    const receiptNo = String(item?.rcept_no || "").trim();
    return {
      ticker,
      code: ticker.slice(0, 6),
      name: String(item?.corp_name || "").trim(),
      date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
      title,
      summary: "",
      source: "OpenDART",
      receiptNo,
      url: receiptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}` : "",
    };
  }

  async fetchDisclosures(ticker) {
    if (!this.apiKey) throw new Error(".env.local에 DART_API_KEY가 없습니다.");
    const corpCode = await this.corpCode(ticker.slice(0, 6));
    if (!corpCode) throw new Error("DART 회사코드를 찾지 못했습니다. 데이터 업데이트 후 다시 시도해 주세요.");
    const baseParams = {
      crtfc_key: this.apiKey,
      corp_code: corpCode,
      bgn_de: dateYearsBefore(3),
      end_de: todayApiDate(),
      last_reprt_at: "Y",
      sort: "date",
      sort_mth: "asc",
      page_count: "100",
    };
    const records = [];
    for (const disclosureType of DART_TYPES) {
      let pageNo = 1;
      let totalPages = 1;
      while (pageNo <= totalPages) {
        const payload = await this.requestJson({
          ...baseParams,
          pblntf_ty: disclosureType,
          page_no: String(pageNo),
        });
        const status = String(payload?.status || "");
        if (status === "013") break;
        if (status && status !== "000") throw new Error(payload?.message || `DART 오류 ${status}`);
        totalPages = Math.min(MAX_DART_PAGES, Math.max(1, Number(payload?.total_page) || 1));
        (payload?.list || []).forEach((item) => {
          const record = DartGateway.recordFromItem(ticker, item);
          if (record) records.push(record);
        });
        pageNo += 1;
      }
    }
    const unique = new Map(records.map((record) => [
      `${record.date}|${record.title}|${record.receiptNo}`,
      record,
    ]));
    return [...unique.values()].sort((left, right) => (
      left.date.localeCompare(right.date) || left.title.localeCompare(right.title)
    ));
  }

  async disclosures(ticker, force = false) {
    const target = String(ticker || "").trim().toUpperCase();
    if (!TICKER_PATTERN.test(target)) throw new Error("종목코드는 005930.KS 형식이어야 합니다.");
    if (this.pending.has(target)) return this.pending.get(target);
    const task = (async () => {
      const cachePath = path.join(this.cacheDir, `${target}.json`);
      const cached = await readJson(cachePath);
      const savedAtMs = Number(cached?.saved_at || 0) * 1000;
      if (!force && Array.isArray(cached?.records) && Date.now() - savedAtMs <= this.disclosureTtlMs) {
        return { records: cached.records, cached: true };
      }
      const records = await this.fetchDisclosures(target);
      await writeJsonAtomic(cachePath, {
        saved_at: Date.now() / 1000,
        ticker: target,
        records,
      });
      return { records, cached: false };
    })().finally(() => this.pending.delete(target));
    this.pending.set(target, task);
    return task;
  }
}

function corsHeaders(request) {
  const origin = String(request.headers.origin || "").trim();
  if (!isAllowedOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-private-network": request.headers["access-control-request-private-network"] === "true" ? "true" : undefined,
    vary: "Origin",
  };
}

function sendJson(request, response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = Object.fromEntries(Object.entries(corsHeaders(request)).filter(([, value]) => value));
  response.writeHead(statusCode, {
    ...headers,
    "cache-control": "no-store",
    "content-length": body.length,
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function serveStatic(response, pathname, headOnly = false) {
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = path.resolve(DOCS_DIR, `.${relative}`);
  if (filePath !== DOCS_DIR && !filePath.startsWith(`${DOCS_DIR}${path.sep}`)) throw new Error("invalid path");
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not a file");
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-length": info.size,
    "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "x-content-type-options": "nosniff",
  });
  if (headOnly) response.end();
  else createReadStream(filePath).pipe(response);
}

export async function createThinkStockServer(options = {}) {
  const envText = await readFile(ENV_FILE, "utf8").catch(() => "");
  const apiKey = String(options.apiKey || process.env.DART_API_KEY || parseEnvText(envText).DART_API_KEY || "").trim();
  const gateway = options.gateway || new DartGateway(apiKey);
  await gateway.initialize();
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/")) {
      response.writeHead(204, {
        ...corsHeaders(request),
        "access-control-allow-headers": "Content-Type",
        "access-control-allow-methods": "GET, OPTIONS",
      });
      response.end();
      return;
    }
    if (requestUrl.pathname === "/api/health") {
      sendJson(request, response, 200, { ok: true, dartConfigured: Boolean(gateway.apiKey) });
      return;
    }
    if (requestUrl.pathname === "/api/dart/disclosures") {
      if (!isPrivateAddress(request.socket.remoteAddress)) {
        sendJson(request, response, 403, { ok: false, error: "로컬 네트워크에서만 사용할 수 있습니다." });
        return;
      }
      try {
        const ticker = String(requestUrl.searchParams.get("ticker") || "").toUpperCase();
        const force = ["1", "true", "yes"].includes(String(requestUrl.searchParams.get("force") || "").toLowerCase());
        const result = await gateway.disclosures(ticker, force);
        sendJson(request, response, 200, {
          ok: true,
          ticker,
          cached: result.cached,
          latestDate: result.records.at(-1)?.date || "",
          records: result.records,
        });
      } catch (error) {
        sendJson(request, response, 503, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(request, response, 404, { ok: false, error: "API 경로를 찾을 수 없습니다." });
      return;
    }
    try {
      await serveStatic(response, requestUrl.pathname, request.method === "HEAD");
    } catch (_) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

function localAddresses(port) {
  const addresses = new Set(["127.0.0.1"]);
  Object.values(networkInterfaces()).flat().forEach((item) => {
    if (item?.family === "IPv4" && isPrivateAddress(item.address)) addresses.add(item.address);
  });
  return [...addresses].sort().map((address) => `http://${address}:${port}`);
}

async function main() {
  const portIndex = process.argv.indexOf("--port");
  const hostIndex = process.argv.indexOf("--host");
  const port = Math.max(1, Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8787) || 8787);
  const host = String(hostIndex >= 0 ? process.argv[hostIndex + 1] : "0.0.0.0");
  const server = await createThinkStockServer();
  server.listen(port, host, () => {
    console.log("ThinkStock 로컬 서버가 시작되었습니다.");
    localAddresses(port).forEach((address) => console.log(`접속 주소: ${address}`));
    console.log("종료하려면 이 창에서 Ctrl+C를 누르세요.");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
