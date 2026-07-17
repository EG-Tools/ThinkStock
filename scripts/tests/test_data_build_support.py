from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from data_build_support import (
    detect_price_rebases,
    disclosure_start_dates,
    incremental_month_code,
    incremental_start_date,
    should_full_rebuild,
)


class DataBuildSupportTests(unittest.TestCase):
    def test_incremental_ranges_keep_overlap_and_full_mode_uses_fallback(self) -> None:
        fallback = date(1996, 1, 1)

        self.assertEqual(
            incremental_start_date("2026-07-17", fallback, 120, False),
            date(2026, 3, 19),
        )
        self.assertEqual(
            incremental_start_date("2026-07-17", fallback, 120, True),
            fallback,
        )
        self.assertEqual(
            incremental_month_code("2026-07-01", "199601", 18, False),
            "202501",
        )

    def test_missing_seed_or_environment_requests_full_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            existing = Path(temp_dir) / "existing.json"
            missing = Path(temp_dir) / "missing.json"
            existing.write_text("{}", encoding="utf-8")
            with patch.dict(os.environ, {"PAGES_FULL_REBUILD": "0"}, clear=False):
                self.assertFalse(should_full_rebuild([existing]))
                self.assertTrue(should_full_rebuild([existing, missing]))
            with patch.dict(os.environ, {"PAGES_FULL_REBUILD": "1"}, clear=False):
                self.assertTrue(should_full_rebuild([existing]))

    def test_price_rebase_detection_catches_split_scale_changes(self) -> None:
        index = pd.to_datetime(["2026-07-13", "2026-07-14", "2026-07-15"])
        seed = pd.DataFrame({"AAA": [1000, 1010, 1020], "BBB": [200, 202, 204]}, index=index)
        live = pd.DataFrame({"AAA": [100, 101, 102], "BBB": [201, 203, 205]}, index=index)

        self.assertEqual(detect_price_rebases(seed, live, ["AAA", "BBB"]), ["AAA"])

    def test_disclosure_ranges_are_calculated_per_ticker(self) -> None:
        starts = disclosure_start_dates(
            [
                {"code": "005930", "date": "2026-07-10"},
                {"ticker": "218410.KQ", "date": "2026-06-01"},
            ],
            ["005930", "218410", "000000"],
            date(2023, 7, 17),
            120,
            False,
        )

        self.assertEqual(starts["005930"], "20260312")
        self.assertEqual(starts["218410"], "20260201")
        self.assertEqual(starts["000000"], "20230717")


if __name__ == "__main__":
    unittest.main()
