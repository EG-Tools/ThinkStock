from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
LOCAL_ENV_FILE = ROOT / ".env.local"
DEFAULT_CACHE_DIR = ROOT / ".thinkstock-cache" / "dart"
DART_CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
DART_DISCLOSURE_URL = "https://opendart.fss.or.kr/api/list.json"
TICKER_PATTERN = re.compile(r"^(\d{6})\.(KS|KQ)$")
CORP_CODE_TTL_SECONDS = 7 * 24 * 60 * 60
DISCLOSURE_TTL_SECONDS = 6 * 60 * 60
STALE_CACHE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
MAX_DART_PAGES = 100
DART_DISCLOSURE_TYPES = ("A", "B", "C", "E", "I")
IMPORTANT_DISCLOSURE_PATTERN = re.compile(
    r"반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|"
    r"배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|"
    r"전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|"
    r"합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|"
    r"최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|"
    r"부도|공개매수|장래사업|경영계획"
)


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        clean_key = key.strip()
        clean_value = value.strip().strip('"').strip("'")
        if clean_key:
            values[clean_key] = clean_value
    return values


def resolve_dart_api_key() -> str:
    return str(os.environ.get("DART_API_KEY") or load_env_file(LOCAL_ENV_FILE).get("DART_API_KEY") or "").strip()


def years_before(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year - years)
    except ValueError:
        return day.replace(year=day.year - years, day=28)


def is_private_client(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        return False
    return address.is_private or address.is_loopback


def is_allowed_origin(origin: str) -> bool:
    clean = str(origin or "").strip()
    if clean in {"capacitor://localhost", "ionic://localhost"}:
        return True
    try:
        parsed = urllib.parse.urlsplit(clean)
        return parsed.scheme in {"http", "https"} and bool(parsed.hostname) and is_private_client(parsed.hostname)
    except ValueError:
        return False


def local_network_addresses(port: int) -> list[str]:
    addresses = {"127.0.0.1"}
    try:
        host_name = socket.gethostname()
        for item in socket.getaddrinfo(host_name, None, family=socket.AF_INET):
            address = item[4][0]
            if is_private_client(address):
                addresses.add(address)
    except OSError:
        pass
    return [f"http://{address}:{port}" for address in sorted(addresses)]


class DartGateway:
    def __init__(
        self,
        api_key: str,
        cache_dir: Path = DEFAULT_CACHE_DIR,
        disclosure_ttl_seconds: int = DISCLOSURE_TTL_SECONDS,
    ) -> None:
        self.api_key = str(api_key or "").strip()
        self.cache_dir = Path(cache_dir)
        self.disclosure_ttl_seconds = max(0, int(disclosure_ttl_seconds))
        self._corp_lock = threading.Lock()
        self._ticker_locks: dict[str, threading.Lock] = {}
        self._ticker_locks_guard = threading.Lock()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cleanup_stale_cache()

    def cleanup_stale_cache(self) -> None:
        cutoff = time.time() - STALE_CACHE_MAX_AGE_SECONDS
        for path in self.cache_dir.glob("*.json"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                continue

    def _ticker_lock(self, ticker: str) -> threading.Lock:
        with self._ticker_locks_guard:
            return self._ticker_locks.setdefault(ticker, threading.Lock())

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any] | None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else None
        except (OSError, ValueError, TypeError):
            return None

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        temporary = path.with_suffix(f".{threading.get_ident()}.tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
            encoding="utf-8",
        )
        temporary.replace(path)

    @staticmethod
    def _is_fresh(payload: dict[str, Any] | None, ttl_seconds: int) -> bool:
        if not payload:
            return False
        saved_at = float(payload.get("saved_at") or 0)
        return saved_at > 0 and time.time() - saved_at <= ttl_seconds

    def _request_bytes(self, url: str, timeout: int = 30) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": "ThinkStock-Local/1.0"})
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    return response.read()
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code not in {408, 425, 429, 500, 502, 503, 504}:
                    raise
            except urllib.error.URLError as exc:
                last_error = exc
            if attempt < 2:
                time.sleep(0.5 * (2**attempt))
        raise RuntimeError(f"DART 접속에 실패했습니다: {last_error}")

    def _request_json(self, base_url: str, params: dict[str, str]) -> dict[str, Any]:
        url = f"{base_url}?{urllib.parse.urlencode(params)}"
        payload = json.loads(self._request_bytes(url).decode("utf-8-sig"))
        if not isinstance(payload, dict):
            raise RuntimeError("DART 응답 형식이 올바르지 않습니다.")
        return payload

    def _download_corp_codes(self) -> dict[str, dict[str, str]]:
        body = self._request_bytes(
            f"{DART_CORP_CODE_URL}?{urllib.parse.urlencode({'crtfc_key': self.api_key})}",
            timeout=60,
        )
        with zipfile.ZipFile(BytesIO(body)) as archive:
            xml_name = next((name for name in archive.namelist() if name.lower().endswith(".xml")), "")
            if not xml_name:
                raise RuntimeError("DART 회사코드 압축파일에 XML이 없습니다.")
            root = ET.fromstring(archive.read(xml_name))

        codes: dict[str, dict[str, str]] = {}
        for node in root.findall(".//list"):
            stock_code = str(node.findtext("stock_code") or "").strip()
            corp_code = str(node.findtext("corp_code") or "").strip()
            if len(stock_code) != 6 or not stock_code.isdigit() or not corp_code:
                continue
            codes[stock_code] = {
                "corp_code": corp_code,
                "corp_name": str(node.findtext("corp_name") or "").strip(),
            }
        if not codes:
            raise RuntimeError("DART 회사코드 목록이 비어 있습니다.")
        return codes

    def corp_codes(self) -> dict[str, dict[str, str]]:
        path = self.cache_dir / "corp_codes.json"
        with self._corp_lock:
            cached = self._read_json(path)
            if self._is_fresh(cached, CORP_CODE_TTL_SECONDS) and isinstance(cached.get("codes"), dict):
                return cached["codes"]
            try:
                codes = self._download_corp_codes()
                self._write_json(path, {"saved_at": time.time(), "codes": codes})
                return codes
            except Exception:
                if cached and isinstance(cached.get("codes"), dict) and cached["codes"]:
                    return cached["codes"]
                raise

    @staticmethod
    def _record_from_item(ticker: str, item: dict[str, Any]) -> dict[str, str] | None:
        raw_date = str(item.get("rcept_dt") or "").strip()
        title = str(item.get("report_nm") or "").strip()
        if len(raw_date) != 8 or not raw_date.isdigit() or not IMPORTANT_DISCLOSURE_PATTERN.search(title):
            return None
        receipt_no = str(item.get("rcept_no") or "").strip()
        return {
            "ticker": ticker,
            "code": ticker[:6],
            "name": str(item.get("corp_name") or "").strip(),
            "date": f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}",
            "title": title,
            "summary": "",
            "source": "OpenDART",
            "receiptNo": receipt_no,
            "url": (
                f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={urllib.parse.quote(receipt_no)}"
                if receipt_no
                else ""
            ),
        }

    def _fetch_disclosures(self, ticker: str) -> list[dict[str, str]]:
        if not self.api_key:
            raise RuntimeError(".env.local에 DART_API_KEY가 없습니다.")
        corp = self.corp_codes().get(ticker[:6])
        if not corp or not corp.get("corp_code"):
            raise RuntimeError("DART 회사코드를 찾지 못했습니다. 신규 상장 종목이면 잠시 후 다시 시도해 주세요.")

        today = date.today()
        base_params = {
            "crtfc_key": self.api_key,
            "corp_code": corp["corp_code"],
            "bgn_de": years_before(today, 3).strftime("%Y%m%d"),
            "end_de": today.strftime("%Y%m%d"),
            "last_reprt_at": "Y",
            "sort": "date",
            "sort_mth": "asc",
            "page_count": "100",
        }
        records: list[dict[str, str]] = []
        for disclosure_type in DART_DISCLOSURE_TYPES:
            total_pages = 1
            page_no = 1
            while page_no <= total_pages:
                payload = self._request_json(
                    DART_DISCLOSURE_URL,
                    {
                        **base_params,
                        "pblntf_ty": disclosure_type,
                        "page_no": str(page_no),
                    },
                )
                status = str(payload.get("status") or "")
                if status == "013":
                    break
                if status and status != "000":
                    raise RuntimeError(str(payload.get("message") or f"DART 오류 {status}"))
                total_pages = min(MAX_DART_PAGES, max(1, int(payload.get("total_page") or 1)))
                for item in payload.get("list") or []:
                    if not isinstance(item, dict):
                        continue
                    record = self._record_from_item(ticker, item)
                    if record:
                        records.append(record)
                page_no += 1

        unique = {
            (record["date"], record["title"], record["receiptNo"]): record
            for record in records
        }
        return sorted(unique.values(), key=lambda row: (row["date"], row["title"]))

    def disclosures(self, ticker: str, force: bool = False) -> tuple[list[dict[str, str]], bool]:
        target = str(ticker or "").strip().upper()
        if not TICKER_PATTERN.fullmatch(target):
            raise ValueError("종목코드는 005930.KS 형식이어야 합니다.")
        path = self.cache_dir / f"{target}.json"
        with self._ticker_lock(target):
            cached = self._read_json(path)
            if not force and self._is_fresh(cached, self.disclosure_ttl_seconds):
                rows = cached.get("records")
                if isinstance(rows, list):
                    return rows, True
            rows = self._fetch_disclosures(target)
            self._write_json(path, {"saved_at": time.time(), "ticker": target, "records": rows})
            return rows, False


class ThinkStockRequestHandler(SimpleHTTPRequestHandler):
    server_version = "ThinkStockLocal/1.0"

    def __init__(self, *args: Any, gateway: DartGateway, **kwargs: Any) -> None:
        self.gateway = gateway
        super().__init__(*args, directory=str(DOCS_DIR), **kwargs)

    def end_headers(self) -> None:
        origin = str(self.headers.get("Origin") or "").strip()
        if is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            if str(self.headers.get("Access-Control-Request-Private-Network") or "").lower() == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_api(self, parsed: urllib.parse.SplitResult) -> bool:
        if parsed.path == "/api/health":
            self._send_json(200, {"ok": True, "dartConfigured": bool(self.gateway.api_key)})
            return True
        if parsed.path != "/api/dart/disclosures":
            return False
        if not is_private_client(self.client_address[0]):
            self._send_json(403, {"ok": False, "error": "로컬 네트워크에서만 사용할 수 있습니다."})
            return True
        query = urllib.parse.parse_qs(parsed.query)
        ticker = str((query.get("ticker") or [""])[0]).strip().upper()
        force = str((query.get("force") or ["0"])[0]).lower() in {"1", "true", "yes"}
        try:
            records, cached = self.gateway.disclosures(ticker, force=force)
            latest = records[-1].get("date", "") if records else ""
            self._send_json(200, {
                "ok": True,
                "ticker": ticker,
                "cached": cached,
                "latestDate": latest,
                "records": records,
            })
        except ValueError as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self._send_json(503, {"ok": False, "error": str(exc)})
        return True

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if self._serve_api(parsed):
            return
        if parsed.path.startswith("/api/"):
            self._send_json(404, {"ok": False, "error": "API 경로를 찾을 수 없습니다."})
            return
        super().do_GET()

    def do_OPTIONS(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(404)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {format_string % args}")


def create_server(host: str, port: int, gateway: DartGateway) -> ThreadingHTTPServer:
    def handler(*args: Any, **kwargs: Any) -> ThinkStockRequestHandler:
        return ThinkStockRequestHandler(*args, gateway=gateway, **kwargs)

    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve ThinkStock and proxy OpenDART from this PC.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    gateway = DartGateway(resolve_dart_api_key())
    server = create_server(args.host, args.port, gateway)
    print("ThinkStock 로컬 서버가 시작되었습니다.")
    print(f"DART API: {'준비됨' if gateway.api_key else '.env.local의 DART_API_KEY 확인 필요'}")
    for address in local_network_addresses(args.port):
        print(f"접속 주소: {address}")
    print("종료하려면 이 창에서 Ctrl+C를 누르세요.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nThinkStock 로컬 서버를 종료합니다.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
