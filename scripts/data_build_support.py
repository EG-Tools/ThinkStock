from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path
from time import monotonic
from typing import Iterable

import pandas as pd


PRICE_OVERLAP_DAYS = 180
KOFIA_OVERLAP_DAYS = 180
ECOS_LEADING_OVERLAP_MONTHS = 18
ECOS_NEWS_OVERLAP_DAYS = 120
FREESIS_OVERLAP_DAYS = 180
DART_OVERLAP_DAYS = 120
PRICE_REBASE_RATIO_THRESHOLD = 1.8


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def should_full_rebuild(required_seeds: Iterable[Path]) -> bool:
    return env_flag("PAGES_FULL_REBUILD") or any(not path.exists() for path in required_seeds)


def incremental_start_date(
    latest: object,
    fallback: date,
    overlap_days: int,
    full_rebuild: bool,
) -> date:
    if full_rebuild:
        return fallback
    timestamp = pd.to_datetime(latest, errors="coerce")
    if pd.isna(timestamp):
        return fallback
    return max(fallback, timestamp.date() - timedelta(days=max(0, overlap_days)))


def incremental_month_code(
    latest: object,
    fallback: str,
    overlap_months: int,
    full_rebuild: bool,
) -> str:
    if full_rebuild:
        return fallback
    timestamp = pd.to_datetime(latest, errors="coerce")
    if pd.isna(timestamp):
        return fallback
    shifted = pd.Timestamp(timestamp).to_period("M") - max(0, overlap_months)
    return max(fallback, shifted.strftime("%Y%m"))


def detect_price_rebases(
    seed: pd.DataFrame,
    live: pd.DataFrame,
    tickers: Iterable[str],
    threshold: float = PRICE_REBASE_RATIO_THRESHOLD,
    minimum_overlap: int = 3,
) -> list[str]:
    rebased: list[str] = []
    lower = 1.0 / max(1.01, float(threshold))
    upper = max(1.01, float(threshold))
    for ticker in tickers:
        if ticker not in seed.columns or ticker not in live.columns:
            continue
        overlap = pd.concat(
            [
                pd.to_numeric(seed[ticker], errors="coerce").rename("seed"),
                pd.to_numeric(live[ticker], errors="coerce").rename("live"),
            ],
            axis=1,
            join="inner",
        ).dropna()
        overlap = overlap[(overlap["seed"] > 0) & (overlap["live"] > 0)]
        if len(overlap) < minimum_overlap:
            continue
        ratio = float((overlap["seed"] / overlap["live"]).median())
        if ratio < lower or ratio > upper:
            rebased.append(ticker)
    return rebased


def disclosure_start_dates(
    existing_records: list[dict],
    stock_codes: Iterable[str],
    fallback: date,
    overlap_days: int,
    full_rebuild: bool,
) -> dict[str, str]:
    latest_by_code: dict[str, date] = {}
    for record in existing_records:
        code = str(record.get("code") or str(record.get("ticker") or "").split(".")[0]).strip()
        parsed = pd.to_datetime(record.get("date"), errors="coerce")
        if len(code) != 6 or pd.isna(parsed):
            continue
        current = latest_by_code.get(code)
        value = parsed.date()
        if current is None or value > current:
            latest_by_code[code] = value

    starts: dict[str, str] = {}
    for raw_code in stock_codes:
        code = str(raw_code).strip()
        start = incremental_start_date(
            latest_by_code.get(code),
            fallback,
            overlap_days,
            full_rebuild,
        )
        starts[code] = start.strftime("%Y%m%d")
    return starts


def source_health_summary(
    summary: dict,
    started_at: float,
    stale_after_days: int | None = None,
    today: date | None = None,
    status: str = "",
    error: str = "",
    finished_at: float | None = None,
) -> dict:
    out = dict(summary or {})
    ended_at = monotonic() if finished_at is None else float(finished_at)
    out["duration_ms"] = max(0, int(round((ended_at - float(started_at)) * 1000)))
    rows = int(out.get("rows") or 0)
    latest = pd.to_datetime(out.get("latest"), errors="coerce")
    age_days: int | None = None
    if not pd.isna(latest):
        age_days = ((today or date.today()) - latest.date()).days
        out["age_days"] = age_days

    resolved_status = status.strip().lower()
    if not resolved_status:
        if error:
            resolved_status = "error"
        elif rows <= 0:
            resolved_status = "empty"
        elif stale_after_days is not None and age_days is not None and age_days > stale_after_days:
            resolved_status = "stale"
        else:
            resolved_status = "ok"
    out["status"] = resolved_status
    if error:
        out["error"] = str(error).splitlines()[0].strip()
    return out


def health_warnings(sources: dict[str, dict]) -> list[str]:
    warnings: list[str] = []
    for name, summary in sources.items():
        if not isinstance(summary, dict):
            continue
        status = str(summary.get("status") or "")
        if status in {"empty", "stale", "error", "degraded"}:
            detail = str(summary.get("error") or summary.get("latest") or "no rows")
            warnings.append(f"{name}: {status} ({detail})")
    return warnings
