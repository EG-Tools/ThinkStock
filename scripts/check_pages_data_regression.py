from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path


CORE_DATASETS = {
    "prices": "prices.json",
    "macro": "macro_data.json",
    "credit": "credit_data.json",
    "adr": "adr_data.json",
}
MIN_POINT_RETENTION = 0.98
MIN_CORP_CODE_RETENTION = 0.98


class DataRegressionError(AssertionError):
    pass


@dataclass(frozen=True)
class SeriesStats:
    earliest: str
    latest: str
    points: int


def load_json(path: Path) -> dict:
    if not path.exists():
        raise DataRegressionError(f"missing data file: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise DataRegressionError(f"invalid JSON {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise DataRegressionError(f"payload must be an object: {path}")
    return payload


def records_from_payload(payload: dict) -> list[dict]:
    records = payload.get("records")
    if isinstance(records, list) and records:
        return [row for row in records if isinstance(row, dict)]

    dates = payload.get("dates")
    columns = payload.get("columns")
    if not isinstance(dates, list) or not isinstance(columns, dict):
        return []

    rows: list[dict] = []
    for index, raw_date in enumerate(dates):
        row: dict = {"date": str(raw_date or "")[:10]}
        for key, values in columns.items():
            row[str(key)] = values[index] if isinstance(values, list) and index < len(values) else None
        rows.append(row)
    return rows


def is_finite_number(value: object) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def collect_series_stats(payload: dict) -> dict[str, SeriesStats]:
    rows = records_from_payload(payload)
    raw_series = payload.get("series")
    if isinstance(raw_series, list) and raw_series:
        series = [str(key) for key in raw_series if str(key)]
    else:
        series = sorted({str(key) for row in rows for key in row if key != "date"})

    stats: dict[str, SeriesStats] = {}
    for key in series:
        dates = sorted(
            str(row.get("date") or "")[:10]
            for row in rows
            if str(row.get("date") or "")[:10] and is_finite_number(row.get(key))
        )
        if dates:
            stats[key] = SeriesStats(earliest=dates[0], latest=dates[-1], points=len(dates))
    return stats


def compare_core_dataset(name: str, baseline_path: Path, current_path: Path) -> list[str]:
    baseline_stats = collect_series_stats(load_json(baseline_path))
    current_stats = collect_series_stats(load_json(current_path))
    if not baseline_stats:
        return [f"{name}: baseline has no numeric series; comparison skipped"]

    messages: list[str] = []
    for key, before in baseline_stats.items():
        after = current_stats.get(key)
        if after is None:
            raise DataRegressionError(f"{name}: series disappeared: {key}")
        if after.earliest > before.earliest:
            raise DataRegressionError(
                f"{name}: {key} history starts later ({before.earliest} -> {after.earliest})"
            )
        if after.latest < before.latest:
            raise DataRegressionError(
                f"{name}: {key} latest date regressed ({before.latest} -> {after.latest})"
            )
        minimum_points = max(1, math.floor(before.points * MIN_POINT_RETENTION))
        if after.points < minimum_points:
            raise DataRegressionError(
                f"{name}: {key} lost too many points ({before.points} -> {after.points})"
            )
        messages.append(
            f"{name}/{key}: {after.earliest}..{after.latest}, {after.points} points"
        )
    return messages


def disclosure_files(payload: dict) -> dict[str, str]:
    files = payload.get("files")
    if isinstance(files, dict):
        return {str(ticker): str(path) for ticker, path in files.items() if ticker and path}
    return {}


def disclosure_stats(data_root: Path, relative_path: str) -> SeriesStats | None:
    clean_path = relative_path.removeprefix("./data/").removeprefix("data/")
    payload = load_json(data_root / clean_path)
    dates = sorted(
        str(row.get("date") or "")[:10]
        for row in records_from_payload(payload)
        if str(row.get("date") or "")[:10]
    )
    if not dates:
        return None
    return SeriesStats(earliest=dates[0], latest=dates[-1], points=len(dates))


def compare_disclosures(baseline_root: Path, current_root: Path) -> list[str]:
    baseline_manifest = load_json(baseline_root / "disclosures.json")
    current_manifest = load_json(current_root / "disclosures.json")
    baseline_files = disclosure_files(baseline_manifest)
    current_files = disclosure_files(current_manifest)
    if not baseline_files:
        return ["disclosures: baseline manifest is empty; comparison skipped"]

    missing = sorted(set(baseline_files) - set(current_files))
    if missing:
        raise DataRegressionError(f"disclosures: tickers disappeared: {', '.join(missing[:8])}")

    messages: list[str] = []
    for ticker, baseline_path in baseline_files.items():
        before = disclosure_stats(baseline_root, baseline_path)
        after = disclosure_stats(current_root, current_files[ticker])
        if before and not after:
            raise DataRegressionError(f"disclosures: records disappeared for {ticker}")
        if before and after and after.latest < before.latest:
            raise DataRegressionError(
                f"disclosures: {ticker} latest date regressed ({before.latest} -> {after.latest})"
            )
        if after:
            messages.append(f"disclosures/{ticker}: latest {after.latest}, {after.points} records")
    return messages


def compare_corp_codes(baseline_root: Path, current_root: Path) -> str:
    file_name = "dart_corp_codes.json"
    baseline_rows = records_from_payload(load_json(baseline_root / file_name))
    current_rows = records_from_payload(load_json(current_root / file_name))
    if not baseline_rows:
        return "dart_corp_codes: baseline is empty; comparison skipped"
    minimum_rows = max(1, math.floor(len(baseline_rows) * MIN_CORP_CODE_RETENTION))
    if len(current_rows) < minimum_rows:
        raise DataRegressionError(
            f"dart_corp_codes: map shrank too much ({len(baseline_rows)} -> {len(current_rows)})"
        )
    return f"dart_corp_codes: {len(current_rows)} records"


def check_regression(baseline_root: Path, current_root: Path) -> list[str]:
    messages: list[str] = []
    for name, file_name in CORE_DATASETS.items():
        messages.extend(
            compare_core_dataset(name, baseline_root / file_name, current_root / file_name)
        )
    messages.extend(compare_disclosures(baseline_root, current_root))
    messages.append(compare_corp_codes(baseline_root, current_root))
    return messages


def main() -> int:
    parser = argparse.ArgumentParser(description="Reject Pages data that regresses from the last known-good build.")
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--current", type=Path, required=True)
    args = parser.parse_args()

    try:
        messages = check_regression(args.baseline.resolve(), args.current.resolve())
    except DataRegressionError as exc:
        print(f"Pages data regression check failed: {exc}")
        return 1

    print("Pages data regression check passed:")
    for message in messages:
        print(f"- {message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
