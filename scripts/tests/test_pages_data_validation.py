from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from validate_pages_data import validate_source_output_alignment


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


if __name__ == "__main__":
    unittest.main()
