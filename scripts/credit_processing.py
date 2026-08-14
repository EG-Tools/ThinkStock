from __future__ import annotations

import pandas as pd

from payload_output import records_from_payload


CREDIT_SERIES = ["customer_deposit", "kospi_credit", "kosdaq_credit"]
MACRO_SERIES = ["leading_cycle", "news_sentiment"]
CREDIT_MAX_DAILY_PCT_CHANGE = 0.12
CREDIT_MAX_DAILY_ABS_CHANGE = {
    "customer_deposit": 25.0,
    "kospi_credit": 3.0,
    "kosdaq_credit": 1.0,
}


def pick_numeric_columns(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=columns)
    out = frame.copy()
    for column in columns:
        if column not in out.columns:
            out[column] = pd.NA
        out[column] = pd.to_numeric(out[column], errors="coerce")
    out = out[columns].dropna(how="all").sort_index()
    out.index.name = "date"
    return out


def extract_credit_seed_from_macro(macro: pd.DataFrame) -> pd.DataFrame:
    return pick_numeric_columns(macro, CREDIT_SERIES)


def extract_public_macro_source(macro: pd.DataFrame) -> pd.DataFrame:
    return pick_numeric_columns(macro, MACRO_SERIES)


def merge_credit_frames(*frames: pd.DataFrame) -> pd.DataFrame:
    prepared = [
        pick_numeric_columns(frame, CREDIT_SERIES)
        for frame in frames
        if frame is not None and not frame.empty
    ]
    if not prepared:
        return pd.DataFrame(columns=CREDIT_SERIES)
    merged = prepared[0].copy()
    for frame in prepared[1:]:
        merged = frame.combine_first(merged)
    merged = merged.sort_index()
    merged.index.name = "date"
    return merged[CREDIT_SERIES]


def is_plausible_credit_transition(
    prev_date: pd.Timestamp,
    prev_row: pd.Series,
    row_date: pd.Timestamp,
    row: pd.Series,
) -> bool:
    day_span = max(1, (row_date.normalize() - prev_date.normalize()).days)
    for column in CREDIT_SERIES:
        prev_value = pd.to_numeric(prev_row.get(column), errors="coerce")
        value = pd.to_numeric(row.get(column), errors="coerce")
        if pd.isna(prev_value) or pd.isna(value) or float(prev_value) <= 0:
            continue
        daily_pct_change = abs(float(value) / float(prev_value) - 1.0) / day_span
        daily_abs_change = abs(float(value) - float(prev_value)) / day_span
        if (
            daily_pct_change > CREDIT_MAX_DAILY_PCT_CHANGE
            and daily_abs_change > CREDIT_MAX_DAILY_ABS_CHANGE[column]
        ):
            return False
    return True


def is_plausible_credit_value_transition(
    column: str,
    prev_date: pd.Timestamp,
    prev_value: float,
    row_date: pd.Timestamp,
    value: float,
) -> bool:
    day_span = max(1, (row_date.normalize() - prev_date.normalize()).days)
    daily_pct_change = abs(float(value) / float(prev_value) - 1.0) / day_span if prev_value > 0 else 0.0
    daily_abs_change = abs(float(value) - float(prev_value)) / day_span
    return not (
        daily_pct_change > CREDIT_MAX_DAILY_PCT_CHANGE
        and daily_abs_change > CREDIT_MAX_DAILY_ABS_CHANGE[column]
    )


def accepted_credit_series_tail(
    column: str,
    seed_series: pd.Series,
    live_series: pd.Series,
    source_name: str,
    events: list[str] | None = None,
) -> pd.Series:
    seed_values = pd.to_numeric(seed_series, errors="coerce").dropna().sort_index()
    live_values = pd.to_numeric(live_series, errors="coerce").dropna().sort_index()
    live_values = live_values[live_values > 0]
    if live_values.empty:
        return pd.Series(dtype="float64", name=column)

    if seed_values.empty:
        previous_date = live_values.index[0]
        previous_value = float(live_values.iloc[0])
        accepted: dict[pd.Timestamp, float] = {previous_date: previous_value}
        candidates = live_values.iloc[1:]
    else:
        previous_date = seed_values.index[-1]
        previous_value = float(seed_values.iloc[-1])
        accepted = {}
        candidates = live_values[live_values.index > previous_date]

    candidate_items = list(candidates.items())
    for index, (row_date, raw_value) in enumerate(candidate_items):
        value = float(raw_value)
        if is_plausible_credit_value_transition(
            column,
            previous_date,
            previous_value,
            row_date,
            value,
        ):
            accepted[row_date] = value
            previous_date = row_date
            previous_value = value
            continue

        next_item = candidate_items[index + 1] if index + 1 < len(candidate_items) else None
        isolated_spike = bool(
            next_item
            and is_plausible_credit_value_transition(
                column,
                previous_date,
                previous_value,
                next_item[0],
                float(next_item[1]),
            )
        )
        action = "point" if isolated_spike else "tail"
        event = (
            f"Quarantined {source_name} {column} {action} from "
            f"{row_date.strftime('%Y-%m-%d')} due to discontinuity."
        )
        print(event)
        if events is not None:
            events.append(event)
        if not isolated_spike:
            break

    return pd.Series(accepted, dtype="float64", name=column).sort_index()


def quarantine_credit_frame(
    live: pd.DataFrame,
    fallback: pd.DataFrame,
    source_name: str,
    events: list[str] | None = None,
) -> pd.DataFrame:
    live = pick_numeric_columns(live, CREDIT_SERIES)
    fallback = pick_numeric_columns(fallback, CREDIT_SERIES)
    output = pd.DataFrame(index=live.index.union(fallback.index).sort_values(), columns=CREDIT_SERIES)
    for column in CREDIT_SERIES:
        accepted = accepted_credit_series_tail(
            column,
            pd.Series(dtype="float64"),
            live[column],
            source_name,
            events,
        )
        fallback_values = pd.to_numeric(fallback[column], errors="coerce")
        output[column] = accepted.combine_first(fallback_values)
    output = output.dropna(how="all").sort_index()
    output.index.name = "date"
    return output[CREDIT_SERIES]


def merge_credit_seed_with_existing_tail(
    seed: pd.DataFrame,
    existing: pd.DataFrame,
) -> pd.DataFrame:
    seed = pick_numeric_columns(seed, CREDIT_SERIES)
    existing = pick_numeric_columns(existing, CREDIT_SERIES)
    if seed.empty:
        return existing
    if existing.empty:
        return seed
    tail = existing[existing.index > seed.index.max()].sort_index()
    if tail.empty:
        return seed

    keep: list[pd.Timestamp] = []
    prev_date = seed.index.max()
    prev_row = seed.loc[prev_date]
    for row_date, row in tail.iterrows():
        if not is_plausible_credit_transition(prev_date, prev_row, row_date, row):
            print(f"Dropped existing credit tail from {row_date.strftime('%Y-%m-%d')} due to discontinuity.")
            break
        keep.append(row_date)
        prev_date = row_date
        prev_row = row
    return merge_credit_frames(seed, tail.loc[keep]) if keep else seed


def credit_frame_from_payload(payload: dict) -> pd.DataFrame:
    rows = records_from_payload(payload)
    if not isinstance(rows, list) or not rows:
        return pd.DataFrame(columns=CREDIT_SERIES)
    frame = pd.DataFrame.from_records(rows)
    if "date" not in frame.columns:
        return pd.DataFrame(columns=CREDIT_SERIES)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    for column in CREDIT_SERIES:
        if column not in frame.columns:
            frame[column] = pd.NA
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["date"]).drop_duplicates(subset=["date"]).sort_values("date")
    if frame.empty:
        return pd.DataFrame(columns=CREDIT_SERIES)
    out = frame.set_index("date")[CREDIT_SERIES]
    out.index.name = "date"
    return out


def select_credit_seed(
    historical_credit_seed: pd.DataFrame,
    existing_credit_seed: pd.DataFrame,
) -> pd.DataFrame:
    if existing_credit_seed is not None and not existing_credit_seed.empty:
        return existing_credit_seed.copy()
    if historical_credit_seed is not None and not historical_credit_seed.empty:
        return historical_credit_seed.copy()
    return pd.DataFrame(columns=CREDIT_SERIES)


def find_credit_history_discontinuity(frame: pd.DataFrame) -> str:
    if frame is None or frame.empty:
        return ""
    last_seen: dict[str, tuple[pd.Timestamp, float] | None] = {
        column: None for column in CREDIT_SERIES
    }
    for row_date, row in frame.sort_index().iterrows():
        for column in CREDIT_SERIES:
            value = pd.to_numeric(row.get(column), errors="coerce")
            if pd.isna(value):
                continue
            previous = last_seen[column]
            if previous is not None:
                prev_date, prev_value = previous
                day_span = max(1, (row_date.normalize() - prev_date.normalize()).days)
                daily_pct_change = abs(float(value) / prev_value - 1.0) / day_span if prev_value > 0 else 0.0
                daily_abs_change = abs(float(value) - prev_value) / day_span
                if (
                    daily_pct_change > CREDIT_MAX_DAILY_PCT_CHANGE
                    and daily_abs_change > CREDIT_MAX_DAILY_ABS_CHANGE[column]
                ):
                    return (
                        f"{column} {prev_date.strftime('%Y-%m-%d')}->{row_date.strftime('%Y-%m-%d')} "
                        f"({prev_value:g}->{float(value):g})"
                    )
            last_seen[column] = (row_date, float(value))
    return ""


def median_scale_factor(seed: pd.Series, live: pd.Series) -> float:
    merged = pd.concat([seed, live], axis=1, keys=["seed", "live"]).dropna()
    if merged.empty:
        return 1.0
    ratios = (
        (merged["seed"] / merged["live"])
        .replace([pd.NA, float("inf"), float("-inf")], pd.NA)
        .dropna()
    )
    ratios = ratios[ratios > 0]
    return float(ratios.median()) if not ratios.empty else 1.0


def merge_credit_seed_with_incremental_tail(
    seed: pd.DataFrame,
    live: pd.DataFrame,
    source_name: str,
    events: list[str] | None = None,
) -> tuple[pd.DataFrame, int]:
    if live.empty:
        return seed, 0
    if seed.empty:
        return live.sort_index(), len(live)
    seed = pick_numeric_columns(seed, CREDIT_SERIES)
    live = pick_numeric_columns(live, CREDIT_SERIES).sort_index()
    aligned_live = live.copy()
    for column in CREDIT_SERIES:
        overlap = pd.concat(
            [
                pd.to_numeric(seed[column], errors="coerce").rename("seed"),
                pd.to_numeric(live[column], errors="coerce").rename("live"),
            ],
            axis=1,
            join="inner",
        ).dropna()
        overlap = overlap[(overlap["seed"] > 0) & (overlap["live"] > 0)]
        factor = 1.0
        if len(overlap) >= 5:
            recent_overlap = overlap.sort_index().tail(20)
            factor = median_scale_factor(recent_overlap["seed"], recent_overlap["live"])
        if 0.5 <= factor <= 2.0 and (factor > 1.02 or factor < 0.98):
            aligned_live[column] = aligned_live[column] * factor

    merged = seed.copy()
    accepted_dates: set[pd.Timestamp] = set()
    for column in CREDIT_SERIES:
        accepted = accepted_credit_series_tail(
            column,
            seed[column],
            aligned_live[column],
            source_name,
            events,
        )
        for row_date, value in accepted.items():
            merged.loc[row_date, column] = value
            accepted_dates.add(row_date)
    if not accepted_dates:
        return seed, 0
    merged = pick_numeric_columns(merged, CREDIT_SERIES)
    merged.index.name = "date"
    return merged[CREDIT_SERIES], len(accepted_dates)


def merge_credit_seed_with_freesis(
    seed: pd.DataFrame,
    live: pd.DataFrame,
    events: list[str] | None = None,
) -> tuple[pd.DataFrame, int]:
    if live.empty:
        return seed, 0
    if seed.empty:
        return live.sort_index(), len(live)
    live = live.sort_index()
    if len(live) >= 1000:
        merged = quarantine_credit_frame(live, seed, "Freesis", events)
        merged.index.name = "date"
        return merged[CREDIT_SERIES], len(merged)
    return merge_credit_seed_with_incremental_tail(seed, live, "Freesis", events)


def merge_credit_seed_with_kofia(
    seed: pd.DataFrame,
    live: pd.DataFrame,
    events: list[str] | None = None,
) -> tuple[pd.DataFrame, int]:
    return merge_credit_seed_with_incremental_tail(seed, live, "KOFIA", events)
