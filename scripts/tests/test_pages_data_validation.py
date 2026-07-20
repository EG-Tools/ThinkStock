from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from validate_pages_data import (
    actionable_output_anomalies,
    validate_build_health,
    validate_source_output_alignment,
)


class PagesDataValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.report = {
            "sources": {
                "ecos_news_sentiment": {"rows": 3, "latest": "2026-07-12"},
            },
        }
        self.prices = [
            {"date": "2026-07-10", "^KS11": 3200},
            {"date": "2026-07-13", "^KS11": 3220},
        ]

    def test_rejects_weekend_source_missing_from_next_market_day(self) -> None:
        rows = {
            "prices": self.prices,
            "macro": [
                {"date": "2026-07-10", "news_sentiment": 110.72},
                {"date": "2026-07-13", "news_sentiment": None},
            ],
        }

        with self.assertRaisesRegex(AssertionError, "source/output mismatch"):
            validate_source_output_alignment(self.report, rows)

    def test_accepts_weekend_source_rolled_to_next_market_day(self) -> None:
        rows = {
            "prices": self.prices,
            "macro": [
                {"date": "2026-07-10", "news_sentiment": 110.72},
                {"date": "2026-07-13", "news_sentiment": 110.34},
            ],
        }

        summaries = validate_source_output_alignment(self.report, rows)

        self.assertEqual(summaries, ["source/output ecos_news_sentiment: 2026-07-12 -> 2026-07-13"])

    def test_validates_build_health_metrics(self) -> None:
        report = {
            "sources": {
                f"source_{index}": {
                    "rows": 10,
                    "latest": "2026-07-16",
                    "status": "ok",
                    "duration_ms": index,
                }
                for index in range(5)
            },
            "health": {
                "total_duration_ms": 1250,
                "warnings": [],
                "http": {"requests": 7, "retries": 1, "failures": 0},
            },
        }

        summaries = validate_build_health(report)

        self.assertEqual(summaries[1], "build alerts: none")

    @patch("validate_pages_data.STRICT_FRESHNESS", True)
    def test_strict_build_health_rejects_output_anomalies(self) -> None:
        report = {
            "sources": {
                f"source_{index}": {
                    "rows": 10,
                    "latest": "2026-07-16",
                    "status": "ok",
                    "duration_ms": index,
                }
                for index in range(5)
            },
            "health": {
                "total_duration_ms": 1250,
                "warnings": ["output adr/fear_greed changed"],
                "anomalies": [
                    "output adr/fear_greed: latest value changed 80.0% (50 -> 90)"
                ],
                "http": {"requests": 7, "retries": 1, "failures": 0},
            },
        }

        with self.assertRaisesRegex(AssertionError, "output anomalies detected"):
            validate_build_health(report)

    def test_value_anomaly_filter_allows_custom_stock_rebases(self) -> None:
        anomalies = [
            "output prices/005930.KS: latest value changed 80.0% (70000 -> 14000)",
            "output credit/kospi_credit: latest value changed 40.0% (20 -> 28)",
            "output prices: rows dropped (7000 -> 3000)",
        ]

        actionable = actionable_output_anomalies(anomalies)

        self.assertNotIn(anomalies[0], actionable)
        self.assertIn(anomalies[1], actionable)
        self.assertIn(anomalies[2], actionable)


if __name__ == "__main__":
    unittest.main()
