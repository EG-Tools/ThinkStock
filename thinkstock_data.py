import json
from pathlib import Path
from typing import Any

import pandas as pd


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
