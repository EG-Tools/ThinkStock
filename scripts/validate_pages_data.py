import json
import math
import os
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

from split_pages_data import SEGMENTED_FILES


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"
BUILD_REPORT_JSON = DATA_DIR / "build_report.json"

DATASETS = {
    "prices": DATA_DIR / "prices.json",
    "macro": DATA_DIR / "macro_data.json",
    "credit": DATA_DIR / "credit_data.json",
    "adr": DATA_DIR / "adr_data.json",
    "disclosures": DATA_DIR / "disclosures.json",
}

CREDIT_COLUMNS = ("customer_deposit", "kospi_credit", "kosdaq_credit")
ADR_COLUMNS = ("adr_kospi", "adr_kosdaq", "fear_greed")
# Freesis historical KOSDAQ credit starts with very small positive values.
# True zero or negative source values are normalized to null during build.
CREDIT_LIMITS = {
    "customer_deposit": (0.0001, 300.0),
    "kospi_credit": (0.0001, 80.0),
    "kosdaq_credit": (0.0001, 50.0),
}
CREDIT_MAX_DAILY_PCT_CHANGE = 0.12
CREDIT_MAX_DAILY_ABS_CHANGE = {
    "customer_deposit": 25.0,
    "kospi_credit": 3.0,
    "kosdaq_credit": 1.0,
}
CREDIT_MAX_FRESH_DAYS = 14
PRICE_MAX_FRESH_DAYS = 10
ADR_MAX_FRESH_DAYS = 10
LEADING_MAX_FRESH_DAYS = 150
NEWS_SENTIMENT_MAX_FRESH_DAYS = 14
STRICT_FRESHNESS = os.environ.get("PAGES_STRICT_FRESHNESS", "").strip() == "1"

SOURCE_OUTPUT_RULES = (
    ("ecos_leading_cycle", "macro", ("leading_cycle",), True),
    ("ecos_news_sentiment", "macro", ("news_sentiment",), True),
    ("kofia_credit", "credit", CREDIT_COLUMNS, False),
    ("freesis_credit", "credit", CREDIT_COLUMNS, False),
    ("adr", "adr", ("adr_kospi", "adr_kosdaq"), False),
    ("fear_greed", "adr", ("fear_greed",), False),
)


def fail(message: str) -> None:
    raise AssertionError(message)


def validate_segmented_payloads() -> list[str]:
    summaries: list[str] = []
    for filename in SEGMENTED_FILES:
        source_path = DATA_DIR / filename
        stem = source_path.stem
        recent_path = DATA_DIR / f"{stem}_recent.json"
        history_path = DATA_DIR / f"{stem}_history.json"
        if not recent_path.exists() or not history_path.exists():
            fail(f"segmented payload is missing for {filename}")

        full = json.loads(source_path.read_text(encoding="utf-8"))
        recent = json.loads(recent_path.read_text(encoding="utf-8"))
        history = json.loads(history_path.read_text(encoding="utf-8"))
        full_dates = list(full.get("dates") or [])
        recent_dates = list(recent.get("dates") or [])
        history_dates = list(history.get("dates") or [])
        if history_dates + recent_dates != full_dates:
            fail(f"segmented dates do not reconstruct {filename}")

        full_columns = full.get("columns") or {}
        recent_columns = recent.get("columns") or {}
        history_columns = history.get("columns") or {}
        for series, values in full_columns.items():
            rebuilt = list(history_columns.get(series) or []) + list(recent_columns.get(series) or [])
            if rebuilt != list(values or []):
                fail(f"segmented column {series} does not reconstruct {filename}")
        summaries.append(f"{stem} segments: recent {len(recent_dates)}, history {len(history_dates)}")
    return summaries


def warn(message: str) -> None:
    print(f"Pages data validation warning: {message}", file=sys.stderr)


def fail_or_warn_freshness(message: str) -> None:
    if STRICT_FRESHNESS:
        fail(message)
    warn(message)


def parse_date(raw: object, label: str) -> date:
    text = str(raw or "").strip()[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError as exc:
        raise AssertionError(f"{label}: invalid date {raw!r}") from exc


def load_payload(name: str) -> dict:
    path = DATASETS[name]
    if not path.exists():
        fail(f"{name}: missing {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise AssertionError(f"{name}: invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        fail(f"{name}: payload must be an object")
    return payload


def load_build_report() -> dict:
    if not BUILD_REPORT_JSON.exists():
        return {}
    try:
        payload = json.loads(BUILD_REPORT_JSON.read_text(encoding="utf-8"))
    except Exception as exc:
        raise AssertionError(f"build report: invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        fail("build report: payload must be an object")
    return payload


def records_from_payload(payload: dict) -> list[dict]:
    rows = payload.get("records")
    if isinstance(rows, list) and rows:
        return rows

    dates = payload.get("dates")
    columns = payload.get("columns")
    if not isinstance(dates, list) or not isinstance(columns, dict):
        return []

    raw_series = payload.get("series")
    series = [str(value).strip() for value in raw_series if str(value).strip()] if isinstance(raw_series, list) else list(columns)
    out: list[dict] = []
    for idx, raw_date in enumerate(dates):
        row = {"date": raw_date}
        for key in series:
            values = columns.get(key)
            row[key] = values[idx] if isinstance(values, list) and idx < len(values) else None
        out.append(row)
    return out


def validate_records(name: str, payload: dict) -> list[dict]:
    rows = records_from_payload(payload)
    if not isinstance(rows, list) or not rows:
        fail(f"{name}: records must be a non-empty list")

    prev_date: date | None = None
    seen: set[date] = set()
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            fail(f"{name}: row {idx} must be an object")
        row_date = parse_date(row.get("date"), f"{name} row {idx}")
        if prev_date and row_date <= prev_date:
            fail(f"{name}: dates must be strictly increasing near {row_date.isoformat()}")
        if row_date in seen:
            fail(f"{name}: duplicate date {row_date.isoformat()}")
        seen.add(row_date)
        prev_date = row_date

        numeric_values = 0
        for key, value in row.items():
            if key == "date" or value is None:
                continue
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
                fail(f"{name}: {key} on {row_date.isoformat()} must be a finite number")
            numeric_values += 1
        if numeric_values == 0:
            fail(f"{name}: row {row_date.isoformat()} has no numeric values")

    return rows


def numeric_columns_from_payload(payload: dict, rows: list[dict]) -> tuple[str, ...]:
    raw_series = payload.get("series")
    if isinstance(raw_series, list):
        columns = tuple(str(value).strip() for value in raw_series if str(value).strip())
        if columns:
            return columns

    seen: set[str] = set()
    columns: list[str] = []
    for row in rows:
        for key, value in row.items():
            if key == "date" or key in seen:
                continue
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
                seen.add(key)
                columns.append(key)
    return tuple(columns)


def latest_numeric_date(name: str, rows: list[dict], columns: tuple[str, ...]) -> date:
    if not columns:
        fail(f"{name}: no numeric columns available for freshness validation")

    latest: date | None = None
    for row in rows:
        row_date = parse_date(row.get("date"), name)
        for key in columns:
            value = row.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
                if latest is None or row_date > latest:
                    latest = row_date
                break

    if latest is None:
        fail(f"{name}: no numeric values available for freshness validation")
    return latest


def validate_freshness(name: str, rows: list[dict], columns: tuple[str, ...], max_days: int) -> None:
    latest = latest_numeric_date(name, rows, columns)
    age_days = (date.today() - latest).days
    if age_days < -1:
        fail(f"{name}: latest date {latest.isoformat()} is in the future")
    if age_days > max_days:
        fail_or_warn_freshness(f"{name}: latest date {latest.isoformat()} is stale ({age_days} days old)")


def validate_source_output_alignment(build_report: dict, rows_by_dataset: dict[str, list[dict]]) -> list[str]:
    sources = build_report.get("sources")
    if not isinstance(sources, dict):
        return []

    price_rows = rows_by_dataset.get("prices", [])
    price_dates = [parse_date(row.get("date"), "prices") for row in price_rows]
    summaries: list[str] = []
    for source_name, output_name, columns, align_to_market_day in SOURCE_OUTPUT_RULES:
        source = sources.get(source_name)
        if not isinstance(source, dict) or int(source.get("rows") or 0) <= 0:
            continue
        source_latest = parse_date(source.get("latest"), f"build report source {source_name}")
        expected_latest = source_latest
        if align_to_market_day:
            market_dates = [value for value in price_dates if value >= source_latest]
            if not market_dates:
                summaries.append(
                    f"source/output {source_name}: waiting for a market date after {source_latest.isoformat()}"
                )
                continue
            expected_latest = market_dates[0]

        output_rows = rows_by_dataset.get(output_name, [])
        actual_latest = latest_numeric_date(output_name, output_rows, columns)
        if actual_latest < expected_latest:
            fail(
                "source/output mismatch: "
                f"{source_name} latest {source_latest.isoformat()} requires "
                f"{output_name}/{','.join(columns)} through {expected_latest.isoformat()}, "
                f"got {actual_latest.isoformat()}"
            )
        summaries.append(
            f"source/output {source_name}: {source_latest.isoformat()} -> {actual_latest.isoformat()}"
        )
    return summaries


def validate_credit(rows: list[dict]) -> None:
    last_seen = {key: None for key in CREDIT_COLUMNS}
    for row in rows:
        row_date = parse_date(row.get("date"), "credit")
        for key in CREDIT_COLUMNS:
            value = row.get(key)
            if value is None:
                continue
            value = float(value)
            lower, upper = CREDIT_LIMITS[key]
            if not lower <= value <= upper:
                fail(f"credit: {key} on {row_date.isoformat()} out of expected range: {value}")

            prev = last_seen[key]
            if prev is not None:
                prev_date, prev_value = prev
                if prev_value > 0:
                    pct_change = abs(value / prev_value - 1.0)
                    day_span = max(1, (row_date - prev_date).days)
                    daily_pct_change = pct_change / day_span
                    daily_abs_change = abs(value - prev_value) / day_span
                    if (
                        daily_pct_change > CREDIT_MAX_DAILY_PCT_CHANGE
                        and daily_abs_change > CREDIT_MAX_DAILY_ABS_CHANGE[key]
                    ):
                        fail(
                            "credit: "
                            f"{key} changed {pct_change:.2%} over {day_span} day(s) from {prev_date.isoformat()} "
                            f"to {row_date.isoformat()} ({prev_value} -> {value})"
                        )
            last_seen[key] = (row_date, value)

    missing_columns = [key for key, latest in last_seen.items() if latest is None]
    if missing_columns:
        fail(f"credit: missing numeric series: {missing_columns}")

    has_live_credit_source = (
        os.environ.get("KOFIA_API_KEY", "").strip()
        or os.environ.get("ENABLE_FREESIS_CREDIT_TAIL", "").strip() == "1"
    )
    if has_live_credit_source:
        latest = parse_date(rows[-1].get("date"), "credit latest")
        age_days = (date.today() - latest).days
        if age_days > CREDIT_MAX_FRESH_DAYS:
            fail_or_warn_freshness(f"credit: latest date {latest.isoformat()} is stale ({age_days} days old)")
    else:
        committed_latest = read_committed_credit_latest()
        if committed_latest:
            latest = parse_date(rows[-1].get("date"), "credit latest")
            if latest > committed_latest:
                fail(
                    "credit: latest date advanced without KOFIA_API_KEY "
                    f"({committed_latest.isoformat()} -> {latest.isoformat()})"
                )


def validate_macro_columns(payload: dict, rows: list[dict]) -> None:
    columns = set(numeric_columns_from_payload(payload, rows))
    forbidden = columns.intersection((*CREDIT_COLUMNS, *ADR_COLUMNS))
    if forbidden:
        fail(f"macro: duplicated series should live in dedicated payloads: {sorted(forbidden)}")


def validate_auxiliary(rows: list[dict]) -> None:
    for row in rows:
        value = row.get("fear_greed")
        if value is not None and not 0 <= float(value) <= 100:
            fail(f"adr: fear_greed out of range on {row.get('date')}: {value}")


def validate_disclosures(payload: dict) -> list[dict]:
    rows = payload.get("records")
    if not isinstance(rows, list) and payload.get("format") == "by-ticker-v1":
        rows = []
        files = payload.get("files")
        if not isinstance(files, dict) or not files:
            fail("disclosures: by-ticker manifest must include files")
        for rel_path in files.values():
            path = ROOT / "docs" / str(rel_path).lstrip("./").replace("/", os.sep)
            if not path.exists():
                fail(f"disclosures: missing ticker file {path}")
            try:
                ticker_payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                raise AssertionError(f"disclosures: invalid ticker JSON {path}: {exc}") from exc
            ticker_rows = ticker_payload.get("records", [])
            if not isinstance(ticker_rows, list):
                fail(f"disclosures: ticker file records must be a list {path}")
            rows.extend(ticker_rows)

    if not isinstance(rows, list):
        fail("disclosures: records must be a list")
    rows = sorted(rows, key=lambda row: (
        str(row.get("date") or ""),
        str(row.get("ticker") or ""),
        str(row.get("title") or ""),
    ))

    prev_key: tuple[str, str, str] | None = None
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            fail(f"disclosures: row {idx} must be an object")
        ticker = str(row.get("ticker") or "")
        title = str(row.get("title") or "")
        row_date = parse_date(row.get("date"), f"disclosures row {idx}")
        if not ticker.endswith((".KS", ".KQ")):
            fail(f"disclosures: invalid ticker on row {idx}: {ticker!r}")
        if not title:
            fail(f"disclosures: row {idx} missing title")
        key = (row_date.isoformat(), ticker, title)
        if prev_key and key < prev_key:
            fail(f"disclosures: rows must be sorted near {key}")
        prev_key = key
    return rows


def read_committed_credit_latest() -> date | None:
    try:
        raw = subprocess.check_output(
            ["git", "show", "HEAD:docs/data/credit_data.json"],
            cwd=ROOT,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
        )
        payload = json.loads(raw)
        rows = records_from_payload(payload)
        if not rows:
            return None
        return parse_date(rows[-1].get("date"), "committed credit latest")
    except Exception:
        return None


def main() -> int:
    summaries: list[str] = validate_segmented_payloads()
    rows_by_dataset: dict[str, list[dict]] = {}
    for name in ("prices", "macro", "credit", "adr", "disclosures"):
        payload = load_payload(name)
        if name == "disclosures":
            rows = validate_disclosures(payload)
            latest = rows[-1]["date"] if rows else "empty"
            summaries.append(f"{name}: {len(rows)} rows, latest {latest}")
            continue
        rows = validate_records(name, payload)
        rows_by_dataset[name] = rows
        summaries.append(f"{name}: {len(rows)} rows, latest {rows[-1]['date']}")
        if name == "prices":
            validate_freshness(name, rows, numeric_columns_from_payload(payload, rows), PRICE_MAX_FRESH_DAYS)
        elif name == "macro":
            validate_macro_columns(payload, rows)
            validate_freshness(name, rows, ("leading_cycle",), LEADING_MAX_FRESH_DAYS)
            macro_columns = set(numeric_columns_from_payload(payload, rows))
            if "news_sentiment" in macro_columns:
                validate_freshness(name, rows, ("news_sentiment",), NEWS_SENTIMENT_MAX_FRESH_DAYS)
            elif os.environ.get("ECOS_API_KEY", "").strip():
                fail("macro: news_sentiment is missing while ECOS_API_KEY is configured")
        elif name == "adr":
            validate_auxiliary(rows)
            validate_freshness(name, rows, ADR_COLUMNS, ADR_MAX_FRESH_DAYS)
        if name == "credit":
            validate_credit(rows)

    summaries.extend(validate_source_output_alignment(load_build_report(), rows_by_dataset))

    print("Pages data validation passed:")
    for summary in summaries:
        print(f"- {summary}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"Pages data validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
