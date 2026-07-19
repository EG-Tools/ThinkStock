from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import median

import pandas as pd


BUILD_HISTORY_FORMAT = "thinkstock-build-history-v1"
BUILD_HISTORY_LIMIT = 20
DEFAULT_VALUE_CHANGE_THRESHOLDS = {
    "leading_cycle": 0.05,
    "news_sentiment": 0.35,
    "customer_deposit": 0.25,
    "kospi_credit": 0.25,
    "kosdaq_credit": 0.25,
}


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
            series_latest_values: dict[str, float] = {}
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
                    series_latest_values[str(key)] = float(values[valid_indexes[-1]])
            summary["series_latest"] = series_latest
            summary["series_points"] = series_points
            summary["series_latest_values"] = series_latest_values
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
        "outputs": {
            str(name): {
                key: summary.get(key)
                for key in (
                    "rows",
                    "latest",
                    "series_latest",
                    "series_points",
                    "series_latest_values",
                )
                if key in summary
            }
            for name, summary in (report.get("outputs") or {}).items()
            if isinstance(summary, dict)
        },
    }


def detect_output_anomalies(
    report: dict,
    previous_runs: list[dict],
    retention_ratio: float = 0.8,
    value_change_thresholds: dict[str, float] | None = None,
) -> list[str]:
    if not previous_runs:
        return []
    current_outputs = report.get("outputs") if isinstance(report.get("outputs"), dict) else {}
    previous_outputs = previous_runs[-1].get("outputs")
    if not isinstance(previous_outputs, dict):
        return []

    thresholds = {
        **DEFAULT_VALUE_CHANGE_THRESHOLDS,
        **(value_change_thresholds or {}),
    }
    warnings: list[str] = []
    for name, current in current_outputs.items():
        previous = previous_outputs.get(name)
        if not isinstance(current, dict) or not isinstance(previous, dict):
            continue
        current_latest = str(current.get("latest") or "")
        previous_latest = str(previous.get("latest") or "")
        if current_latest and previous_latest and current_latest < previous_latest:
            warnings.append(
                f"output {name}: latest regressed ({previous_latest} -> {current_latest})"
            )

        previous_rows = int(previous.get("rows") or 0)
        current_rows = int(current.get("rows") or 0)
        if previous_rows >= 20 and current_rows < previous_rows * retention_ratio:
            warnings.append(
                f"output {name}: rows dropped ({previous_rows} -> {current_rows})"
            )

        previous_points = previous.get("series_points")
        current_points = current.get("series_points")
        if isinstance(previous_points, dict) and isinstance(current_points, dict):
            for series, previous_count_raw in previous_points.items():
                previous_count = int(previous_count_raw or 0)
                current_count = int(current_points.get(series) or 0)
                if previous_count >= 20 and current_count < previous_count * retention_ratio:
                    warnings.append(
                        f"output {name}/{series}: points dropped "
                        f"({previous_count} -> {current_count})"
                    )

        previous_values = previous.get("series_latest_values")
        current_values = current.get("series_latest_values")
        if not isinstance(previous_values, dict) or not isinstance(current_values, dict):
            continue
        for series, current_value_raw in current_values.items():
            if series not in previous_values:
                continue
            try:
                previous_value = float(previous_values[series])
                current_value = float(current_value_raw)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(previous_value) or not math.isfinite(current_value):
                continue
            threshold = float(thresholds.get(series, 0.75))
            denominator = max(abs(previous_value), 1e-9)
            change_ratio = abs(current_value - previous_value) / denominator
            if change_ratio > threshold:
                warnings.append(
                    f"output {name}/{series}: latest value changed "
                    f"{change_ratio * 100:.1f}% ({previous_value:g} -> {current_value:g})"
                )
    return warnings


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
    previous_runs = load_build_history(history_path)
    anomalies = detect_output_anomalies(report, previous_runs)
    health = report.setdefault("health", {})
    health["anomalies"] = anomalies
    warnings = health.setdefault("warnings", [])
    for anomaly in anomalies:
        if anomaly not in warnings:
            warnings.append(anomaly)
    runs = update_build_history(history_path, report)
    health["trend"] = summarize_build_trend(runs)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
