from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


def records_from_payload(payload: dict) -> list[dict]:
    records = payload.get("records", []) if isinstance(payload, dict) else []
    if isinstance(records, list) and records:
        return records

    dates = payload.get("dates", []) if isinstance(payload, dict) else []
    columns = payload.get("columns", {}) if isinstance(payload, dict) else {}
    if not isinstance(dates, list) or not isinstance(columns, dict):
        return []
    raw_series = payload.get("series", [])
    series = (
        [str(value).strip() for value in raw_series if str(value).strip()]
        if isinstance(raw_series, list)
        else list(columns)
    )
    out: list[dict] = []
    for index, raw_date in enumerate(dates):
        row = {"date": raw_date}
        for key in series:
            values = columns.get(key)
            row[key] = values[index] if isinstance(values, list) and index < len(values) else None
        out.append(row)
    return out


def records_to_frame(records: list[dict], series_names: list[str]) -> pd.DataFrame:
    frame = pd.DataFrame.from_records(records)
    if frame.empty or "date" not in frame.columns:
        return pd.DataFrame(columns=series_names)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.dropna(subset=["date"]).set_index("date").sort_index()
    for column in series_names:
        if column not in frame.columns:
            frame[column] = pd.NA
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame[series_names]
    frame = frame[~frame.index.duplicated(keep="last")]
    frame.index.name = "date"
    return frame


def build_payload(df: pd.DataFrame, labels: dict[str, str], series_names: list[str]) -> dict:
    dates: list[str] = []
    columns: dict[str, list[float | None]] = {series: [] for series in series_names}
    if not df.empty:
        clean = df.copy()
        for series in series_names:
            if series not in clean.columns:
                clean[series] = pd.NA
        clean = clean[series_names].reset_index().copy()
        clean["date"] = pd.to_datetime(clean["date"]).dt.strftime("%Y-%m-%d")
        dates = clean["date"].tolist()
        for column in series_names:
            clean[column] = pd.to_numeric(clean[column], errors="coerce").round(6)
            columns[column] = (
                clean[column].astype(object).where(pd.notna(clean[column]), None).tolist()
            )
    return {
        "generated_at": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "format": "columnar-v1",
        "series": series_names,
        "display_names": {key: labels[key] for key in series_names if key in labels},
        "dates": dates,
        "columns": columns,
    }


def write_columnar_payload_or_keep(path: Path, payload: dict, label: str) -> bool:
    if payload.get("dates"):
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )
        return True
    if path.exists():
        print(f"{label} payload is empty; keeping existing {path.name}.")
        return False
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    return True
