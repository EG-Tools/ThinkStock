"""
ThinkStock 로컬 데이터 갱신 스크립트
=====================================
KRX Open API로 모든 시세 데이터를 받아 docs/data/ 에 저장합니다.
KRX 승인이 안 된 항목은 자동으로 yfinance 로 fallback 합니다.

사용법:
    python scripts/fetch_local.py

API 키 위치:
    scripts/krx_key.txt  (한 줄에 키만 — git 에 올라가지 않음)

KRX 서비스 신청 (openapi.krx.co.kr → 마이페이지 → 서비스 신청):
    - KOSPI Series Daily Price      → idx/kospi_dd_trd
    - KOSDAQ Series Daily Price     → idx/kosdaq_dd_trd
    - Listed Securities Daily Trading → stk/stk_bydd_trd  (or stk/stk_dd_trd)
    - KOSDAQ Daily Trading          → stk/ksq_dd_trd
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"
KEY_FILE = Path(__file__).parent / "krx_key.txt"
SAMPLE_MACRO = ROOT / "sample_macro_data.csv"

LOOKBACK_YEARS = 30
BASE_URL = "http://data-dbg.krx.co.kr/svc/apis"

# ── KRX endpoint map ───────────────────────────────────────────────────────
#  각 항목: (endpoint_path, response_date_col, response_value_col, market_param)
KRX_ENDPOINTS = {
    "^KS11": ("idx/kospi_dd_trd",  "BAS_DD", "CLSPRC_IDX",  {}),
    "^KQ11": ("idx/kosdaq_dd_trd", "BAS_DD", "CLSPRC_IDX",  {}),
    # 개별 종목은 isuCd (ISIN 코드) 파라미터 필요
    "005930.KS": ("stk/stk_dd_trd", "BAS_DD", "CLSPRC", {"isuCd": "KR7005930003"}),
    "218410.KQ": ("stk/ksq_dd_trd", "BAS_DD", "CLSPRC", {"isuCd": "KR7218410006"}),
}
YFINANCE_TICKERS = list(KRX_ENDPOINTS.keys())

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


# ── Helpers ────────────────────────────────────────────────────────────────

def load_key() -> str | None:
    if KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
        if key:
            return key
    return None


def years_before(ref: date, years: int) -> date:
    try:
        return ref.replace(year=ref.year - years)
    except ValueError:
        return ref.replace(year=ref.year - years, month=2, day=28)


def date_range_chunks(start: date, end: date, chunk_days: int = 365):
    """KRX API 는 한 번에 1년치 이하 권장 — 청크로 분할."""
    cur = start
    while cur <= end:
        yield cur, min(cur + timedelta(days=chunk_days - 1), end)
        cur += timedelta(days=chunk_days)


# ── KRX fetch ──────────────────────────────────────────────────────────────

def fetch_krx_series(key: str, ticker: str, start: date, end: date) -> pd.Series | None:
    """단일 종목/지수를 KRX API 에서 30년치 가져옴. 실패 시 None."""
    try:
        import requests
    except ImportError:
        return None

    ep, date_col, val_col, extra_params = KRX_ENDPOINTS[ticker]
    headers = {"AUTH_KEY": key}
    frames = []

    for chunk_start, chunk_end in date_range_chunks(start, end):
        params = {
            "basDd": chunk_end.strftime("%Y%m%d"),
            "strtDd": chunk_start.strftime("%Y%m%d"),
            "endDd":  chunk_end.strftime("%Y%m%d"),
            **extra_params,
        }
        try:
            r = requests.get(f"{BASE_URL}/{ep}", headers=headers, params=params, timeout=30)
            data = r.json()
        except Exception as e:
            print(f"    KRX fetch error ({ticker} {chunk_start}~{chunk_end}): {e}")
            return None

        if data.get("respCode") == "401":
            print(f"    KRX 미승인: {ticker} ({ep}) — yfinance 로 대체합니다")
            return None
        if data.get("respCode") and data["respCode"] != "200":
            print(f"    KRX 오류: {ticker}: {data}")
            return None

        rows = data.get("OutBlock_1", [])
        if not rows:
            continue

        df = pd.DataFrame(rows)
        df[date_col] = pd.to_datetime(df[date_col], format="%Y%m%d", errors="coerce")
        df[val_col] = pd.to_numeric(df[val_col].astype(str).str.replace(",", ""), errors="coerce")
        df = df[[date_col, val_col]].dropna().rename(columns={date_col: "date", val_col: ticker})
        frames.append(df)

    if not frames:
        return None

    combined = pd.concat(frames).set_index("date")[ticker].sort_index()
    combined = combined[~combined.index.duplicated(keep="last")]
    combined.name = ticker
    return combined


# ── yfinance fallback ──────────────────────────────────────────────────────

def fetch_yfinance(tickers: list[str], start: date, end: date) -> pd.DataFrame:
    try:
        import yfinance as yf
    except ImportError:
        print("yfinance 미설치 — pip install yfinance")
        return pd.DataFrame(columns=tickers)

    frames = []
    for ticker in tickers:
        data = yf.download(
            ticker,
            start=start,
            end=end + timedelta(days=1),
            auto_adjust=False,
            progress=False,
            threads=False,
        )
        if data is None or data.empty:
            continue
        for col in ("Close", "Adj Close"):
            if isinstance(data.columns, pd.MultiIndex):
                if (col, ticker) in data.columns:
                    s = data[(col, ticker)].dropna().rename(ticker)
                    break
            elif col in data.columns:
                s = data[col].dropna().rename(ticker)
                break
        else:
            continue
        idx = pd.to_datetime(s.index)
        try:
            idx = idx.tz_localize(None)
        except Exception:
            idx = idx.tz_convert(None)
        s.index = idx
        frames.append(s.to_frame())

    if not frames:
        return pd.DataFrame(columns=tickers)
    return pd.concat(frames, axis=1).sort_index()


# ── Macro (macro_data.json) ────────────────────────────────────────────────

def load_macro_source() -> pd.DataFrame:
    if not SAMPLE_MACRO.exists():
        return pd.DataFrame()
    macro = pd.read_csv(SAMPLE_MACRO)
    if macro.empty or "date" not in macro.columns:
        return pd.DataFrame()
    macro["date"] = pd.to_datetime(macro["date"], errors="coerce")
    macro = macro.dropna(subset=["date"]).sort_values("date").set_index("date")
    for col in macro.columns:
        macro[col] = pd.to_numeric(macro[col], errors="coerce")
    return macro


def densify_macro(macro: pd.DataFrame, price_index: pd.DatetimeIndex) -> pd.DataFrame:
    if macro.empty:
        return macro
    target = pd.DatetimeIndex(price_index).sort_values().unique()
    if target.empty:
        target = pd.date_range(macro.index.min(), macro.index.max(), freq="B")
    target = target[(target >= macro.index.min()) & (target <= macro.index.max())]
    if target.empty:
        return macro.iloc[0:0]
    expanded = macro.reindex(macro.index.union(target)).sort_index()
    dense = expanded.interpolate(method="time", limit_area="inside").reindex(target)
    dense.index.name = "date"
    return dense


# ── Payload builder ────────────────────────────────────────────────────────

def build_payload(df: pd.DataFrame, series_names: list[str]) -> dict:
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
        "series": series_names,
        "display_names": {k: v for k, v in DISPLAY_NAMES.items() if k in series_names},
        "records": records,
    }


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    key = load_key()
    if not key:
        print("⚠  KRX API 키 없음 — scripts/krx_key.txt 확인. yfinance 만 사용합니다.")
    else:
        print(f"✓  KRX API 키 로드: {key[:8]}...")

    start = years_before(date.today(), LOOKBACK_YEARS)
    end   = date.today()
    print(f"조회 범위: {start} ~ {end}\n")

    # ── Price data ─────────────────────────────────────────────────────────
    price_frames: dict[str, pd.Series] = {}
    yf_needed: list[str] = []

    for ticker in YFINANCE_TICKERS:
        if key:
            print(f"  KRX → {ticker} ...", end=" ", flush=True)
            s = fetch_krx_series(key, ticker, start, end)
            if s is not None and not s.empty:
                price_frames[ticker] = s
                print(f"✓ {len(s)}행")
                continue
        yf_needed.append(ticker)

    if yf_needed:
        print(f"\n  yfinance → {yf_needed} ...", end=" ", flush=True)
        yf_df = fetch_yfinance(yf_needed, start, end)
        for t in yf_needed:
            if t in yf_df.columns:
                price_frames[t] = yf_df[t].dropna()
                print(f"\n  yfinance ✓ {t}: {len(price_frames[t])}행", end="")
        print()

    if not price_frames:
        print("❌ 가격 데이터를 가져오지 못했습니다.")
        sys.exit(1)

    prices = pd.concat(price_frames.values(), axis=1).sort_index()
    prices.index.name = "date"
    prices.index = pd.to_datetime(prices.index)

    # ── Macro data ─────────────────────────────────────────────────────────
    print("\n  매크로 데이터 (CSV) 로드...", end=" ")
    macro_raw = load_macro_source()
    macro = densify_macro(macro_raw, prices.index)
    print(f"✓ {len(macro)}행 ({list(macro.columns)})")

    # ── Write ──────────────────────────────────────────────────────────────
    price_payload = build_payload(prices, list(prices.columns))
    macro_payload = build_payload(macro, list(macro.columns))

    out_prices = DATA_DIR / "prices.json"
    out_macro  = DATA_DIR / "macro_data.json"
    out_csv    = DATA_DIR / "sample_macro_data.csv"

    out_prices.write_text(json.dumps(price_payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    out_macro.write_text(json.dumps(macro_payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    if SAMPLE_MACRO.exists():
        out_csv.write_text(SAMPLE_MACRO.read_text(encoding="utf-8"), encoding="utf-8")

    print(f"\n✓  {out_prices.name} — {len(price_payload['records'])}행")
    print(f"✓  {out_macro.name}  — {len(macro_payload['records'])}행")
    print(f"✓  {out_csv.name}")
    print("\n완료! 이제 git add docs/data/ 후 커밋·푸시하세요.")


if __name__ == "__main__":
    main()
