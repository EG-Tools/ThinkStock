import json
import os
import re
import zipfile
from datetime import date
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

import pandas as pd
import requests
import yfinance as yf

DEFAULT_TICKERS = ["^KS11", "^KQ11", "005930.KS", "218410.KQ"]
DISPLAY_NAMES = {
    "leading_cycle": "\uC120\uD589\uC9C0\uC218 \uC21C\uD658\uBCC0\uB3D9\uCE58",
    "kospi_credit": "\uCF54\uC2A4\uD53C \uC2E0\uC6A9\uC794\uACE0",
    "kosdaq_credit": "\uCF54\uC2A4\uB2E5 \uC2E0\uC6A9\uC794\uACE0",
    "^KS11": "\uCF54\uC2A4\uD53C",
    "^KQ11": "\uCF54\uC2A4\uB2E5",
    "005930.KS": "\uC0BC\uC131\uC804\uC790",
    "218410.KQ": "RFHIC",
}
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"
SAMPLE_MACRO = ROOT / "sample_macro_data.csv"
OUTPUT_JSON = DATA_DIR / "prices.json"
OUTPUT_MACRO_JSON = DATA_DIR / "macro_data.json"
OUTPUT_MACRO_CSV = DATA_DIR / "sample_macro_data.csv"
OUTPUT_CREDIT_JSON = DATA_DIR / "credit_data.json"
OUTPUT_ADR_JSON = DATA_DIR / "adr_data.json"
OUTPUT_DISCLOSURES_JSON = DATA_DIR / "disclosures.json"
LOOKBACK_YEARS = 30
DART_DISCLOSURE_LOOKBACK_YEARS = 3
ECOS_STAT_CODE = "901Y067"  # Composite Leading Indicator
ECOS_ITEM_CODE = "I16E"     # Leading index cyclical component
ECOS_START = "199601"
OECD_FRED_SERIES_ID = "KORLOLITOAASTSAM"  # OECD CLI (AA, STSA) mirrored by FRED
OECD_FRED_URL = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={OECD_FRED_SERIES_ID}"
LOCAL_ENV_FILE = ROOT / ".env.local"
LOCAL_SCRIPT_ENV_FILE = ROOT / "scripts" / ".env.local"
LOCAL_ECOS_KEY_FILE = ROOT / "scripts" / "ecos_key.txt"
LOCAL_KOFIA_KEY_FILE = ROOT / "scripts" / "kofia_key.txt"
KOFIA_CREDIT_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo"
FREESIS_CREDIT_META_URL = "https://freesis.kofia.or.kr/meta/getMetaDataList.do"
FREESIS_CREDIT_OBJ_NM = "STATSCU0100000070BO"
FREESIS_CREDIT_UNIT_CODE = "06"
FREESIS_CREDIT_START = "19980101"
ENABLE_FREESIS_CREDIT_TAIL = os.environ.get("ENABLE_FREESIS_CREDIT_TAIL", "").strip() == "1"
ADR_SOURCE_URL = "http://www.adrinfo.kr/chart"
DART_CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
DART_DISCLOSURE_URL = "https://opendart.fss.or.kr/api/list.json"


def extract_close_series(data: pd.DataFrame, ticker: str) -> pd.Series | None:
    if isinstance(data.columns, pd.MultiIndex):
        if ("Close", ticker) in data.columns:
            return data[("Close", ticker)]
        if ("Adj Close", ticker) in data.columns:
            return data[("Adj Close", ticker)]
        try:
            return data.xs("Close", axis=1, level=0).iloc[:, 0]
        except Exception:
            return None
    if "Close" in data.columns:
        return data["Close"]
    if "Adj Close" in data.columns:
        return data["Adj Close"]
    return None


def years_before(reference: date, years: int) -> date:
    try:
        return reference.replace(year=reference.year - years)
    except ValueError:
        return reference.replace(year=reference.year - years, month=2, day=28)


def fetch_prices() -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    start_date = years_before(date.today(), LOOKBACK_YEARS)
    for ticker in DEFAULT_TICKERS:
        data = yf.download(
            ticker,
            start=start_date,
            end=pd.Timestamp(date.today()) + pd.Timedelta(days=1),
            auto_adjust=False,
            progress=False,
            threads=False,
        )
        if data is None or data.empty:
            continue
        series = extract_close_series(data, ticker)
        if series is None:
            continue
        series = series.rename(ticker).dropna()
        index = pd.to_datetime(series.index)
        try:
            index = index.tz_localize(None)
        except Exception:
            try:
                index = index.tz_convert(None)
            except Exception:
                pass
        series.index = index
        frames.append(series.to_frame())
    if not frames:
        return pd.DataFrame(columns=DEFAULT_TICKERS)
    out = pd.concat(frames, axis=1).sort_index()
    out.index.name = "date"
    return out


def load_macro_source() -> pd.DataFrame:
    if not SAMPLE_MACRO.exists():
        return pd.DataFrame()
    macro = pd.read_csv(SAMPLE_MACRO)
    if macro.empty or "date" not in macro.columns:
        return pd.DataFrame()
    macro["date"] = pd.to_datetime(macro["date"], errors="coerce")
    macro = macro.dropna(subset=["date"]).sort_values("date")
    value_cols = [column for column in macro.columns if column != "date"]
    for column in value_cols:
        macro[column] = pd.to_numeric(macro[column], errors="coerce")
    macro = macro.set_index("date")
    macro.index.name = "date"
    return macro



def _read_env_key(path: Path, key: str) -> str:
    if not path.exists():
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return ""
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        if k.strip() != key:
            continue
        return v.strip().strip('"').strip("'")
    return ""


def resolve_ecos_api_key() -> str:
    env_key = os.environ.get("ECOS_API_KEY", "").strip()
    if env_key:
        return env_key

    for env_file in (LOCAL_ENV_FILE, LOCAL_SCRIPT_ENV_FILE):
        file_key = _read_env_key(env_file, "ECOS_API_KEY")
        if file_key:
            return file_key

    if LOCAL_ECOS_KEY_FILE.exists():
        try:
            return LOCAL_ECOS_KEY_FILE.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            return ""
    return ""


def resolve_kofia_api_key() -> str:
    env_key = os.environ.get("KOFIA_API_KEY", "").strip()
    if env_key:
        return env_key

    for env_file in (LOCAL_ENV_FILE, LOCAL_SCRIPT_ENV_FILE):
        file_key = _read_env_key(env_file, "KOFIA_API_KEY")
        if file_key:
            return file_key

    if LOCAL_KOFIA_KEY_FILE.exists():
        try:
            return LOCAL_KOFIA_KEY_FILE.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            return ""
    return ""


def resolve_dart_api_key() -> str:
    return os.environ.get("DART_API_KEY", "").strip()


def configured_disclosure_stock_codes() -> list[str]:
    raw = os.environ.get("DART_DISCLOSURE_STOCK_CODES", "")
    extras = [part.strip() for part in raw.split(",") if part.strip()]
    codes = [ticker.split(".")[0] for ticker in DEFAULT_TICKERS] + extras
    seen: set[str] = set()
    out: list[str] = []
    for code in codes:
        clean = re.sub(r"\D", "", code)[:6]
        if len(clean) != 6 or clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
    return out


def fetch_ecos_leading_cycle(api_key: str) -> pd.DataFrame:
    if not api_key:
        return pd.DataFrame(columns=["leading_cycle"])
    end_ym = pd.Timestamp.today().strftime("%Y%m")
    url = (
        f"https://ecos.bok.or.kr/api/StatisticSearch/{api_key}/json/kr/1/5000/"
        f"{ECOS_STAT_CODE}/M/{ECOS_START}/{end_ym}/{ECOS_ITEM_CODE}"
    )
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        print(f"ECOS fetch failed: {exc}")
        return pd.DataFrame(columns=["leading_cycle"])

    rows = payload.get("StatisticSearch", {}).get("row", [])
    if not rows:
        result = payload.get("RESULT", {})
        code = result.get("CODE")
        msg = result.get("MESSAGE")
        if code:
            print(f"ECOS returned {code}: {msg}")
        return pd.DataFrame(columns=["leading_cycle"])

    records: list[dict] = []
    for row in rows:
        ym = str(row.get("TIME", ""))
        val = row.get("DATA_VALUE")
        if len(ym) != 6:
            continue
        try:
            dt = pd.to_datetime(f"{ym[:4]}-{ym[4:6]}-01")
            records.append({"date": dt, "leading_cycle": float(val)})
        except Exception:
            continue

    if not records:
        return pd.DataFrame(columns=["leading_cycle"])
    out = pd.DataFrame.from_records(records).drop_duplicates(subset=["date"]).sort_values("date")
    out = out.set_index("date")
    out.index.name = "date"
    return out


def merge_macro_with_leading_cycle(macro: pd.DataFrame, leading_cycle: pd.DataFrame) -> pd.DataFrame:
    if leading_cycle.empty:
        return macro
    if macro.empty:
        return leading_cycle
    merged = macro.copy()
    if "leading_cycle" not in merged.columns:
        merged["leading_cycle"] = pd.NA
    for idx, row in leading_cycle.iterrows():
        merged.loc[idx, "leading_cycle"] = row["leading_cycle"]
    merged = merged.sort_index()
    merged.index.name = "date"
    return merged


def fetch_oecd_leading_cycle_from_fred() -> pd.DataFrame:
    try:
        frame = pd.read_csv(OECD_FRED_URL)
    except Exception as exc:
        print(f"OECD(FRED mirror) fetch failed: {exc}")
        return pd.DataFrame(columns=["leading_cycle"])

    if frame.empty or "observation_date" not in frame.columns or OECD_FRED_SERIES_ID not in frame.columns:
        return pd.DataFrame(columns=["leading_cycle"])

    out = frame.rename(
        columns={
            "observation_date": "date",
            OECD_FRED_SERIES_ID: "leading_cycle",
        }
    )
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out["leading_cycle"] = pd.to_numeric(out["leading_cycle"], errors="coerce")
    out = out.dropna(subset=["date", "leading_cycle"])
    if out.empty:
        return pd.DataFrame(columns=["leading_cycle"])
    out = out.set_index("date").sort_index()
    out.index.name = "date"
    return out[["leading_cycle"]]


def apply_recent_oecd_tail(
    macro: pd.DataFrame,
    oecd: pd.DataFrame,
    months: int = 2,
    after_month: pd.Timestamp | None = None,
) -> tuple[pd.DataFrame, int]:
    if oecd.empty or "leading_cycle" not in oecd.columns:
        return macro, 0

    series = pd.to_numeric(oecd["leading_cycle"], errors="coerce").dropna()
    if after_month is not None:
        cutoff = pd.Timestamp(after_month).normalize()
        series = series[series.index > cutoff]

    tail = series.tail(months)
    if tail.empty:
        return macro, 0

    if macro.empty:
        merged = tail.to_frame(name="leading_cycle")
        merged.index.name = "date"
        return merged, len(tail)

    merged = macro.copy()
    if "leading_cycle" not in merged.columns:
        merged["leading_cycle"] = pd.NA

    # Fill only the months after latest ECOS month (or latest 2 if ECOS missing).
    applied = 0
    for month_start, value in tail.items():
        month_end = (month_start + pd.offsets.MonthEnd(1)).normalize()
        mask = (merged.index >= month_start) & (merged.index <= month_end)
        if mask.any():
            merged.loc[mask, "leading_cycle"] = float(value)
            applied += 1
        else:
            merged.loc[month_start, "leading_cycle"] = float(value)
            applied += 1

    merged = merged.sort_index()
    merged.index.name = "date"
    return merged, applied



def parse_won_to_trillion(raw: object) -> float | None:
    try:
        n = float(str(raw).replace(",", ""))
    except Exception:
        return None
    return round(n / 1e12, 4)


def _credit_frame_from_records(records: list[dict]) -> pd.DataFrame:
    if not records:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    out = pd.DataFrame.from_records(records)
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out["kospi_credit"] = pd.to_numeric(out.get("kospi_credit"), errors="coerce")
    out["kosdaq_credit"] = pd.to_numeric(out.get("kosdaq_credit"), errors="coerce")
    out = out.dropna(subset=["date"])
    if out.empty:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])
    out = out.drop_duplicates(subset=["date"], keep="last").sort_values("date").set_index("date")
    out.index.name = "date"
    return out[["kospi_credit", "kosdaq_credit"]]


def fetch_kofia_credit(api_key: str) -> pd.DataFrame:
    clean = str(api_key or "").strip()
    if not clean:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    key_candidates = [clean]
    decoded = unquote(clean)
    if decoded and decoded != clean:
        key_candidates.append(decoded)

    last_error = ""
    for service_key in dict.fromkeys(key_candidates):
        records: list[dict] = []
        try:
            num_rows = 1000
            page_no = 1
            last_page = 1

            while page_no <= last_page:
                response = requests.get(
                    KOFIA_CREDIT_URL,
                    params={
                        "serviceKey": service_key,
                        "numOfRows": str(num_rows),
                        "pageNo": str(page_no),
                        "resultType": "json",
                    },
                    timeout=30,
                )
                response.raise_for_status()
                payload = response.json()
                header = payload.get("response", {}).get("header", {})
                result_code = str(header.get("resultCode", ""))
                if result_code and result_code != "00":
                    raise RuntimeError(header.get("resultMsg") or "KOFIA API error")

                body = payload.get("response", {}).get("body", {})
                raw_items = body.get("items", {}).get("item")
                items = raw_items if isinstance(raw_items, list) else ([raw_items] if raw_items else [])

                for item in items:
                    bas_dt = str(item.get("basDt", ""))
                    if len(bas_dt) != 8 or not bas_dt.isdigit():
                        continue
                    kospi = parse_won_to_trillion(item.get("crdTrFingScrs"))
                    kosdaq = parse_won_to_trillion(item.get("crdTrFingKosdaq"))
                    if kospi is None and kosdaq is None:
                        continue
                    records.append(
                        {
                            "date": f"{bas_dt[:4]}-{bas_dt[4:6]}-{bas_dt[6:8]}",
                            "kospi_credit": kospi,
                            "kosdaq_credit": kosdaq,
                        }
                    )

                total_count = pd.to_numeric(body.get("totalCount"), errors="coerce")
                rows_per_page = pd.to_numeric(body.get("numOfRows"), errors="coerce")
                if page_no == 1 and pd.notna(total_count) and total_count > 0:
                    per_page = int(rows_per_page) if pd.notna(rows_per_page) and rows_per_page > 0 else num_rows
                    last_page = max(1, int((int(total_count) + per_page - 1) / per_page))

                if not items:
                    break
                page_no += 1

        except Exception as exc:
            last_error = str(exc)
            continue

        out = _credit_frame_from_records(records)
        if not out.empty:
            return out

    if last_error:
        print(f"KOFIA credit fetch failed: {last_error}")
    return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])


def fetch_freesis_credit() -> pd.DataFrame:
    today_ymd = pd.Timestamp.today().strftime("%Y%m%d")
    payload = {
        "dmSearch": {
            "OBJ_NM": FREESIS_CREDIT_OBJ_NM,
            "tmpV1": "D",
            "tmpV40": FREESIS_CREDIT_UNIT_CODE,
            "tmpV45": FREESIS_CREDIT_START,
            "tmpV46": today_ymd,
        }
    }
    headers = {"Content-Type": "application/json; charset=UTF-8"}

    try:
        response = requests.post(
            FREESIS_CREDIT_META_URL,
            json=payload,
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        body = response.json()
    except Exception as exc:
        print(f"Freesis credit fetch failed: {exc}")
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    rows = body.get("ds1", [])
    if not rows:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    records: list[dict] = []
    for row in rows:
        raw_date = str(row.get("TMPV1", ""))
        if len(raw_date) != 8:
            continue
        dt = pd.to_datetime(f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}", errors="coerce")
        if pd.isna(dt):
            continue

        kospi = parse_won_to_trillion(row.get("TMPV3"))
        kosdaq = parse_won_to_trillion(row.get("TMPV4"))
        if kospi is None and kosdaq is None:
            continue

        records.append(
            {
                "date": dt,
                "kospi_credit": kospi,
                "kosdaq_credit": kosdaq,
            }
        )

    return _credit_frame_from_records(records)


def extract_adr_array(html: str, var_name: str) -> list:
    token = f"const {var_name}="
    start = html.find(token)
    if start < 0:
        return []
    start += len(token)
    end = html.find("];", start)
    if end < 0:
        return []
    raw = re.sub(r",\s*\]", "]", html[start:end + 1])
    return json.loads(raw)


def fetch_adr_data() -> list[dict]:
    try:
        response = requests.get(
            ADR_SOURCE_URL,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20,
        )
        response.raise_for_status()
        html = response.text
        kospi_raw = extract_adr_array(html, "kospi_adr")
        kosdaq_raw = extract_adr_array(html, "kosdaq_adr")
    except Exception as exc:
        print(f"ADR fetch failed: {exc}")
        return []

    from datetime import datetime, timedelta, timezone

    kst = timezone(timedelta(hours=9))

    def ts_to_date(ts_ms: object) -> str:
        try:
            return datetime.fromtimestamp(float(ts_ms) / 1000, tz=kst).strftime("%Y-%m-%d")
        except Exception:
            return ""

    kospi_map = {ts_to_date(item[0]): item[1] for item in kospi_raw if isinstance(item, list) and len(item) >= 2}
    kosdaq_map = {ts_to_date(item[0]): item[1] for item in kosdaq_raw if isinstance(item, list) and len(item) >= 2}
    all_dates = sorted(date_key for date_key in set(kospi_map) | set(kosdaq_map) if date_key)

    records: list[dict] = []
    for date_key in all_dates:
        kospi = pd.to_numeric(kospi_map.get(date_key), errors="coerce")
        kosdaq = pd.to_numeric(kosdaq_map.get(date_key), errors="coerce")
        record = {
            "date": date_key,
            "adr_kospi": None if pd.isna(kospi) else round(float(kospi), 6),
            "adr_kosdaq": None if pd.isna(kosdaq) else round(float(kosdaq), 6),
        }
        if record["adr_kospi"] is not None or record["adr_kosdaq"] is not None:
            records.append(record)

    return records


def build_adr_payload(records: list[dict]) -> dict:
    return {
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "ADR (Advance-Decline Ratio) - KOSPI / KOSDAQ",
        "source": "adrinfo.kr",
        "note": "Values are percentages. 100=balanced, >120=overbought, <80=oversold",
        "series": ["adr_kospi", "adr_kosdaq"],
        "records": records,
    }


def disclosure_type_from_title(title: str) -> str | None:
    text = str(title or "")
    if re.search(r"반기보고서|분기보고서|사업보고서", text):
        return "실적"
    if re.search(r"배당|현금ㆍ현물배당|현금.?현물배당", text):
        return "배당"
    if re.search(r"단일판매|공급계약|수주", text):
        return "수주"
    if re.search(r"유상증자|신주인수권|증권신고서\(지분증권\)", text):
        return "유상증자"
    if re.search(r"전환사채|신주인수권부사채|교환사채", text):
        return "자금조달"
    if re.search(r"합병|분할|영업양수|영업양도", text):
        return "구조변경"
    return "공시"


def fetch_dart_corp_code_map(api_key: str) -> dict[str, dict[str, str]]:
    response = requests.get(DART_CORP_CODE_URL, params={"crtfc_key": api_key}, timeout=30)
    response.raise_for_status()
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        xml_name = next((name for name in archive.namelist() if name.lower().endswith(".xml")), "")
        if not xml_name:
            return {}
        root = ET.fromstring(archive.read(xml_name))

    out: dict[str, dict[str, str]] = {}
    for node in root.findall("list"):
        stock_code = (node.findtext("stock_code") or "").strip()
        corp_code = (node.findtext("corp_code") or "").strip()
        corp_name = (node.findtext("corp_name") or "").strip()
        if len(stock_code) == 6 and corp_code:
            out[stock_code] = {"corp_code": corp_code, "corp_name": corp_name}
    return out


def stock_code_to_ticker(stock_code: str, corp_cls: str = "") -> str:
    if stock_code.endswith(".KS") or stock_code.endswith(".KQ"):
        return stock_code
    for ticker in DEFAULT_TICKERS:
        if ticker.startswith(stock_code):
            return ticker
    return f"{stock_code}.KQ" if corp_cls == "K" else f"{stock_code}.KS"


def fetch_dart_disclosures(api_key: str, stock_codes: list[str]) -> list[dict]:
    if not api_key or not stock_codes:
        return []
    try:
        corp_map = fetch_dart_corp_code_map(api_key)
    except Exception as exc:
        print(f"DART corp code fetch failed: {exc}")
        return []

    start_date = years_before(date.today(), DART_DISCLOSURE_LOOKBACK_YEARS).strftime("%Y%m%d")
    end_date = date.today().strftime("%Y%m%d")
    records: list[dict] = []

    for stock_code in stock_codes:
        corp = corp_map.get(stock_code)
        if not corp:
            print(f"DART corp code not found for {stock_code}")
            continue

        page_no = 1
        total_page = 1
        while page_no <= total_page:
            try:
                response = requests.get(
                    DART_DISCLOSURE_URL,
                    params={
                        "crtfc_key": api_key,
                        "corp_code": corp["corp_code"],
                        "bgn_de": start_date,
                        "end_de": end_date,
                        "last_reprt_at": "Y",
                        "sort": "date",
                        "sort_mth": "asc",
                        "page_no": str(page_no),
                        "page_count": "100",
                    },
                    timeout=30,
                )
                response.raise_for_status()
                payload = response.json()
            except Exception as exc:
                print(f"DART disclosure fetch failed for {stock_code}: {exc}")
                break

            status = str(payload.get("status", ""))
            if status == "013":
                break
            if status and status != "000":
                print(f"DART returned {status} for {stock_code}: {payload.get('message')}")
                break

            total_page = int(payload.get("total_page") or 1)
            for item in payload.get("list", []) or []:
                title = str(item.get("report_nm") or "").strip()
                event_type = disclosure_type_from_title(title)
                if not event_type:
                    continue
                raw_date = str(item.get("rcept_dt") or "")
                if len(raw_date) != 8:
                    continue
                receipt_no = str(item.get("rcept_no") or "").strip()
                corp_cls = str(item.get("corp_cls") or "").strip()
                records.append(
                    {
                        "ticker": stock_code_to_ticker(stock_code, corp_cls),
                        "code": stock_code,
                        "name": str(item.get("corp_name") or corp["corp_name"] or stock_code).strip(),
                        "date": f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}",
                        "type": event_type,
                        "title": title,
                        "summary": "",
                        "source": "OpenDART",
                        "receiptNo": receipt_no,
                        "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt_no}" if receipt_no else "",
                    }
                )
            page_no += 1

    dedup: dict[tuple[str, str, str], dict] = {}
    for record in records:
        dedup[(record["ticker"], record["date"], record["title"])] = record
    return sorted(dedup.values(), key=lambda row: (row["date"], row["ticker"], row["title"]))


def build_disclosure_payload(records: list[dict]) -> dict:
    return {
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenDART",
        "series": ["disclosures"],
        "records": records,
    }


def load_existing_credit_seed() -> pd.DataFrame:
    if not OUTPUT_CREDIT_JSON.exists():
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])
    try:
        payload = json.loads(OUTPUT_CREDIT_JSON.read_text(encoding="utf-8"))
    except Exception:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    rows = payload.get("records", []) if isinstance(payload, dict) else []
    if not isinstance(rows, list) or not rows:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    frame = pd.DataFrame.from_records(rows)
    if "date" not in frame.columns:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["kospi_credit"] = pd.to_numeric(frame.get("kospi_credit"), errors="coerce")
    frame["kosdaq_credit"] = pd.to_numeric(frame.get("kosdaq_credit"), errors="coerce")
    frame = frame.dropna(subset=["date"]).drop_duplicates(subset=["date"]).sort_values("date")
    if frame.empty:
        return pd.DataFrame(columns=["kospi_credit", "kosdaq_credit"])

    out = frame.set_index("date")[["kospi_credit", "kosdaq_credit"]]
    out.index.name = "date"
    return out


def median_scale_factor(seed: pd.Series, live: pd.Series) -> float:
    merged = pd.concat([seed, live], axis=1, keys=["seed", "live"]).dropna()
    if merged.empty:
        return 1.0
    ratios = (merged["seed"] / merged["live"]).replace([pd.NA, float("inf"), float("-inf")], pd.NA).dropna()
    ratios = ratios[(ratios > 0)]
    if ratios.empty:
        return 1.0
    return float(ratios.median())


def merge_credit_seed_with_freesis(seed: pd.DataFrame, live: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    if live.empty:
        return seed, 0
    if seed.empty:
        return live, len(live)

    scale_k = median_scale_factor(seed["kospi_credit"], live["kospi_credit"])
    scale_q = median_scale_factor(seed["kosdaq_credit"], live["kosdaq_credit"])

    scaled = live.copy()
    scaled["kospi_credit"] = pd.to_numeric(scaled["kospi_credit"], errors="coerce") * scale_k
    scaled["kosdaq_credit"] = pd.to_numeric(scaled["kosdaq_credit"], errors="coerce") * scale_q

    latest_seed = seed.index.max()
    new_tail = scaled[scaled.index > latest_seed]
    if new_tail.empty:
        return seed, 0

    merged = pd.concat([seed, new_tail], axis=0)
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged.index.name = "date"
    return merged, len(new_tail)


def merge_credit_seed_with_kofia(seed: pd.DataFrame, live: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    if live.empty:
        return seed, 0
    if seed.empty:
        return live.sort_index(), len(live)

    merged = seed.copy()
    applied = 0
    for idx, row in live.sort_index().iterrows():
        prev = merged.loc[idx] if idx in merged.index else pd.Series(dtype="float64")
        next_kospi = row["kospi_credit"] if pd.notna(row["kospi_credit"]) else prev.get("kospi_credit", pd.NA)
        next_kosdaq = row["kosdaq_credit"] if pd.notna(row["kosdaq_credit"]) else prev.get("kosdaq_credit", pd.NA)
        prev_kospi = prev.get("kospi_credit", pd.NA)
        prev_kosdaq = prev.get("kosdaq_credit", pd.NA)
        changed = idx not in merged.index or (
            (pd.isna(prev_kospi) and pd.notna(next_kospi))
            or (pd.notna(prev_kospi) and pd.notna(next_kospi) and float(next_kospi) != float(prev_kospi))
            or (pd.isna(prev_kosdaq) and pd.notna(next_kosdaq))
            or (pd.notna(prev_kosdaq) and pd.notna(next_kosdaq) and float(next_kosdaq) != float(prev_kosdaq))
        )
        if changed:
            applied += 1
        merged.loc[idx, "kospi_credit"] = next_kospi
        merged.loc[idx, "kosdaq_credit"] = next_kosdaq

    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged.index.name = "date"
    return merged[["kospi_credit", "kosdaq_credit"]], applied


def densify_macro(macro: pd.DataFrame, price_index: pd.DatetimeIndex) -> pd.DataFrame:
    if macro.empty:
        return macro
    target_index = pd.DatetimeIndex(price_index).sort_values().unique()
    if target_index.empty:
        target_index = pd.date_range(start=macro.index.min(), end=macro.index.max(), freq="B")
    target_index = target_index[(target_index >= macro.index.min()) & (target_index <= macro.index.max())]
    if target_index.empty:
        return macro.iloc[0:0].copy()
    expanded = macro.reindex(macro.index.union(target_index)).sort_index()
    dense = expanded.interpolate(method="time", limit_area="inside").reindex(target_index)
    dense.index.name = "date"
    return dense


def build_payload(df: pd.DataFrame, labels: dict[str, str], series_names: list[str]) -> dict:
    records: list[dict] = []
    if not df.empty:
        clean = df.reset_index().copy()
        clean["date"] = pd.to_datetime(clean["date"]).dt.strftime("%Y-%m-%d")
        for column in clean.columns:
            if column == "date":
                continue
            clean[column] = pd.to_numeric(clean[column], errors="coerce").round(6)
        clean = clean.astype(object).where(pd.notna(clean), None)
        records = clean.to_dict(orient="records")
    return {
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "series": series_names,
        "display_names": labels,
        "records": records,
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    prices = fetch_prices()

    macro_source = load_macro_source()
    ecos_key = resolve_ecos_api_key()
    latest_ecos_month: pd.Timestamp | None = None
    if ecos_key:
        leading_cycle = fetch_ecos_leading_cycle(ecos_key)
        if not leading_cycle.empty:
            macro_source = merge_macro_with_leading_cycle(macro_source, leading_cycle)
            latest_ecos_month = leading_cycle.index.max().normalize()
            latest = leading_cycle.index.max().strftime("%Y-%m")
            print(f"Applied ECOS leading_cycle rows: {len(leading_cycle)} (latest={latest})")

    oecd_leading_cycle = fetch_oecd_leading_cycle_from_fred()
    if not oecd_leading_cycle.empty:
        macro_source, applied_months = apply_recent_oecd_tail(
            macro_source,
            oecd_leading_cycle,
            months=2,
            after_month=latest_ecos_month,
        )
        if applied_months:
            latest = oecd_leading_cycle.index.max().strftime("%Y-%m")
            print(f"Applied OECD leading_cycle tail months: {applied_months} (latest={latest})")

    macro = densify_macro(macro_source, prices.index if not prices.empty else pd.DatetimeIndex([]))

    credit_seed = load_existing_credit_seed()
    credit_merged = credit_seed
    kofia_key = resolve_kofia_api_key()
    if kofia_key:
        credit_kofia = fetch_kofia_credit(kofia_key)
        credit_merged, applied_kofia_credit = merge_credit_seed_with_kofia(credit_merged, credit_kofia)
        if applied_kofia_credit > 0:
            latest_credit = credit_merged.index.max().strftime("%Y-%m-%d")
            print(f"Applied KOFIA credit rows: {applied_kofia_credit} (latest={latest_credit})")
        else:
            print("KOFIA credit had no new rows.")
    else:
        print("KOFIA_API_KEY is not configured; using existing verified credit seed.")

    if ENABLE_FREESIS_CREDIT_TAIL:
        credit_live = fetch_freesis_credit()
        credit_merged, appended_credit = merge_credit_seed_with_freesis(credit_merged, credit_live)
    else:
        appended_credit = 0
        print("Skipped Freesis credit tail; using existing verified credit seed only.")

    if appended_credit > 0:
        latest_credit = credit_merged.index.max().strftime("%Y-%m-%d")
        print(f"Applied Freesis credit tail rows: {appended_credit} (latest={latest_credit})")

    adr_records = fetch_adr_data()
    if adr_records:
        print(f"Applied ADR rows: {len(adr_records)} (latest={adr_records[-1]['date']})")
    else:
        print("ADR fetch had no rows; keeping existing adr_data.json.")

    dart_key = resolve_dart_api_key()
    disclosure_records = fetch_dart_disclosures(dart_key, configured_disclosure_stock_codes()) if dart_key else []
    if disclosure_records:
        print(f"Applied DART disclosure rows: {len(disclosure_records)} (latest={disclosure_records[-1]['date']})")
    else:
        print("DART_API_KEY is not configured or returned no disclosure rows.")

    credit_payload = build_payload(
        credit_merged,
        DISPLAY_NAMES,
        ["kospi_credit", "kosdaq_credit"],
    )
    price_payload = build_payload(prices, DISPLAY_NAMES, DEFAULT_TICKERS)
    macro_payload = build_payload(macro, DISPLAY_NAMES, list(macro.columns))
    OUTPUT_JSON.write_text(
        json.dumps(price_payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    OUTPUT_MACRO_JSON.write_text(
        json.dumps(macro_payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )

    if credit_merged.empty:
        print("Freesis credit is empty — keeping existing credit_data.json")
    else:
        OUTPUT_CREDIT_JSON.write_text(
            json.dumps(credit_payload, ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )
    if adr_records:
        OUTPUT_ADR_JSON.write_text(
            json.dumps(build_adr_payload(adr_records), ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )
    OUTPUT_DISCLOSURES_JSON.write_text(
        json.dumps(build_disclosure_payload(disclosure_records), ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    if macro_source.empty:
        OUTPUT_MACRO_CSV.write_text("date\n", encoding="utf-8")
    else:
        macro_source_out = macro_source.reset_index().copy()
        macro_source_out["date"] = pd.to_datetime(macro_source_out["date"]).dt.strftime("%Y-%m-%d")
        macro_source_out.to_csv(OUTPUT_MACRO_CSV, index=False, float_format="%.4f")

    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote {OUTPUT_MACRO_JSON}")
    if not credit_merged.empty:
        print(f"Wrote {OUTPUT_CREDIT_JSON}")
    if adr_records:
        print(f"Wrote {OUTPUT_ADR_JSON}")
    print(f"Wrote {OUTPUT_DISCLOSURES_JSON}")
    print(f"Wrote {OUTPUT_MACRO_CSV}")

if __name__ == "__main__":
    main()
