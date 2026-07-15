from __future__ import annotations

import pandas as pd


def densify_macro(macro: pd.DataFrame, price_index: pd.DatetimeIndex) -> pd.DataFrame:
    if macro.empty:
        return macro

    target_index = pd.DatetimeIndex(price_index).sort_values().unique()
    clean = macro.copy().sort_index()
    clean.index = pd.DatetimeIndex(clean.index).normalize()
    clean = clean[~clean.index.duplicated(keep="last")]

    bounds: dict[str, tuple[pd.Timestamp, pd.Timestamp]] = {}
    for column in clean.columns:
        valid = pd.to_numeric(clean[column], errors="coerce").dropna()
        if valid.empty:
            continue
        source_start = pd.Timestamp(valid.index.min()).normalize()
        source_end = pd.Timestamp(valid.index.max()).normalize()
        # Monthly statistics use the first day as their timestamp. If that day
        # is a holiday, keep that observation through the same month.
        effective_end = source_end
        if source_end.is_month_start:
            effective_end = (source_end + pd.offsets.MonthEnd(0)).normalize()
        elif column == "news_sentiment" and source_end not in target_index:
            # Weekend news sentiment becomes actionable on the next market day.
            following_market_days = target_index[target_index > source_end]
            if not following_market_days.empty:
                effective_end = pd.Timestamp(following_market_days[0]).normalize()
        bounds[column] = (source_start, effective_end)

    if not bounds:
        return clean.iloc[0:0].copy()

    global_start = min(start for start, _ in bounds.values())
    global_end = max(end for _, end in bounds.values())

    if target_index.empty:
        target_index = pd.date_range(start=global_start, end=global_end, freq="B")
    target_index = target_index[(target_index >= global_start) & (target_index <= global_end)]
    if target_index.empty:
        return clean.iloc[0:0].copy()

    dense = pd.DataFrame(index=target_index, columns=clean.columns, dtype="float64")
    for column, (source_start, effective_end) in bounds.items():
        source = pd.to_numeric(clean[column], errors="coerce").dropna()
        column_target = target_index[(target_index >= source_start) & (target_index <= effective_end)]
        if column_target.empty:
            continue
        expanded = source.reindex(source.index.union(column_target)).sort_index()
        values = expanded.interpolate(method="time", limit_area="inside").reindex(column_target)
        source_end = pd.Timestamp(source.index.max()).normalize()
        if effective_end > source_end:
            trailing = (values.index >= source_end) & (values.index <= effective_end)
            values.loc[trailing] = values.loc[trailing].fillna(float(source.iloc[-1]))
        dense.loc[column_target, column] = values

    dense.index.name = "date"
    return dense
