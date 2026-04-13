import json
from datetime import date
from pathlib import Path

import pandas as pd
import yfinance as yf

DEFAULT_TICKERS = ["^KS11", "^KQ11", "005930.KS", "218410.KQ"]
DISPLAY_NAMES = {
    "leading_cycle": "선행지수 순환변동치",
    "kospi_credit": "코스피 신용잔고",
    "kosdaq_credit": "코스닥 신용잔고",
    "^KS11": "코스피",
    "^KQ11": "코스닥",
    "005930.KS": "삼성전자",
    "218410.KQ": "RFHIC",
}
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"
SAMPLE_MACRO = ROOT / "sample_macro_data.csv"
OUTPUT_JSON = DATA_DIR / "prices.json"
OUTPUT_MACRO = DATA_DIR / "sample_macro_data.csv"
LOOKBACK_YEARS = 30


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
    frames = []
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


def build_payload(df: pd.DataFrame) -> dict:
    records = []
    if not df.empty:
        clean = df.reset_index().copy()
        clean["date"] = pd.to_datetime(clean["date"]).dt.strftime("%Y-%m-%d")
        for column in clean.columns:
            if column == "date":
                continue
            clean[column] = pd.to_numeric(clean[column], errors="coerce").round(4)
        records = clean.where(pd.notna(clean), None).to_dict(orient="records")
    return {
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tickers": DEFAULT_TICKERS,
        "display_names": DISPLAY_NAMES,
        "records": records,
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    prices = fetch_prices()
    payload = build_payload(prices)
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    OUTPUT_MACRO.write_text(SAMPLE_MACRO.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote {OUTPUT_MACRO}")


if __name__ == "__main__":
    main()
