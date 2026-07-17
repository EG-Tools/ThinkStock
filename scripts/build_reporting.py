from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import median

import pandas as pd


BUILD_HISTORY_FORMAT = "thinkstock-build-history-v1"
BUILD_HISTORY_LIMIT = 20


def utc_stamp() -> str:
    return pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def frame_summary(frame: pd.DataFrame) -> dict:
    if frame is None or frame.empty:
        return {"rows": 0, "latest": ""}
    try:
        latest = pd.to_datetime(frame.index.max()).strftime("%Y-%m-%d")
    except Exception:
        latest = ""
    return {"rows": int(len(frame)), "latest": latest}


def record_summary(records: list[dict]) -> dict:
    if not records:
        return {"rows": 0, "latest": ""}
    latest = max(str(record.get("date") or "")[:10] for record in records)
    return {"rows": len(records), "latest": latest}


def payload_file_summary(path: Path) -> dict:
    if not path.exists():
        return {"rows": 0, "latest": ""}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"rows": 0, "latest": ""}

    dates = payload.get("dates")
    if isinstance(dates, list) and dates:
        summary = {"rows": len(dates), "latest": str(dates[-1])[:10]}
        columns = payload.get("columns")
        if isinstance(columns, dict):
            series_latest: dict[str, str] = {}
            series_points: dict[str, int] = {}
            for key, values in columns.items():
                if not isinstance(values, list):
                    continue
                valid_indexes = [
                    index
                    for index, value in enumerate(values[:len(dates)])
                    if isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(float(value))
                ]
                if valid_indexes:
                    series_latest[str(key)] = str(dates[valid_indexes[-1]])[:10]
                    series_points[str(key)] = len(valid_indexes)
            summary["series_latest"] = series_latest
            summary["series_points"] = series_points
        return summary

    records = payload.get("records")
    if isinstance(records, list):
        return record_summary(records)
    return {
        "rows": int(payload.get("total") or 0),
        "latest": max(payload.get("latest", {}).values(), default=""),
    }


def compact_history_entry(report: dict) -> dict:
    health = report.get("health") if isinstance(report.get("health"), dict) else {}
    http = health.get("http") if isinstance(health.get("http"), dict) else {}
    sources = report.get("sources") if isinstance(report.get("sources"), dict) else {}
    return {
        "generated_at": str(report.get("generated_at") or ""),
        "mode": str(report.get("mode") or "unknown"),
        "duration_ms": int(health.get("total_duration_ms") or 0),
        "warnings": len(health.get("warnings") or []),
        "http": {
            "requests": int(http.get("requests") or 0),
            "retries": int(http.get("retries") or 0),
            "failures": int(http.get("failures") or 0),
        },
        "sources": {
            str(name): {
                "status": str(summary.get("status") or ""),
                "latest": str(summary.get("latest") or ""),
                "duration_ms": int(summary.get("duration_ms") or 0),
            }
            for name, summary in sources.items()
            if isinstance(summary, dict) and summary.get("status")
        },
    }


def load_build_history(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    runs = payload.get("runs") if isinstance(payload, dict) else None
    return [run for run in (runs or []) if isinstance(run, dict)]


def update_build_history(path: Path, report: dict, limit: int = BUILD_HISTORY_LIMIT) -> list[dict]:
    current = compact_history_entry(report)
    runs = load_build_history(path)
    generated_at = current["generated_at"]
    runs = [run for run in runs if str(run.get("generated_at") or "") != generated_at]
    runs.append(current)
    runs = sorted(runs, key=lambda run: str(run.get("generated_at") or ""))[-max(1, limit):]
    path.write_text(
        json.dumps({
            "format": BUILD_HISTORY_FORMAT,
            "updated_at": generated_at,
            "runs": runs,
        }, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    return runs


def summarize_build_trend(runs: list[dict], window: int = 10) -> dict:
    recent = runs[-max(1, window):]
    durations = [
        int(run.get("duration_ms") or 0)
        for run in recent
        if int(run.get("duration_ms") or 0) > 0
    ]
    healthy_runs = sum(
        1
        for run in recent
        if int(run.get("warnings") or 0) == 0
        and int((run.get("http") or {}).get("failures") or 0) == 0
    )
    latest_duration = durations[-1] if durations else 0
    median_duration = int(round(median(durations))) if durations else 0
    return {
        "window": len(recent),
        "healthy_runs": healthy_runs,
        "healthy_rate_pct": round((healthy_runs / len(recent)) * 100, 1) if recent else 0.0,
        "median_duration_ms": median_duration,
        "latest_duration_ms": latest_duration,
        "duration_vs_median_pct": (
            round(((latest_duration - median_duration) / median_duration) * 100, 1)
            if median_duration > 0
            else 0.0
        ),
        "total_retries": sum(int((run.get("http") or {}).get("retries") or 0) for run in recent),
        "total_failures": sum(int((run.get("http") or {}).get("failures") or 0) for run in recent),
    }


def write_report_with_history(report: dict, report_path: Path, history_path: Path) -> None:
    runs = update_build_history(history_path, report)
    report.setdefault("health", {})["trend"] = summarize_build_trend(runs)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
