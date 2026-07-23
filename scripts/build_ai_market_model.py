from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from provider_clients import RetryingHttpClient, fetch_yahoo_prices
from provider_sources import resolve_api_key


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "docs" / "data" / "ai_market_model.json"
LOCAL_ENV_FILE = ROOT / ".env.local"
MODEL_FORMAT = "thinkstock-ai-market-model-v1"
FEATURE_FORMAT = "ai-market-features-v1"
MARKETS = {
    "KOSPI": {
        "endpoint": "stk_bydd_trd",
        "suffix": "KS",
        "benchmark": "^KS11",
    },
    "KOSDAQ": {
        "endpoint": "ksq_bydd_trd",
        "suffix": "KQ",
        "benchmark": "^KQ11",
    },
}
FEATURE_NAMES = (
    "return_5_vol_scaled",
    "return_20_vol_scaled",
    "return_63_vol_scaled",
    "return_126_vol_scaled",
    "log_volatility_20_63",
    "log_volatility_63_126",
    "downside_deviation_63",
    "drawdown_63_vol_scaled",
    "rsi_14",
    "macd_oscillator_vol_scaled",
    "market_return_20_vol_scaled",
    "market_return_63_vol_scaled",
    "market_return_126_vol_scaled",
    "market_correlation_252",
    "market_beta_252",
    "market_downside_beta_252",
    "relative_return_63_vol_scaled",
)
HORIZONS = (20, 63, 126)
LOOKBACK_YEARS = (5, 10, 15, 25)
RIDGE_LAMBDAS = (1.0, 4.0, 16.0, 64.0, 256.0)
TRADING_DAYS = 252
SAMPLE_STEP = 21
MIN_PRICE_ROWS = TRADING_DAYS
CORPORATE_ACTION_LOG_RETURN = math.log(1.5)
EPSILON = 1e-9


@dataclass(frozen=True)
class TrainingSample:
    ticker: str
    anchor_date: pd.Timestamp
    target_date: pd.Timestamp
    features: tuple[float, ...]
    target: float
    baseline: float
    volatility: float


def utc_stamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def calendar_years_ago(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year - int(years))
    except ValueError:
        return value.replace(year=value.year - int(years), day=28)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, float(value)))


def parse_krx_number(value: object) -> int:
    clean = str(value or "").replace(",", "").strip()
    try:
        return int(float(clean))
    except (TypeError, ValueError):
        return 0


def normalize_market_cap_rows(rows: object, market: str, limit: int = 200) -> list[dict]:
    config = MARKETS.get(str(market or "").upper())
    if not config or not isinstance(rows, list):
        return []
    normalized: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw_code = "".join(character for character in str(row.get("ISU_CD") or "") if character.isdigit())
        code = raw_code.zfill(6)[-6:]
        name = str(row.get("ISU_NM") or "").strip()
        market_cap = parse_krx_number(row.get("MKTCAP"))
        if not raw_code or len(raw_code) > 6 or code == "000000" or not name or market_cap <= 0:
            continue
        ticker = f"{code}.{config['suffix']}"
        candidate = {
            "ticker": ticker,
            "code": code,
            "name": name,
            "market": str(market).upper(),
            "market_cap": market_cap,
        }
        previous = normalized.get(ticker)
        if previous is None or market_cap > previous["market_cap"]:
            normalized[ticker] = candidate
    ranked = sorted(normalized.values(), key=lambda item: (-item["market_cap"], item["ticker"]))
    return ranked[:max(0, int(limit))]


def fetch_top_market_cap_universe(
    client: RetryingHttpClient,
    api_key: str,
    *,
    as_of: date | None = None,
    per_market: int = 200,
    lookback_days: int = 14,
) -> dict:
    key = str(api_key or "").strip()
    if not key:
        raise ValueError("KRX API key is not configured")
    end_date = as_of or date.today()
    for offset in range(max(0, int(lookback_days)) + 1):
        base_date = end_date - timedelta(days=offset)
        date_code = base_date.strftime("%Y%m%d")
        selections: dict[str, list[dict]] = {}
        for market, config in MARKETS.items():
            rows: list[dict] = []
            for root in (
                f"https://data-dbg.krx.co.kr/svc/apis/sto/{config['endpoint']}",
                f"https://data-dbg.krx.co.kr/svc/sample/apis/sto/{config['endpoint']}",
            ):
                try:
                    payload = client.get_json(
                        root,
                        params={"basDd": date_code, "AUTH_KEY": key},
                        timeout=30,
                    )
                    candidate = payload.get("OutBlock_1") if isinstance(payload, dict) else []
                    normalized = normalize_market_cap_rows(candidate, market, per_market)
                    if len(normalized) >= per_market:
                        rows = candidate
                        break
                except Exception:
                    continue
            selections[market] = normalize_market_cap_rows(rows, market, per_market)
        if all(len(selections[market]) == per_market for market in MARKETS):
            return {
                "base_date": base_date.isoformat(),
                "markets": selections,
            }
    raise RuntimeError("KRX daily trading information did not return a complete top-market-cap universe")


def batched(values: Sequence[str], size: int) -> Iterable[list[str]]:
    clean_size = max(1, int(size))
    for index in range(0, len(values), clean_size):
        yield list(values[index:index + clean_size])


def fetch_training_prices(
    tickers: Sequence[str],
    start: date,
    end: date,
    *,
    batch_size: int = 40,
) -> tuple[pd.DataFrame, dict[str, str]]:
    frames: list[pd.DataFrame] = []
    failures: dict[str, str] = {}
    for ticker_batch in batched(list(tickers), batch_size):
        frame, batch_failures = fetch_yahoo_prices(ticker_batch, start, end)
        if not frame.empty:
            frames.append(frame)
        failures.update(batch_failures)
    if not frames:
        return pd.DataFrame(), failures
    output = pd.concat(frames, axis=1, sort=False).sort_index()
    output = output.loc[:, ~output.columns.duplicated(keep="last")]
    output.index = pd.to_datetime(output.index).tz_localize(None)
    output.index.name = "date"
    return output, failures


def sample_standard_deviation(values: np.ndarray) -> float:
    clean = np.asarray(values, dtype=float)
    if clean.size < 2:
        return 0.0
    return float(np.std(clean, ddof=1))


def exponential_moving_average(values: np.ndarray, period: int) -> np.ndarray:
    clean = np.asarray(values, dtype=float)
    if clean.size == 0:
        return clean
    output = np.empty(clean.size, dtype=float)
    alpha = 2.0 / (period + 1.0)
    output[0] = clean[0]
    for index in range(1, clean.size):
        output[index] = (alpha * clean[index]) + ((1.0 - alpha) * output[index - 1])
    return output


def macd_oscillator(prices: np.ndarray) -> np.ndarray:
    logs = np.log(np.asarray(prices, dtype=float))
    fast = exponential_moving_average(logs, 12)
    slow = exponential_moving_average(logs, 26)
    macd = fast - slow
    return macd - exponential_moving_average(macd, 9)


def maximum_drawdown(prices: np.ndarray) -> float:
    peak = float(prices[0])
    drawdown = 0.0
    for value in prices:
        peak = max(peak, float(value))
        drawdown = min(drawdown, (float(value) / peak) - 1.0)
    return drawdown


def pearson(left: np.ndarray, right: np.ndarray) -> float:
    size = min(left.size, right.size)
    if size < 8:
        return 0.0
    left_clean = left[-size:]
    right_clean = right[-size:]
    left_delta = left_clean - np.mean(left_clean)
    right_delta = right_clean - np.mean(right_clean)
    denominator = math.sqrt(max(EPSILON, float(np.sum(left_delta ** 2) * np.sum(right_delta ** 2))))
    return float(np.sum(left_delta * right_delta) / denominator)


def feature_vector(
    prices: np.ndarray,
    market_prices: np.ndarray,
    anchor: int,
    macd: np.ndarray | None = None,
) -> tuple[tuple[float, ...], float, dict[int, float]] | None:
    if anchor < TRADING_DAYS or anchor >= len(prices) or len(market_prices) != len(prices):
        return None
    if not np.all(np.isfinite(prices[anchor - TRADING_DAYS:anchor + 1])):
        return None
    if not np.all(np.isfinite(market_prices[anchor - TRADING_DAYS:anchor + 1])):
        return None
    returns = np.diff(np.log(prices))
    market_returns = np.diff(np.log(market_prices))
    volatility20 = sample_standard_deviation(returns[anchor - 20:anchor])
    volatility63 = sample_standard_deviation(returns[anchor - 63:anchor])
    volatility126 = sample_standard_deviation(returns[anchor - 126:anchor])
    scale = max(0.002, volatility63)
    market_volatility = max(0.002, sample_standard_deviation(market_returns[anchor - 63:anchor]))

    momentum = {
        window: float(math.log(prices[anchor] / prices[anchor - window]))
        for window in (5, 20, 63, 126)
    }
    normalized_return = lambda window: clamp(momentum[window] / (scale * math.sqrt(window)), -4.0, 4.0)
    market_momentum = {
        window: float(math.log(market_prices[anchor] / market_prices[anchor - window]))
        for window in (20, 63, 126)
    }
    market_return = lambda window: clamp(
        market_momentum[window] / (market_volatility * math.sqrt(window)), -4.0, 4.0
    )
    recent = returns[anchor - 63:anchor]
    negative = recent[recent < 0]
    downside = math.sqrt(float(np.mean(negative ** 2))) if negative.size else 0.0
    rsi_returns = returns[anchor - 14:anchor]
    gains = float(np.sum(rsi_returns[rsi_returns >= 0]))
    losses = float(-np.sum(rsi_returns[rsi_returns < 0]))
    rsi = 0.0 if gains + losses < EPSILON else ((gains / (gains + losses)) - 0.5) * 2.0
    stock_relationship = returns[anchor - TRADING_DAYS:anchor]
    market_relationship = market_returns[anchor - TRADING_DAYS:anchor]
    correlation = pearson(stock_relationship, market_relationship)
    market_variance = float(np.var(market_relationship, ddof=1))
    beta = (
        correlation * sample_standard_deviation(stock_relationship) / math.sqrt(market_variance)
        if market_variance > EPSILON
        else 0.0
    )
    downside_indexes = market_relationship < 0
    downside_market = market_relationship[downside_indexes]
    downside_stock = stock_relationship[downside_indexes]
    downside_variance = float(np.var(downside_market, ddof=1)) if downside_market.size > 1 else 0.0
    downside_beta = (
        pearson(downside_stock, downside_market)
        * sample_standard_deviation(downside_stock)
        / math.sqrt(downside_variance)
        if downside_variance > EPSILON
        else beta
    )
    oscillator = macd if macd is not None else macd_oscillator(prices)
    features = (
        normalized_return(5),
        normalized_return(20),
        normalized_return(63),
        normalized_return(126),
        clamp(math.log(max(EPSILON, volatility20) / max(EPSILON, volatility63)), -2.0, 2.0),
        clamp(math.log(max(EPSILON, volatility63) / max(EPSILON, volatility126)), -2.0, 2.0),
        clamp(downside / scale, 0.0, 3.0),
        clamp(maximum_drawdown(prices[anchor - 62:anchor + 1]) / (scale * math.sqrt(63)), -4.0, 0.0),
        clamp(rsi, -1.0, 1.0),
        clamp(float(oscillator[anchor]) / scale, -3.0, 3.0),
        market_return(20),
        market_return(63),
        market_return(126),
        clamp(correlation, -1.0, 1.0),
        clamp(beta, -3.0, 3.0),
        clamp(downside_beta, -3.0, 3.0),
        clamp(normalized_return(63) - market_return(63), -4.0, 4.0),
    )
    if not all(math.isfinite(value) for value in features):
        return None
    return features, scale, momentum


def fallback_prediction(momentum_5: float, volatility: float, horizon: int) -> float:
    multiplier = 0.25 if horizon <= 20 else 0.1
    horizon_limit = 0.08 if horizon <= 20 else (0.15 if horizon <= 63 else 0.25)
    raw = momentum_5 * (horizon / 5.0) * multiplier
    return clamp(
        raw,
        max(-horizon_limit, -volatility * math.sqrt(horizon) * 2.5),
        min(horizon_limit, volatility * math.sqrt(horizon) * 2.5),
    )


def prediction_bound(volatility: float, horizon: int) -> float:
    floor = 0.12 if horizon <= 20 else (0.25 if horizon <= 63 else 0.45)
    return min(0.75, max(floor, volatility * math.sqrt(horizon) * 2.5))


def build_samples(
    prices: pd.DataFrame,
    ticker_markets: dict[str, str],
    horizon: int,
    *,
    sample_step: int = SAMPLE_STEP,
) -> list[TrainingSample]:
    samples: list[TrainingSample] = []
    for ticker, market in ticker_markets.items():
        benchmark = MARKETS.get(market, {}).get("benchmark")
        if ticker not in prices or benchmark not in prices:
            continue
        pair = prices[[ticker, benchmark]].copy()
        pair[benchmark] = pair[benchmark].ffill()
        pair = pair.dropna(subset=[ticker, benchmark])
        if len(pair) < MIN_PRICE_ROWS + horizon:
            continue
        stock = pd.to_numeric(pair[ticker], errors="coerce").to_numpy(dtype=float)
        market_prices = pd.to_numeric(pair[benchmark], errors="coerce").to_numpy(dtype=float)
        dates = pd.DatetimeIndex(pair.index)
        oscillator = macd_oscillator(stock)
        stock_returns = np.diff(np.log(stock))
        action_flags = np.abs(stock_returns) > CORPORATE_ACTION_LOG_RETURN
        action_prefix = np.concatenate(([0], np.cumsum(action_flags.astype(int))))
        for anchor in range(TRADING_DAYS, len(stock) - horizon, max(1, int(sample_step))):
            window_start = max(0, anchor - TRADING_DAYS)
            action_count = action_prefix[anchor + horizon] - action_prefix[window_start]
            if action_count:
                continue
            result = feature_vector(stock, market_prices, anchor, oscillator)
            if result is None:
                continue
            features, volatility, momentum = result
            target = float(math.log(stock[anchor + horizon] / stock[anchor]))
            if not math.isfinite(target):
                continue
            samples.append(TrainingSample(
                ticker=ticker,
                anchor_date=dates[anchor],
                target_date=dates[anchor + horizon],
                features=features,
                target=target,
                baseline=fallback_prediction(momentum[5], volatility, horizon),
                volatility=volatility,
            ))
    return sorted(samples, key=lambda item: (item.anchor_date, item.ticker))


def purged_walk_forward_folds(
    samples: Sequence[TrainingSample],
    *,
    fold_count: int = 3,
    initial_fraction: float = 0.6,
    training_lookback_years: int | None = None,
    validation_dates: Sequence[pd.Timestamp] | None = None,
) -> list[tuple[list[int], list[int]]]:
    unique_dates = sorted({sample.anchor_date for sample in samples})
    minimum_dates = max(8, fold_count * 2)
    if len(unique_dates) < minimum_dates:
        return []
    if validation_dates is None:
        first_validation = max(1, min(len(unique_dates) - fold_count, int(len(unique_dates) * initial_fraction)))
        selected_validation_dates = unique_dates[first_validation:]
    else:
        available = set(unique_dates)
        selected_validation_dates = sorted({
            pd.Timestamp(value) for value in validation_dates if pd.Timestamp(value) in available
        })
    blocks = [list(block) for block in np.array_split(selected_validation_dates, fold_count) if len(block)]
    folds: list[tuple[list[int], list[int]]] = []
    for block in blocks:
        validation_start = block[0]
        validation_end = block[-1]
        training_start = (
            validation_start - pd.DateOffset(years=int(training_lookback_years))
            if training_lookback_years
            else None
        )
        training = [
            index for index, sample in enumerate(samples)
            if sample.target_date < validation_start
            and (training_start is None or sample.anchor_date >= training_start)
        ]
        validation = [
            index for index, sample in enumerate(samples)
            if validation_start <= sample.anchor_date <= validation_end
        ]
        if training and validation:
            folds.append((training, validation))
    return folds


def common_recent_validation_dates(
    samples: Sequence[TrainingSample],
    *,
    validation_years: int = 3,
) -> list[pd.Timestamp]:
    unique_dates = sorted({sample.anchor_date for sample in samples})
    if not unique_dates:
        return []
    cutoff = unique_dates[-1] - pd.DateOffset(years=max(1, int(validation_years)))
    recent = [value for value in unique_dates if value >= cutoff]
    return recent if len(recent) >= 12 else unique_dates[max(1, int(len(unique_dates) * 0.6)):]


def samples_within_lookback(
    samples: Sequence[TrainingSample],
    lookback_years: int,
) -> list[TrainingSample]:
    if not samples:
        return []
    cutoff = max(sample.anchor_date for sample in samples) - pd.DateOffset(years=int(lookback_years))
    return [sample for sample in samples if sample.anchor_date >= cutoff]


def fit_ridge(features: np.ndarray, targets: np.ndarray, ridge_lambda: float) -> dict:
    x = np.asarray(features, dtype=float)
    y = np.asarray(targets, dtype=float)
    means = np.mean(x, axis=0)
    deviations = np.std(x, axis=0, ddof=1)
    deviations = np.where(np.isfinite(deviations) & (deviations > EPSILON), deviations, 1.0)
    standardized = (x - means) / deviations
    design = np.column_stack((np.ones(len(standardized)), standardized))
    penalty = np.eye(design.shape[1]) * float(ridge_lambda)
    penalty[0, 0] = 0.0
    low, high = np.quantile(y, [0.01, 0.99]) if len(y) >= 20 else (float(np.min(y)), float(np.max(y)))
    winsorized = np.clip(y, low, high)
    try:
        coefficients = np.linalg.solve(design.T @ design + penalty, design.T @ winsorized)
    except np.linalg.LinAlgError:
        coefficients = np.linalg.pinv(design.T @ design + penalty) @ design.T @ winsorized
    return {
        "intercept": float(coefficients[0]),
        "coefficients": coefficients[1:],
        "means": means,
        "standard_deviations": deviations,
    }


def ridge_predict(model: dict, features: np.ndarray) -> np.ndarray:
    x = np.asarray(features, dtype=float)
    standardized = (x - model["means"]) / model["standard_deviations"]
    return model["intercept"] + (standardized @ model["coefficients"])


def prediction_metrics(actual: np.ndarray, predicted: np.ndarray, baseline: np.ndarray) -> dict:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    baseline = np.asarray(baseline, dtype=float)
    mae = float(np.mean(np.abs(actual - predicted)))
    baseline_mae = float(np.mean(np.abs(actual - baseline)))
    improvement = 0.0 if baseline_mae <= EPSILON else (baseline_mae - mae) / baseline_mae
    direction = float(np.mean(np.sign(actual) == np.sign(predicted)))
    baseline_direction = float(np.mean(np.sign(actual) == np.sign(baseline)))
    residuals = actual - predicted
    lower, upper = np.quantile(residuals, [0.1, 0.9])
    coverage = float(np.mean((residuals >= lower) & (residuals <= upper)))
    return {
        "mae": mae,
        "baseline_mae": baseline_mae,
        "improvement": improvement,
        "direction_accuracy": direction,
        "baseline_direction_accuracy": baseline_direction,
        "residual_lower": float(lower),
        "residual_upper": float(upper),
        "residual_coverage": coverage,
    }


def model_reliability(metrics: dict, winning_folds: int, fold_count: int, sample_count: int) -> float:
    improvement = float(metrics.get("improvement") or 0.0)
    direction = float(metrics.get("direction_accuracy") or 0.0)
    if improvement <= 0 or direction < 0.5 or fold_count <= 0:
        return 0.0
    improvement_score = clamp(improvement / 0.12, 0.0, 1.0)
    direction_score = clamp((direction - 0.5) / 0.08, 0.0, 1.0)
    consistency_score = clamp(winning_folds / fold_count, 0.0, 1.0)
    sample_score = clamp(sample_count / 3000.0, 0.0, 1.0)
    return clamp(
        ((0.5 * improvement_score) + (0.25 * direction_score) + (0.25 * consistency_score))
        * sample_score,
        0.0,
        1.0,
    )


def train_horizon_model(
    samples: Sequence[TrainingSample],
    horizon: int,
    *,
    training_lookback_years: int | None = None,
    validation_dates: Sequence[pd.Timestamp] | None = None,
) -> dict:
    if len(samples) < 200:
        raise ValueError(f"insufficient {horizon}-day training samples: {len(samples)}")
    folds = purged_walk_forward_folds(
        samples,
        training_lookback_years=training_lookback_years,
        validation_dates=validation_dates,
    )
    if len(folds) < 2:
        raise ValueError(f"insufficient {horizon}-day validation folds")
    candidate_results: list[dict] = []
    for ridge_lambda in RIDGE_LAMBDAS:
        actual_all: list[float] = []
        predicted_all: list[float] = []
        baseline_all: list[float] = []
        winning_folds = 0
        for training_indexes, validation_indexes in folds:
            training = [samples[index] for index in training_indexes]
            validation = [samples[index] for index in validation_indexes]
            model = fit_ridge(
                np.asarray([item.features for item in training]),
                np.asarray([item.target for item in training]),
                ridge_lambda,
            )
            raw = ridge_predict(model, np.asarray([item.features for item in validation]))
            predicted = np.asarray([
                clamp(value, -prediction_bound(item.volatility, horizon), prediction_bound(item.volatility, horizon))
                for value, item in zip(raw, validation)
            ])
            actual = np.asarray([item.target for item in validation])
            baseline = np.asarray([item.baseline for item in validation])
            if np.mean(np.abs(actual - predicted)) < np.mean(np.abs(actual - baseline)):
                winning_folds += 1
            actual_all.extend(actual.tolist())
            predicted_all.extend(predicted.tolist())
            baseline_all.extend(baseline.tolist())
        metrics = prediction_metrics(
            np.asarray(actual_all),
            np.asarray(predicted_all),
            np.asarray(baseline_all),
        )
        candidate_results.append({
            "lambda": ridge_lambda,
            "metrics": metrics,
            "winning_folds": winning_folds,
            "validation_samples": len(actual_all),
        })
    selected = min(
        candidate_results,
        key=lambda item: (item["metrics"]["mae"], -item["metrics"]["direction_accuracy"], item["lambda"]),
    )
    final_samples = (
        samples_within_lookback(samples, training_lookback_years)
        if training_lookback_years
        else list(samples)
    )
    if len(final_samples) < 200:
        raise ValueError(f"insufficient {horizon}-day final training samples: {len(final_samples)}")
    final_model = fit_ridge(
        np.asarray([item.features for item in final_samples]),
        np.asarray([item.target for item in final_samples]),
        selected["lambda"],
    )
    metrics = selected["metrics"]
    reliability = model_reliability(
        metrics,
        selected["winning_folds"],
        len(folds),
        selected["validation_samples"],
    )
    return {
        "horizon_days": horizon,
        "lambda": selected["lambda"],
        "intercept": round(float(final_model["intercept"]), 10),
        "coefficients": [round(float(value), 10) for value in final_model["coefficients"]],
        "means": [round(float(value), 10) for value in final_model["means"]],
        "standard_deviations": [round(float(value), 10) for value in final_model["standard_deviations"]],
        "training_samples": len(final_samples),
        "validation_samples": selected["validation_samples"],
        "validation_folds": len(folds),
        "winning_folds": selected["winning_folds"],
        "metrics": {
            "mae": round(metrics["mae"], 8),
            "baseline_mae": round(metrics["baseline_mae"], 8),
            "improvement": round(metrics["improvement"], 6),
            "direction_accuracy": round(metrics["direction_accuracy"], 6),
            "baseline_direction_accuracy": round(metrics["baseline_direction_accuracy"], 6),
        },
        "residual_interval_80": {
            "lower": round(metrics["residual_lower"], 8),
            "upper": round(metrics["residual_upper"], 8),
            "coverage": round(metrics["residual_coverage"], 6),
        },
        "reliability": round(reliability, 6),
    }


def train_best_lookback_model(
    samples: Sequence[TrainingSample],
    horizon: int,
    *,
    lookback_years: Sequence[int] = LOOKBACK_YEARS,
) -> dict:
    validation_dates = common_recent_validation_dates(samples)
    candidates: list[dict] = []
    for years in lookback_years:
        try:
            model = train_horizon_model(
                samples,
                horizon,
                training_lookback_years=int(years),
                validation_dates=validation_dates,
            )
        except ValueError:
            continue
        candidates.append({"lookback_years": int(years), "model": model})
    if not candidates:
        raise ValueError(f"no valid {horizon}-day lookback candidate")
    selected = min(
        candidates,
        key=lambda item: (
            item["model"]["metrics"]["mae"],
            -item["model"]["metrics"]["direction_accuracy"],
            item["lookback_years"],
        ),
    )
    result = dict(selected["model"])
    result["selected_lookback_years"] = selected["lookback_years"]
    result["lookback_candidates"] = [
        {
            "years": item["lookback_years"],
            "mae": item["model"]["metrics"]["mae"],
            "baseline_mae": item["model"]["metrics"]["baseline_mae"],
            "improvement": item["model"]["metrics"]["improvement"],
            "direction_accuracy": item["model"]["metrics"]["direction_accuracy"],
            "validation_samples": item["model"]["validation_samples"],
        }
        for item in candidates
    ]
    return result


def is_current_month_model(payload: object, today: date | None = None) -> bool:
    if not isinstance(payload, dict) or payload.get("format") != MODEL_FORMAT:
        return False
    try:
        generated = datetime.fromisoformat(str(payload.get("generated_at") or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    current = today or date.today()
    return generated.year == current.year and generated.month == current.month


def read_model(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def build_model_payload(
    universe: dict,
    prices: pd.DataFrame,
    failures: dict[str, str] | None = None,
) -> dict:
    ticker_markets = {
        item["ticker"]: market
        for market, records in universe["markets"].items()
        for item in records
    }
    models: dict[str, dict] = {}
    sample_tickers: set[str] = set()
    for horizon in HORIZONS:
        samples = build_samples(prices, ticker_markets, horizon)
        sample_tickers.update(item.ticker for item in samples)
        models[str(horizon)] = train_best_lookback_model(samples, horizon)
    available_tickers = [ticker for ticker in ticker_markets if ticker in prices and prices[ticker].count() >= MIN_PRICE_ROWS]
    start_date = pd.Timestamp(prices.index.min()).date().isoformat()
    end_date = pd.Timestamp(prices.index.max()).date().isoformat()
    return {
        "format": MODEL_FORMAT,
        "generated_at": utc_stamp(),
        "training_window": {
            "start": start_date,
            "end": end_date,
            "requested_max_calendar_years": max(LOOKBACK_YEARS),
            "available_calendar_years": round(
                (pd.Timestamp(end_date) - pd.Timestamp(start_date)).days / 365.2425,
                2,
            ),
            "candidate_lookback_years": list(LOOKBACK_YEARS),
            "short_listing_policy": "use all available history after 252 feature days plus the forecast horizon",
        },
        "universe": {
            "source": "KRX Open API daily trading information",
            "base_date": universe["base_date"],
            "selection": {market: len(records) for market, records in universe["markets"].items()},
            "tickers": {
                market: [item["ticker"] for item in records]
                for market, records in universe["markets"].items()
            },
            "price_history_available": len(available_tickers),
            "training_tickers": len(sample_tickers),
            "price_fetch_failures": len(failures or {}),
        },
        "feature_schema": {
            "format": FEATURE_FORMAT,
            "names": list(FEATURE_NAMES),
            "target": "forward_log_return",
            "market_mapping": {market: config["benchmark"] for market, config in MARKETS.items()},
        },
        "validation": {
            "method": "common recent three-fold purged walk-forward lookback selection",
            "sample_step_trading_days": SAMPLE_STEP,
            "purge_rule": "training target_date must be earlier than validation anchor_date",
            "baseline": "bounded five-day momentum",
            "candidate_lookback_years": list(LOOKBACK_YEARS),
            "reliability_formula": "positive MAE improvement, direction >= 0.5, fold consistency, sample coverage",
        },
        "horizons": models,
        "limitations": [
            "The current top-market-cap universe introduces survivorship bias.",
            "Corporate-action windows with a daily absolute log return above log(1.5) are excluded.",
            "The model is probabilistic and must not be treated as investment advice.",
        ],
    }


def write_model(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    temporary.replace(path)


def model_payload_passes_validation(payload: object) -> bool:
    if not isinstance(payload, dict) or payload.get("format") != MODEL_FORMAT:
        return False
    horizons = payload.get("horizons")
    if not isinstance(horizons, dict) or set(horizons) != {str(value) for value in HORIZONS}:
        return False
    for horizon in HORIZONS:
        model = horizons.get(str(horizon))
        metrics = model.get("metrics") if isinstance(model, dict) else None
        if not isinstance(metrics, dict):
            return False
        try:
            mae = float(metrics["mae"])
            baseline_mae = float(metrics["baseline_mae"])
            selected_years = int(model["selected_lookback_years"])
        except (KeyError, TypeError, ValueError):
            return False
        if (
            not math.isfinite(mae)
            or not math.isfinite(baseline_mae)
            or mae > baseline_mae
            or selected_years not in LOOKBACK_YEARS
            or int(model.get("validation_folds") or 0) < 2
        ):
            return False
    return True


def build_or_reuse_ai_market_model(
    output_path: Path = DEFAULT_OUTPUT,
    *,
    api_key: str = "",
    client: RetryingHttpClient | None = None,
    today: date | None = None,
    force: bool = False,
) -> tuple[dict, str]:
    existing = read_model(output_path)
    current = today or date.today()
    if not force and is_current_month_model(existing, current):
        return existing, "cached"
    key = str(api_key or resolve_api_key(LOCAL_ENV_FILE, "KRX_API_KEY", "KRX_AUTH_KEY")).strip()
    if not key:
        if existing:
            return existing, "stale-cache"
        raise ValueError("KRX API key is not configured")
    http = client or RetryingHttpClient()
    universe = fetch_top_market_cap_universe(http, key, as_of=current)
    ticker_markets = {
        item["ticker"]: market
        for market, records in universe["markets"].items()
        for item in records
    }
    tickers = list(ticker_markets) + [config["benchmark"] for config in MARKETS.values()]
    start = calendar_years_ago(current, max(LOOKBACK_YEARS))
    prices, failures = fetch_training_prices(tickers, start, current)
    if any(benchmark not in prices for benchmark in ("^KS11", "^KQ11")):
        raise RuntimeError("Yahoo benchmark price history is incomplete")
    payload = build_model_payload(universe, prices, failures)
    if not model_payload_passes_validation(payload):
        if existing:
            return existing, "preserved"
        raise RuntimeError("new AI market model failed baseline validation")
    write_model(output_path, payload)
    return payload, "built"


def main() -> int:
    force = os.environ.get("AI_MODEL_FORCE", "").strip() == "1"
    payload, status = build_or_reuse_ai_market_model(force=force)
    universe = payload.get("universe", {})
    print(
        "AI market model "
        f"{status}: {universe.get('training_tickers', 0)} training tickers, "
        f"base date {universe.get('base_date', 'unknown')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
