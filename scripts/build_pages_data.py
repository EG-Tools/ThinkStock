import json
import os
from datetime import date
from pathlib import Path

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
LOOKBACK_YEARS = 30
ECOS_STAT_CODE = "901Y067"  # Composite Leading Indicator
ECOS_ITEM_CODE = "I16E"     # Leading index cyclical component
ECOS_START = "199601"
OECD_FRED_SERIES_ID = "KORLOLITOAASTSAM"  # OECD CLI (AA, STSA) mirrored by FRED
OECD_FRED_URL = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={OECD_FRED_SERIES_ID}"


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
    ecos_key = os.environ.get("ECOS_API_KEY", "").strip()
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

    if macro_source.empty:
        OUTPUT_MACRO_CSV.write_text("date\n", encoding="utf-8")
    else:
        macro_source_out = macro_source.reset_index().copy()
        macro_source_out["date"] = pd.to_datetime(macro_source_out["date"]).dt.strftime("%Y-%m-%d")
        macro_source_out.to_csv(OUTPUT_MACRO_CSV, index=False, float_format="%.4f")

    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote {OUTPUT_MACRO_JSON}")
    print(f"Wrote {OUTPUT_MACRO_CSV}")


if __name__ == "__main__":
    main()
