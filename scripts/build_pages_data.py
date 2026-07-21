import json
import os
import re
import subprocess
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path
from time import monotonic
from urllib.parse import unquote
from xml.etree import ElementTree as ET

import pandas as pd

from data_build_support import (
    DART_OVERLAP_DAYS,
    ECOS_LEADING_OVERLAP_MONTHS,
    ECOS_NEWS_OVERLAP_DAYS,
    FREESIS_OVERLAP_DAYS,
    KOFIA_OVERLAP_DAYS,
    PRICE_OVERLAP_DAYS,
    detect_price_rebases,
    disclosure_start_dates,
    health_warnings,
    incremental_month_code,
    incremental_start_date,
    should_full_rebuild,
)
from build_reporting import (
    frame_summary,
    payload_file_summary,
    record_summary,
    utc_stamp,
    write_report_with_history,
)
from credit_processing import (
    CREDIT_MAX_DAILY_ABS_CHANGE,
    CREDIT_MAX_DAILY_PCT_CHANGE,
    CREDIT_SERIES,
    MACRO_SERIES,
    accepted_credit_series_tail,
    credit_frame_from_payload,
    extract_credit_seed_from_macro,
    extract_public_macro_source,
    find_credit_history_discontinuity,
    is_plausible_credit_transition,
    is_plausible_credit_value_transition,
    median_scale_factor,
    merge_credit_frames,
    merge_credit_seed_with_existing_tail,
    merge_credit_seed_with_freesis,
    merge_credit_seed_with_incremental_tail,
    merge_credit_seed_with_kofia,
    pick_numeric_columns,
    quarantine_credit_frame,
    select_credit_seed,
)
from disclosure_processing import (
    build_dart_corp_code_payload,
    build_dart_corp_code_payloads,
    build_disclosure_manifest,
    build_disclosure_payload,
    compact_dart_corp_codes,
    disclosure_file_name,
    disclosure_type_from_title,
    is_important_disclosure_title,
    is_low_impact_disclosure_title,
    normalize_disclosure_records,
    should_display_disclosure,
)
from macro_utils import densify_macro
from payload_output import (
    build_payload,
    records_from_payload,
    records_to_frame,
    write_columnar_payload_or_keep,
)
from provider_clients import (
    RetryingHttpClient,
    fetch_kofia_items,
    fetch_yahoo_prices,
)
from provider_contracts import (
    adr_series_points,
    dart_disclosure_page,
    fear_greed_rows,
    freesis_rows,
)
from provider_sources import (
    fetch_ecos_leading_cycle as fetch_ecos_leading_cycle_source,
    fetch_ecos_news_sentiment as fetch_ecos_news_sentiment_source,
    fetch_kosis_leading_cycle as fetch_kosis_leading_cycle_source,
    fetch_krx_universe as fetch_krx_universe_source,
    fetch_oecd_leading_cycle_from_fred as fetch_oecd_leading_cycle_from_fred_source,
    normalize_krx_universe_rows as normalize_krx_universe_rows_source,
    read_env_key,
    resolve_api_key,
)
from split_pages_data import split_all_payloads
from source_pipeline import SourcePipeline

DEFAULT_TICKERS = ["^KS11", "^KQ11", "005930.KS", "218410.KQ"]
AUXILIARY_SERIES = ["adr_kospi", "adr_kosdaq", "fear_greed"]
DISPLAY_NAMES = {
    "leading_cycle": "\uC120\uD589\uC21C\uD658\uBCC0\uB3D9",
    "news_sentiment": "\uB274\uC2A4\uC2EC\uB9AC",
    "customer_deposit": "\uACE0\uAC1D\uC608\uD0C1\uAE08",
    "kospi_credit": "\uCF54\uC2A4\uD53C \uC2E0\uC6A9\uC794\uACE0",
    "kosdaq_credit": "\uCF54\uC2A4\uB2E5 \uC2E0\uC6A9\uC794\uACE0",
    "^KS11": "\uCF54\uC2A4\uD53C",
    "^KQ11": "\uCF54\uC2A4\uB2E5",
    "adr_kospi": "ADR K",
    "adr_kosdaq": "ADR KQ",
    "fear_greed": "\uACF5\uD3EC\uD0D0\uC695",
    "005930.KS": "\uC0BC\uC131\uC804\uC790",
    "218410.KQ": "RFHIC",
}
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"
SAMPLE_MACRO = ROOT / "sample_macro_data.csv"
OUTPUT_JSON = DATA_DIR / "prices.json"
OUTPUT_MACRO_JSON = DATA_DIR / "macro_data.json"
OUTPUT_CREDIT_JSON = DATA_DIR / "credit_data.json"
OUTPUT_ADR_JSON = DATA_DIR / "adr_data.json"
OUTPUT_DISCLOSURES_JSON = DATA_DIR / "disclosures.json"
DISCLOSURE_DATA_DIR = DATA_DIR / "disclosures"
OUTPUT_DART_CORP_CODES_JSON = DATA_DIR / "dart_corp_codes.json"
DART_CORP_CODE_DATA_DIR = DATA_DIR / "dart_corp_codes"
OUTPUT_KRX_UNIVERSE_JSON = DATA_DIR / "krx_universe.json"
OUTPUT_BUILD_REPORT_JSON = DATA_DIR / "build_report.json"
OUTPUT_BUILD_HISTORY_JSON = DATA_DIR / "build_history.json"
LOOKBACK_YEARS = 30
DART_DISCLOSURE_LOOKBACK_YEARS = 3
DART_MARKET_LOOKBACK_DAYS = 90
DART_MARKET_MAX_PAGES = 60
DART_MARKET_FETCH_WORKERS = 4
DART_MARKET_DISCLOSURE_TYPES = ("A", "B", "C", "E", "I")
DART_CORP_CODE_PREFIX_LENGTH = 2
KRX_LOOKBACK_DAYS = 14
ECOS_STAT_CODE = "901Y067"  # Composite Leading Indicator
ECOS_ITEM_CODE = "I16E"     # Leading index cyclical component
ECOS_START = "199601"
ECOS_NEWS_STAT_CODE = "521Y001"
ECOS_NEWS_ITEM_CODE = "A001"
ECOS_NEWS_START = "20050101"
KOSIS_LEADING_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
KOSIS_START = "199601"
OECD_FRED_SERIES_ID = "KORLOLITOAASTSAM"  # OECD CLI (AA, STSA) mirrored by FRED
OECD_FRED_URL = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={OECD_FRED_SERIES_ID}"
LOCAL_ENV_FILE = ROOT / ".env.local"
KOFIA_CREDIT_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo"
KOFIA_MARKET_FUNDS_URL = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/getSecuritiesMarketTotalCapitalInfo"
FREESIS_CREDIT_META_URL = "https://freesis.kofia.or.kr/meta/getMetaDataList.do"
FREESIS_CREDIT_OBJ_NM = "STATSCU0100000070BO"
FREESIS_MARKET_FUNDS_OBJ_NM = "STATSCU0100000060BO"
FREESIS_CREDIT_UNIT_CODE = "01"
FREESIS_CREDIT_START = "19960101"
ENABLE_FREESIS_CREDIT_TAIL = os.environ.get("ENABLE_FREESIS_CREDIT_TAIL", "").strip() == "1"
ADR_SOURCE_URL = "http://www.adrinfo.kr/chart"
FEAR_GREED_SOURCE_URL = "https://kospi.feargreedchart.com/api/?action=kospi-history"
DART_CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
DART_DISCLOSURE_URL = "https://opendart.fss.or.kr/api/list.json"
KRX_BASE_INFO_ENDPOINTS = {
    "KOSPI": "stk_isu_base_info",
    "KOSDAQ": "ksq_isu_base_info",
}
_HTTP_CLIENT_LOCAL = threading.local()
_HTTP_CLIENTS: list[RetryingHttpClient] = []
_HTTP_CLIENTS_LOCK = threading.Lock()
SOURCE_STALE_AFTER_DAYS = {
    "prices": 10,
    "ecos_leading_cycle": 150,
    "ecos_news_sentiment": 14,
    "kosis_leading_cycle": 150,
    "oecd_leading_cycle": 150,
    "kofia_credit": 14,
    "freesis_credit": 14,
    "adr": 10,
    "fear_greed": 10,
}


def http_client() -> RetryingHttpClient:
    client = getattr(_HTTP_CLIENT_LOCAL, "client", None)
    if client is None:
        client = RetryingHttpClient()
        _HTTP_CLIENT_LOCAL.client = client
        with _HTTP_CLIENTS_LOCK:
            _HTTP_CLIENTS.append(client)
    return client


def aggregate_http_metrics() -> dict[str, int]:
    totals = {"requests": 0, "retries": 0, "failures": 0}
    with _HTTP_CLIENTS_LOCK:
        clients = list(_HTTP_CLIENTS)
    for client in clients:
        for key, value in client.metrics().items():
            totals[key] = totals.get(key, 0) + int(value or 0)
    return totals


def years_before(reference: date, years: int) -> date:
    try:
        return reference.replace(year=reference.year - years)
    except ValueError:
        return reference.replace(year=reference.year - years, month=2, day=28)


def fetch_prices(start_date: date | None = None) -> pd.DataFrame:
    start = start_date or years_before(date.today(), LOOKBACK_YEARS)
    frame, failures = fetch_yahoo_prices(DEFAULT_TICKERS, start, date.today())
    for ticker, message in failures.items():
        print(f"Yahoo price fetch failed for {ticker}: {message}")
    for ticker in DEFAULT_TICKERS:
        if ticker not in frame.columns:
            frame[ticker] = pd.NA
    frame = frame.reindex(columns=DEFAULT_TICKERS).sort_index()
    frame.index.name = "date"
    return frame


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
    return read_env_key(path, key)


def resolve_ecos_api_key() -> str:
    return resolve_api_key(LOCAL_ENV_FILE, "ECOS_API_KEY")


def resolve_kosis_api_key() -> str:
    return resolve_api_key(LOCAL_ENV_FILE, "KOSIS_API_KEY")


def resolve_kofia_api_key() -> str:
    return resolve_api_key(LOCAL_ENV_FILE, "KOFIA_API_KEY")


def resolve_dart_api_key() -> str:
    return resolve_api_key(LOCAL_ENV_FILE, "DART_API_KEY")


def redact_error_message(error: Exception, *secrets: str) -> str:
    message = str(error)
    for secret in secrets:
        clean = str(secret or "").strip()
        if clean:
            message = message.replace(clean, "[redacted]")
    return message


def resolve_krx_api_key() -> str:
    return resolve_api_key(LOCAL_ENV_FILE, "KRX_API_KEY", "KRX_AUTH_KEY")


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


def normalize_krx_universe_rows(rows: list[dict], market: str) -> list[dict]:
    return normalize_krx_universe_rows_source(rows, market, KRX_BASE_INFO_ENDPOINTS)


def fetch_krx_universe(api_key: str, lookback_days: int = KRX_LOOKBACK_DAYS) -> dict:
    return fetch_krx_universe_source(
        http_client(),
        api_key,
        KRX_BASE_INFO_ENDPOINTS,
        lookback_days,
    )


def fetch_ecos_leading_cycle(api_key: str, start_ym: str = ECOS_START) -> pd.DataFrame:
    return fetch_ecos_leading_cycle_source(
        http_client(),
        api_key,
        start_ym,
        ECOS_STAT_CODE,
        ECOS_ITEM_CODE,
    )


def fetch_ecos_news_sentiment(api_key: str, start_ymd: str = ECOS_NEWS_START) -> pd.DataFrame:
    return fetch_ecos_news_sentiment_source(
        http_client(),
        api_key,
        start_ymd,
        ECOS_NEWS_STAT_CODE,
        ECOS_NEWS_ITEM_CODE,
    )


def fetch_kosis_leading_cycle(api_key: str, start_ym: str = KOSIS_START) -> pd.DataFrame:
    return fetch_kosis_leading_cycle_source(
        http_client(),
        api_key,
        start_ym,
        KOSIS_LEADING_URL,
    )


def merge_macro_frame(macro: pd.DataFrame, incoming: pd.DataFrame) -> pd.DataFrame:
    if incoming.empty:
        return macro
    if macro.empty:
        return incoming.sort_index()
    merged = macro.copy()
    for column in incoming.columns:
        if column not in merged.columns:
            merged[column] = pd.NA
        for idx, value in incoming[column].items():
            if pd.notna(value):
                merged.loc[idx, column] = value
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged.index.name = "date"
    return merged


def merge_macro_with_leading_cycle(macro: pd.DataFrame, leading_cycle: pd.DataFrame) -> pd.DataFrame:
    return merge_macro_frame(macro, leading_cycle)


def fetch_oecd_leading_cycle_from_fred() -> pd.DataFrame:
    return fetch_oecd_leading_cycle_from_fred_source(
        http_client(),
        OECD_FRED_URL,
        OECD_FRED_SERIES_ID,
    )


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
        return pd.DataFrame(columns=CREDIT_SERIES)

    out = pd.DataFrame.from_records(records)
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    for column in CREDIT_SERIES:
        if column not in out.columns:
            out[column] = pd.NA
        out[column] = pd.to_numeric(out[column], errors="coerce")
        out.loc[out[column] <= 0, column] = pd.NA
    out = out.dropna(subset=["date"])
    out = out.dropna(subset=CREDIT_SERIES, how="all")
    if out.empty:
        return pd.DataFrame(columns=CREDIT_SERIES)
    out = out.drop_duplicates(subset=["date"], keep="last").sort_values("date").set_index("date")
    out.index.name = "date"
    return out[CREDIT_SERIES]


def fetch_kofia_credit(
    api_key: str,
    start_ymd: str = "",
    request_stats: dict | None = None,
) -> pd.DataFrame:
    clean = str(api_key or "").strip()
    if not clean:
        return pd.DataFrame(columns=CREDIT_SERIES)

    key_candidates = [clean]
    decoded = unquote(clean)
    if decoded and decoded != clean:
        key_candidates.append(decoded)

    last_error = ""
    for service_key in dict.fromkeys(key_candidates):
        records: list[dict] = []
        try:
            result = fetch_kofia_items(
                http_client(),
                KOFIA_CREDIT_URL,
                service_key,
                begin_date=start_ymd,
            )
            if request_stats is not None:
                request_stats.update({
                    "credit_pages": result.pages,
                    "credit_total_count": result.total_count,
                    "credit_stopped_early": result.stopped_early,
                })
            for item in result.items:
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
        except Exception as exc:
            last_error = str(exc)
            continue

        out = _credit_frame_from_records(records)
        if not out.empty:
            return out

    if last_error:
        print(f"KOFIA credit fetch failed: {last_error}")
    return pd.DataFrame(columns=CREDIT_SERIES)


def fetch_kofia_customer_deposit(
    api_key: str,
    start_ymd: str = "",
    request_stats: dict | None = None,
) -> pd.DataFrame:
    clean = str(api_key or "").strip()
    if not clean:
        return pd.DataFrame(columns=CREDIT_SERIES)

    key_candidates = [clean]
    decoded = unquote(clean)
    if decoded and decoded != clean:
        key_candidates.append(decoded)

    last_error = ""
    for service_key in dict.fromkeys(key_candidates):
        records: list[dict] = []
        try:
            result = fetch_kofia_items(
                http_client(),
                KOFIA_MARKET_FUNDS_URL,
                service_key,
                begin_date=start_ymd,
            )
            if request_stats is not None:
                request_stats.update({
                    "deposit_pages": result.pages,
                    "deposit_total_count": result.total_count,
                    "deposit_stopped_early": result.stopped_early,
                })
            for item in result.items:
                bas_dt = str(item.get("basDt", ""))
                if len(bas_dt) != 8 or not bas_dt.isdigit():
                    continue
                customer_deposit = parse_won_to_trillion(item.get("invrDpsgAmt"))
                if customer_deposit is None:
                    continue
                records.append(
                    {
                        "date": f"{bas_dt[:4]}-{bas_dt[4:6]}-{bas_dt[6:8]}",
                        "customer_deposit": customer_deposit,
                    }
                )
        except Exception as exc:
            last_error = str(exc)
            continue

        out = _credit_frame_from_records(records)
        if not out.empty:
            return out

    if last_error:
        print(f"KOFIA customer deposit fetch failed: {last_error}")
    return pd.DataFrame(columns=CREDIT_SERIES)


def fetch_freesis_credit(start_ymd: str = FREESIS_CREDIT_START) -> pd.DataFrame:
    today_ymd = pd.Timestamp.today().strftime("%Y%m%d")
    payload = {
        "dmSearch": {
            "OBJ_NM": FREESIS_CREDIT_OBJ_NM,
            "tmpV1": "D",
            "tmpV40": FREESIS_CREDIT_UNIT_CODE,
            "tmpV45": start_ymd,
            "tmpV46": today_ymd,
        }
    }
    headers = {"Content-Type": "application/json; charset=UTF-8"}

    try:
        body = http_client().post_json(
            FREESIS_CREDIT_META_URL,
            json=payload,
            headers=headers,
            timeout=30,
        )
    except Exception as exc:
        print(f"Freesis credit fetch failed: {exc}")
        return pd.DataFrame(columns=CREDIT_SERIES)

    try:
        rows = freesis_rows(body)
    except ValueError as exc:
        print(f"Freesis credit response contract failed: {exc}")
        return pd.DataFrame(columns=CREDIT_SERIES)
    if not rows:
        return pd.DataFrame(columns=CREDIT_SERIES)

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


def fetch_freesis_customer_deposit(start_ymd: str = FREESIS_CREDIT_START) -> pd.DataFrame:
    today_ymd = pd.Timestamp.today().strftime("%Y%m%d")
    payload = {
        "dmSearch": {
            "OBJ_NM": FREESIS_MARKET_FUNDS_OBJ_NM,
            "tmpV1": "D",
            "tmpV40": FREESIS_CREDIT_UNIT_CODE,
            "tmpV45": start_ymd,
            "tmpV46": today_ymd,
        }
    }
    headers = {"Content-Type": "application/json; charset=UTF-8"}

    try:
        body = http_client().post_json(
            FREESIS_CREDIT_META_URL,
            json=payload,
            headers=headers,
            timeout=30,
        )
    except Exception as exc:
        print(f"Freesis customer deposit fetch failed: {exc}")
        return pd.DataFrame(columns=CREDIT_SERIES)

    try:
        rows = freesis_rows(body)
    except ValueError as exc:
        print(f"Freesis customer deposit response contract failed: {exc}")
        return pd.DataFrame(columns=CREDIT_SERIES)

    records: list[dict] = []
    for row in rows:
        raw_date = str(row.get("TMPV1", ""))
        if len(raw_date) != 8:
            continue
        dt = pd.to_datetime(f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}", errors="coerce")
        if pd.isna(dt):
            continue
        customer_deposit = parse_won_to_trillion(row.get("TMPV2"))
        if customer_deposit is None:
            continue
        records.append({"date": dt, "customer_deposit": customer_deposit})

    return _credit_frame_from_records(records)


def extract_adr_array(html: str, var_name: str) -> list:
    return adr_series_points(html, var_name)


def fetch_adr_data() -> list[dict]:
    try:
        html = http_client().get_text(
            ADR_SOURCE_URL,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20,
        )
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

    kospi_map = {ts_to_date(item[0]): item[1] for item in kospi_raw}
    kosdaq_map = {ts_to_date(item[0]): item[1] for item in kosdaq_raw}
    all_dates = sorted(date_key for date_key in set(kospi_map) | set(kosdaq_map) if date_key)

    records: list[dict] = []
    for date_key in all_dates:
        kospi = pd.to_numeric(kospi_map.get(date_key), errors="coerce")
        kosdaq = pd.to_numeric(kosdaq_map.get(date_key), errors="coerce")
        record = {
            "date": date_key,
            "adr_kospi": None if pd.isna(kospi) or not 0 <= float(kospi) <= 1000 else round(float(kospi), 6),
            "adr_kosdaq": None if pd.isna(kosdaq) or not 0 <= float(kosdaq) <= 1000 else round(float(kosdaq), 6),
        }
        if record["adr_kospi"] is not None or record["adr_kosdaq"] is not None:
            records.append(record)

    return records


def fetch_fear_greed_data() -> list[dict]:
    try:
        payload = http_client().get_json(
            FEAR_GREED_SOURCE_URL,
            headers={"User-Agent": "ThinkStock/1.0 (+https://eg-tools.github.io/ThinkStock/)"},
            timeout=25,
        )
    except Exception as exc:
        print(f"KOSPI fear-greed fetch failed: {exc}")
        return []

    try:
        rows = fear_greed_rows(payload)
    except ValueError as exc:
        print(f"KOSPI fear-greed response contract failed: {exc}")
        return []

    records: list[dict] = []
    for row in rows:
        dt = pd.to_datetime(row.get("date"), errors="coerce")
        score = pd.to_numeric(row.get("score"), errors="coerce")
        if pd.isna(dt) or pd.isna(score) or not 0 <= float(score) <= 100:
            continue
        records.append({"date": dt.strftime("%Y-%m-%d"), "fear_greed": float(score)})
    return sorted(records, key=lambda item: item["date"])


def build_adr_payload(frame: pd.DataFrame) -> dict:
    payload = build_payload(frame, DISPLAY_NAMES, AUXILIARY_SERIES)
    payload.update({
        "description": "ADR (KOSPI/KOSDAQ) and KOSPI Fear & Greed auxiliary indicators",
        "source": "adrinfo.kr; kospi.feargreedchart.com",
        "note": "ADR: 100=balanced, >120=overbought, <80=oversold. Fear & Greed: 0=fear, 100=greed.",
    })
    return payload


def fetch_dart_corp_code_map(api_key: str) -> dict[str, dict[str, str]]:
    content = http_client().get_bytes(
        DART_CORP_CODE_URL,
        params={"crtfc_key": api_key},
        timeout=30,
    )
    with zipfile.ZipFile(BytesIO(content)) as archive:
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


def fetch_dart_disclosures(
    api_key: str,
    stock_codes: list[str],
    corp_map: dict[str, dict[str, str]] | None = None,
    start_dates: dict[str, str] | None = None,
) -> list[dict]:
    if not api_key or not stock_codes:
        return []
    if corp_map is None:
        try:
            corp_map = fetch_dart_corp_code_map(api_key)
        except Exception as exc:
            print(f"DART corp code fetch failed: {redact_error_message(exc, api_key)}")
            return []

    default_start_date = years_before(date.today(), DART_DISCLOSURE_LOOKBACK_YEARS).strftime("%Y%m%d")
    end_date = date.today().strftime("%Y%m%d")
    records: list[dict] = []

    for stock_code in stock_codes:
        start_date = (start_dates or {}).get(stock_code, default_start_date)
        corp = corp_map.get(stock_code)
        if not corp:
            print(f"DART corp code not found for {stock_code}")
            continue

        page_no = 1
        total_page = 1
        while page_no <= total_page:
            try:
                payload = http_client().get_json(
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
            except Exception as exc:
                print(
                    f"DART disclosure fetch failed for {stock_code}: "
                    f"{redact_error_message(exc, api_key)}"
                )
                break

            try:
                dart_page = dart_disclosure_page(payload)
            except ValueError as exc:
                print(f"DART response contract failed for {stock_code}: {exc}")
                break
            if dart_page.status == "013":
                break
            if dart_page.status and dart_page.status != "000":
                print(
                    f"DART returned {dart_page.status} for {stock_code}: "
                    f"{dart_page.message}"
                )
                break

            total_page = dart_page.total_page
            for item in dart_page.items:
                title = str(item.get("report_nm") or "").strip()
                event_type = disclosure_type_from_title(title)
                if not event_type:
                    continue
                if not should_display_disclosure(title, event_type):
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


def fetch_dart_market_disclosures(
    api_key: str,
    lookback_days: int = DART_MARKET_LOOKBACK_DAYS,
    max_pages: int = DART_MARKET_MAX_PAGES,
    end_date: date | None = None,
    _streams: tuple[tuple[str, str], ...] | None = None,
) -> list[dict]:
    clean_key = str(api_key or "").strip()
    if not clean_key:
        return []
    end = end_date or date.today()
    start = end - timedelta(days=max(1, int(lookback_days)) - 1)
    streams = tuple(
        (corp_cls, disclosure_type)
        for corp_cls in ("Y", "K")
        for disclosure_type in DART_MARKET_DISCLOSURE_TYPES
    )
    if _streams is None:
        worker_count = min(DART_MARKET_FETCH_WORKERS, len(streams))

        def fetch_stream(stream: tuple[str, str]) -> list[dict]:
            return fetch_dart_market_disclosures(
                clean_key,
                lookback_days=lookback_days,
                max_pages=max_pages,
                end_date=end,
                _streams=(stream,),
            )

        records: list[dict] = []
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="dart-market") as executor:
            for stream_records in executor.map(fetch_stream, streams):
                records.extend(stream_records)
        return normalize_disclosure_records(records)

    selected_streams = set(_streams)
    records: list[dict] = []

    windows: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        window_end = min(end, cursor + timedelta(days=89))
        windows.append((cursor, window_end))
        cursor = window_end + timedelta(days=1)

    page_limit = max(1, int(max_pages))
    for corp_cls in ("Y", "K"):
        for disclosure_type in DART_MARKET_DISCLOSURE_TYPES:
            if (corp_cls, disclosure_type) not in selected_streams:
                continue
            pending_windows = list(reversed(windows))
            while pending_windows:
                window_start, window_end = pending_windows.pop(0)
                page_no = 1
                total_page = 1
                while page_no <= min(total_page, page_limit):
                    try:
                        payload = http_client().get_json(
                            DART_DISCLOSURE_URL,
                            params={
                                "crtfc_key": clean_key,
                                "bgn_de": window_start.strftime("%Y%m%d"),
                                "end_de": window_end.strftime("%Y%m%d"),
                                "last_reprt_at": "Y",
                                "corp_cls": corp_cls,
                                "pblntf_ty": disclosure_type,
                                "sort": "date",
                                "sort_mth": "desc",
                                "page_no": str(page_no),
                                "page_count": "100",
                            },
                            timeout=30,
                        )
                        dart_page = dart_disclosure_page(payload)
                    except Exception as exc:
                        print(
                            "DART market disclosure fetch failed for "
                            f"{window_start}..{window_end} {corp_cls}/{disclosure_type} page {page_no}: "
                            f"{redact_error_message(exc, clean_key)}"
                        )
                        break
                    if dart_page.status == "013":
                        break
                    if dart_page.status and dart_page.status != "000":
                        print(
                            f"DART market returned {dart_page.status} for "
                            f"{window_start}..{window_end} {corp_cls}/{disclosure_type}: {dart_page.message}"
                        )
                        break

                    available_pages = max(1, dart_page.total_page)
                    if page_no == 1 and available_pages > page_limit and window_start < window_end:
                        midpoint = window_start + (window_end - window_start) // 2
                        pending_windows[0:0] = [
                            (midpoint + timedelta(days=1), window_end),
                            (window_start, midpoint),
                        ]
                        print(
                            "Splitting saturated DART market window "
                            f"{window_start}..{window_end} {corp_cls}/{disclosure_type} "
                            f"({available_pages} pages)."
                        )
                        break
                    if page_no == 1 and available_pages > page_limit:
                        print(
                            "DART market single-day result reached the page limit for "
                            f"{window_start} {corp_cls}/{disclosure_type}: "
                            f"{available_pages} pages, reading {page_limit}."
                        )
                    total_page = min(available_pages, page_limit)
                    for item in dart_page.items:
                        stock_code = re.sub(r"\D", "", str(item.get("stock_code") or ""))[:6]
                        title = str(item.get("report_nm") or "").strip()
                        event_type = disclosure_type_from_title(title)
                        raw_date = str(item.get("rcept_dt") or "").strip()
                        if (
                            len(stock_code) != 6
                            or len(raw_date) != 8
                            or not event_type
                            or not should_display_disclosure(title, event_type)
                        ):
                            continue
                        receipt_no = str(item.get("rcept_no") or "").strip()
                        ticker = stock_code_to_ticker(stock_code, corp_cls)
                        records.append({
                            "ticker": ticker,
                            "code": stock_code,
                            "name": str(item.get("corp_name") or stock_code).strip(),
                            "date": f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}",
                            "type": event_type,
                            "title": title,
                            "summary": "",
                            "source": "OpenDART",
                            "receiptNo": receipt_no,
                            "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt_no}" if receipt_no else "",
                        })
                    page_no += 1

    return normalize_disclosure_records(records)


def write_disclosure_payloads(records: list[dict]) -> dict:
    normalized = normalize_disclosure_records(records)
    DISCLOSURE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    by_ticker: dict[str, list[dict]] = {}
    for record in normalized:
        by_ticker.setdefault(record["ticker"], []).append(record)

    for stale in DISCLOSURE_DATA_DIR.glob("*.json"):
        if stale.stem not in by_ticker:
            stale.unlink()

    for ticker, ticker_records in by_ticker.items():
        path = DISCLOSURE_DATA_DIR / disclosure_file_name(ticker)
        path.write_text(
            json.dumps(build_disclosure_payload(ticker_records), ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )

    return build_disclosure_manifest(normalized)


def write_dart_corp_code_payloads(corp_map: dict[str, dict[str, str]]) -> dict:
    manifest, shards = build_dart_corp_code_payloads(
        corp_map,
        DART_CORP_CODE_PREFIX_LENGTH,
    )
    DART_CORP_CODE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for stale in DART_CORP_CODE_DATA_DIR.glob("*.json"):
        if stale.stem not in shards:
            stale.unlink()
    for prefix, payload in shards.items():
        (DART_CORP_CODE_DATA_DIR / f"{prefix}.json").write_text(
            json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
            encoding="utf-8",
        )
    OUTPUT_DART_CORP_CODES_JSON.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    return manifest


def load_existing_dart_corp_code_seed() -> dict[str, dict[str, str]]:
    if not OUTPUT_DART_CORP_CODES_JSON.exists():
        return {}
    try:
        payload = json.loads(OUTPUT_DART_CORP_CODES_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {}
    codes = payload.get("codes")
    if isinstance(codes, dict):
        return {
            str(stock_code).strip(): {"corp_code": str(corp_code).strip(), "corp_name": ""}
            for stock_code, corp_code in codes.items()
            if len(str(stock_code).strip()) == 6 and str(corp_code).strip()
        }
    files = payload.get("files")
    if payload.get("format") == "stock-to-corp-shards-v1" and isinstance(files, dict):
        out: dict[str, dict[str, str]] = {}
        for relative_path in files.values():
            path = ROOT / "docs" / str(relative_path).lstrip("./").replace("/", os.sep)
            try:
                shard_payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            shard_codes = shard_payload.get("codes")
            if not isinstance(shard_codes, dict):
                continue
            for stock_code, corp_code in shard_codes.items():
                clean_stock_code = str(stock_code).strip()
                clean_corp_code = str(corp_code).strip()
                if len(clean_stock_code) == 6 and clean_corp_code:
                    out[clean_stock_code] = {
                        "corp_code": clean_corp_code,
                        "corp_name": "",
                    }
        return out
    records = payload.get("records", [])
    if not isinstance(records, list):
        return {}
    out: dict[str, dict[str, str]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        stock_code = str(record.get("stock_code") or "").strip()
        corp_code = str(record.get("corp_code") or "").strip()
        corp_name = str(record.get("corp_name") or "").strip()
        if len(stock_code) == 6 and corp_code:
            out[stock_code] = {"corp_code": corp_code, "corp_name": corp_name}
    return out


def load_existing_disclosure_seed() -> list[dict]:
    if not OUTPUT_DISCLOSURES_JSON.exists():
        return []
    try:
        payload = json.loads(OUTPUT_DISCLOSURES_JSON.read_text(encoding="utf-8"))
    except Exception:
        return []
    records = payload.get("records", [])
    if isinstance(records, list) and records:
        return normalize_disclosure_records(records)

    files = payload.get("files", {}) if isinstance(payload, dict) else {}
    if not isinstance(files, dict):
        return []
    out: list[dict] = []
    for rel_path in files.values():
        path = ROOT / "docs" / str(rel_path).lstrip("./").replace("/", os.sep)
        if not path.exists():
            continue
        try:
            ticker_payload = json.loads(path.read_text(encoding="utf-8"))
            ticker_records = ticker_payload.get("records", [])
        except Exception:
            continue
        if isinstance(ticker_records, list):
            out.extend(ticker_records)
    return normalize_disclosure_records(out)


def load_existing_price_seed() -> pd.DataFrame:
    if not OUTPUT_JSON.exists():
        return pd.DataFrame(columns=DEFAULT_TICKERS)
    try:
        payload = json.loads(OUTPUT_JSON.read_text(encoding="utf-8"))
        return records_to_frame(records_from_payload(payload), DEFAULT_TICKERS)
    except Exception as exc:
        print(f"Existing price data read failed: {exc}")
        return pd.DataFrame(columns=DEFAULT_TICKERS)


def load_existing_macro_seed() -> pd.DataFrame:
    if not OUTPUT_MACRO_JSON.exists():
        return pd.DataFrame(columns=MACRO_SERIES)
    try:
        payload = json.loads(OUTPUT_MACRO_JSON.read_text(encoding="utf-8"))
        return records_to_frame(records_from_payload(payload), MACRO_SERIES)
    except Exception as exc:
        print(f"Existing macro data read failed: {exc}")
        return pd.DataFrame(columns=MACRO_SERIES)


def merge_price_seed_with_live(seed: pd.DataFrame, live: pd.DataFrame) -> pd.DataFrame:
    seed = seed.reindex(columns=DEFAULT_TICKERS).copy()
    live = live.reindex(columns=DEFAULT_TICKERS).copy()
    if seed.empty:
        merged = live
    elif live.empty:
        merged = seed
    else:
        merged = seed.reindex(seed.index.union(live.index)).sort_index()
        for ticker in DEFAULT_TICKERS:
            fresh = pd.to_numeric(live[ticker], errors="coerce").dropna()
            merged.loc[fresh.index, ticker] = fresh
    merged = merged.apply(pd.to_numeric, errors="coerce")
    merged = merged.dropna(how="all")
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged.index.name = "date"
    return merged[DEFAULT_TICKERS]


def load_existing_adr_seed() -> pd.DataFrame:
    if not OUTPUT_ADR_JSON.exists():
        return pd.DataFrame(columns=AUXILIARY_SERIES)
    try:
        payload = json.loads(OUTPUT_ADR_JSON.read_text(encoding="utf-8"))
        return records_to_frame(records_from_payload(payload), AUXILIARY_SERIES)
    except Exception as exc:
        print(f"Existing auxiliary data read failed: {exc}")
        return pd.DataFrame(columns=AUXILIARY_SERIES)


def merge_auxiliary_data(seed: pd.DataFrame, records: list[dict], columns: list[str]) -> pd.DataFrame:
    incoming = records_to_frame(records, columns)
    if incoming.empty:
        return seed
    merged = seed.copy()
    if merged.empty:
        merged = pd.DataFrame(index=incoming.index, columns=AUXILIARY_SERIES, dtype="float64")
    else:
        merged = merged.reindex(merged.index.union(incoming.index)).sort_index()
    for column in columns:
        if column not in merged.columns:
            merged[column] = pd.NA
        merged.loc[incoming.index, column] = incoming[column]
    for column in AUXILIARY_SERIES:
        if column not in merged.columns:
            merged[column] = pd.NA
    merged = merged[AUXILIARY_SERIES]
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged.index.name = "date"
    return merged


def load_existing_credit_seed() -> pd.DataFrame:
    if not OUTPUT_CREDIT_JSON.exists():
        return pd.DataFrame(columns=CREDIT_SERIES)
    try:
        payload = json.loads(OUTPUT_CREDIT_JSON.read_text(encoding="utf-8"))
    except Exception:
        return pd.DataFrame(columns=CREDIT_SERIES)
    return credit_frame_from_payload(payload)


def load_committed_credit_seed() -> pd.DataFrame:
    try:
        raw = subprocess.check_output(
            ["git", "show", "HEAD:docs/data/credit_data.json"],
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            stderr=subprocess.DEVNULL,
        )
        payload = json.loads(raw)
    except Exception:
        return pd.DataFrame(columns=CREDIT_SERIES)
    return credit_frame_from_payload(payload)


def main() -> None:
    build_started = monotonic()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    full_rebuild = should_full_rebuild(
        [OUTPUT_JSON, OUTPUT_MACRO_JSON, OUTPUT_CREDIT_JSON, OUTPUT_DISCLOSURES_JSON]
    )
    build_report = {
        "generated_at": utc_stamp(),
        "mode": "full" if full_rebuild else "incremental",
        "sources": {},
        "outputs": {},
        "events": [],
    }
    pipeline = SourcePipeline(build_report, SOURCE_STALE_AFTER_DAYS)
    existing_prices = load_existing_price_seed()
    price_fallback = years_before(date.today(), LOOKBACK_YEARS)
    price_start = incremental_start_date(
        existing_prices.index.max() if not existing_prices.empty else None,
        price_fallback,
        PRICE_OVERLAP_DAYS,
        full_rebuild,
    )
    price_started = monotonic()
    live_prices = fetch_prices(price_start)
    price_rebases = detect_price_rebases(existing_prices, live_prices, DEFAULT_TICKERS)
    if price_rebases and not full_rebuild:
        event = f"Price rebase detected for {', '.join(price_rebases)}; refetching full history."
        print(event)
        build_report["events"].append(event)
        live_prices = fetch_prices(price_fallback)
        price_start = price_fallback
    prices = merge_price_seed_with_live(existing_prices, live_prices)
    build_report["policy"] = {
        "mode": build_report["mode"],
        "price_start": price_start.strftime("%Y-%m-%d"),
        "price_overlap_days": PRICE_OVERLAP_DAYS,
        "price_rebases": price_rebases,
    }
    pipeline.record("prices", frame_summary(live_prices), price_started)
    build_report["sources"]["price_seed"] = frame_summary(existing_prices)
    for ticker in DEFAULT_TICKERS:
        live_values = live_prices[ticker].dropna() if ticker in live_prices else pd.Series(dtype="float64")
        seed_values = existing_prices[ticker].dropna() if ticker in existing_prices else pd.Series(dtype="float64")
        if not seed_values.empty and (live_values.empty or seed_values.index.max() > live_values.index.max()):
            latest_seed = seed_values.index.max().strftime("%Y-%m-%d")
            latest_live = live_values.index.max().strftime("%Y-%m-%d") if not live_values.empty else "empty"
            event = f"Preserved newer cached price tail for {ticker}: live={latest_live}, seed={latest_seed}"
            print(event)
            build_report["events"].append(event)

    sample_macro_source = load_macro_source()
    existing_macro_source = load_existing_macro_seed()
    macro_source = sample_macro_source
    if not full_rebuild and not existing_macro_source.empty:
        macro_source = merge_macro_frame(macro_source, existing_macro_source)
    build_report["sources"]["sample_macro"] = frame_summary(sample_macro_source)
    build_report["sources"]["macro_seed"] = frame_summary(existing_macro_source)
    ecos_key = resolve_ecos_api_key()
    kosis_key = resolve_kosis_api_key()
    leading_values = (
        pd.to_numeric(macro_source.get("leading_cycle"), errors="coerce").dropna()
        if "leading_cycle" in macro_source
        else pd.Series(dtype="float64")
    )
    news_values = (
        pd.to_numeric(macro_source.get("news_sentiment"), errors="coerce").dropna()
        if "news_sentiment" in macro_source
        else pd.Series(dtype="float64")
    )
    latest_official_month = leading_values.index.max().normalize() if not leading_values.empty else None
    ecos_leading_start = incremental_month_code(
        latest_official_month,
        ECOS_START,
        ECOS_LEADING_OVERLAP_MONTHS,
        full_rebuild,
    )
    news_fallback = pd.to_datetime(ECOS_NEWS_START, format="%Y%m%d").date()
    ecos_news_start = incremental_start_date(
        news_values.index.max() if not news_values.empty else None,
        news_fallback,
        ECOS_NEWS_OVERLAP_DAYS,
        full_rebuild,
    ).strftime("%Y%m%d")
    build_report["policy"].update({
        "ecos_leading_start": ecos_leading_start,
        "ecos_news_start": ecos_news_start,
        "ecos_leading_overlap_months": ECOS_LEADING_OVERLAP_MONTHS,
        "ecos_news_overlap_days": ECOS_NEWS_OVERLAP_DAYS,
    })
    if kosis_key:
        kosis_leading_cycle = pipeline.run(
            "kosis_leading_cycle",
            lambda: fetch_kosis_leading_cycle(kosis_key, ecos_leading_start),
            frame_summary,
        )
        if not kosis_leading_cycle.empty:
            macro_source = merge_macro_with_leading_cycle(macro_source, kosis_leading_cycle)
            kosis_latest_month = kosis_leading_cycle.index.max().normalize()
            latest_official_month = max(
                month for month in (latest_official_month, kosis_latest_month) if month is not None
            )
            latest = kosis_leading_cycle.index.max().strftime("%Y-%m")
            print(f"Applied KOSIS leading_cycle rows: {len(kosis_leading_cycle)} (latest={latest})")
            build_report["events"].append(
                f"Applied KOSIS leading_cycle rows: {len(kosis_leading_cycle)} latest={latest}"
            )
    else:
        build_report["events"].append("KOSIS_API_KEY is not configured.")

    if ecos_key:
        leading_cycle = pipeline.run(
            "ecos_leading_cycle",
            lambda: fetch_ecos_leading_cycle(ecos_key, ecos_leading_start),
            frame_summary,
        )
        if not leading_cycle.empty:
            macro_source = merge_macro_with_leading_cycle(macro_source, leading_cycle)
            ecos_latest_month = leading_cycle.index.max().normalize()
            latest_official_month = max(
                month for month in (latest_official_month, ecos_latest_month) if month is not None
            )
            latest = leading_cycle.index.max().strftime("%Y-%m")
            print(f"Applied ECOS leading_cycle rows: {len(leading_cycle)} (latest={latest})")
            build_report["events"].append(f"Applied ECOS leading_cycle rows: {len(leading_cycle)} latest={latest}")

        news_sentiment = pipeline.run(
            "ecos_news_sentiment",
            lambda: fetch_ecos_news_sentiment(ecos_key, ecos_news_start),
            frame_summary,
        )
        if not news_sentiment.empty:
            macro_source = merge_macro_frame(macro_source, news_sentiment)
            latest_news = news_sentiment.index.max().strftime("%Y-%m-%d")
            print(f"Applied ECOS news_sentiment rows: {len(news_sentiment)} (latest={latest_news})")
            build_report["events"].append(
                f"Applied ECOS news_sentiment rows: {len(news_sentiment)} latest={latest_news}"
            )
    else:
        build_report["events"].append("ECOS_API_KEY is not configured.")

    oecd_leading_cycle = pipeline.run(
        "oecd_leading_cycle",
        fetch_oecd_leading_cycle_from_fred,
        frame_summary,
    )
    if not oecd_leading_cycle.empty:
        macro_source, applied_months = apply_recent_oecd_tail(
            macro_source,
            oecd_leading_cycle,
            months=2,
            after_month=latest_official_month,
        )
        if applied_months:
            latest = oecd_leading_cycle.index.max().strftime("%Y-%m")
            print(f"Applied OECD leading_cycle tail months: {applied_months} (latest={latest})")
            build_report["events"].append(f"Applied OECD leading_cycle tail months: {applied_months} latest={latest}")

    historical_credit_seed = extract_credit_seed_from_macro(macro_source)
    public_macro_source = extract_public_macro_source(macro_source)
    macro = densify_macro(public_macro_source, prices.index if not prices.empty else pd.DatetimeIndex([]))

    existing_credit_seed = load_existing_credit_seed()
    cached_credit_issue = find_credit_history_discontinuity(existing_credit_seed)
    if cached_credit_issue:
        committed_credit_seed = load_committed_credit_seed()
        committed_credit_issue = find_credit_history_discontinuity(committed_credit_seed)
        if not committed_credit_seed.empty and not committed_credit_issue:
            existing_credit_seed = committed_credit_seed
            event = f"Discarded invalid cached credit seed: {cached_credit_issue}"
            print(event)
            build_report["events"].append(event)
        else:
            print(f"Cached credit seed has a discontinuity: {cached_credit_issue}")
    kofia_key = resolve_kofia_api_key()
    credit_seed = select_credit_seed(historical_credit_seed, existing_credit_seed)
    if not existing_credit_seed.empty:
        latest_existing_credit = existing_credit_seed.index.max().strftime("%Y-%m-%d")
        print(f"Keeping existing verified credit seed (latest={latest_existing_credit}).")
        build_report["events"].append(f"Keeping existing verified credit seed latest={latest_existing_credit}")
    build_report["sources"]["credit_seed"] = frame_summary(credit_seed)
    credit_merged = credit_seed
    kofia_start = incremental_start_date(
        credit_seed.index.max() if not credit_seed.empty else None,
        pd.to_datetime(FREESIS_CREDIT_START, format="%Y%m%d").date(),
        KOFIA_OVERLAP_DAYS,
        full_rebuild,
    ).strftime("%Y%m%d")
    build_report["policy"]["kofia_start"] = kofia_start
    build_report["policy"]["kofia_overlap_days"] = KOFIA_OVERLAP_DAYS
    if kofia_key:
        def load_kofia_credit() -> tuple[pd.DataFrame, dict]:
            request_stats: dict = {}
            frame = merge_credit_frames(
                fetch_kofia_credit(kofia_key, kofia_start, request_stats),
                fetch_kofia_customer_deposit(kofia_key, kofia_start, request_stats),
            )
            return frame, request_stats

        credit_kofia, _ = pipeline.run(
            "kofia_credit",
            load_kofia_credit,
            lambda result: {
                **frame_summary(result[0]),
                **result[1],
            },
        )
        credit_merged, applied_kofia_credit = merge_credit_seed_with_kofia(
            credit_merged,
            credit_kofia,
            build_report["events"],
        )
        if applied_kofia_credit > 0:
            latest_credit = credit_merged.index.max().strftime("%Y-%m-%d")
            print(f"Applied KOFIA credit rows: {applied_kofia_credit} (latest={latest_credit})")
            build_report["events"].append(f"Applied KOFIA credit rows: {applied_kofia_credit} latest={latest_credit}")
        else:
            print("KOFIA credit had no new rows.")
            build_report["events"].append("KOFIA credit had no new rows.")
    else:
        print("KOFIA_API_KEY is not configured; using existing verified credit seed.")
        build_report["events"].append("KOFIA_API_KEY is not configured; using existing verified credit seed.")

    if ENABLE_FREESIS_CREDIT_TAIL:
        freesis_start = incremental_start_date(
            credit_merged.index.max() if not credit_merged.empty else None,
            pd.to_datetime(FREESIS_CREDIT_START, format="%Y%m%d").date(),
            FREESIS_OVERLAP_DAYS,
            full_rebuild,
        ).strftime("%Y%m%d")
        build_report["policy"]["freesis_start"] = freesis_start
        build_report["policy"]["freesis_overlap_days"] = FREESIS_OVERLAP_DAYS
        credit_live = pipeline.run(
            "freesis_credit",
            lambda: merge_credit_frames(
                fetch_freesis_credit(freesis_start),
                fetch_freesis_customer_deposit(freesis_start),
            ),
            frame_summary,
        )
        credit_merged, appended_credit = merge_credit_seed_with_freesis(
            credit_merged,
            credit_live,
            build_report["events"],
        )
    else:
        appended_credit = 0
        print("Skipped Freesis credit history; using existing verified credit seed only.")

    if appended_credit > 0:
        latest_credit = credit_merged.index.max().strftime("%Y-%m-%d")
        print(f"Applied Freesis credit rows: {appended_credit} (latest={latest_credit})")
        build_report["events"].append(f"Applied Freesis credit rows: {appended_credit} latest={latest_credit}")

    adr_records = pipeline.run(
        "adr",
        fetch_adr_data,
        record_summary,
        allow_failure=True,
        default=[],
    )
    if adr_records:
        print(f"Applied ADR rows: {len(adr_records)} (latest={adr_records[-1]['date']})")
        build_report["events"].append(f"Applied ADR rows: {len(adr_records)} latest={adr_records[-1]['date']}")
    else:
        print("ADR fetch had no rows; keeping existing adr_data.json.")
        build_report["events"].append("ADR fetch had no rows; keeping existing adr_data.json.")

    fear_greed_records = pipeline.run(
        "fear_greed",
        fetch_fear_greed_data,
        record_summary,
        allow_failure=True,
        default=[],
    )
    if fear_greed_records:
        latest_fear_greed = fear_greed_records[-1]["date"]
        print(f"Applied KOSPI fear-greed rows: {len(fear_greed_records)} (latest={latest_fear_greed})")
        build_report["events"].append(
            f"Applied KOSPI fear-greed rows: {len(fear_greed_records)} latest={latest_fear_greed}"
        )
    else:
        print("KOSPI fear-greed fetch had no rows; keeping existing auxiliary data.")
        build_report["events"].append("KOSPI fear-greed fetch had no rows; keeping existing auxiliary data.")

    auxiliary = load_existing_adr_seed()
    auxiliary = merge_auxiliary_data(auxiliary, adr_records, ["adr_kospi", "adr_kosdaq"])
    auxiliary = merge_auxiliary_data(auxiliary, fear_greed_records, ["fear_greed"])

    krx_key = resolve_krx_api_key()
    krx_universe_started = monotonic()
    krx_universe = fetch_krx_universe(krx_key) if krx_key else {}
    if not krx_universe and OUTPUT_KRX_UNIVERSE_JSON.exists():
        try:
            krx_universe = json.loads(OUTPUT_KRX_UNIVERSE_JSON.read_text(encoding="utf-8"))
        except Exception:
            krx_universe = {}
    pipeline.record(
        "krx_universe",
        {
            "rows": int(krx_universe.get("total") or 0),
            "latest": str(krx_universe.get("base_date") or ""),
        },
        krx_universe_started,
        status="ok" if krx_universe.get("records") else ("skipped" if not krx_key else "empty"),
    )

    dart_key = resolve_dart_api_key()
    dart_corp_map = load_existing_dart_corp_code_seed()
    dart_corp_started = monotonic()
    dart_corp_mode = "cached"
    dart_corp_error = ""
    if dart_key and (full_rebuild or not dart_corp_map):
        try:
            refreshed_dart_corp_map = fetch_dart_corp_code_map(dart_key)
            if refreshed_dart_corp_map:
                dart_corp_map = refreshed_dart_corp_map
                dart_corp_mode = "refreshed"
        except Exception as exc:
            dart_corp_error = redact_error_message(exc, dart_key)
            print(f"DART corp code map fetch failed: {dart_corp_error}")
    if not dart_corp_map:
        print("DART corp code map is unavailable.")
    elif not full_rebuild:
        print(f"Keeping existing DART corp code map ({len(dart_corp_map)} rows).")
        build_report["events"].append(f"Keeping existing DART corp code map rows: {len(dart_corp_map)}")
    pipeline.record(
        "dart_corp_codes",
        {"rows": len(dart_corp_map), "latest": "", "mode": dart_corp_mode},
        dart_corp_started,
        status=(
            "error"
            if dart_corp_error and not dart_corp_map
            else ("degraded" if dart_corp_error else ("cached" if dart_corp_mode == "cached" else "ok"))
        ),
        error=dart_corp_error,
    )

    existing_disclosure_records = load_existing_disclosure_seed()
    existing_disclosure_tickers = {
        str(record.get("ticker") or "")
        for record in existing_disclosure_records
        if record.get("ticker")
    }
    market_disclosure_backfill = full_rebuild or len(existing_disclosure_tickers) < 1000
    disclosure_stock_codes = configured_disclosure_stock_codes()
    dart_starts = disclosure_start_dates(
        existing_disclosure_records,
        disclosure_stock_codes,
        years_before(date.today(), DART_DISCLOSURE_LOOKBACK_YEARS),
        DART_OVERLAP_DAYS,
        full_rebuild,
    )
    build_report["policy"]["dart_overlap_days"] = DART_OVERLAP_DAYS
    build_report["policy"]["dart_earliest_start"] = min(dart_starts.values(), default="")
    disclosures_started = monotonic()
    configured_disclosure_records = (
        fetch_dart_disclosures(
            dart_key,
            disclosure_stock_codes,
            dart_corp_map,
            start_dates=dart_starts,
        )
        if dart_key
        else []
    )
    market_lookback_days = (
        DART_DISCLOSURE_LOOKBACK_YEARS * 366
        if market_disclosure_backfill
        else DART_MARKET_LOOKBACK_DAYS
    )
    build_report["policy"]["dart_market_backfill"] = market_disclosure_backfill
    build_report["policy"]["dart_market_lookback_days"] = market_lookback_days
    market_disclosure_records = (
        fetch_dart_market_disclosures(dart_key, lookback_days=market_lookback_days)
        if dart_key
        else []
    )
    fresh_disclosure_records = normalize_disclosure_records(
        configured_disclosure_records + market_disclosure_records
    )
    if fresh_disclosure_records:
        disclosure_records = normalize_disclosure_records(
            existing_disclosure_records + fresh_disclosure_records
        )
        disclosure_cutoff = years_before(date.today(), DART_DISCLOSURE_LOOKBACK_YEARS).isoformat()
        disclosure_records = [
            record for record in disclosure_records
            if str(record.get("date") or "") >= disclosure_cutoff
        ]
        print(f"Applied DART disclosure rows: {len(fresh_disclosure_records)} (latest={fresh_disclosure_records[-1]['date']})")
        build_report["events"].append(
            f"Applied DART disclosure rows: {len(fresh_disclosure_records)} latest={fresh_disclosure_records[-1]['date']}"
        )
    else:
        disclosure_records = existing_disclosure_records
        if disclosure_records:
            latest_disclosure = max(str(record.get("date") or "") for record in disclosure_records)
            print(
                "DART_API_KEY is not configured or returned no disclosure rows; "
                f"keeping existing disclosures.json ({len(disclosure_records)} rows, latest={latest_disclosure})."
            )
            build_report["events"].append(
                f"Keeping existing disclosures rows: {len(disclosure_records)} latest={latest_disclosure}"
            )
        else:
            print("DART_API_KEY is not configured or returned no disclosure rows.")
            build_report["events"].append("DART_API_KEY is not configured or returned no disclosure rows.")
    pipeline.record(
        "disclosures",
        record_summary(disclosure_records),
        disclosures_started,
        status="ok" if disclosure_records else ("skipped" if not dart_key else "empty"),
    )

    credit_payload = build_payload(
        credit_merged,
        DISPLAY_NAMES,
        CREDIT_SERIES,
    )
    price_payload = build_payload(prices, DISPLAY_NAMES, DEFAULT_TICKERS)
    macro_payload = build_payload(macro, DISPLAY_NAMES, MACRO_SERIES)
    wrote_prices = write_columnar_payload_or_keep(OUTPUT_JSON, price_payload, "Price")
    wrote_macro = write_columnar_payload_or_keep(OUTPUT_MACRO_JSON, macro_payload, "Macro")

    if credit_merged.empty:
        print("Freesis credit is empty — keeping existing credit_data.json")
    else:
        OUTPUT_CREDIT_JSON.write_text(
            json.dumps(credit_payload, ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )
    if not auxiliary.empty:
        OUTPUT_ADR_JSON.write_text(
            json.dumps(build_adr_payload(auxiliary), ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )
    disclosure_manifest = write_disclosure_payloads(disclosure_records)
    OUTPUT_DISCLOSURES_JSON.write_text(
        json.dumps(disclosure_manifest, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    if dart_corp_map:
        write_dart_corp_code_payloads(dart_corp_map)
    if krx_universe.get("records"):
        OUTPUT_KRX_UNIVERSE_JSON.write_text(
            json.dumps(
                krx_universe,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ),
            encoding="utf-8",
        )
    build_report["segments"] = split_all_payloads(DATA_DIR)
    build_report["outputs"]["prices"] = payload_file_summary(OUTPUT_JSON)
    build_report["outputs"]["macro"] = payload_file_summary(OUTPUT_MACRO_JSON)
    build_report["outputs"]["credit"] = payload_file_summary(OUTPUT_CREDIT_JSON)
    build_report["outputs"]["adr"] = payload_file_summary(OUTPUT_ADR_JSON)
    build_report["outputs"]["disclosures"] = {
        **payload_file_summary(OUTPUT_DISCLOSURES_JSON),
        "tickers": len(disclosure_manifest.get("tickers", [])),
    }
    build_report["outputs"]["dart_corp_codes"] = payload_file_summary(OUTPUT_DART_CORP_CODES_JSON)
    build_report["outputs"]["krx_universe"] = payload_file_summary(OUTPUT_KRX_UNIVERSE_JSON)
    http_metrics = aggregate_http_metrics()
    warnings = health_warnings(build_report["sources"])
    if int(http_metrics.get("failures") or 0) > 0:
        warnings.append(f"http: {http_metrics['failures']} failed requests")
    build_report["health"] = {
        "total_duration_ms": int(round((monotonic() - build_started) * 1000)),
        "warnings": warnings,
        "http": http_metrics,
    }
    for warning in warnings:
        print(f"Build health warning: {warning}")
    write_report_with_history(
        build_report,
        OUTPUT_BUILD_REPORT_JSON,
        OUTPUT_BUILD_HISTORY_JSON,
    )
    if wrote_prices:
        print(f"Wrote {OUTPUT_JSON}")
    if wrote_macro:
        print(f"Wrote {OUTPUT_MACRO_JSON}")
    if not credit_merged.empty:
        print(f"Wrote {OUTPUT_CREDIT_JSON}")
    if not auxiliary.empty:
        print(f"Wrote {OUTPUT_ADR_JSON}")
    print(f"Wrote {OUTPUT_DISCLOSURES_JSON}")
    if dart_corp_map:
        print(f"Wrote {OUTPUT_DART_CORP_CODES_JSON}")
    print(f"Wrote {OUTPUT_BUILD_REPORT_JSON}")
    print(f"Wrote {OUTPUT_BUILD_HISTORY_JSON}")

if __name__ == "__main__":
    main()
