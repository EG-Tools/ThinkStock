from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any


class ProviderContractError(ValueError):
    pass


def ecos_statistic_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    search = payload.get("StatisticSearch")
    if search is None:
        if isinstance(payload.get("RESULT"), dict):
            return []
        raise ProviderContractError("ECOS response is missing StatisticSearch")
    if not isinstance(search, dict):
        raise ProviderContractError("ECOS StatisticSearch must be an object")
    rows = search.get("row")
    if rows is None:
        return []
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ProviderContractError("ECOS StatisticSearch.row must be an array")
    return rows


def kosis_rows(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
        raise ProviderContractError("KOSIS response must be an array")
    return payload


@dataclass(frozen=True)
class KofiaPage:
    header: dict[str, Any]
    body: dict[str, Any]
    items: list[dict[str, Any]]


def kofia_page(payload: dict[str, Any]) -> KofiaPage:
    response = payload.get("response")
    if not isinstance(response, dict):
        raise ProviderContractError("KOFIA response is missing response")
    header = response.get("header")
    body = response.get("body")
    if not isinstance(header, dict) or not isinstance(body, dict):
        raise ProviderContractError("KOFIA response header or body is invalid")
    items_container = body.get("items") or {}
    if not isinstance(items_container, dict):
        raise ProviderContractError("KOFIA body.items must be an object")
    raw_items = items_container.get("item")
    if raw_items is None:
        items: list[dict[str, Any]] = []
    elif isinstance(raw_items, dict):
        items = [raw_items]
    elif isinstance(raw_items, list) and all(isinstance(item, dict) for item in raw_items):
        items = raw_items
    else:
        raise ProviderContractError("KOFIA body.items.item must be an object or array")
    return KofiaPage(header=header, body=body, items=items)


@dataclass(frozen=True)
class DartPage:
    status: str
    message: str
    total_page: int
    items: list[dict[str, Any]]


def dart_disclosure_page(payload: dict[str, Any]) -> DartPage:
    if "status" not in payload:
        raise ProviderContractError("DART response is missing status")
    status = str(payload.get("status", ""))
    message = str(payload.get("message", ""))
    if status != "000":
        return DartPage(status=status, message=message, total_page=1, items=[])
    raw_items = payload.get("list")
    if raw_items is None:
        items: list[dict[str, Any]] = []
    elif isinstance(raw_items, list) and all(isinstance(item, dict) for item in raw_items):
        items = raw_items
    else:
        raise ProviderContractError("DART list must be an array")
    try:
        total_page = max(1, int(payload.get("total_page") or 1))
    except (TypeError, ValueError) as exc:
        raise ProviderContractError("DART total_page must be numeric") from exc
    return DartPage(
        status=status,
        message=message,
        total_page=total_page,
        items=items,
    )


def freesis_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if "ds1" not in payload:
        raise ProviderContractError("Freesis response is missing ds1")
    rows = payload.get("ds1")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ProviderContractError("Freesis ds1 must be an array")
    return rows


def fear_greed_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if "rows" not in payload:
        raise ProviderContractError("Fear-greed response is missing rows")
    rows = payload.get("rows")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ProviderContractError("Fear-greed rows must be an array")
    return rows


def adr_series_points(html: str, variable_name: str) -> list[list[Any]]:
    pattern = rf"const\s+{re.escape(variable_name)}\s*=\s*(\[[\s\S]*?\]);"
    match = re.search(pattern, str(html or ""))
    if not match:
        raise ProviderContractError(f"ADR response is missing {variable_name}")
    try:
        points = json.loads(re.sub(r",\s*\]", "]", match.group(1)))
    except json.JSONDecodeError as exc:
        raise ProviderContractError(f"ADR {variable_name} is invalid JSON") from exc
    if not isinstance(points, list) or any(
        not isinstance(point, list) or len(point) < 2
        for point in points
    ):
        raise ProviderContractError(f"ADR {variable_name} points are invalid")
    return points


def yahoo_close_columns(columns: list[Any], tickers: list[str]) -> bool:
    clean_tickers = {str(ticker) for ticker in tickers}
    for column in columns:
        if isinstance(column, tuple):
            parts = tuple(str(part) for part in column)
            if any(part in {"Close", "Adj Close"} for part in parts) and (
                not clean_tickers or any(part in clean_tickers for part in parts)
            ):
                return True
        elif str(column) in {"Close", "Adj Close"}:
            return True
    return False
