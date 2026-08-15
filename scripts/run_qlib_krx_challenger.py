from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

import lightgbm as lgb
import numpy as np
import pandas as pd
import qlib
from qlib.data.dataset import DataHandlerLP, DatasetH


ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / ".thinkstock-cache" / "ai-backtest"
QLIB_DIR = CACHE_DIR / "qlib"
MANIFEST_PATH = QLIB_DIR / "manifest.json"
REPORT_PATH = QLIB_DIR / "challenger-report.json"
PREDICTION_PATH = QLIB_DIR / "challenger-predictions.jsonl"
MODEL_DIR = QLIB_DIR / "models"
AUDIT_SNAPSHOT_PATH = QLIB_DIR / "sealed-primary-audit-v3.json"
CONFIRMATION_AUDIT_SNAPSHOT_PATH = QLIB_DIR / "sealed-confirmation-audit-v3.json"
MANIFEST_FORMAT = "thinkstock-qlib-krx-manifest-v2"
REPORT_FORMAT = "thinkstock-qlib-challenger-report-v2"
HORIZONS = (20, 63, 126)
MARKETS = ("KOSPI", "KOSDAQ")
RANDOM_SEED = 20260815
TRADING_DAYS = 252
CORPORATE_ACTION_LOG_RETURN = math.log(1.5)

CONTEXT_FIELDS = (
    "leading_cycle",
    "policy_rate",
    "export_value",
    "import_value",
    "news_sentiment",
    "customer_deposit",
    "kospi_credit",
    "kosdaq_credit",
    "fear_greed",
    "adr_kospi",
    "adr_kosdaq",
    "score",
    "t10y2y",
    "t10y3m",
    "unemployment",
    "creditSpread",
    "sahm",
    "fedFunds",
    "krwUsd",
    "initialClaims4w",
    "vix",
    "vkospi",
)

MODEL_CANDIDATES = (
    (
        "conservative",
        {
            "n_estimators": 240,
            "learning_rate": 0.025,
            "num_leaves": 15,
            "max_depth": 4,
            "min_child_samples": 120,
            "reg_alpha": 1.0,
            "reg_lambda": 8.0,
            "colsample_bytree": 0.72,
            "subsample": 0.82,
        },
    ),
    (
        "balanced",
        {
            "n_estimators": 320,
            "learning_rate": 0.025,
            "num_leaves": 23,
            "max_depth": 5,
            "min_child_samples": 90,
            "reg_alpha": 0.6,
            "reg_lambda": 6.0,
            "colsample_bytree": 0.82,
            "subsample": 0.86,
        },
    ),
    (
        "nonlinear",
        {
            "n_estimators": 360,
            "learning_rate": 0.02,
            "num_leaves": 31,
            "max_depth": 6,
            "min_child_samples": 80,
            "reg_alpha": 0.8,
            "reg_lambda": 10.0,
            "colsample_bytree": 0.78,
            "subsample": 0.84,
        },
    ),
)


@dataclass(frozen=True)
class Calibration:
    scale: float
    offset: float
    lower: float
    upper: float
    validation_mae: float


def utc_stamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"expected an object in {path}")
    return value


def read_json_or_none(path: Path) -> dict | None:
    try:
        return read_json(path)
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def rounded(value: object, digits: int = 6) -> float | None:
    number = finite(value, math.nan)
    return round(number, digits) if math.isfinite(number) else None


def unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(str(value) for value in values if str(value)))


def cohort_tickers(manifest: dict, cohort: str) -> list[str]:
    source = manifest["validation"]["cohorts"][cohort]
    return unique(ticker for market in MARKETS for ticker in source.get(market, []))


def ticker_market_map(manifest: dict) -> dict[str, str]:
    result: dict[str, str] = {}
    for cohort in ("development", "holdout", "audit"):
        source = manifest["validation"]["cohorts"][cohort]
        for market in MARKETS:
            for ticker in source.get(market, []):
                result[str(ticker)] = market
    return result


def normalize_price_series(record: object) -> pd.Series:
    if not isinstance(record, dict):
        return pd.Series(dtype="float64")
    dates = record.get("dates")
    prices = record.get("prices")
    if not isinstance(dates, list) or not isinstance(prices, list) or len(dates) != len(prices):
        return pd.Series(dtype="float64")
    frame = pd.DataFrame({
        "datetime": pd.to_datetime(dates, errors="coerce"),
        "close": pd.to_numeric(prices, errors="coerce"),
    }).dropna()
    frame = frame[frame["close"] > 0].drop_duplicates("datetime", keep="last").sort_values("datetime")
    return pd.Series(frame["close"].to_numpy(dtype="float64"), index=frame["datetime"], name="close")


def normalize_volume_series(record: object) -> pd.Series:
    if not isinstance(record, dict):
        return pd.Series(dtype="float64")
    dates = record.get("dates")
    volumes = record.get("volumes")
    if not isinstance(dates, list) or not isinstance(volumes, list) or len(dates) != len(volumes):
        return pd.Series(dtype="float64")
    frame = pd.DataFrame({
        "datetime": pd.to_datetime(dates, errors="coerce"),
        "volume": pd.to_numeric(volumes, errors="coerce"),
    }).dropna(subset=["datetime"])
    frame = frame[frame["volume"].ge(0)].drop_duplicates("datetime", keep="last").sort_values("datetime")
    return pd.Series(frame["volume"].to_numpy(dtype="float64"), index=frame["datetime"], name="volume")


def profile_model_group(profile: object) -> str:
    source = profile if isinstance(profile, dict) else {}
    tags = set(str(value) for value in source.get("tags", []) if str(value))
    if tags.intersection({"bank", "holding", "range-dividend"}):
        return "income-defensive"
    if "pharma-biotech" in tags:
        return "pharma-biotech"
    if "export-cyclical" in tags:
        return "export-cyclical"
    return "dynamic-liquidity"


def rows_to_frame(rows: object, fields: Sequence[str]) -> pd.DataFrame:
    if not isinstance(rows, list) or not rows:
        return pd.DataFrame()
    frame = pd.DataFrame(rows)
    if "date" not in frame:
        return pd.DataFrame()
    frame["datetime"] = pd.to_datetime(frame["date"], errors="coerce")
    selected = [field for field in fields if field in frame]
    if not selected:
        return pd.DataFrame()
    for field in selected:
        frame[field] = pd.to_numeric(frame[field], errors="coerce")
    return frame[["datetime", *selected]].dropna(subset=["datetime"]).groupby("datetime").last()


def build_context_features(context: dict) -> pd.DataFrame:
    frames = [
        rows_to_frame(context.get("macroRows"), CONTEXT_FIELDS),
        rows_to_frame(context.get("creditRows"), CONTEXT_FIELDS),
        rows_to_frame(context.get("auxiliaryRows"), CONTEXT_FIELDS),
        rows_to_frame(context.get("crisisRows"), CONTEXT_FIELDS),
    ]
    frames = [frame for frame in frames if not frame.empty]
    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, axis=1)
    combined = combined.T.groupby(level=0).last().T.sort_index().ffill()
    features: dict[str, pd.Series] = {}
    for field in CONTEXT_FIELDS:
        if field not in combined:
            continue
        values = pd.to_numeric(combined[field], errors="coerce")
        mean = values.rolling(TRADING_DAYS, min_periods=60).mean()
        deviation = values.rolling(TRADING_DAYS, min_periods=60).std().replace(0, np.nan)
        features[f"context_{field}_z252"] = (values - mean) / deviation
        features[f"context_{field}_delta20"] = (values - values.shift(20)) / deviation
    result = pd.DataFrame(features, index=combined.index)
    return result.replace([np.inf, -np.inf], np.nan)


def rolling_downside_volatility(returns: pd.Series, window: int) -> pd.Series:
    return returns.where(returns < 0, 0).rolling(window, min_periods=max(10, window // 2)).std() * math.sqrt(TRADING_DAYS)


def normalized_rsi(returns: pd.Series, window: int = 14) -> pd.Series:
    gain = returns.clip(lower=0).rolling(window, min_periods=window).mean()
    loss = (-returns.clip(upper=0)).rolling(window, min_periods=window).mean()
    relative = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + relative))
    return (rsi.fillna(50) - 50) / 50


def price_feature_frame(
    ticker: str,
    market: str,
    prices: pd.Series,
    volume: pd.Series,
    benchmark: pd.Series,
    context_features: pd.DataFrame,
    model_group_base: str,
) -> pd.DataFrame:
    log_price = np.log(prices)
    returns = log_price.diff()
    benchmark_price = benchmark.reindex(prices.index).ffill()
    benchmark_log = np.log(benchmark_price)
    benchmark_returns = benchmark_log.diff()
    result = pd.DataFrame(index=prices.index)
    for window in (5, 20, 63, 126, 252):
        result[f"return_{window}"] = log_price.diff(window)
    for window in (20, 63, 126):
        result[f"volatility_{window}"] = returns.rolling(window, min_periods=max(10, window // 2)).std() * math.sqrt(TRADING_DAYS)
    result["downside_volatility_63"] = rolling_downside_volatility(returns, 63)
    result["volatility_ratio_20_126"] = result["volatility_20"] / result["volatility_126"].replace(0, np.nan)
    for window in (20, 63, 126, 252):
        result[f"drawdown_{window}"] = log_price - log_price.rolling(window, min_periods=max(10, window // 2)).max()
    for window in (20, 60, 120, 252):
        result[f"ma_gap_{window}"] = log_price - log_price.rolling(window, min_periods=max(10, window // 2)).mean()
    result["rsi_14"] = normalized_rsi(returns)
    result["short_reversal"] = result["return_5"] - (result["return_20"] / 4)
    result["medium_acceleration"] = result["return_20"] - (result["return_63"] * (20 / 63))
    result["distance_from_high_252"] = log_price - log_price.rolling(252, min_periods=126).max()
    result["distance_from_low_252"] = log_price - log_price.rolling(252, min_periods=126).min()
    for window in (20, 63, 126):
        market_return = benchmark_log.diff(window)
        result[f"market_return_{window}"] = market_return
        result[f"relative_return_{window}"] = result[f"return_{window}"] - market_return
    for window in (63, 252):
        covariance = returns.rolling(window, min_periods=max(30, window // 2)).cov(benchmark_returns)
        market_variance = benchmark_returns.rolling(window, min_periods=max(30, window // 2)).var()
        result[f"market_beta_{window}"] = covariance / market_variance.replace(0, np.nan)
        result[f"market_correlation_{window}"] = returns.rolling(
            window,
            min_periods=max(30, window // 2),
        ).corr(benchmark_returns)
    result["market_kosdaq"] = 1.0 if market == "KOSDAQ" else 0.0
    aligned_volume = pd.to_numeric(volume.reindex(prices.index), errors="coerce")
    log_volume = np.log1p(aligned_volume.where(aligned_volume >= 0))
    log_turnover = np.log1p((prices * aligned_volume).where(aligned_volume >= 0))
    result["log_volume"] = log_volume
    result["log_turnover"] = log_turnover
    result["volume_surprise_20"] = log_volume - log_volume.rolling(20, min_periods=10).mean()
    result["turnover_surprise_20"] = log_turnover - log_turnover.rolling(20, min_periods=10).mean()
    result["turnover_trend_63"] = log_turnover - log_turnover.rolling(63, min_periods=30).mean()
    result["turnover_level_63"] = log_turnover.rolling(63, min_periods=30).median()
    result["amihud_20"] = (
        returns.abs() / (prices * aligned_volume).replace(0, np.nan)
    ).rolling(20, min_periods=10).mean() * 1_000_000_000
    result["volume_coverage_63"] = aligned_volume.notna().rolling(63, min_periods=1).mean()
    result["daily_return"] = returns
    result["model_group_base"] = model_group_base
    if not context_features.empty:
        aligned_context = pd.merge_asof(
            pd.DataFrame({"datetime": result.index}),
            context_features.reset_index().rename(columns={context_features.index.name or "index": "datetime"}),
            on="datetime",
            direction="backward",
        ).set_index("datetime")
        result = result.join(aligned_context, how="left")
    bad_day = returns.abs().gt(CORPORATE_ACTION_LOG_RETURN).astype("float64")
    for horizon in HORIZONS:
        absolute_target = log_price.shift(-horizon) - log_price
        market_target = benchmark_log.shift(-horizon) - benchmark_log
        result[f"label_{horizon}"] = absolute_target - market_target
        result[f"absolute_label_{horizon}"] = absolute_target
        result[f"market_label_{horizon}"] = market_target
        result[f"target_date_{horizon}"] = pd.Series(prices.index, index=prices.index).shift(-horizon)
        result[f"future_bad_{horizon}"] = bad_day.rolling(horizon, min_periods=horizon).sum().shift(-horizon)
    result["instrument"] = ticker
    return result.replace([np.inf, -np.inf], np.nan)


def build_feature_frames(
    tickers: Sequence[str],
    prices_payload: dict,
    market_by_ticker: dict[str, str],
    context_features: pd.DataFrame,
    benchmarks: dict[str, pd.Series],
    profiles: dict[str, dict],
) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}
    for index, ticker in enumerate(tickers, start=1):
        record = prices_payload.get("series", {}).get(ticker)
        series = normalize_price_series(record)
        volume = normalize_volume_series(record)
        if len(series) < TRADING_DAYS + max(HORIZONS):
            continue
        market = market_by_ticker[ticker]
        frames[ticker] = price_feature_frame(
            ticker,
            market,
            series,
            volume,
            benchmarks[market],
            context_features,
            profile_model_group(profiles.get(ticker)),
        )
        if index % 25 == 0 or index == len(tickers):
            print(f"Qlib features {index}/{len(tickers)}", file=sys.stderr, flush=True)
    return frames


def feature_names(frames: dict[str, pd.DataFrame]) -> list[str]:
    excluded_prefixes = (
        "label_",
        "absolute_label_",
        "market_label_",
        "target_date_",
        "future_bad_",
    )
    excluded = {
        "instrument",
        "daily_return",
        "model_group_base",
        "volume_coverage_63",
    }
    names = sorted({
        column
        for frame in frames.values()
        for column in frame.columns
        if column not in excluded and not str(column).startswith(excluded_prefixes)
    })
    return names


def samples_for(
    tickers: Sequence[str],
    frames: dict[str, pd.DataFrame],
    horizon: int,
    features: Sequence[str],
    step: int,
) -> pd.DataFrame:
    records: list[pd.DataFrame] = []
    for ticker in tickers:
        frame = frames.get(ticker)
        if frame is None:
            continue
        eligible = frame[
            frame[f"label_{horizon}"].notna()
            & frame[f"target_date_{horizon}"].notna()
            & frame[f"future_bad_{horizon}"].fillna(0).eq(0)
            & frame["return_252"].notna()
        ].iloc[::step].copy()
        if eligible.empty:
            continue
        eligible = eligible.reindex(columns=[
            *features,
            f"label_{horizon}",
            f"absolute_label_{horizon}",
            f"market_label_{horizon}",
            f"target_date_{horizon}",
        ])
        eligible["instrument"] = ticker
        eligible["market"] = "KOSDAQ" if finite(eligible["market_kosdaq"].iloc[-1]) > 0.5 else "KOSPI"
        eligible["datetime"] = eligible.index
        eligible["label"] = eligible[f"label_{horizon}"]
        eligible["absolute_label"] = eligible[f"absolute_label_{horizon}"]
        eligible["market_label"] = eligible[f"market_label_{horizon}"]
        eligible["target_date"] = pd.to_datetime(eligible[f"target_date_{horizon}"])
        eligible["momentum"] = eligible["relative_return_20"].clip(-0.30, 0.30) * min(
            2.0,
            math.sqrt(horizon / 20),
        )
        eligible["model_group_base"] = frame.loc[eligible.index, "model_group_base"].astype(str)
        records.append(eligible[[
            "datetime",
            "instrument",
            "market",
            "target_date",
            "label",
            "absolute_label",
            "market_label",
            "momentum",
            "model_group_base",
            *features,
        ]])
    if not records:
        return pd.DataFrame()
    return pd.concat(records, ignore_index=True).sort_values(["datetime", "instrument"]).reset_index(drop=True)


def add_cross_sectional_rank_label(frame: pd.DataFrame, minimum_group: int = 5) -> pd.DataFrame:
    if frame.empty:
        return frame.assign(model_label=pd.Series(dtype="float64"))
    ranked = frame.copy()
    group_size = ranked.groupby(["datetime", "market"])["label"].transform("size")
    ranked["model_label"] = ranked.groupby(["datetime", "market"])["label"].rank(
        method="average",
        pct=True,
    ) - 0.5
    return ranked[group_size >= max(2, int(minimum_group))].dropna(subset=["model_label"])


def add_cross_sectional_rank_features(frame: pd.DataFrame, features: Sequence[str]) -> pd.DataFrame:
    ranked = frame.copy()
    market_level_prefixes = ("context_", "market_return_")
    market_level_features = {"market_kosdaq"}
    rank_features = [
        feature
        for feature in features
        if feature not in market_level_features and not feature.startswith(market_level_prefixes)
    ]
    grouped = ranked.groupby(["datetime", "market"], sort=False)
    for feature in rank_features:
        ranked[feature] = grouped[feature].rank(method="average", pct=True) - 0.5
    dynamic = ranked["model_group_base"].eq("dynamic-liquidity")
    liquidity = pd.to_numeric(ranked.get("turnover_level_63"), errors="coerce")
    ranked["model_group"] = ranked["model_group_base"].astype(str)
    ranked.loc[dynamic & liquidity.ge(0.20), "model_group"] = "size-liquid"
    ranked.loc[dynamic & liquidity.le(-0.20), "model_group"] = "size-small"
    ranked.loc[dynamic & liquidity.gt(-0.20) & liquidity.lt(0.20), "model_group"] = "size-mid"
    ranked.loc[dynamic & liquidity.isna(), "model_group"] = "general"
    return ranked


def ticker_disjoint_validation_set(frame: pd.DataFrame, seed: str) -> set[str]:
    if frame.empty:
        return set()
    metadata = frame[["instrument", "market", "model_group_base"]].drop_duplicates("instrument")
    selected: set[str] = set()
    for _, group in metadata.groupby(["market", "model_group_base"], sort=True):
        tickers = sorted(
            group["instrument"].astype(str).tolist(),
            key=lambda ticker: hashlib.sha256(f"{seed}|{ticker}".encode("utf-8")).hexdigest(),
        )
        if len(tickers) < 4:
            continue
        count = min(len(tickers) - 1, max(1, round(len(tickers) * 0.20)))
        selected.update(tickers[:count])
    return selected


def qlib_dataset(frame: pd.DataFrame, features: Sequence[str], segments: dict[str, tuple[str, str]]) -> DatasetH:
    index = pd.MultiIndex.from_frame(frame[["datetime", "instrument"]], names=["datetime", "instrument"])
    values = pd.DataFrame(index=index)
    for feature in features:
        values[("feature", feature)] = pd.to_numeric(frame[feature], errors="coerce").to_numpy()
    values[("label", "LABEL0")] = pd.to_numeric(frame["model_label"], errors="coerce").to_numpy()
    values.columns = pd.MultiIndex.from_tuples(values.columns)
    handler = DataHandlerLP.from_df(values.sort_index())
    return DatasetH(handler=handler, segments=segments)


def prepared_xy(dataset: DatasetH, segment: str) -> tuple[pd.DataFrame, np.ndarray]:
    prepared = dataset.prepare(segment, col_set=["feature", "label"], data_key=DataHandlerLP.DK_L)
    x = prepared["feature"].replace([np.inf, -np.inf], np.nan)
    y = np.asarray(prepared["label"].iloc[:, 0], dtype="float64")
    return x, y


def calibration_for(actual: np.ndarray, predicted: np.ndarray, train_actual: np.ndarray) -> Calibration:
    finite_train = train_actual[np.isfinite(train_actual)]
    lower = max(-0.60, float(np.quantile(finite_train, 0.01)))
    upper = min(0.60, float(np.quantile(finite_train, 0.99)))
    best: Calibration | None = None
    for scale in (0.25, 0.40, 0.55, 0.70, 0.85, 1.0):
        offset = float(np.median(actual - (predicted * scale)))
        offset = max(-0.03, min(0.03, offset))
        adjusted = np.clip((predicted * scale) + offset, lower, upper)
        mae = float(np.mean(np.abs(actual - adjusted)))
        candidate = Calibration(scale, offset, lower, upper, mae)
        if best is None or candidate.validation_mae < best.validation_mae:
            best = candidate
    if best is None:
        raise RuntimeError("prediction calibration failed")
    return best


def calibrated_prediction(predicted: np.ndarray, calibration: Calibration) -> np.ndarray:
    return np.clip(
        (np.asarray(predicted, dtype="float64") * calibration.scale) + calibration.offset,
        calibration.lower,
        calibration.upper,
    )


def model_instance(parameters: dict) -> lgb.LGBMRegressor:
    return lgb.LGBMRegressor(
        objective="regression",
        random_state=RANDOM_SEED,
        n_jobs=max(1, min(4, os.cpu_count() or 1)),
        verbosity=-1,
        deterministic=True,
        force_col_wise=True,
        **parameters,
    )


def fit_best_model(
    dataset: DatasetH,
    development_rows: pd.DataFrame,
    minimum_train_rows: int = 500,
    minimum_valid_rows: int = 100,
) -> tuple[lgb.LGBMRegressor, Calibration, dict, pd.DataFrame, np.ndarray]:
    x_train, y_train = prepared_xy(dataset, "train")
    x_valid, y_valid = prepared_xy(dataset, "valid")
    if len(x_train) < minimum_train_rows or len(x_valid) < minimum_valid_rows:
        raise RuntimeError(f"insufficient Qlib development rows: train={len(x_train)}, valid={len(x_valid)}")
    metadata = development_rows.set_index(["datetime", "instrument"])
    train_actual = pd.to_numeric(metadata.reindex(x_train.index)["label"], errors="coerce").to_numpy()
    valid_metadata = metadata.reindex(x_valid.index)
    valid_actual = pd.to_numeric(valid_metadata["label"], errors="coerce").to_numpy()
    best: tuple[float, lgb.LGBMRegressor, Calibration, dict] | None = None
    for name, parameters in MODEL_CANDIDATES:
        model = model_instance(parameters)
        model.fit(
            x_train,
            y_train,
            eval_X=(x_valid,),
            eval_y=(y_valid,),
            callbacks=[lgb.early_stopping(35, verbose=False)],
        )
        raw_prediction = model.predict(x_valid)
        calibration = calibration_for(valid_actual, raw_prediction, train_actual)
        predicted = calibrated_prediction(raw_prediction, calibration)
        signed_bias = float(np.mean(predicted - valid_actual))
        validation_frame = pd.DataFrame({
            "datetime": x_valid.index.get_level_values("datetime"),
            "instrument": x_valid.index.get_level_values("instrument"),
            "market": valid_metadata["market"].astype(str).to_numpy(),
            "actual": valid_actual,
            "predicted": raw_prediction,
        })
        rank_ic, _, rank_ic_days = daily_rank_ic(validation_frame)
        validation_spread, validation_spread_days = top_bottom_spread(validation_frame)
        rank_score = finite(rank_ic, -1.0)
        spread_score = max(-0.05, min(0.05, finite(validation_spread, -0.05)))
        score = -(rank_score + spread_score) + (calibration.validation_mae * 0.01)
        detail = {
            "name": name,
            "parameters": parameters,
            "bestIteration": int(model.best_iteration_ or parameters["n_estimators"]),
            "validationMae": rounded(calibration.validation_mae),
            "validationBias": rounded(signed_bias),
            "validationRankIc": rounded(rank_ic, 4),
            "validationRankIcDays": rank_ic_days,
            "validationTopBottomSpread": rounded(validation_spread),
            "validationTopBottomSpreadDays": validation_spread_days,
        }
        if best is None or score < best[0]:
            best = (score, model, calibration, detail)
    if best is None:
        raise RuntimeError("no Qlib LightGBM candidate completed")
    return best[1], best[2], best[3], x_train, y_train


def fit_specialist_models(
    development_rows: pd.DataFrame,
    features: Sequence[str],
    segments: dict[str, tuple[str, str]],
    global_model: lgb.LGBMRegressor,
    global_calibration: Calibration,
    quick: bool = False,
) -> tuple[dict[str, dict], list[dict]]:
    specialists: dict[str, dict] = {}
    reports: list[dict] = []
    minimum_train = 120 if quick else 450
    minimum_valid = 30 if quick else 90
    balanced_parameters = dict(MODEL_CANDIDATES[1][1])
    for group in sorted(development_rows["model_group"].dropna().astype(str).unique()):
        group_rows = development_rows[development_rows["model_group"].eq(group)]
        if group_rows["instrument"].nunique() < (4 if quick else 8):
            continue
        dataset = qlib_dataset(group_rows, features, segments)
        x_train, y_train = prepared_xy(dataset, "train")
        x_valid, y_valid = prepared_xy(dataset, "valid")
        if len(x_train) < minimum_train or len(x_valid) < minimum_valid:
            continue
        model = model_instance(balanced_parameters)
        model.fit(
            x_train,
            y_train,
            eval_X=(x_valid,),
            eval_y=(y_valid,),
            callbacks=[lgb.early_stopping(25, verbose=False)],
        )
        metadata = group_rows.set_index(["datetime", "instrument"])
        train_actual = pd.to_numeric(metadata.reindex(x_train.index)["label"], errors="coerce").to_numpy()
        valid_metadata = metadata.reindex(x_valid.index)
        valid_actual = pd.to_numeric(valid_metadata["label"], errors="coerce").to_numpy()
        calibration = calibration_for(valid_actual, model.predict(x_valid), train_actual)
        specialist_prediction = calibrated_prediction(model.predict(x_valid), calibration)
        global_prediction = calibrated_prediction(global_model.predict(x_valid), global_calibration)
        specialist_mae = float(np.mean(np.abs(valid_actual - specialist_prediction)))
        global_mae = float(np.mean(np.abs(valid_actual - global_prediction)))
        specialist_frame = pd.DataFrame({
            "datetime": x_valid.index.get_level_values("datetime"),
            "instrument": x_valid.index.get_level_values("instrument"),
            "market": valid_metadata["market"].astype(str).to_numpy(),
            "actual": valid_actual,
            "predicted": specialist_prediction,
        })
        global_frame = specialist_frame.assign(predicted=global_prediction)
        specialist_ic, _, specialist_days = daily_rank_ic(specialist_frame)
        global_ic, _, global_days = daily_rank_ic(global_frame)
        ic_gain = finite(specialist_ic, -1) - finite(global_ic, -1)
        mae_gain = 1 - (specialist_mae / global_mae) if global_mae > 0 else -1
        rank_supported = min(specialist_days, global_days) >= (5 if quick else 15)
        rank_safe = not rank_supported or ic_gain >= -0.01
        enabled = (mae_gain >= 0.01 and rank_safe) or (
            rank_supported
            and ic_gain >= 0.01
            and specialist_mae <= global_mae * 1.02
        )
        detail = {
            "group": group,
            "enabled": bool(enabled),
            "trainRows": int(len(x_train)),
            "validationRows": int(len(x_valid)),
            "validationStocks": int(group_rows["instrument"].nunique()),
            "maeImprovement": rounded(mae_gain, 4),
            "rankIcImprovement": rounded(ic_gain, 4),
            "specialistRankIc": rounded(specialist_ic, 4),
            "globalRankIc": rounded(global_ic, 4),
            "rankSupported": bool(rank_supported),
            "rankSafe": bool(rank_safe),
            "weight": 0.25 if enabled else 0.0,
        }
        reports.append(detail)
        if enabled:
            specialists[group] = {
                "model": model,
                "calibration": calibration,
                "weight": 0.25,
                "detail": detail,
            }
    return specialists, reports


def prediction_frame(
    model: lgb.LGBMRegressor,
    calibration: Calibration,
    samples: pd.DataFrame,
    features: Sequence[str],
    segment_name: str,
    specialists: dict[str, dict] | None = None,
) -> pd.DataFrame:
    if samples.empty:
        return pd.DataFrame()
    start = samples["datetime"].min().date().isoformat()
    end = samples["datetime"].max().date().isoformat()
    dataset = qlib_dataset(samples, features, {segment_name: (start, end)})
    x, y = prepared_xy(dataset, segment_name)
    predicted = calibrated_prediction(model.predict(x), calibration)
    metadata = samples.set_index(["datetime", "instrument"]).reindex(x.index)
    model_groups = metadata["model_group"].astype(str)
    specialist_applied = np.zeros(len(x), dtype="int8")
    for group, specialist in (specialists or {}).items():
        mask = model_groups.eq(group).to_numpy()
        if not np.any(mask):
            continue
        specialist_prediction = calibrated_prediction(
            specialist["model"].predict(x.iloc[np.flatnonzero(mask)]),
            specialist["calibration"],
        )
        weight = max(0.0, min(0.35, finite(specialist.get("weight"), 0.25)))
        predicted[mask] = (predicted[mask] * (1 - weight)) + (specialist_prediction * weight)
        specialist_applied[mask] = 1
    result = pd.DataFrame({
        "datetime": x.index.get_level_values("datetime"),
        "instrument": x.index.get_level_values("instrument"),
        "market": metadata["market"].astype(str).to_numpy(),
        "actual": pd.to_numeric(metadata["label"], errors="coerce").to_numpy(),
        "model_label": y,
        "predicted": predicted,
        "absolute_actual": pd.to_numeric(metadata["absolute_label"], errors="coerce").to_numpy(),
        "market_actual": pd.to_numeric(metadata["market_label"], errors="coerce").to_numpy(),
        "momentum": pd.to_numeric(metadata["momentum"], errors="coerce").to_numpy(),
        "model_group": model_groups.to_numpy(),
        "specialist_applied": specialist_applied,
    })
    return result.replace([np.inf, -np.inf], np.nan).dropna()


def daily_rank_ic(frame: pd.DataFrame) -> tuple[float | None, float | None, int]:
    values: list[float] = []
    for _, group in frame.groupby(["datetime", "market"]):
        if len(group) < 5 or group["predicted"].nunique() < 2 or group["actual"].nunique() < 2:
            continue
        correlation = group["predicted"].corr(group["actual"], method="spearman")
        if pd.notna(correlation):
            values.append(float(correlation))
    if not values:
        return None, None, 0
    mean = float(np.mean(values))
    deviation = float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
    information_ratio = mean / deviation * math.sqrt(TRADING_DAYS / 5) if deviation > 0 else None
    return mean, information_ratio, len(values)


def top_bottom_spread(frame: pd.DataFrame) -> tuple[float | None, int]:
    spreads: list[float] = []
    for _, group in frame.groupby(["datetime", "market"]):
        if len(group) < 10 or group["predicted"].nunique() < 5:
            continue
        ranked = group.sort_values("predicted")
        count = max(1, len(ranked) // 5)
        spreads.append(float(ranked.tail(count)["actual"].mean() - ranked.head(count)["actual"].mean()))
    return (float(np.mean(spreads)), len(spreads)) if spreads else (None, 0)


def metric_summary(frame: pd.DataFrame) -> dict:
    if frame.empty:
        return {
            "samples": 0,
            "stocks": 0,
            "directionAccuracy": None,
            "meanAbsoluteLogError": None,
            "noChangeMae": None,
            "improvementVsNoChange": None,
            "momentumMae": None,
            "improvementVsMomentum": None,
            "meanDailyRankIc": None,
        }
    actual = frame["actual"].to_numpy(dtype="float64")
    predicted = frame["predicted"].to_numpy(dtype="float64")
    momentum = frame["momentum"].to_numpy(dtype="float64")
    mae = float(np.mean(np.abs(actual - predicted)))
    no_change_mae = float(np.mean(np.abs(actual)))
    momentum_mae = float(np.mean(np.abs(actual - momentum)))
    rank_ic, rank_ic_ir, rank_ic_days = daily_rank_ic(frame)
    spread, spread_days = top_bottom_spread(frame)
    return {
        "samples": int(len(frame)),
        "stocks": int(frame["instrument"].nunique()),
        "firstDate": frame["datetime"].min().date().isoformat(),
        "lastDate": frame["datetime"].max().date().isoformat(),
        "directionAccuracy": rounded(np.mean(np.sign(actual) == np.sign(predicted)), 4),
        "meanAbsoluteLogError": rounded(mae),
        "rootMeanSquaredLogError": rounded(math.sqrt(float(np.mean((actual - predicted) ** 2)))),
        "noChangeMae": rounded(no_change_mae),
        "improvementVsNoChange": rounded(1 - (mae / no_change_mae), 4) if no_change_mae > 0 else None,
        "momentumMae": rounded(momentum_mae),
        "improvementVsMomentum": rounded(1 - (mae / momentum_mae), 4) if momentum_mae > 0 else None,
        "meanSignedError": rounded(float(np.mean(predicted - actual))),
        "meanPredictedReturn": rounded(float(np.mean(predicted))),
        "meanActualReturn": rounded(float(np.mean(actual))),
        "upsidePredictionRate": rounded(float(np.mean(predicted > 0)), 4),
        "meanDailyRankIc": rounded(rank_ic, 4),
        "rankIcInformationRatio": rounded(rank_ic_ir, 4),
        "rankIcDays": rank_ic_days,
        "topBottomActualSpread": rounded(spread),
        "topBottomSpreadDays": spread_days,
    }


def metrics_pass(metrics: dict, minimum_samples: int = 100) -> bool:
    return (
        int(metrics.get("samples") or 0) >= minimum_samples
        and int(metrics.get("rankIcDays") or 0) >= (5 if minimum_samples < 100 else 20)
        and finite(metrics.get("meanDailyRankIc"), -1) >= 0.02
        and finite(metrics.get("topBottomActualSpread"), -1) > 0
    )


def feature_importance(model: lgb.LGBMRegressor, features: Sequence[str], limit: int = 20) -> list[dict]:
    values = model.booster_.feature_importance(importance_type="gain")
    total = float(np.sum(values))
    ranked = sorted(zip(features, values), key=lambda item: item[1], reverse=True)[:limit]
    return [
        {"feature": feature, "gainShare": rounded(value / total, 6) if total > 0 else 0.0}
        for feature, value in ranked
    ]


def write_predictions(records: Sequence[dict]) -> None:
    with PREDICTION_PATH.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def rolling_periods(start: pd.Timestamp, end: pd.Timestamp, months: int = 3):
    cursor = pd.Timestamp(start).normalize()
    final = pd.Timestamp(end).normalize()
    while cursor <= final:
        next_cursor = (cursor + pd.DateOffset(months=months)).normalize()
        period_end = min(final, next_cursor - pd.offsets.Day(1))
        yield cursor, period_end
        cursor = next_cursor


def evaluate_locked_cohort(
    cohort_name: str,
    tickers: Sequence[str],
    trained: dict[int, list[dict]],
    report_horizons: dict[str, dict],
    prices_payload: dict,
    market_by_ticker: dict[str, str],
    context_features: pd.DataFrame,
    benchmarks: dict[str, pd.Series],
    profiles: dict[str, dict],
    features: Sequence[str],
    sample_step: int,
    rank_group_minimum: int,
    minimum_samples: int,
) -> tuple[int, list[dict]]:
    frames = build_feature_frames(
        tickers,
        prices_payload,
        market_by_ticker,
        context_features,
        benchmarks,
        profiles,
    )
    records: list[dict] = []
    wins = 0
    for horizon in HORIZONS:
        fold_models = trained[horizon]
        frozen_features = fold_models[0]["features"]
        test_start = fold_models[0]["start"]
        samples = samples_for(tickers, frames, horizon, frozen_features, sample_step)
        samples = add_cross_sectional_rank_label(samples, rank_group_minimum)
        samples = add_cross_sectional_rank_features(samples, frozen_features)
        samples = samples[samples["datetime"] >= test_start]
        parts = []
        for fold_index, fold in enumerate(fold_models, start=1):
            fold_samples = samples[
                (samples["datetime"] >= fold["start"])
                & (samples["datetime"] <= fold["end"])
            ]
            if fold_samples.empty:
                continue
            parts.append(prediction_frame(
                fold["model"],
                fold["calibration"],
                fold_samples,
                frozen_features,
                f"{cohort_name}_{fold_index}",
                fold.get("specialists"),
            ))
        predictions = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
        metrics = metric_summary(predictions)
        report_horizons[str(horizon)][cohort_name] = metrics
        if metrics_pass(metrics, minimum_samples):
            wins += 1
        for row in predictions.itertuples(index=False):
            records.append({
                "cohort": cohort_name,
                "horizon": horizon,
                "date": row.datetime.date().isoformat(),
                "instrument": row.instrument,
                "market": row.market,
                "modelGroup": row.model_group,
                "specialistApplied": bool(row.specialist_applied),
                "actual": rounded(row.actual),
                "absoluteActual": rounded(row.absolute_actual),
                "marketActual": rounded(row.market_actual),
                "predicted": rounded(row.predicted),
                "momentum": rounded(row.momentum),
            })
    return wins, records


def run(args: argparse.Namespace) -> dict:
    manifest = read_json(MANIFEST_PATH)
    if manifest.get("format") != MANIFEST_FORMAT:
        raise ValueError("refresh the Qlib KRX manifest first")
    price_path = ROOT / manifest["source"]["prices"]
    context_path = ROOT / manifest["source"]["context"]
    prices_payload = read_json(price_path)
    context_payload = read_json(context_path)
    protocol_fingerprint = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    audit_snapshot = read_json_or_none(AUDIT_SNAPSHOT_PATH)
    confirmation_audit_snapshot = read_json_or_none(CONFIRMATION_AUDIT_SNAPSHOT_PATH)
    snapshot_identity = {
        "protocolFingerprint": protocol_fingerprint,
        "priceFingerprint": manifest["source"]["priceFingerprint"],
        "contextFingerprint": manifest["source"]["contextFingerprint"],
        "auditCohorts": manifest["validation"]["cohorts"]["audit"],
    }
    snapshot_matches = bool(audit_snapshot) and all(
        audit_snapshot.get(key) == value for key, value in snapshot_identity.items()
    )
    confirmation_snapshot_identity = {
        "protocolFingerprint": protocol_fingerprint,
        "priceFingerprint": manifest["source"]["priceFingerprint"],
        "contextFingerprint": manifest["source"]["contextFingerprint"],
        "auditCohorts": manifest["validation"]["cohorts"]["confirmationAudit"],
    }
    confirmation_snapshot_matches = bool(confirmation_audit_snapshot) and all(
        confirmation_audit_snapshot.get(key) == value
        for key, value in confirmation_snapshot_identity.items()
    )
    market_by_ticker = ticker_market_map(manifest)
    development = cohort_tickers(manifest, "development")
    holdout = cohort_tickers(manifest, "holdout")
    audit = cohort_tickers(manifest, "audit")
    confirmation_audit = cohort_tickers(manifest, "confirmationAudit")
    if args.quick:
        development = [ticker for market in MARKETS for ticker in manifest["validation"]["cohorts"]["development"][market][:10]]
        holdout = [ticker for market in MARKETS for ticker in manifest["validation"]["cohorts"]["holdout"][market][:5]]
        audit = [ticker for market in MARKETS for ticker in manifest["validation"]["cohorts"]["audit"][market][:5]]
        confirmation_audit = [
            ticker
            for market in MARKETS
            for ticker in manifest["validation"]["cohorts"]["confirmationAudit"][market][:5]
        ]
    benchmark_by_market = manifest["market"]["benchmarkByMarket"]
    benchmarks = {
        market: normalize_price_series(prices_payload.get("series", {}).get(benchmark_by_market[market]))
        for market in MARKETS
    }
    if any(len(series) < 1000 for series in benchmarks.values()):
        raise RuntimeError("KOSPI/KOSDAQ benchmark history is incomplete")
    context_features = build_context_features(context_payload)
    profiles = manifest["validation"].get("profiles", {})
    research_tickers = unique([*development, *holdout])
    frames = build_feature_frames(
        research_tickers,
        prices_payload,
        market_by_ticker,
        context_features,
        benchmarks,
        profiles,
    )
    features = feature_names(frames)
    if len(features) < 25:
        raise RuntimeError(f"Qlib feature coverage is incomplete: {len(features)}")
    sample_step = 10 if args.quick else int(manifest["validation"]["sampleStepTradingDays"])
    report_horizons: dict[str, dict] = {}
    prediction_records: list[dict] = []
    trained: dict[int, list[dict]] = {}
    minimum_samples = 30 if args.quick else 100

    for horizon in HORIZONS:
        development_samples = samples_for(development, frames, horizon, features, sample_step)
        rank_group_minimum = 3 if args.quick else 5
        holdout_samples = add_cross_sectional_rank_label(
            samples_for(holdout, frames, horizon, features, sample_step),
            rank_group_minimum,
        )
        development_samples = add_cross_sectional_rank_label(development_samples, rank_group_minimum)
        holdout_samples = add_cross_sectional_rank_features(holdout_samples, features)
        development_samples = add_cross_sectional_rank_features(development_samples, features)
        if development_samples.empty or holdout_samples.empty:
            raise RuntimeError(f"Qlib {horizon}-day samples are incomplete")
        latest_anchor = max(development_samples["datetime"].max(), holdout_samples["datetime"].max())
        test_start = (latest_anchor - pd.DateOffset(years=1)).normalize()
        fold_models: list[dict] = []
        fold_reports: list[dict] = []
        holdout_parts: list[pd.DataFrame] = []
        for fold_index, (fold_start, fold_end) in enumerate(rolling_periods(test_start, latest_anchor), start=1):
            valid_start = (fold_start - pd.DateOffset(years=1)).normalize()
            inner_validation_tickers = ticker_disjoint_validation_set(
                development_samples,
                f"{RANDOM_SEED}|{horizon}|{fold_index}",
            )
            train_rows = development_samples[
                ~development_samples["instrument"].isin(inner_validation_tickers)
                &
                (development_samples["datetime"] < valid_start)
                & (development_samples["target_date"] < valid_start)
            ].copy()
            valid_rows = development_samples[
                development_samples["instrument"].isin(inner_validation_tickers)
                & (development_samples["datetime"] >= valid_start)
                & (development_samples["datetime"] < fold_start)
                & (development_samples["target_date"] < fold_start)
            ].copy()
            train_rows = add_cross_sectional_rank_label(train_rows, rank_group_minimum)
            valid_rows = add_cross_sectional_rank_label(valid_rows, rank_group_minimum)
            development_ready = pd.concat([train_rows, valid_rows], ignore_index=True)
            train_start = development_ready["datetime"].min().date().isoformat()
            train_end = (valid_start - pd.offsets.Day(1)).date().isoformat()
            valid_end = (fold_start - pd.offsets.Day(1)).date().isoformat()
            segments = {
                "train": (train_start, train_end),
                "valid": (valid_start.date().isoformat(), valid_end),
            }
            dataset = qlib_dataset(development_ready, features, segments)
            model, calibration, selected_model, _, _ = fit_best_model(
                dataset,
                development_ready,
                minimum_train_rows=200 if args.quick else 500,
                minimum_valid_rows=50 if args.quick else 100,
            )
            specialists, specialist_reports = fit_specialist_models(
                development_ready,
                features,
                segments,
                model,
                calibration,
                args.quick,
            )
            eligible_holdout = holdout_samples[
                (holdout_samples["datetime"] >= fold_start)
                & (holdout_samples["datetime"] <= fold_end)
            ]
            if not eligible_holdout.empty:
                holdout_parts.append(prediction_frame(
                    model,
                    calibration,
                    eligible_holdout,
                    features,
                    f"test_{fold_index}",
                    specialists,
                ))
            fold_models.append({
                "start": fold_start,
                "end": fold_end,
                "model": model,
                "calibration": calibration,
                "features": features,
                "specialists": specialists,
            })
            fold_reports.append({
                "start": fold_start.date().isoformat(),
                "end": fold_end.date().isoformat(),
                "trainRows": int(len(train_rows)),
                "validationRows": int(len(valid_rows)),
                "trainStocks": int(train_rows["instrument"].nunique()),
                "validationStocks": int(valid_rows["instrument"].nunique()),
                "tickerDisjointValidation": True,
                "selectedModel": selected_model,
                "specialists": specialist_reports,
                "calibration": {
                    "scale": rounded(calibration.scale),
                    "offset": rounded(calibration.offset),
                    "lower": rounded(calibration.lower),
                    "upper": rounded(calibration.upper),
                },
            })
        if not holdout_parts:
            raise RuntimeError(f"Qlib {horizon}-day rolling holdout is empty")
        holdout_predictions = pd.concat(holdout_parts, ignore_index=True)
        holdout_metrics = metric_summary(holdout_predictions)
        model_path = MODEL_DIR / f"horizon-{horizon}.txt"
        latest_model = fold_models[-1]["model"]
        latest_model.booster_.save_model(model_path)
        trained[horizon] = fold_models
        report_horizons[str(horizon)] = {
            "split": {
                "testStart": test_start.date().isoformat(),
                "testEnd": latest_anchor.date().isoformat(),
                "rollingMonths": 3,
                "rollingFolds": len(fold_reports),
                "purgedByTargetDate": True,
            },
            "development": {
                "tickers": int(development_samples["instrument"].nunique()),
            },
            "rollingFolds": fold_reports,
            "selectedModel": fold_reports[-1]["selectedModel"],
            "calibration": fold_reports[-1]["calibration"],
            "holdout": holdout_metrics,
            "audit": None,
            "confirmationAudit": None,
            "featureImportance": feature_importance(latest_model, features),
        }
        for row in holdout_predictions.itertuples(index=False):
            prediction_records.append({
                "cohort": "holdout",
                "horizon": horizon,
                "date": row.datetime.date().isoformat(),
                "instrument": row.instrument,
                "market": row.market,
                "modelGroup": row.model_group,
                "specialistApplied": bool(row.specialist_applied),
                "actual": rounded(row.actual),
                "absoluteActual": rounded(row.absolute_actual),
                "marketActual": rounded(row.market_actual),
                "predicted": rounded(row.predicted),
                "momentum": rounded(row.momentum),
            })
        print(
            f"Qlib horizon {horizon}: holdout improvement={holdout_metrics['improvementVsNoChange']} "
            f"direction={holdout_metrics['directionAccuracy']} rankIC={holdout_metrics['meanDailyRankIc']}",
            file=sys.stderr,
            flush=True,
        )

    holdout_wins = sum(
        metrics_pass(report_horizons[str(horizon)]["holdout"], minimum_samples)
        for horizon in HORIZONS
    )
    audit_status = "not-run-holdout-failed"
    audit_wins = 0
    audit_records: list[dict] = []
    if holdout_wins >= 2 and not args.no_audit and snapshot_matches:
        for horizon in HORIZONS:
            report_horizons[str(horizon)]["audit"] = audit_snapshot["horizons"][str(horizon)]
            if metrics_pass(report_horizons[str(horizon)]["audit"], minimum_samples):
                audit_wins += 1
        audit_records = list(audit_snapshot.get("predictions") or [])
        prediction_records.extend(audit_records)
        audit_status = "reused-sealed"
    elif holdout_wins >= 2 and not args.no_audit and audit_snapshot:
        audit_status = "blocked-rotate-required"
    elif holdout_wins >= 2 and not args.no_audit:
        audit_wins, audit_records = evaluate_locked_cohort(
            "audit",
            audit,
            trained,
            report_horizons,
            prices_payload,
            market_by_ticker,
            context_features,
            benchmarks,
            profiles,
            features,
            sample_step,
            rank_group_minimum,
            minimum_samples,
        )
        prediction_records.extend(audit_records)
        audit_status = "completed"
    elif args.no_audit:
        audit_status = "disabled"

    audit_passed = audit_status in {"completed", "reused-sealed"} and audit_wins >= 2
    confirmation_audit_status = "not-run-primary-audit-failed"
    confirmation_audit_wins = 0
    confirmation_records: list[dict] = []
    if audit_passed and not args.no_audit and confirmation_snapshot_matches:
        for horizon in HORIZONS:
            report_horizons[str(horizon)]["confirmationAudit"] = (
                confirmation_audit_snapshot["horizons"][str(horizon)]
            )
            if metrics_pass(report_horizons[str(horizon)]["confirmationAudit"], minimum_samples):
                confirmation_audit_wins += 1
        confirmation_records = list(confirmation_audit_snapshot.get("predictions") or [])
        prediction_records.extend(confirmation_records)
        confirmation_audit_status = "reused-sealed"
    elif audit_passed and not args.no_audit and confirmation_audit_snapshot:
        confirmation_audit_status = "blocked-rotate-required"
    elif audit_passed and not args.no_audit:
        confirmation_audit_wins, confirmation_records = evaluate_locked_cohort(
            "confirmationAudit",
            confirmation_audit,
            trained,
            report_horizons,
            prices_payload,
            market_by_ticker,
            context_features,
            benchmarks,
            profiles,
            features,
            sample_step,
            rank_group_minimum,
            minimum_samples,
        )
        prediction_records.extend(confirmation_records)
        confirmation_audit_status = "completed"
    elif args.no_audit:
        confirmation_audit_status = "disabled"

    confirmation_audit_passed = (
        confirmation_audit_status in {"completed", "reused-sealed"}
        and confirmation_audit_wins >= 2
    )
    volume_coverage = finite(manifest.get("dataQuality", {}).get("volumeCoverage"), 0)
    breadth_count = sum(
        len(manifest["validation"]["cohorts"]["development"].get(market, []))
        for market in MARKETS
    )
    data_quality_runtime_eligible = volume_coverage >= 0.75 and breadth_count >= 100
    report = {
        "format": REPORT_FORMAT,
        "generatedAt": utc_stamp(),
        "backend": {
            "qlib": True,
            "qlibVersion": qlib.__version__,
            "lightgbmVersion": lgb.__version__,
            "pythonVersion": platform.python_version(),
            "dataHandler": "DataHandlerLP.from_df",
            "dataset": "DatasetH",
            "model": "LightGBM cross-sectional rank regression custom Qlib model",
            "protocolFingerprint": protocol_fingerprint,
        },
        "task": "cross-sectional-ranking",
        "market": manifest["market"],
        "manifest": {
            "format": manifest["format"],
            "generatedAt": manifest["generatedAt"],
            "priceFingerprint": manifest["source"]["priceFingerprint"],
            "contextFingerprint": manifest["source"]["contextFingerprint"],
        },
        "sample": {
            "quick": bool(args.quick),
            "sampleStepTradingDays": sample_step,
            "developmentTickers": len(development),
            "holdoutTickers": len(holdout),
            "auditTickers": len(audit),
            "confirmationAuditTickers": len(confirmation_audit),
            "features": len(features),
            "featureNames": features,
            "target": "forward-excess-log-return-versus-market-benchmark",
            "preprocessing": "market-date cross-sectional rank features and labels with skill-gated archetype specialists",
        },
        "horizons": report_horizons,
        "holdout": {
            "wins": holdout_wins,
            "requiredWins": 2,
            "passed": holdout_wins >= 2,
        },
        "audit": {
            "status": audit_status,
            "wins": audit_wins,
            "requiredWins": 2,
            "passed": audit_passed,
        },
        "confirmationAudit": {
            "status": confirmation_audit_status,
            "wins": confirmation_audit_wins,
            "requiredWins": 2,
            "passed": confirmation_audit_passed,
        },
        "dataQuality": {
            **manifest.get("dataQuality", {}),
            "runtimeEligible": data_quality_runtime_eligible,
        },
        "matchedAnchor": {
            "status": "not-run",
            "passed": False,
            "reason": "comparison runs only after both sealed audit cohorts pass",
        },
        "decision": {
            "researchCandidate": confirmation_audit_passed,
            "runtimeIntegrationEligible": False,
            "nextStep": (
                "matched-anchor-comparison-required"
                if confirmation_audit_passed
                else "keep-thinkstock-champion"
            ),
            "reason": (
                "Qlib remains an offline challenger until it beats the same-anchor ThinkStock forecast."
            ),
        },
        "limitations": manifest.get("limitations", []),
    }
    if audit_status == "completed":
        snapshot = {
            "format": "thinkstock-qlib-sealed-primary-audit-v3",
            "generatedAt": utc_stamp(),
            **snapshot_identity,
            "horizons": {
                str(horizon): report_horizons[str(horizon)]["audit"]
                for horizon in HORIZONS
            },
            "predictions": audit_records,
        }
        AUDIT_SNAPSHOT_PATH.write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if confirmation_audit_status == "completed":
        confirmation_snapshot = {
            "format": "thinkstock-qlib-sealed-confirmation-audit-v3",
            "generatedAt": utc_stamp(),
            **confirmation_snapshot_identity,
            "horizons": {
                str(horizon): report_horizons[str(horizon)]["confirmationAudit"]
                for horizon in HORIZONS
            },
            "predictions": confirmation_records,
        }
        CONFIRMATION_AUDIT_SNAPSHOT_PATH.write_text(
            json.dumps(confirmation_snapshot, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return report, prediction_records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the offline ThinkStock Qlib KRX challenger")
    parser.add_argument("--quick", action="store_true", help="use a small smoke-test cohort")
    parser.add_argument("--no-audit", action="store_true", help="keep the audit cohort untouched")
    return parser.parse_args()


def main() -> None:
    random.seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)
    QLIB_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    report, predictions = run(parse_args())
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_predictions(predictions)
    print(json.dumps({
        "report": str(REPORT_PATH.relative_to(ROOT)),
        "predictions": str(PREDICTION_PATH.relative_to(ROOT)),
        "holdout": report["holdout"],
        "audit": report["audit"],
        "confirmationAudit": report["confirmationAudit"],
        "decision": report["decision"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
