from __future__ import annotations

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from build_ai_market_model import (
    FEATURE_NAMES,
    HORIZONS,
    LOOKBACK_YEARS,
    MODEL_FORMAT,
    MODEL_BLEND_WEIGHTS,
    TrainingSample,
    apply_feature_transform,
    build_random_feature_transform,
    build_samples,
    calendar_years_ago,
    common_recent_validation_dates,
    is_current_month_model,
    model_payload_passes_validation,
    normalize_market_cap_rows,
    purged_walk_forward_folds,
    samples_within_lookback,
    train_horizon_model,
)


class AiMarketModelTests(unittest.TestCase):
    def test_market_cap_rows_are_deduplicated_ranked_and_limited(self) -> None:
        rows = [
            {"ISU_CD": "005930", "ISU_NM": "Samsung", "MKTCAP": "400,000"},
            {"ISU_CD": "000660", "ISU_NM": "SK hynix", "MKTCAP": "300000"},
            {"ISU_CD": "005930", "ISU_NM": "Samsung", "MKTCAP": "390000"},
            {"ISU_CD": "invalid", "ISU_NM": "Bad", "MKTCAP": "500000"},
        ]

        selected = normalize_market_cap_rows(rows, "KOSPI", limit=2)

        self.assertEqual([item["ticker"] for item in selected], ["005930.KS", "000660.KS"])
        self.assertEqual([item["market_cap"] for item in selected], [400000, 300000])

    def test_purged_folds_keep_training_targets_before_validation(self) -> None:
        samples = []
        start = pd.Timestamp("2020-01-01")
        for index in range(80):
            anchor = start + pd.Timedelta(days=index * 7)
            samples.append(TrainingSample(
                ticker=f"{index % 5:06d}.KS",
                anchor_date=anchor,
                target_date=anchor + pd.Timedelta(days=28),
                features=tuple([float(index % 7)] * len(FEATURE_NAMES)),
                target=0.01,
                baseline=0.0,
                volatility=0.02,
            ))

        folds = purged_walk_forward_folds(samples)

        self.assertEqual(len(folds), 3)
        for training, validation in folds:
            validation_start = min(samples[index].anchor_date for index in validation)
            self.assertTrue(all(samples[index].target_date < validation_start for index in training))

    def test_purged_folds_limit_training_to_candidate_lookback(self) -> None:
        samples = []
        start = pd.Timestamp("2000-01-01")
        for index in range(320):
            anchor = start + pd.Timedelta(days=index * 28)
            samples.append(TrainingSample(
                ticker=f"{index % 5:06d}.KS",
                anchor_date=anchor,
                target_date=anchor + pd.Timedelta(days=21),
                features=tuple([0.0] * len(FEATURE_NAMES)),
                target=0.0,
                baseline=0.0,
                volatility=0.02,
            ))
        validation_dates = common_recent_validation_dates(samples)

        folds = purged_walk_forward_folds(
            samples,
            training_lookback_years=5,
            validation_dates=validation_dates,
        )

        self.assertEqual(len(folds), 3)
        for training, validation in folds:
            validation_start = min(samples[index].anchor_date for index in validation)
            cutoff = validation_start - pd.DateOffset(years=5)
            self.assertTrue(all(samples[index].anchor_date >= cutoff for index in training))
            self.assertTrue(all(samples[index].target_date < validation_start for index in training))

    def test_short_listing_history_is_used_after_feature_window_and_horizon(self) -> None:
        horizon = min(HORIZONS)
        dates = pd.bdate_range("2024-01-02", periods=252 + horizon + 2)
        stock = pd.Series([100.0 + index * 0.1 for index in range(len(dates))], index=dates)
        market = pd.Series([2000.0 + index * 0.2 for index in range(len(dates))], index=dates)
        prices = pd.DataFrame({"123456.KS": stock, "^KS11": market})

        samples = build_samples(prices, {"123456.KS": "KOSPI"}, horizon, sample_step=1)

        self.assertGreater(len(samples), 0)

    def test_lookback_filter_keeps_short_listings_and_limits_long_histories(self) -> None:
        end = pd.Timestamp("2026-01-01")
        samples = [
            TrainingSample(
                ticker="123456.KS",
                anchor_date=end - pd.DateOffset(years=years),
                target_date=end - pd.DateOffset(years=years) + pd.Timedelta(days=20),
                features=tuple([0.0] * len(FEATURE_NAMES)),
                target=0.0,
                baseline=0.0,
                volatility=0.02,
            )
            for years in range(21)
        ]

        selected = samples_within_lookback(samples, 10)

        self.assertTrue(all(item.anchor_date >= end - pd.DateOffset(years=10) for item in selected))
        self.assertEqual(len(selected), 11)
        self.assertEqual(LOOKBACK_YEARS, (5, 10, 15, 25))

    def test_ridge_model_learns_an_out_of_sample_signal(self) -> None:
        samples = []
        start = pd.Timestamp("2018-01-01")
        for date_index in range(120):
            anchor = start + pd.Timedelta(days=date_index * 7)
            for ticker_index in range(5):
                signal = ((date_index % 13) - 6) / 6 + ((ticker_index - 2) * 0.08)
                features = [0.0] * len(FEATURE_NAMES)
                features[0] = signal
                features[2] = signal * 0.4
                target = (signal * 0.06) + (((date_index + ticker_index) % 3) - 1) * 0.001
                samples.append(TrainingSample(
                    ticker=f"{ticker_index:06d}.KS",
                    anchor_date=anchor,
                    target_date=anchor + pd.Timedelta(days=35),
                    features=tuple(features),
                    target=target,
                    baseline=0.0,
                    volatility=0.02,
                ))

        model = train_horizon_model(samples, 20)

        self.assertGreater(model["metrics"]["improvement"], 0.8)
        self.assertGreater(model["metrics"]["direction_accuracy"], 0.9)
        self.assertGreater(model["reliability"], 0.05)
        hidden_size = int((model.get("feature_transform") or {}).get("hidden_size") or 0)
        self.assertEqual(len(model["coefficients"]), len(FEATURE_NAMES) + hidden_size)
        self.assertIn(model["blend_weight"], MODEL_BLEND_WEIGHTS)

    def test_random_feature_transform_is_deterministic_and_preserves_inputs(self) -> None:
        features = np.asarray([[0.1] * len(FEATURE_NAMES), [-0.2] * len(FEATURE_NAMES)])
        first = build_random_feature_transform(8)
        second = build_random_feature_transform(8)

        transformed = apply_feature_transform(features, first)

        self.assertEqual(transformed.shape, (2, len(FEATURE_NAMES) + 8))
        self.assertTrue((transformed[:, :len(FEATURE_NAMES)] == features).all())
        self.assertTrue((first["weights"] == second["weights"]).all())
        self.assertTrue((first["biases"] == second["biases"]).all())

    def test_monthly_cache_requires_matching_schema_and_month(self) -> None:
        payload = {"format": MODEL_FORMAT, "generated_at": "2026-07-02T00:00:00Z"}

        self.assertTrue(is_current_month_model(payload, date(2026, 7, 31)))
        self.assertFalse(is_current_month_model(payload, date(2026, 8, 1)))
        self.assertFalse(is_current_month_model({**payload, "format": "old"}, date(2026, 7, 31)))

    def test_calendar_lookback_handles_leap_day_exactly(self) -> None:
        self.assertEqual(calendar_years_ago(date(2026, 7, 23), 25), date(2001, 7, 23))
        self.assertEqual(calendar_years_ago(date(2024, 2, 29), 5), date(2019, 2, 28))

    def test_payload_validation_rejects_a_model_worse_than_baseline(self) -> None:
        horizons = {
            str(horizon): {
                "selected_lookback_years": 10,
                "validation_folds": 3,
                "blend_weight": 1.0,
                "feature_transform": None,
                "coefficients": [0.0] * len(FEATURE_NAMES),
                "means": [0.0] * len(FEATURE_NAMES),
                "standard_deviations": [1.0] * len(FEATURE_NAMES),
                "metrics": {"mae": 0.1, "baseline_mae": 0.2},
            }
            for horizon in HORIZONS
        }
        payload = {"format": MODEL_FORMAT, "horizons": horizons}

        self.assertTrue(model_payload_passes_validation(payload))
        horizons["63"]["metrics"]["mae"] = 0.3
        self.assertFalse(model_payload_passes_validation(payload))


if __name__ == "__main__":
    unittest.main()
