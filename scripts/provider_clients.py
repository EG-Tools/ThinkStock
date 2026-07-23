from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Iterable

import pandas as pd
import requests
import yfinance as yf

from provider_contracts import ProviderContractError, kofia_page, yahoo_close_columns


RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}
REQUEST_EXCEPTION = getattr(requests, "RequestException", Exception)


@dataclass(frozen=True)
class KofiaFetchResult:
    items: list[dict]
    pages: int
    total_count: int
    begin_date: str
    stopped_early: bool


class RetryingHttpClient:
    def __init__(
        self,
        session: requests.Session | None = None,
        attempts: int = 3,
        backoff_seconds: float = 0.6,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
        self.session = session or requests.Session()
        self.attempts = max(1, int(attempts))
        self.backoff_seconds = max(0.0, float(backoff_seconds))
        self.sleep_fn = sleep_fn
        self._metrics = {"requests": 0, "retries": 0, "failures": 0}

    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        last_error: Exception | None = None
        for attempt in range(self.attempts):
            try:
                self._metrics["requests"] += 1
                response = self.session.request(method, url, **kwargs)
                if response.status_code not in RETRYABLE_STATUS_CODES:
                    response.raise_for_status()
                    return response
                response.raise_for_status()
            except (REQUEST_EXCEPTION, RuntimeError) as exc:
                last_error = exc
                response = getattr(exc, "response", None)
                status_code = getattr(response, "status_code", None)
                if status_code is not None and status_code not in RETRYABLE_STATUS_CODES:
                    self._metrics["failures"] += 1
                    raise
                if attempt + 1 >= self.attempts:
                    self._metrics["failures"] += 1
                    raise
                self._metrics["retries"] += 1
                retry_after = 0.0
                if response is not None:
                    try:
                        retry_after = float(response.headers.get("Retry-After", "0") or 0)
                    except (TypeError, ValueError):
                        retry_after = 0.0
                delay = max(retry_after, self.backoff_seconds * (2 ** attempt))
                if delay > 0:
                    self.sleep_fn(delay)
        raise last_error or RuntimeError(f"HTTP request failed: {method} {url}")

    def get_json(self, url: str, **kwargs: Any) -> dict:
        return self.request("GET", url, **kwargs).json()

    def post_json(self, url: str, **kwargs: Any) -> dict:
        return self.request("POST", url, **kwargs).json()

    def get_text(self, url: str, **kwargs: Any) -> str:
        return self.request("GET", url, **kwargs).text

    def get_bytes(self, url: str, **kwargs: Any) -> bytes:
        return self.request("GET", url, **kwargs).content

    def metrics(self) -> dict[str, int]:
        return dict(self._metrics)


def extract_close_series(data: pd.DataFrame, ticker: str) -> pd.Series | None:
    if not isinstance(data, pd.DataFrame) or data.empty:
        return None
    if isinstance(data.columns, pd.MultiIndex):
        for column in (
            ("Close", ticker),
            ("Adj Close", ticker),
            (ticker, "Close"),
            (ticker, "Adj Close"),
        ):
            if column in data.columns:
                value = data[column]
                if isinstance(value, pd.DataFrame):
                    return value.iloc[:, 0] if value.shape[1] == 1 else None
                return value
        return None
    if "Close" in data.columns:
        return data["Close"]
    if "Adj Close" in data.columns:
        return data["Adj Close"]
    return None


def _normalize_price_series(series: pd.Series, ticker: str) -> pd.Series:
    clean = pd.to_numeric(series, errors="coerce").rename(ticker).dropna()
    clean = clean[clean > 0]
    index = pd.to_datetime(clean.index)
    try:
        index = index.tz_localize(None)
    except (TypeError, AttributeError):
        try:
            index = index.tz_convert(None)
        except (TypeError, AttributeError):
            pass
    clean.index = index
    return clean


def fetch_yahoo_prices(
    tickers: Iterable[str],
    start: date,
    end: date,
    download_fn: Callable[..., Any] | None = None,
) -> tuple[pd.DataFrame, dict[str, str]]:
    cleaned = list(dict.fromkeys(str(ticker).strip() for ticker in tickers if str(ticker).strip()))
    if not cleaned:
        return pd.DataFrame(), {}
    downloader = download_fn or yf.download
    download_end = pd.Timestamp(end) + pd.Timedelta(days=1)
    series_by_ticker: dict[str, pd.Series] = {}
    failures: dict[str, str] = {}

    try:
        batch = downloader(
            cleaned,
            start=start,
            end=download_end,
            auto_adjust=False,
            progress=False,
            threads=True,
            group_by="column",
        )
        if not isinstance(batch, pd.DataFrame) or not yahoo_close_columns(list(batch.columns), cleaned):
            raise ProviderContractError("Yahoo response is missing close columns")
        for ticker in cleaned:
            if len(cleaned) > 1 and not isinstance(getattr(batch, "columns", None), pd.MultiIndex):
                break
            series = extract_close_series(batch, ticker)
            if series is None:
                continue
            normalized = _normalize_price_series(series, ticker)
            if not normalized.empty:
                series_by_ticker[ticker] = normalized
    except Exception:
        pass

    for ticker in cleaned:
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
            if not isinstance(data, pd.DataFrame) or not yahoo_close_columns(list(data.columns), [ticker]):
                raise ProviderContractError("Yahoo response is missing close columns")
            series = extract_close_series(data, ticker)
            if series is None:
                failures[ticker] = "close series unavailable"
                continue
            normalized = _normalize_price_series(series, ticker)
            if normalized.empty:
                failures[ticker] = "price rows unavailable"
                continue
            series_by_ticker[ticker] = normalized
        except Exception as exc:
            failures[ticker] = str(exc).splitlines()[0].strip() or "price request failed"

    if not series_by_ticker:
        return pd.DataFrame(), failures
    output = pd.concat(
        [series_by_ticker[ticker] for ticker in cleaned if ticker in series_by_ticker],
        axis=1,
    ).sort_index()
    output.index.name = "date"
    return output, failures


def fetch_kofia_items(
    client: RetryingHttpClient,
    endpoint: str,
    service_key: str,
    begin_date: str = "",
    date_field: str = "basDt",
    timeout: int = 30,
) -> KofiaFetchResult:
    items_out: list[dict] = []
    page_no = 1
    last_page = 1
    pages_fetched = 0
    total_count_value = 0
    stopped_early = False
    descending_order = False
    previous_page_last = ""
    clean_begin_date = str(begin_date or "").replace("-", "")[:8]
    while page_no <= last_page:
        params = {
            "serviceKey": service_key,
            "numOfRows": "1000",
            "pageNo": str(page_no),
            "resultType": "json",
        }
        if len(clean_begin_date) == 8 and clean_begin_date.isdigit():
            params["beginBasDt"] = clean_begin_date
        payload = client.get_json(
            endpoint,
            params=params,
            timeout=timeout,
        )
        pages_fetched += 1
        page = kofia_page(payload)
        header = page.header
        result_code = str(header.get("resultCode", ""))
        if result_code and result_code != "00":
            raise RuntimeError(header.get("resultMsg") or "KOFIA API error")
        body = page.body
        valid_items = page.items
        page_dates = [
            str(item.get(date_field) or "").replace("-", "")[:8]
            for item in valid_items
        ]
        page_dates = [value for value in page_dates if len(value) == 8 and value.isdigit()]
        if len(page_dates) >= 2 and page_dates[0] > page_dates[-1]:
            descending_order = True
        if previous_page_last and page_dates and previous_page_last > page_dates[0]:
            descending_order = True
        if page_dates:
            previous_page_last = page_dates[-1]

        if clean_begin_date:
            items_out.extend(
                item
                for item in valid_items
                if str(item.get(date_field) or "").replace("-", "")[:8] >= clean_begin_date
            )
        else:
            items_out.extend(valid_items)
        total_count = pd.to_numeric(body.get("totalCount"), errors="coerce")
        rows_per_page = pd.to_numeric(body.get("numOfRows"), errors="coerce")
        if page_no == 1 and pd.notna(total_count) and total_count > 0:
            total_count_value = int(total_count)
            per_page = int(rows_per_page) if pd.notna(rows_per_page) and rows_per_page > 0 else 1000
            last_page = max(1, (int(total_count) + per_page - 1) // per_page)
        if clean_begin_date and descending_order and page_dates and min(page_dates) < clean_begin_date:
            stopped_early = True
            break
        if not valid_items:
            break
        page_no += 1
    return KofiaFetchResult(
        items=items_out,
        pages=pages_fetched,
        total_count=total_count_value,
        begin_date=clean_begin_date,
        stopped_early=stopped_early,
    )
