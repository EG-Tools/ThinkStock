"""
ThinkStock 로컬 데이터 갱신 스크립트
=====================================
전략:
  - 전체 히스토리: yfinance (KRX는 하루 단위 호출만 지원)
  - 최근 N일 갱신: KRX Open API (공식 데이터로 덮어쓰기)
  - RFHIC(코스닥 개별): yfinance (코스닥 일별매매 미승인)
  - 신용융자 잔고: 금융투자협회 종합통계정보 API (data.go.kr)

사용법:
    python scripts/fetch_local.py           # 전체 재빌드 (yfinance + KRX 최근 30일)
    python scripts/fetch_local.py --days 5  # 최근 5일만 KRX 갱신

API 키:
    scripts/krx_key.txt    (KRX API 키, 한 줄, git 비포함)
    scripts/kofia_key.txt  (금융투자협회 API 키, 한 줄, git 비포함)

KRX 승인된 서비스:
    idx/kospi_dd_trd   - KOSPI 시리즈 일별시세
    idx/kosdaq_dd_trd  - KOSDAQ 시리즈 일별시세
    sto/stk_bydd_trd   - 유가증권 일별매매 (삼성전자 포함)
    sto/stk_isu_base_info, sto/ksq_isu_base_info  - 종목기본정보

금융투자협회 API:
    GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo
      - crdTrFingScrs   : 코스피 신용융자 잔고 (원)
      - crdTrFingKosdaq : 코스닥 신용융자 잔고 (원)
"""

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

ROOT      = Path(__file__).resolve().parents[1]
DATA_DIR  = ROOT / "docs" / "data"
KEY_FILE  = Path(__file__).parent / "krx_key.txt"
KOFIA_KEY_FILE = Path(__file__).parent / "kofia_key.txt"
SAMPLE_MACRO = ROOT / "sample_macro_data.csv"

KRX_BASE     = "http://data-dbg.krx.co.kr/svc/apis"
LOOKBACK_YRS = 30
DEFAULT_UPDATE_DAYS = 30   # 기본 KRX 갱신 범위

DISPLAY_NAMES = {
    "leading_cycle": "선행지수 순환변동치",
    "kospi_credit":  "코스피 신용잔고",
    "kosdaq_credit": "코스닥 신용잔고",
    "^KS11":         "코스피",
    "^KQ11":         "코스닥",
    "005930.KS":     "삼성전자",
    "218410.KQ":     "RFHIC",
    "adr_kospi":     "ADR K",
    "adr_kosdaq":    "ADR KQ",
}

YFINANCE_TICKERS = ["^KS11", "^KQ11", "005930.KS", "218410.KQ"]

# KRX 설정: (endpoint, IDX_NM or ISU_CD filter, value column)
KRX_CONFIG = {
    "^KS11":     ("idx/kospi_dd_trd", "IDX_NM", "코스피",  "CLSPRC_IDX", "BAS_DD"),
    "^KQ11":     ("idx/kosdaq_dd_trd","IDX_NM", "코스닥",  "CLSPRC_IDX", "BAS_DD"),
    "005930.KS": ("sto/stk_bydd_trd", "ISU_CD", "005930", "TDD_CLSPRC", "BAS_DD"),
    "218410.KQ": ("sto/ksq_bydd_trd", "ISU_CD", "218410", "TDD_CLSPRC", "BAS_DD"),
}


KOFIA_CREDIT_URL = (
    "https://apis.data.go.kr/1160100/service"
    "/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo"
)

# ── Helpers ────────────────────────────────────────────────────────────────

def load_key() -> str | None:
    if KEY_FILE.exists():
        k = KEY_FILE.read_text().strip()
        return k if k else None
    return None

def load_kofia_key() -> str | None:
    if KOFIA_KEY_FILE.exists():
        k = KOFIA_KEY_FILE.read_text().strip()
        return k if k else None
    return None


def years_before(ref: date, y: int) -> date:
    try:
        return ref.replace(year=ref.year - y)
    except ValueError:
        return ref.replace(year=ref.year - y, month=2, day=28)


def trading_days_between(start: date, end: date) -> list[date]:
    """월~금 날짜 목록 (공휴일 미제외, KRX 빈 응답은 skip)."""
    days = []
    cur = start
    while cur <= end:
        if cur.weekday() < 5:   # 월(0)~금(4)
            days.append(cur)
        cur += timedelta(days=1)
    return days


# ── yfinance (히스토리 전체) ───────────────────────────────────────────────

def fetch_yfinance(tickers: list[str], start: date, end: date) -> pd.DataFrame:
    try:
        import yfinance as yf
    except ImportError:
        print("  yfinance 미설치: pip install yfinance")
        return pd.DataFrame(columns=tickers)

    frames = []
    for ticker in tickers:
        print(f"  yfinance {ticker} ...", end=" ", flush=True)
        data = yf.download(
            ticker,
            start=start,
            end=end + timedelta(days=1),
            auto_adjust=False,
            progress=False,
            threads=False,
        )
        if data is None or data.empty:
            print("빈 데이터")
            continue
        s = None
        for col in ("Close", "Adj Close"):
            if isinstance(data.columns, pd.MultiIndex):
                if (col, ticker) in data.columns:
                    s = data[(col, ticker)].dropna().rename(ticker); break
            elif col in data.columns:
                s = data[col].dropna().rename(ticker); break
        if s is None:
            print("컬럼 없음")
            continue
        idx = pd.to_datetime(s.index)
        try: idx = idx.tz_localize(None)
        except Exception: idx = idx.tz_convert(None)
        s.index = idx
        frames.append(s.to_frame())
        print(f"{len(s)}행")

    if not frames:
        return pd.DataFrame(columns=tickers)
    return pd.concat(frames, axis=1).sort_index()


# ── KRX (최근 N일 갱신) ────────────────────────────────────────────────────

def fetch_krx_day(key: str, ticker: str, d: date) -> float | None:
    """특정 날짜 종가 1개 반환. 공휴일/비거래일이면 None."""
    try:
        import requests
    except ImportError:
        return None

    ep, filter_col, filter_val, val_col, date_col = KRX_CONFIG[ticker]
    r = requests.get(
        f"{KRX_BASE}/{ep}",
        headers={"AUTH_KEY": key},
        params={"basDd": d.strftime("%Y%m%d")},
        timeout=15,
    )
    d_json = r.json()
    rows = d_json.get("OutBlock_1", [])
    for row in rows:
        if row.get(filter_col, "") == filter_val:
            raw = row.get(val_col, "")
            try:
                return float(str(raw).replace(",", ""))
            except (ValueError, TypeError):
                return None
    return None


def update_with_krx(key: str, existing: pd.DataFrame, update_days: int) -> pd.DataFrame:
    """
    최근 update_days 일치 데이터를 KRX API 로 갱신.
    기존 데이터에 없는 날짜는 추가, 있는 날짜는 덮어쓰기.
    """
    today = date.today()
    start = today - timedelta(days=update_days)
    days  = trading_days_between(start, today)
    krx_tickers = list(KRX_CONFIG.keys())

    print(f"\nKRX 갱신: {start} ~ {today} ({len(days)}일 조회)")
    new_rows: dict[str, dict[str, float]] = {}

    for d in days:
        row: dict[str, float] = {}
        for t in krx_tickers:
            val = fetch_krx_day(key, t, d)
            if val is not None:
                row[t] = val
        if row:
            new_rows[d.strftime("%Y-%m-%d")] = row
            print(f"  {d}: {list(row.keys())}")
        # else: 비거래일 (공휴일 등) → skip

    if not new_rows:
        print("  갱신 데이터 없음")
        return existing

    new_df = pd.DataFrame.from_dict(new_rows, orient="index")
    new_df.index = pd.to_datetime(new_df.index)
    new_df.index.name = "date"

    if existing.empty:
        return new_df

    merged = existing.copy()
    for col in new_df.columns:
        if col not in merged.columns:
            merged[col] = float("nan")
    for idx_val, row_data in new_df.iterrows():
        for col, val in row_data.items():
            merged.loc[idx_val, col] = val

    return merged.sort_index()


# ── Macro ──────────────────────────────────────────────────────────────────

def load_macro(price_index: pd.DatetimeIndex) -> pd.DataFrame:
    if not SAMPLE_MACRO.exists():
        return pd.DataFrame()
    macro = pd.read_csv(SAMPLE_MACRO)
    if macro.empty or "date" not in macro.columns:
        return pd.DataFrame()
    macro["date"] = pd.to_datetime(macro["date"], errors="coerce")
    macro = macro.dropna(subset=["date"]).sort_values("date").set_index("date")
    for col in macro.columns:
        macro[col] = pd.to_numeric(macro[col], errors="coerce")

    target = pd.DatetimeIndex(price_index).sort_values().unique()
    target = target[(target >= macro.index.min()) & (target <= macro.index.max())]
    if target.empty:
        return macro
    expanded = macro.reindex(macro.index.union(target)).sort_index()
    dense = expanded.interpolate(method="time", limit_area="inside").reindex(target)
    dense.index.name = "date"
    return dense


# ── Payload ────────────────────────────────────────────────────────────────

def build_payload(df: pd.DataFrame, series: list[str]) -> dict:
    records: list[dict] = []
    if not df.empty:
        clean = df.reset_index().copy()
        clean["date"] = pd.to_datetime(clean["date"]).dt.strftime("%Y-%m-%d")
        for col in clean.columns:
            if col == "date":
                continue
            clean[col] = pd.to_numeric(clean[col], errors="coerce").round(6)
        clean = clean.astype(object).where(pd.notna(clean), None)
        records = clean.to_dict(orient="records")
    return {
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "series": series,
        "display_names": {k: v for k, v in DISPLAY_NAMES.items() if k in series},
        "records": records,
    }


# ── adrinfo.kr ADR 데이터 ──────────────────────────────────────────────────

def fetch_adr_data() -> list[dict]:
    """
    adrinfo.kr/chart 에서 코스피·코스닥 ADR 데이터를 스크래핑한다.
    반환: [{'date': 'YYYY-MM-DD', 'adr_kospi': float|None, 'adr_kosdaq': float|None}, ...]
    단위: % (100=균형, <80=과매도, >120=과매수)
    """
    import re as _re
    try:
        import requests as _req
    except ImportError:
        print("  requests 미설치: pip install requests")
        return []

    print("  adrinfo.kr ADR 스크래핑 ...", end=" ", flush=True)
    try:
        r = _req.get(
            "http://www.adrinfo.kr/chart",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20,
        )
        r.raise_for_status()
        html = r.text
    except Exception as e:
        print(f"오류: {e}")
        return []

    def extract_array(html: str, var_name: str):
        pos = html.find(f"const {var_name}=")
        if pos < 0:
            return []
        end = html.find("];", pos) + 1
        raw = _re.sub(r",\s*\]", "]", html[pos + len(var_name) + 7: end])
        return json.loads(raw)

    import json as _json
    from datetime import datetime as _dt, timezone as _tz

    def ts_to_date(ts_ms):
        return _dt.fromtimestamp(ts_ms / 1000, tz=_tz.utc).strftime("%Y-%m-%d")

    try:
        kospi_raw  = extract_array(html, "kospi_adr")
        kosdaq_raw = extract_array(html, "kosdaq_adr")
    except Exception as e:
        print(f"파싱 오류: {e}")
        return []

    kospi_map  = {ts_to_date(it[0]): it[1] for it in kospi_raw}
    kosdaq_map = {ts_to_date(it[0]): it[1] for it in kosdaq_raw}
    all_dates  = sorted(set(kospi_map) | set(kosdaq_map))

    records = [
        {"date": d, "adr_kospi": kospi_map.get(d), "adr_kosdaq": kosdaq_map.get(d)}
        for d in all_dates
        if kospi_map.get(d) is not None or kosdaq_map.get(d) is not None
    ]
    # 마지막 유효 날짜
    last = next((r for r in reversed(records) if r["adr_kospi"] is not None), None)
    print(f"{len(records)}행  최신: {last['date']} KOSPI={last['adr_kospi']} KOSDAQ={records[-1].get('adr_kosdaq')}")
    return records


def save_adr_data(records: list[dict]) -> None:
    if not records:
        print("  ADR 데이터 없음 — 저장 건너뜀")
        return
    payload = {
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "ADR (Advance-Decline Ratio) — KOSPI / KOSDAQ",
        "source": "adrinfo.kr",
        "note": "Values are percentages. 100=balanced, >120=overbought, <80=oversold",
        "series": ["adr_kospi", "adr_kosdaq"],
        "records": records,
    }
    out = DATA_DIR / "adr_data.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(f"  adr_data.json 저장: {len(records)}행  {records[0]['date']} ~ {records[-1]['date']}")


# ── KOFIA 신용융자 잔고 ────────────────────────────────────────────────────

def fetch_kofia_credit(key: str) -> list[dict]:
    """
    금융투자협회 API 에서 코스피·코스닥 신용융자 잔고 전체 히스토리를 가져온다.
    반환: [{'date': 'YYYY-MM-DD', 'kospi_credit': float, 'kosdaq_credit': float}, ...]
    단위: 조원 (10^12 KRW)
    """
    try:
        import requests
    except ImportError:
        print("  requests 미설치: pip install requests")
        return []

    print(f"  KOFIA 신용융자 잔고 조회 ...", end=" ", flush=True)
    try:
        r = requests.get(
            KOFIA_CREDIT_URL,
            params={"serviceKey": key, "numOfRows": 5000, "pageNo": 1, "resultType": "json"},
            timeout=30,
            verify=False,
        )
        r.raise_for_status()
        body = r.json()["response"]["body"]
        items = body["items"]["item"]
        total = body["totalCount"]
        print(f"{len(items)}행 / 전체 {total}행")
    except Exception as e:
        print(f"오류: {e}")
        return []

    records = []
    for it in reversed(items):   # 오래된 날짜부터
        d = str(it["basDt"])
        date_str = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        try:
            kospi_c  = round(int(it["crdTrFingScrs"])   / 1e12, 4)
            kosdaq_c = round(int(it["crdTrFingKosdaq"]) / 1e12, 4)
        except (KeyError, ValueError):
            continue
        records.append({"date": date_str, "kospi_credit": kospi_c, "kosdaq_credit": kosdaq_c})
    return records


def save_credit_data(records: list[dict]) -> None:
    if not records:
        print("  신용 데이터 없음 — 저장 건너뜀")
        return
    payload = {
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "코스피·코스닥 신용융자 잔고",
        "source": "금융투자협회 종합통계정보 API (data.go.kr)",
        "unit": "조원 (10^12 KRW)",
        "series": ["kospi_credit", "kosdaq_credit"],
        "records": records,
    }
    out = DATA_DIR / "credit_data.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  credit_data.json 저장: {len(records)}행  {records[0]['date']} ~ {records[-1]['date']}")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ThinkStock 데이터 갱신")
    parser.add_argument("--days", type=int, default=DEFAULT_UPDATE_DAYS,
                        help=f"KRX 로 갱신할 최근 일수 (기본: {DEFAULT_UPDATE_DAYS})")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    key = load_key()
    if key:
        print(f"KRX API 키: {key[:8]}...")
    else:
        print("KRX API 키 없음 — yfinance 만 사용합니다.")

    kofia_key = load_kofia_key()
    if kofia_key:
        print(f"KOFIA API 키: {kofia_key[:8]}...")
    else:
        print("KOFIA API 키 없음 — scripts/kofia_key.txt 에 키를 저장하세요.")

    today = date.today()
    hist_start = years_before(today, LOOKBACK_YRS)

    # ── Step 1: yfinance 전체 히스토리 ────────────────────────────────────
    print(f"\n[1/3] yfinance 히스토리 ({hist_start} ~ {today})")
    prices = fetch_yfinance(YFINANCE_TICKERS, hist_start, today)
    if prices.empty:
        print("오류: yfinance 데이터를 가져오지 못했습니다.")
        sys.exit(1)
    prices.index = pd.to_datetime(prices.index)
    prices.index.name = "date"

    # ── Step 2: KRX 로 최근 N일 덮어쓰기 ─────────────────────────────────
    if key:
        print(f"\n[2/3] KRX 최근 {args.days}일 갱신")
        prices = update_with_krx(key, prices, args.days)
    else:
        print("\n[2/3] KRX 갱신 건너뜀 (API 키 없음)")

    # ── Step 3: 매크로 데이터 ─────────────────────────────────────────────
    print("\n[3/3] 매크로 데이터 로드")
    macro = load_macro(prices.index)
    print(f"  {len(macro)}행  컬럼: {list(macro.columns)}")

    # ── Step 4: adrinfo.kr ADR ────────────────────────────────────────────
    print("\n[4/5] adrinfo.kr ADR 스크래핑")
    adr_records = fetch_adr_data()
    save_adr_data(adr_records)

    # ── Step 5: KOFIA 신용융자 잔고 ───────────────────────────────────────
    print("\n[5/5] KOFIA 신용융자 잔고")
    if kofia_key:
        credit_records = fetch_kofia_credit(kofia_key)
        save_credit_data(credit_records)
    else:
        print("  건너뜀 (KOFIA API 키 없음)")

    # ── 저장 ──────────────────────────────────────────────────────────────
    price_payload = build_payload(prices, list(prices.columns))
    macro_payload = build_payload(macro, list(macro.columns))

    out_p = DATA_DIR / "prices.json"
    out_m = DATA_DIR / "macro_data.json"
    out_c = DATA_DIR / "sample_macro_data.csv"

    out_p.write_text(json.dumps(price_payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    out_m.write_text(json.dumps(macro_payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    if SAMPLE_MACRO.exists():
        out_c.write_text(SAMPLE_MACRO.read_text(encoding="utf-8"), encoding="utf-8")

    print(f"\n완료!")
    print(f"  prices.json     {len(price_payload['records'])}행  시리즈: {price_payload['series']}")
    print(f"  macro_data.json {len(macro_payload['records'])}행  시리즈: {macro_payload['series']}")
    print(f"\n다음 단계: git add docs/data/ && git commit -m '데이터 갱신' && git push")


if __name__ == "__main__":
    main()
