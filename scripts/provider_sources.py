import os
import re
from datetime import date, timedelta
from io import StringIO
from pathlib import Path
from urllib.parse import urlencode

import pandas as pd

from build_reporting import utc_stamp
from provider_contracts import ecos_statistic_rows, kosis_rows


def read_env_key(path: Path, key: str) -> str:
    if not path.exists():
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return ""
    for line in lines:
        value = line.strip()
        if not value or value.startswith("#") or "=" not in value:
            continue
        name, secret = value.split("=", 1)
        if name.strip().lstrip("\ufeff") == key:
            return secret.strip().strip('"').strip("'")
    return ""


def resolve_api_key(path: Path, *names: str) -> str:
    for name in names:
        env_key = os.environ.get(name, "").strip()
        if env_key:
            return env_key
        file_key = read_env_key(path, name)
        if file_key:
            return file_key
    return ""


def normalize_krx_universe_rows(
    rows: list[dict],
    market: str,
    endpoints: dict[str, str],
) -> list[dict]:
    clean_market = str(market or "").strip().upper()
    if clean_market not in endpoints:
        return []
    suffix = "KQ" if clean_market == "KOSDAQ" else "KS"
    normalized: dict[str, dict] = {}
    for row in rows if isinstance(rows, list) else []:
        raw_code = re.sub(r"\D", "", str(row.get("ISU_SRT_CD") or ""))
        code = raw_code.zfill(6)[-6:]
        name = str(row.get("ISU_ABBRV") or row.get("ISU_NM") or "").strip()
        if len(code) != 6 or not name:
            continue
        ticker = f"{code}.{suffix}"
        normalized[ticker] = {
            "ticker": ticker,
            "code": code,
            "name": name,
            "market": clean_market,
        }
    return sorted(normalized.values(), key=lambda item: (item["name"], item["ticker"]))


def fetch_krx_universe(
    client,
    api_key: str,
    endpoints: dict[str, str],
    lookback_days: int = 14,
) -> dict:
    key = str(api_key or "").strip()
    if not key:
        return {}
    for offset in range(max(0, int(lookback_days)) + 1):
        base_date = (date.today() - timedelta(days=offset)).strftime("%Y%m%d")
        market_rows: dict[str, list[dict]] = {}
        for market, endpoint in endpoints.items():
            rows: list[dict] = []
            for root in (
                f"https://data-dbg.krx.co.kr/svc/apis/sto/{endpoint}",
                f"https://data-dbg.krx.co.kr/svc/sample/apis/sto/{endpoint}",
            ):
                try:
                    payload = client.get_json(
                        root,
                        params={"basDd": base_date, "AUTH_KEY": key},
                        timeout=30,
                    )
                    candidate = payload.get("OutBlock_1") if isinstance(payload, dict) else []
                    if isinstance(candidate, list) and candidate:
                        rows = candidate
                        break
                except Exception:
                    continue
            market_rows[market] = rows
        if not all(market_rows.get(market) for market in endpoints):
            continue
        records: list[dict] = []
        for market, rows in market_rows.items():
            records.extend(normalize_krx_universe_rows(rows, market, endpoints))
        records.sort(key=lambda item: (item["name"], item["ticker"]))
        return {
            "generated_at": utc_stamp(),
            "source": "KRX Open API",
            "format": "krx-universe-v1",
            "base_date": f"{base_date[:4]}-{base_date[4:6]}-{base_date[6:8]}",
            "total": len(records),
            "records": records,
        }
    return {}


def fetch_ecos_leading_cycle(
    client,
    api_key: str,
    start_ym: str,
    stat_code: str,
    item_code: str,
) -> pd.DataFrame:
    if not api_key:
        return pd.DataFrame(columns=["leading_cycle"])
    end_ym = pd.Timestamp.today().strftime("%Y%m")
    url = (
        f"https://ecos.bok.or.kr/api/StatisticSearch/{api_key}/json/kr/1/5000/"
        f"{stat_code}/M/{start_ym}/{end_ym}/{item_code}"
    )
    try:
        payload = client.get_json(url, timeout=20)
    except Exception as exc:
        print(f"ECOS fetch failed: {exc}")
        return pd.DataFrame(columns=["leading_cycle"])

    try:
        rows = ecos_statistic_rows(payload)
    except ValueError as exc:
        print(f"ECOS response contract failed: {exc}")
        return pd.DataFrame(columns=["leading_cycle"])
    if not rows:
        result = payload.get("RESULT", {})
        if result.get("CODE"):
            print(f"ECOS returned {result.get('CODE')}: {result.get('MESSAGE')}")
        return pd.DataFrame(columns=["leading_cycle"])

    records: list[dict] = []
    for row in rows:
        ym = str(row.get("TIME", ""))
        if len(ym) != 6:
            continue
        try:
            records.append({
                "date": pd.to_datetime(f"{ym[:4]}-{ym[4:6]}-01"),
                "leading_cycle": float(row.get("DATA_VALUE")),
            })
        except Exception:
            continue
    if not records:
        return pd.DataFrame(columns=["leading_cycle"])
    out = pd.DataFrame.from_records(records).drop_duplicates(subset=["date"]).sort_values("date")
    out = out.set_index("date")
    out.index.name = "date"
    return out


def fetch_ecos_news_sentiment(
    client,
    api_key: str,
    start_ymd: str,
    stat_code: str,
    item_code: str,
) -> pd.DataFrame:
    if not api_key:
        return pd.DataFrame(columns=["news_sentiment"])
    end_ymd = pd.Timestamp.today().strftime("%Y%m%d")
    url = (
        f"https://ecos.bok.or.kr/api/StatisticSearch/{api_key}/json/kr/1/10000/"
        f"{stat_code}/D/{start_ymd}/{end_ymd}/{item_code}"
    )
    try:
        payload = client.get_json(url, timeout=25)
    except Exception as exc:
        print(f"ECOS news sentiment fetch failed: {exc}")
        return pd.DataFrame(columns=["news_sentiment"])

    try:
        rows = ecos_statistic_rows(payload)
    except ValueError as exc:
        print(f"ECOS news sentiment response contract failed: {exc}")
        return pd.DataFrame(columns=["news_sentiment"])
    if not rows:
        result = payload.get("RESULT", {})
        if result.get("CODE"):
            print(f"ECOS news sentiment returned {result.get('CODE')}: {result.get('MESSAGE')}")
        return pd.DataFrame(columns=["news_sentiment"])

    records: list[dict] = []
    for row in rows:
        ymd = str(row.get("TIME", ""))
        if len(ymd) != 8:
            continue
        dt = pd.to_datetime(ymd, format="%Y%m%d", errors="coerce")
        value = pd.to_numeric(row.get("DATA_VALUE"), errors="coerce")
        if pd.notna(dt) and pd.notna(value):
            records.append({"date": dt, "news_sentiment": float(value)})
    if not records:
        return pd.DataFrame(columns=["news_sentiment"])
    out = pd.DataFrame.from_records(records).drop_duplicates(subset=["date"], keep="last")
    out = out.sort_values("date").set_index("date")
    out.index.name = "date"
    return out


def fetch_kosis_leading_cycle(
    client,
    api_key: str,
    start_ym: str,
    base_url: str,
) -> pd.DataFrame:
    if not api_key:
        return pd.DataFrame(columns=["leading_cycle"])
    query = urlencode({
        "method": "getList",
        "apiKey": api_key,
        "format": "json",
        "jsonVD": "Y",
        "orgId": "101",
        "tblId": "DT_1C8015",
        "itmId": "T1",
        "objL1": "A03",
        "prdSe": "M",
        "startPrdDe": start_ym,
        "endPrdDe": pd.Timestamp.today().strftime("%Y%m"),
    })
    try:
        payload = client.get_json(f"{base_url}?{query}", timeout=20)
    except Exception as exc:
        print(f"KOSIS fetch failed: {exc}")
        return pd.DataFrame(columns=["leading_cycle"])

    try:
        rows = kosis_rows(payload)
    except ValueError as exc:
        print(f"KOSIS response contract failed: {exc}")
        return pd.DataFrame(columns=["leading_cycle"])

    records: list[dict] = []
    for row in rows:
        ym = str(row.get("PRD_DE", ""))
        value = pd.to_numeric(str(row.get("DT", "")).replace(",", ""), errors="coerce")
        if len(ym) != 6 or pd.isna(value):
            continue
        dt = pd.to_datetime(ym, format="%Y%m", errors="coerce")
        if pd.notna(dt):
            records.append({"date": dt, "leading_cycle": float(value)})
    if not records:
        return pd.DataFrame(columns=["leading_cycle"])
    out = pd.DataFrame.from_records(records).drop_duplicates(subset=["date"], keep="last")
    out = out.sort_values("date").set_index("date")
    out.index.name = "date"
    return out


def fetch_oecd_leading_cycle_from_fred(
    client,
    url: str,
    series_id: str,
) -> pd.DataFrame:
    try:
        frame = pd.read_csv(StringIO(client.get_text(url, timeout=25)))
    except Exception as exc:
        print(f"OECD(FRED mirror) fetch failed: {exc}")
        return pd.DataFrame(columns=["leading_cycle"])
    if frame.empty or "observation_date" not in frame.columns or series_id not in frame.columns:
        return pd.DataFrame(columns=["leading_cycle"])

    out = frame.rename(columns={"observation_date": "date", series_id: "leading_cycle"})
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out["leading_cycle"] = pd.to_numeric(out["leading_cycle"], errors="coerce")
    out = out.dropna(subset=["date", "leading_cycle"])
    if out.empty:
        return pd.DataFrame(columns=["leading_cycle"])
    out = out.set_index("date").sort_index()
    out.index.name = "date"
    return out[["leading_cycle"]]
