import json
from datetime import date
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import yfinance as yf


BUNDLED_MARKET_DATA_FILES = ("macro_data.json", "credit_data.json")


def bundled_data_revision(data_dir: Path) -> tuple[tuple[str, int, int], ...]:
    revision = []
    for name in BUNDLED_MARKET_DATA_FILES:
        path = data_dir / name
        stat = path.stat()
        revision.append((name, stat.st_mtime_ns, stat.st_size))
    return tuple(revision)


def columnar_payload_to_frame(payload: dict[str, Any]) -> pd.DataFrame:
    dates = payload.get("dates")
    columns = payload.get("columns")
    if payload.get("format") != "columnar-v1" or not isinstance(dates, list) or not isinstance(columns, dict):
        raise ValueError("Unsupported bundled market data format")

    values: dict[str, Any] = {}
    for name, series in columns.items():
        if not isinstance(series, list) or len(series) != len(dates):
            raise ValueError(f"Bundled market data length mismatch: {name}")
        values[str(name)] = pd.to_numeric(pd.Series(series), errors="coerce").to_numpy()

    frame = pd.DataFrame(values, index=pd.to_datetime(dates, errors="coerce"))
    frame = frame.loc[~frame.index.isna()]
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    frame.index.name = "date"
    return frame


def load_bundled_market_data(data_dir: Path) -> pd.DataFrame:
    frames = []
    for name in BUNDLED_MARKET_DATA_FILES:
        payload = json.loads((data_dir / name).read_text(encoding="utf-8"))
        frames.append(columnar_payload_to_frame(payload))

    merged = pd.concat(frames, axis=1).sort_index()
    merged = merged.loc[:, ~merged.columns.duplicated(keep="last")]
    merged.index.name = "date"
    return merged.reset_index()


def extract_close_series(data: pd.DataFrame, ticker: str) -> pd.Series | None:
    if not isinstance(data, pd.DataFrame) or data.empty:
        return None

    close_series: pd.Series | pd.DataFrame | None = None
    if isinstance(data.columns, pd.MultiIndex):
        for column in (
            ("Close", ticker),
            ("Adj Close", ticker),
            (ticker, "Close"),
            (ticker, "Adj Close"),
        ):
            if column in data.columns:
                close_series = data[column]
                break
    elif "Close" in data.columns:
        close_series = data["Close"]
    elif "Adj Close" in data.columns:
        close_series = data["Adj Close"]

    if isinstance(close_series, pd.DataFrame):
        if close_series.shape[1] != 1:
            return None
        close_series = close_series.iloc[:, 0]
    return close_series


def _normalize_price_series(close_series: pd.Series, ticker: str) -> pd.Series:
    series = pd.to_numeric(close_series, errors="coerce").rename(ticker).dropna()
    index = pd.to_datetime(series.index)
    try:
        index = index.tz_localize(None)
    except (TypeError, AttributeError):
        try:
            index = index.tz_convert(None)
        except (TypeError, AttributeError):
            pass
    series.index = index
    return series


def fetch_prices(
    tickers: tuple[str, ...],
    start: date,
    end: date,
    download_fn: Callable[..., Any] | None = None,
) -> tuple[pd.DataFrame, list[str], dict[str, str]]:
    cleaned_tickers = list(dict.fromkeys(ticker.strip() for ticker in tickers if ticker.strip()))
    if not cleaned_tickers:
        return pd.DataFrame(), [], {}

    downloader = download_fn or yf.download
    series_by_ticker: dict[str, pd.Series] = {}
    failures: dict[str, str] = {}
    download_end = pd.Timestamp(end) + pd.Timedelta(days=1)

    try:
        batch = downloader(
            cleaned_tickers,
            start=start,
            end=download_end,
            auto_adjust=False,
            progress=False,
            threads=True,
            group_by="column",
        )
        for ticker in cleaned_tickers:
            # Flat columns are only unambiguous when the batch contains one ticker.
            if len(cleaned_tickers) > 1 and not isinstance(getattr(batch, "columns", None), pd.MultiIndex):
                break
            close_series = extract_close_series(batch, ticker)
            if close_series is not None:
                normalized = _normalize_price_series(close_series, ticker)
                if not normalized.empty:
                    series_by_ticker[ticker] = normalized
    except Exception:
        # Individual retries below preserve partial availability when the batch fails.
        pass

    for ticker in cleaned_tickers:
        if ticker in series_by_ticker:
            continue
        try:
            data = downloader(
                ticker,
                start=start,
                end=download_end,
                auto_adjust=False,
                progress=False,
                threads=False,
            )
            if data is None or data.empty:
                failures[ticker] = "가격 데이터를 찾지 못했습니다."
                continue
            close_series = extract_close_series(data, ticker)
            if close_series is None:
                failures[ticker] = "종가 컬럼을 찾지 못했습니다."
                continue
            normalized = _normalize_price_series(close_series, ticker)
            if normalized.empty:
                failures[ticker] = "가격 데이터를 찾지 못했습니다."
                continue
            series_by_ticker[ticker] = normalized
        except Exception as exc:
            message = str(exc).splitlines()[0].strip()
            failures[ticker] = message or "알 수 없는 오류가 발생했습니다."

    success = [ticker for ticker in cleaned_tickers if ticker in series_by_ticker]
    if not success:
        return pd.DataFrame(), success, failures

    out = pd.concat([series_by_ticker[ticker] for ticker in success], axis=1).sort_index()
    out.index.name = "date"
    return out, success, failures
