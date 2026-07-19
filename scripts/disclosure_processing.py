from __future__ import annotations

import re

import pandas as pd


def disclosure_type_from_title(title: str) -> str | None:
    text = str(title or "")
    if re.search(r"반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출", text):
        return "실적"
    if re.search(r"배당|현금ㆍ현물배당|현금.?현물배당", text):
        return "배당"
    if re.search(r"단일판매|공급계약|수주", text):
        return "수주"
    if re.search(r"유상증자|무상증자|감자|증권신고서\(지분증권\)", text):
        return "증자/감자"
    if re.search(r"전환사채|신주인수권|신주인수권부사채|교환사채|사채권", text):
        return "자금조달"
    if re.search(r"자기주식(취득|처분)결정|주식소각", text):
        return "자사주"
    if re.search(r"합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자", text):
        return "구조/투자"
    if re.search(r"최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획", text):
        return "경영변동"
    return "공시"


def is_important_disclosure_title(title: str, event_type: str = "") -> bool:
    text = str(title or "")
    if event_type in {"실적", "배당", "수주", "증자/감자", "자금조달", "자사주", "구조/투자", "경영변동"}:
        return True
    return bool(re.search(
        r"반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|"
        r"배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|"
        r"전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|"
        r"합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|"
        r"최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획",
        text,
    ))


def is_low_impact_disclosure_title(title: str) -> bool:
    return bool(re.search(
        r"임원ㆍ주요주주특정증권등소유상황보고서|주식등의대량보유상황보고서|최대주주등소유주식변동신고서|"
        r"기업설명회|IR\)|대규모기업집단현황공시|기업지배구조보고서|지속가능경영보고서|동일인등출자계열회사|"
        r"특수관계인|지급수단별|주주총회소집공고|주주총회소집결의|주주총회집중일|정기주주총회결과|"
        r"의결권대리행사|주주명부폐쇄|기준일설정|사외이사의선임|해임또는중도퇴임|"
        r"자기주식취득결과보고서|자기주식처분결과보고서",
        str(title or ""),
    ))


def should_display_disclosure(title: str, event_type: str = "") -> bool:
    if is_important_disclosure_title(title, event_type):
        return True
    if is_low_impact_disclosure_title(title):
        return False
    return False


def normalize_disclosure_records(records: list[dict]) -> list[dict]:
    out: dict[tuple[str, str, str], dict] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        ticker = str(record.get("ticker") or "").strip().upper()
        code = str(record.get("code") or (ticker.split(".")[0] if ticker else "")).strip()
        date_value = str(record.get("date") or "").strip()[:10]
        title = str(record.get("title") or record.get("report_nm") or "").strip()
        if not re.match(r"^[0-9]{6}\.(KS|KQ)$", ticker):
            continue
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_value) or not title:
            continue
        classified_type = disclosure_type_from_title(title)
        raw_type = str(record.get("type") or "").strip()
        event_type = classified_type if not raw_type or raw_type == "공시" else raw_type
        if not should_display_disclosure(title, event_type):
            continue
        out[(ticker, date_value, title)] = {
            "ticker": ticker,
            "code": code,
            "name": str(record.get("name") or record.get("corp_name") or ticker).strip(),
            "date": date_value,
            "type": event_type,
            "title": title,
            "summary": str(record.get("summary") or "").strip(),
            "source": str(record.get("source") or "OpenDART").strip(),
            "receiptNo": str(record.get("receiptNo") or record.get("rcept_no") or "").strip(),
            "url": str(record.get("url") or "").strip(),
        }
    return sorted(out.values(), key=lambda row: (row["date"], row["ticker"], row["title"]))


def build_disclosure_payload(records: list[dict]) -> dict:
    return {
        "generated_at": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenDART",
        "series": ["disclosures"],
        "records": normalize_disclosure_records(records),
    }


def disclosure_file_name(ticker: str) -> str:
    return f"{ticker}.json"


def build_disclosure_manifest(records: list[dict]) -> dict:
    normalized = normalize_disclosure_records(records)
    tickers = sorted({str(record.get("ticker") or "") for record in normalized if record.get("ticker")})
    files = {ticker: f"./data/disclosures/{disclosure_file_name(ticker)}" for ticker in tickers}
    counts = {ticker: 0 for ticker in tickers}
    latest = {ticker: "" for ticker in tickers}
    for record in normalized:
        ticker = record["ticker"]
        counts[ticker] += 1
        latest[ticker] = max(latest[ticker], record["date"])
    return {
        "generated_at": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenDART",
        "format": "by-ticker-v1",
        "series": ["disclosures"],
        "tickers": tickers,
        "files": files,
        "counts": counts,
        "latest": latest,
        "total": len(normalized),
    }


def compact_dart_corp_codes(corp_map: dict[str, dict[str, str]]) -> dict[str, str]:
    return {
        stock_code: str(item.get("corp_code") or "").strip()
        for stock_code, item in sorted(corp_map.items())
        if len(stock_code) == 6 and str(item.get("corp_code") or "").strip()
    }


def build_dart_corp_code_payloads(
    corp_map: dict[str, dict[str, str]],
    prefix_length: int = 2,
) -> tuple[dict, dict[str, dict]]:
    clean_prefix_length = max(1, min(4, int(prefix_length)))
    codes = compact_dart_corp_codes(corp_map)
    by_prefix: dict[str, dict[str, str]] = {}
    for stock_code, corp_code in codes.items():
        by_prefix.setdefault(stock_code[:clean_prefix_length], {})[stock_code] = corp_code
    generated_at = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
    shards = {
        prefix: {
            "generated_at": generated_at,
            "source": "OpenDART",
            "format": "stock-to-corp-shard-v1",
            "prefix": prefix,
            "codes": prefix_codes,
        }
        for prefix, prefix_codes in sorted(by_prefix.items())
    }
    manifest = {
        "generated_at": generated_at,
        "source": "OpenDART",
        "format": "stock-to-corp-shards-v1",
        "prefix_length": clean_prefix_length,
        "total": len(codes),
        "files": {prefix: f"data/dart_corp_codes/{prefix}.json" for prefix in shards},
        "counts": {prefix: len(payload["codes"]) for prefix, payload in shards.items()},
    }
    return manifest, shards


def build_dart_corp_code_payload(corp_map: dict[str, dict[str, str]]) -> dict:
    codes = compact_dart_corp_codes(corp_map)
    return {
        "generated_at": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenDART",
        "format": "stock-to-corp-v2",
        "total": len(codes),
        "codes": codes,
    }
