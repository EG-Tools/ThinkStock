from __future__ import annotations

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
