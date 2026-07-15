from __future__ import annotations

import json
from datetime import date
from pathlib import Path


RECENT_DATA_YEARS = 11
SEGMENTED_FILES = (
    "prices.json",
    "macro_data.json",
    "credit_data.json",
    "adr_data.json",
)


def shift_years(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        return value.replace(year=value.year - years, day=28)


def slice_payload(payload: dict, start: int, end: int, segment: str, cutoff: str) -> dict:
    dates = list(payload.get("dates") or [])
    columns = payload.get("columns") if isinstance(payload.get("columns"), dict) else {}
    out = {
        key: value
        for key, value in payload.items()
        if key not in {"dates", "columns", "segment", "cutoff"}
    }
    out["segment"] = segment
    out["cutoff"] = cutoff
    out["dates"] = dates[start:end]
    out["columns"] = {
        str(key): list(values)[start:end] if isinstance(values, list) else []
        for key, values in columns.items()
    }
    return out


def split_columnar_payload(payload: dict, recent_years: int = RECENT_DATA_YEARS) -> tuple[dict, dict]:
    dates = [str(value)[:10] for value in (payload.get("dates") or [])]
    if not dates:
        return (
            slice_payload(payload, 0, 0, "recent", ""),
            slice_payload(payload, 0, 0, "history", ""),
        )

    latest = date.fromisoformat(dates[-1])
    cutoff = shift_years(latest, recent_years).isoformat()
    split_index = next((index for index, value in enumerate(dates) if value >= cutoff), len(dates))
    recent = slice_payload(payload, split_index, len(dates), "recent", cutoff)
    history = slice_payload(payload, 0, split_index, "history", cutoff)
    return recent, history


def write_payload(path: Path, payload: dict) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
        encoding="utf-8",
    )


def split_all_payloads(data_dir: Path, recent_years: int = RECENT_DATA_YEARS) -> dict[str, dict[str, int]]:
    summary: dict[str, dict[str, int]] = {}
    for filename in SEGMENTED_FILES:
        source = data_dir / filename
        if not source.exists():
            continue
        payload = json.loads(source.read_text(encoding="utf-8"))
        recent, history = split_columnar_payload(payload, recent_years)
        stem = source.stem
        write_payload(data_dir / f"{stem}_recent.json", recent)
        write_payload(data_dir / f"{stem}_history.json", history)
        summary[stem] = {
            "recent": len(recent.get("dates") or []),
            "history": len(history.get("dates") or []),
        }
    return summary


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    summary = split_all_payloads(root / "docs" / "data")
    for name, counts in summary.items():
        print(f"{name}: recent={counts['recent']} history={counts['history']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
